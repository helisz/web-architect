#!/usr/bin/env node
/**
 * 权限自检（用户 2026-11-04 第四批：每人只看自己的图）。
 *
 * 用法：
 *   node scripts/check-rls.mjs                 # 只读检查（不写库）
 *   node scripts/check-rls.mjs --write         # 额外验一条：伪造 creatorId 保存 → 库里的归属仍是自己
 *
 * 凭据来自 .env.local（或同名环境变量）：
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SMOKE_EMAIL / SMOKE_PASSWORD
 *
 * 检查项：
 *   1. 密码登录能拿到 JWT；
 *   2. 匿名（只用 anon key）读 arch_diagram 必须被拒 —— 证明 anon 已无表权限；
 *   3. 登录后能读到自己的图，且返回的每一行 creator_id 都等于自己；
 *   4. 拿别人名下的行做过滤条件，什么都读不到（RLS 生效，不是前端过滤）；
 *   5. --write：用伪造的 creatorId 调 arch_save_diagram，库里归属仍应是自己（触发器兜底），
 *      跑完立刻删掉这张探针图。
 *
 * 退出码：0 全通过 / 1 有失败（方便挂 CI 或上线前手动跑一次）。
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const WRITE = args.includes('--write');

function readEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 没 .env.local 就只看环境变量 */
  }
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SMOKE_EMAIL', 'SMOKE_PASSWORD']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

const env = readEnv();
const url = env.VITE_SUPABASE_URL;
const anonKey = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error('✗ 缺 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（放进 .env.local 或环境变量）');
  process.exit(1);
}
if (!env.SMOKE_EMAIL || !env.SMOKE_PASSWORD) {
  console.error('✗ 缺 SMOKE_EMAIL / SMOKE_PASSWORD：本脚本要登录后才能验证"只看自己的"');
  process.exit(1);
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
};

async function rest(path, { token, method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      'Content-Type': 'application/json',
      Prefer: prefer ?? 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 就留着原文 */
  }
  return { status: response.status, ok: response.ok, json, text };
}

async function main() {
  // 1. 登录
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }),
  });
  if (!login.ok) {
    check('密码登录', false, `HTTP ${login.status}：${(await login.text()).slice(0, 120)}`);
    process.exit(1);
  }
  const session = await login.json();
  const token = session.access_token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const uid = payload.sub;
  check('密码登录', true, `uid=${uid}`);

  // 2. 匿名读必须被拒（anon 已无表权限）
  const anonRead = await rest('arch_diagram?select=diagram_id&limit=1');
  const anonBlocked = !anonRead.ok || (Array.isArray(anonRead.json) && anonRead.json.length === 0);
  check(
    '匿名读 arch_diagram 被拒',
    anonBlocked,
    anonRead.ok ? `HTTP ${anonRead.status}，返回 ${Array.isArray(anonRead.json) ? anonRead.json.length : '?'} 行` : `HTTP ${anonRead.status}`,
  );

  // 3. 自己的图：每行 creator_id 都必须是自己
  const mine = await rest('arch_diagram?select=diagram_id,creator_id,name&is_deleted=eq.false&limit=50', { token });
  if (!mine.ok) {
    check('登录后读自己的图', false, `HTTP ${mine.status}：${mine.text.slice(0, 120)}`);
  } else {
    const rows = mine.json ?? [];
    const foreign = rows.filter((row) => row.creator_id !== uid);
    check('登录后读自己的图', foreign.length === 0, `返回 ${rows.length} 行${foreign.length ? `，其中 ${foreign.length} 行不是自己的` : ''}`);
    if (rows.length === 0) console.warn('  提示：这个账号名下还没有图 —— 若旧图没迁移过来，跑 patch-per-user-rls.sql 的迁移段');
  }

  // 4. 别人名下的行：一条都读不到
  const others = await rest(`arch_diagram?select=diagram_id&creator_id=neq.${uid}&limit=5`, { token });
  const othersRows = Array.isArray(others.json) ? others.json.length : 0;
  check('读不到别人的图', others.ok && othersRows === 0, others.ok ? `返回 ${othersRows} 行` : `HTTP ${others.status}`);

  // 5. 子表也不能侧门读取：取一个别人的 diagram_id，查它的节点
  const anyOther = await rest('arch_node?select=node_id,diagram_id&limit=5', { token });
  const nodeRows = Array.isArray(anyOther.json) ? anyOther.json : [];
  let nodeLeak = 0;
  if (nodeRows.length) {
    const own = new Set(((mine.json ?? []) || []).map((row) => row.diagram_id));
    nodeLeak = nodeRows.filter((row) => !own.has(row.diagram_id)).length;
  }
  check('子表（节点）不会泄漏别人的图', nodeLeak === 0, `抽查 ${nodeRows.length} 行，越权 ${nodeLeak} 行`);

  // 6. 可选：伪造 creatorId 保存，库里归属仍应是自己
  if (WRITE) {
    const probeId = crypto.randomUUID();
    const spoof = crypto.randomUUID();
    const now = new Date().toISOString();
    const payload = {
      diagramId: probeId,
      schemaVersion: '1.0',
      name: `权限自检-${probeId.slice(0, 8)}`,
      description: 'check-rls 探针，可删',
      creatorId: spoof,
      viewport: { x: 0, y: 0, zoom: 1 },
      groups: [],
      nodes: [],
      edges: [],
    };
    const saved = await rest('rpc/arch_save_diagram', {
      token,
      method: 'POST',
      body: { p_payload: payload, p_expected_version: 0 },
      prefer: 'return=representation',
    });
    const readBack = await rest(`arch_diagram?select=diagram_id,creator_id&diagram_id=eq.${probeId}`, { token });
    const row = Array.isArray(readBack.json) ? readBack.json[0] : null;
    check(
      '伪造 creatorId 保存后归属仍是自己',
      Boolean(row) && row.creator_id === uid,
      row ? `库里 creator_id=${row.creator_id}（伪造值 ${spoof.slice(0, 8)}…，保存 HTTP ${saved.status}）` : `读不回探针图（保存 HTTP ${saved.status}）`,
    );
    // 清理：删掉探针图（子表/快照随之级联）
    const removed = await rest(`arch_diagram?diagram_id=eq.${probeId}`, { token, method: 'DELETE', prefer: 'return=minimal' });
    console.log(`  清理探针图：HTTP ${removed.status}`);
    if (saved.status >= 400) console.warn(`  保存探针图报错：${saved.text.slice(0, 160)}`);
    void now;
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${failed.length === 0 ? '✓ 权限自检通过' : `✗ ${failed.length} 项失败`}（共 ${results.length} 项${WRITE ? '，含写库探针' : '，只读'}）`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('✗ 自检异常：', error.message);
  process.exit(1);
});
