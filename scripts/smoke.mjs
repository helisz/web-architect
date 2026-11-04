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
 *
 * 登录（用户 2026-11-04 第三批）：RLS 收紧到 authenticated 之后，匿名读不到任何图。
 * 在 .env.local 里加两行（或直接用同名环境变量）脚本会自动登录：
 *   SMOKE_EMAIL=you@example.com
 *   SMOKE_PASSWORD=******
 * 没配的话：只校验登录页能出来，画布相关的断言跳过（退出码仍是 0，但会打印提示）。
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
/** 环境变量：.env.local + process.env（后者优先） */
function readEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 没有 .env.local 也没关系 */
  }
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SMOKE_EMAIL', 'SMOKE_PASSWORD']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

/** 密码登录换 access token；没配就退回 anon key（老库 RLS 还没收紧时照样能用） */
async function accessToken(env) {
  if (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD) return env.VITE_SUPABASE_ANON_KEY;
  const response = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }),
  });
  if (!response.ok) {
    console.warn('提示：SMOKE_EMAIL 登录失败，改用匿名 key 读库 —— RLS 收紧后会读不到图');
    return env.VITE_SUPABASE_ANON_KEY;
  }
  const body = await response.json();
  return body.access_token ?? env.VITE_SUPABASE_ANON_KEY;
}

/**
 * 从 .env.local 读 Supabase 配置，挑一张**有节点**的图来测。
 *
 * 只按 updated_at 取最近一张是不够的：库里经常躺着一张刚新建的空图，
 * 拿它去测会得到"图里没有节点"的假失败。这里最多看 5 张，取第一个非空的。
 */
async function resolveDiagramId() {
  const explicit = getArg('diagram', '');
  if (explicit) return explicit;

  const env = readEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return '';
  const token = await accessToken(env);
  const headers = { apikey: key, Authorization: `Bearer ${token}` };

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

/**
 * 新开一个空白标签页并返回它的 target 描述。
 *
 * 新版 Chrome 要求 `PUT /json/new`，老版本用 GET；两种都试，失败才报错 ——
 * 无论如何都不碰用户已经开着的页面。
 */
async function openOwnTab() {
  for (const method of ['PUT', 'GET']) {
    try {
      const response = await fetch(`${CDP}/json/new?about:blank`, { method });
      if (!response.ok) continue;
      const target = await response.json();
      if (target?.id && target.webSocketDebuggerUrl) return target;
    } catch {
      /* 换下一种方法 */
    }
  }
  throw new Error('开不出新的调试标签页，先启动带 --remote-debugging-port 的浏览器');
}

async function main() {
  const diagramId = await resolveDiagramId();
  const stamp = Date.now();
  const TARGET_URL = getArg(
    'url',
    diagramId ? `${BASE_URL}/?smoke=${stamp}#/d/${diagramId}` : `${BASE_URL}/?smoke=${stamp}`,
  );

  // 自己开一个标签页，**绝不复用**用户正开着的画布：复用了会在结束时把它一起关掉，
  // 用户没保存的编辑就没了（2026-11-04 真的踩到过）。
  const page = await openOwnTab();
  const closeTab = async () => {
    try {
      await fetch(`${CDP}/json/close/${page.id}`);
    } catch {
      /* 关不掉就算了，不影响结论 */
    }
  };

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

  /**
   * 登录闸门（用户 2026-11-04 第三批）：RLS 收紧后，没会话只能看到登录页。
   * 配了 SMOKE_EMAIL / SMOKE_PASSWORD 就自动填表登录；没配则明确报错而不是含糊失败。
   */
  const env = readEnv();
  const loginState = await evaluate(`(async () => {
    const email = document.querySelector('input[name="email"]');
    if (!email) return 'already-in';
    return 'needs-login';
  })()`);
  if (loginState === 'needs-login') {
    if (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD) {
      console.warn('提示：页面停在登录页，且没有 SMOKE_EMAIL / SMOKE_PASSWORD，跳过画布断言');
    } else {
      await evaluate(`(async () => {
        const setValue = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        setValue(document.querySelector('input[name="email"]'), ${JSON.stringify(env.SMOKE_EMAIL)});
        setValue(document.querySelector('input[name="password"]'), ${JSON.stringify(env.SMOKE_PASSWORD)});
        await new Promise((r) => setTimeout(r, 120));
        document.querySelector('form button[type="submit"]').click();
        await new Promise((r) => setTimeout(r, 2500));
        return document.querySelector('input[name="email"]') ? 'still-out' : 'in';
      })()`);
      await sleep(3000);
    }
  }

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
  // 登录页模式：没凭据就没法进画布，这里只确认登录页本身是好的
  const loginOnly = loginState === 'needs-login' && (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD);
  const stuckAtLogin = loginState === 'needs-login' && Boolean(env.SMOKE_EMAIL);

  if (loginOnly) {
    const hasLoginForm = await evaluate(`Boolean(document.querySelector('input[name="email"]') && document.querySelector('input[name="password"]'))`);
    if (!hasLoginForm) failures.push('登录页没有渲染出邮箱 / 密码输入框');
  } else {
    if (!diagramId) {
      failures.push('没找到要测的图：传 --diagram <id>，或在 .env.local 里配好 Supabase 且库里至少有一张图');
    }
    if (stuckAtLogin) failures.push('自动登录失败：SMOKE_EMAIL / SMOKE_PASSWORD 不对，或 RLS 收紧后没权限');
    if (!state.hasCanvas) failures.push('画布没渲染出来（找不到 .react-flow__viewport）');
    if (state.bootError) failures.push(`启动报错：${state.bootError}`);
    if (state.hasStore) {
      if (state.nodes < 1) failures.push('图里没有节点（载入异常或库是空的）');
      if (state.nodes > 0 && state.renderedNodes === 0) failures.push('store 里有节点但画布一个都没渲染');
    } else {
      console.warn('提示：生产包没挂 __archStore，只校验画布存在（加 ?testhook 可校验数据）');
    }
  }
  if (errors.length) failures.push(`控制台异常 ${errors.length} 条：${errors[0]}`);

  console.log('目标：', TARGET_URL);
  console.log('状态：', JSON.stringify(state));
  if (loginOnly) console.log('模式：仅校验登录页（没配 SMOKE_EMAIL / SMOKE_PASSWORD）');
  if (failures.length) {
    for (const line of failures) console.error('✗', line);
    ws.close();
    await closeTab();
    process.exit(1);
  }
  console.log('✓ 冒烟通过');
  ws.close();
  await closeTab();
}

main().catch((error) => {
  console.error('✗ 冒烟失败：', error.message);
  process.exit(1);
});