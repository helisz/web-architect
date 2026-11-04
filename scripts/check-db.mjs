/**
 * 连通性自检：确认 .env.local 里的 Supabase 项目可用、schema 已生效、RLS 放行。
 *
 * 运行：npm run check:db
 *
 * 只用前端那个 anon key（匿名身份）检查，不接触 service_role：
 *   - REST(PostgREST) 可达
 *   - 5 张 arch_* 表存在且可读
 *   - 匿名写入被放行（本项目没有后端，写权限必须给 anon，见 ADR-0004）
 *   - 写入探测用「故意违反 CHECK 约束的整行」→ 期望 400（说明 RLS 过了、只是数据不合法），
 *     这样不会在库里留下垃圾数据。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(name) {
  const text = readFileSync(join(root, name), 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    if (existsSync(join(root, name))) return { name, env: loadEnvFile(name) };
  }
  console.error('✗ 找不到 .env.local（也没有 .env）');
  console.error('  先执行：copy .env.example .env.local  然后填入两个 VITE_SUPABASE_* 变量');
  process.exit(1);
}

const { name: envFile, env } = loadEnv();
const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = env.VITE_SUPABASE_ANON_KEY ?? '';

if (!url || !key) {
  console.error(`✗ ${envFile} 里缺 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY`);
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

let failed = 0;
function report(ok, name, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { headers, ...init });
  return { status: response.status, text: await response.text() };
}

console.log(`\n配置文件：${envFile}`);
console.log(`项目：${url}\n`);

// 1. 可达性（能收到任何 HTTP 响应就算通；表未建时这里会是 404）
try {
  const ping = await rest('arch_diagram?select=diagram_id&limit=1');
  report(true, 'PostgREST 可达', `HTTP ${ping.status === 404 ? '404（服务在，表还没建）' : ping.status}`);
} catch (error) {
  report(false, 'PostgREST 可达', `${error.message}（检查 URL 是否正确、项目是否被暂停）`);
}

// 2. 五张表存在且可读
const tables = ['arch_diagram', 'arch_group', 'arch_node', 'arch_edge', 'arch_snapshot'];
for (const table of tables) {
  const { status, text } = await rest(`${table}?select=*&limit=1`);
  if (status === 200) {
    let rows = [];
    try {
      rows = JSON.parse(text);
    } catch {
      /* 忽略 */
    }
    report(true, `${table} 可读`, `${rows.length} 行（limit 1）`);
  } else if (/PGRST205|does not exist|schema cache/i.test(text)) {
    report(false, `${table} 可读`, '表不存在 → 把 supabase/schema.sql 全文粘进 SQL Editor 跑一遍');
  } else {
    report(false, `${table} 可读`, `status ${status}: ${text.slice(0, 120)}`);
  }
}

// 3. 匿名写必须被「放行」（本项目无后端，写全靠 anon key）
//    故意违反 arch_ck_viewport_zoom（zoom 必须在 0.1–4），期望 400：说明 RLS 放行了写，只是数据不合法。
const probeId = '00000000-0000-4000-8000-00000000dead';
const writeProbe = await rest('arch_diagram', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({
    diagram_id: probeId,
    name: 'probe-should-fail',
    creator_id: 'check-db',
    viewport_zoom: 99,
  }),
});

if (writeProbe.status === 400) {
  report(true, '匿名写入被 RLS 放行', '约束拦下了探测数据（400），说明写权限正常');
} else if (writeProbe.status === 401 || writeProbe.status === 403 || /row-level security|permission denied/i.test(writeProbe.text)) {
  report(false, '匿名写入被 RLS 放行', `status ${writeProbe.status} → RLS/授权拦住了 anon，保存会失败，重跑 schema.sql 的第 8 段`);
} else if (writeProbe.status === 201 || writeProbe.status === 200) {
  report(false, '匿名写入被 RLS 放行', '约束没生效（探测行竟然写进去了）→ 检查 arch_ck_viewport_zoom 是否存在');
} else {
  report(false, '匿名写入被 RLS 放行', `status ${writeProbe.status}: ${writeProbe.text.slice(0, 120)}`);
}

// 4. 约束确实存在（用另一条违规数据验证 not-null 之外的检查）
const nodeProbe = await rest('arch_node', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ node_id: probeId, diagram_id: probeId, node_type: 'K8s Cluster', x: 0, y: 0 }),
});
report(
  nodeProbe.status === 400 && /check constraint/i.test(nodeProbe.text),
  'arch_ck_node_type 生效',
  nodeProbe.status === 400 ? '大写/空格被拒' : `status ${nodeProbe.status}（期望 400）`,
);

// 5. 保存函数存在且可执行（前端所有写入都走它）
//    故意传空 payload：函数应当以「payload 缺少 diagramId」拒绝（HTTP 400），
//    说明函数在、权限在；若返回 404/PGRST202 说明 schema.sql 只跑了建表、没跑函数。
const rpcProbe = await fetch(`${url}/rest/v1/rpc/arch_save_diagram`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_payload: {}, p_base_version: null }),
});
const rpcText = await rpcProbe.text();
if (rpcProbe.status === 400 && /diagramId/i.test(rpcText)) {
  report(true, 'arch_save_diagram 函数可用', '空 payload 被正确拒绝（400）');
} else if (rpcProbe.status === 404 || /PGRST202|Could not find the function/i.test(rpcText)) {
  report(false, 'arch_save_diagram 函数可用', '函数不存在 → 重跑 supabase/schema.sql（第 9 段）');
} else {
  report(false, 'arch_save_diagram 函数可用', `status ${rpcProbe.status}: ${rpcText.slice(0, 120)}`);
}

console.log('');
if (failed > 0) {
  console.error(`✗ ${failed} 项未通过：先按 README「建库」把 supabase/schema.sql 跑完再试\n`);
  process.exit(1);
}
console.log('✓ 全部通过：项目可达、5 张表已建、RLS 放行 anon 读写、保存函数可用\n');
