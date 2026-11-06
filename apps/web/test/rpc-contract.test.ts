import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createEdge,
  createEmptyDiagram,
  createNode,
  createZoneGroup,
  diagramStats,
} from '@arch/schema';

/**
 * RPC 契约测试：不依赖浏览器，直接用 supabase 同样的 HTTP 形状打 PostgREST。
 *
 * 默认跳过；本地起了 PostgREST 才跑：
 *   $env:POSTGREST_URL='http://127.0.0.1:55434'; $env:POSTGREST_JWT_SECRET='...'; npm test
 *
 * 它验证两件容易错、且只有真打一次才知道的事：
 *   1. 前端 toSavePayload 的字段名与 arch_save_diagram 的 jsonb 解析完全对得上；
 *   2. 返回结构（diagramId/version/savedAt/snapshot）与前端解析一致。
 */

const BASE = process.env.POSTGREST_URL ?? '';
const SECRET = process.env.POSTGREST_JWT_SECRET ?? '';
const ENABLED = Boolean(BASE && SECRET);

function b64url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** 造一个 PostgREST 认的 anon JWT（真实环境这一项由 Supabase 签发） */
function anonJwt(): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ role: 'anon' }));
  const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(signature)}`;
}

/** PostgREST 既可能返回单对象（标量函数），也可能返回数组，两种都要吃 */
function pick(body: unknown): unknown {
  return Array.isArray(body) ? body[0] : body;
}

const headers = (): Record<string, string> => {
  const token = anonJwt();
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

async function rpc(payload: unknown, baseVersion: number | null): Promise<Response> {
  return fetch(`${BASE}/rpc/arch_save_diagram`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_payload: payload, p_base_version: baseVersion }),
  });
}

describe.skipIf(!ENABLED)('arch_save_diagram 与前端 payload 的契约', () => {
  it('前端构造的 payload 能存进库，返回结构与解析一致', async () => {
    const diagram = createEmptyDiagram({ name: '契约测试图' });
    const group = createZoneGroup(diagram.diagramId, 'dmz', { x: 0, y: 0 });
    const waf = createNode('firewall', diagram.diagramId, { x: 10, y: 20 }, { label: 'WAF-1' });
    const db = createNode('db', diagram.diagramId, { x: 40, y: 40 }, { label: 'MySQL' });
    db.groupId = group.groupId;

    const withChildren = {
      ...diagram,
      groups: [group],
      nodes: [waf, db],
      edges: [createEdge(diagram.diagramId, waf.nodeId, db.nodeId, { sourceAnchor: 'right', targetAnchor: 'left' })],
      viewport: { x: 12, y: 34, zoom: 1.25 },
    };

    // 与 diagramRepo.toSavePayload 相同的裁剪规则
    const payload = {
      diagramId: withChildren.diagramId,
      schemaVersion: withChildren.schemaVersion,
      name: withChildren.name,
      description: withChildren.description,
      creatorId: withChildren.creatorId,
      viewport: withChildren.viewport,
      groups: withChildren.groups.map((g) => ({
        groupId: g.groupId,
        parentGroupId: g.parentGroupId ?? null,
        label: g.label,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        bgColor: g.bgColor,
        borderColor: g.borderColor,
        titleColor: g.titleColor,
        collapsed: g.collapsed,
        sort: g.sort,
        extJson: g.extJson ?? null,
      })),
      nodes: withChildren.nodes.map((n) => ({
        nodeId: n.nodeId,
        groupId: n.groupId ?? null,
        label: n.label,
        subLabel: n.subLabel,
        nodeType: n.nodeType,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height,
        bgColor: n.bgColor,
        borderColor: n.borderColor,
        textColor: n.textColor,
        locked: n.locked,
        visible: n.visible,
        sort: n.sort,
        extJson: n.extJson ?? null,
      })),
      edges: withChildren.edges.map((e) => ({
        edgeId: e.edgeId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label ?? null,
        strokeColor: e.strokeColor,
        strokeWidth: e.strokeWidth,
        strokeDasharray: e.strokeDasharray ?? null,
        edgeType: e.edgeType,
        arrow: e.arrow,
        sourceAnchor: e.sourceAnchor ?? null,
        targetAnchor: e.targetAnchor ?? null,
        sort: e.sort,
        extJson: e.extJson ?? null,
      })),
    };

    const first = await rpc(payload, null);
    expect(first.status, await first.clone().text()).toBe(200);
    const result = pick(await first.json()) as { version: number; snapshot: boolean };
    expect(result.version).toBe(1);
    expect(result.snapshot).toBe(true);

    // 读回来核对：分组/节点/连线都在，extJson 的 iconKey 没丢
    const nodesRes = await fetch(
      `${BASE}/arch_node?diagram_id=eq.${diagram.diagramId}&select=label,ext_json,group_id`,
      { headers: headers() },
    );
    const nodes = (await nodesRes.json()) as Array<{ label: string; ext_json: { iconKey: string } | null; group_id: string | null }>;
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.label === 'WAF-1')?.ext_json?.iconKey).toBe('tabler:shield-lock');
    expect(nodes.find((n) => n.label === 'MySQL')?.group_id).toBe(group.groupId);

    const edgesRes = await fetch(`${BASE}/arch_edge?diagram_id=eq.${diagram.diagramId}&select=edge_id`, {
      headers: headers(),
    });
    expect((await edgesRes.json()) as unknown[]).toHaveLength(1);

    const masterRes = await fetch(
      `${BASE}/arch_diagram?diagram_id=eq.${diagram.diagramId}&select=version,viewport_zoom,viewport_x`,
      { headers: headers() },
    );
    const master = pick(await masterRes.json()) as { version: number; viewport_zoom: number; viewport_x: number };
    expect(master.version).toBe(1);
    expect(master.viewport_zoom).toBe(1.25);
    expect(master.viewport_x).toBe(12);

    // 第二次保存：基线正确 → 版本 +1
    const second = await rpc(payload, 1);
    expect(second.status).toBe(200);
    const result2 = pick(await second.json()) as { version: number };
    expect(result2.version).toBe(2);

    // 旧基线 → 冲突（错误信息含 VERSION_CONFLICT，前端靠它识别）
    const conflict = await rpc(payload, 1);
    expect(conflict.status).toBeGreaterThanOrEqual(400);
    expect(await conflict.text()).toContain('VERSION_CONFLICT');

    // 统计口径与库内一致
    const stats = diagramStats(withChildren);
    expect(stats.nodeCount).toBe(2);
    expect(stats.edgeCount).toBe(1);
    expect(stats.groupCount).toBe(1);
  });
});

