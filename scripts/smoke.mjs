#!/usr/bin/env node
/**
 * 冒烟脚本（D1）：用 CDP 打开跑着的页面，确认"能启动 + 能载入图 + 没有报错"。
 *
 * 用法：
 *   node scripts/smoke.mjs                       # 默认 dev server http://127.0.0.1:5273
 *   node scripts/smoke.mjs --url http://127.0.0.1:5274/?testhook --port 9335
 *
 * 前置：浏览器用 `--remote-debugging-port=9335` 启动，且页面已经连上 Supabase。
 * 检查项：store 里有一张非空图、画布渲染出节点、控制台无 exception。
 * 退出码：0 通过 / 1 失败（方便挂到 CI 或 pre-push）。
 */
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const CDP = `http://127.0.0.1:${getArg('port', '9335')}`;
const TARGET_URL = getArg('url', 'http://127.0.0.1:5273/?smoke=1');
const TIMEOUT_MS = Number(getArg('timeout', '45000'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
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
