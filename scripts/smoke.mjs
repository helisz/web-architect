#!/usr/bin/env node
/**
 * 冒烟脚本（D1）：用 CDP 打开跑着的页面，确认"能启动 + 能载入图 + 没有报错"。
 *
 * 用法：
 *   node scripts/smoke.mjs                       # 自动取库里最近一张图，打开 #/d/<id>
 *   node scripts/smoke.mjs --diagram <id>        # 指定图
 *   node scripts/smoke.mjs --url http://127.0.0.1:5274/?testhook --port 9335
 *
 * 前置：浏览器用 `--remote-debugging-port=9335` 启动，且页面已经连上 Supabase。
 * 检查项：store 里有一张非空图、画布渲染出节点、控制台无 exception。
 *
 * 为什么不再直接打开根路径：根路径是图库（用户 2026-11-04 定稿），没有画布。
 * 退出码：0 通过 / 1 失败（方便挂到 CI 或 pre-push）。
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const CDP = `http://127.0.0.1:${getArg('port', '9335')}`;
const BASE_URL = getArg('base', 'http://127.0.0.1:5273');
const TIMEOUT_MS = Number(getArg('timeout', '45000'));

/**
 * 从 .env.local 读 Supabase 配置，挑一张**有节点**的图来测。
 *
 * 只按 updated_at 取最近一张是不够的：库里经常躺着一张刚新建的空图，
 * 拿它去测会得到"图里没有节点"的假失败。这里最多看 5 张，取第一个非空的。
 */
async function resolveDiagramId() {
  const explicit = getArg('diagram', '');
  if (explicit) return explicit;

  const env = {};
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    return '';
  }
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return '';
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const listResponse = await fetch(
    `${url}/rest/v1/arch_diagram?select=diagram_id&is_deleted=eq.false&order=updated_at.desc&limit=5`,
    { headers },
  );
  if (!listResponse.ok) return '';
  const rows = await listResponse.json();

  for (const row of rows ?? []) {
    const nodeResponse = await fetch(
      `${url}/rest/v1/arch_node?select=node_id&diagram_id=eq.${row.diagram_id}&is_deleted=eq.false&limit=1`,
      { headers },
    );
    if (!nodeResponse.ok) continue;
    const nodes = await nodeResponse.json();
    if (Array.isArray(nodes) && nodes.length > 0) return row.diagram_id;
  }
  return rows?.[0]?.diagram_id ?? '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const diagramId = await resolveDiagramId();
  const stamp = Date.now();
  const TARGET_URL = getArg(
    'url',
    diagramId ? `${BASE_URL}/?smoke=${stamp}#/d/${diagramId}` : `${BASE_URL}/?smoke=${stamp}`,
  );

  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的页面目标，先启动带 --remote-debugging-port 的浏览器');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let id = 1;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(String(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 200));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(`console.error: ${String(message.params.args?.[0]?.value ?? '').slice(0, 160)}`);
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id: id++, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: TIMEOUT_MS,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? '页面执行异常');
    return result.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.bringToFront');
  // **绝对不写库**：这个脚本打开的是库里真实的图，如果浏览器里还留着不匹配的草稿，
  // 页面会变"脏"从而自动保存，把用户的版本号白白 +1。这里把两个保存 RPC 拦下来，
  // 顺便把草稿/视口的 localStorage 写入也关掉，让冒烟彻底只读。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        const originalFetch = window.fetch;
        window.__smoke = { blocked: 0 };
        window.fetch = function (input, init) {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (/arch_save_diagram|arch_patch_diagram/.test(url)) {
            window.__smoke.blocked += 1;
            const body = { diagramId: null, version: 1, savedAt: new Date().toISOString(), snapshot: null };
            return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
          return originalFetch.call(window, input, init);
        };
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (typeof key === 'string' && (key.startsWith('arch:draft:') || key.startsWith('arch:viewport:'))) return;
          return originalSetItem.call(this, key, value);
        };
      })();
    `,
  });
  // 目标页可能是上次跑过的同一 URL：同样的地址 Chrome 可能当成原地导航而不重载，
  // 于是 Vite HMR 留下的旧模块状态（含"hook 顺序变了"这类历史报错）会被算到这次头上。
  // 加个时间戳强制换地址，并且只从这次导航之后开始收错误。
  await send('Runtime.discardConsoleEntries');
  errors.length = 0;
  await send('Page.navigate', { url: TARGET_URL });
  await sleep(Number(getArg('wait', '7000')));

  const state = await evaluate(`(() => {
    const store = window.__archStore;
    const canvas = document.querySelector('.react-flow__viewport');
    const diagram = store ? store.getState().diagram : null;
    return {
      hasStore: Boolean(store),
      hasCanvas: Boolean(canvas),
      nodes: diagram ? diagram.nodes.length : -1,
      edges: diagram ? diagram.edges.length : -1,
      renderedNodes: document.querySelectorAll('.react-flow__node').length,
      bootError: store ? store.getState().bootError : null,
      title: document.title,
    };
  })()`);

  const failures = [];
  if (!diagramId) {
    failures.push('没找到要测的图：传 --diagram <id>，或在 .env.local 里配好 Supabase 且库里至少有一张图');
  }
  if (!state.hasCanvas) failures.push('画布没渲染出来（找不到 .react-flow__viewport）');
  if (state.bootError) failures.push(`启动报错：${state.bootError}`);
  if (state.hasStore) {
    if (state.nodes < 1) failures.push('图里没有节点（载入异常或库是空的）');
    if (state.nodes > 0 && state.renderedNodes === 0) failures.push('store 里有节点但画布一个都没渲染');
  } else {
    console.warn('提示：生产包没挂 __archStore，只校验画布存在（加 ?testhook 可校验数据）');
  }
  if (errors.length) failures.push(`控制台异常 ${errors.length} 条：${errors[0]}`);

  console.log('目标：', TARGET_URL);
  console.log('状态：', JSON.stringify(state));
  if (failures.length) {
    for (const line of failures) console.error('✗', line);
    ws.close();
    process.exit(1);
  }
  console.log('✓ 冒烟通过');
  ws.close();
}

main().catch((error) => {
  console.error('✗ 冒烟失败：', error.message);
  process.exit(1);
});
