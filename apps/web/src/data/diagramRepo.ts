import {
  TABLES,
  assembleDiagram,
  parseDiagram,
  validateDiagram,
  type ArchitectureDiagram,
  type DiagramEdgeRow,
  type DiagramGroupRow,
  type DiagramMasterRow,
  type DiagramNodeRow,
  type ValidationIssue,
} from '@arch/schema';
import { supabase } from '../lib/supabase.js';
import type { PayloadPatch } from './payloadDiff.js';
import { reissueIds } from './transfer.js';

/**
 * 数据访问层：浏览器 → Supabase PostgREST。
 *
 * 没有自建后端，因此这里是唯一读写数据库的地方。
 * 写入必须走 Postgres 函数（arch_save_diagram）以保证多表写入是一个事务 ——
 * 见 supabase/schema.sql 与阶段计划 M2。
 */

function client() {
  if (!supabase) {
    throw new Error('Supabase 未配置：请在 .env.local 里填 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
  }
  return supabase;
}

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}：${error?.message ?? '未知错误'}`);
}

export interface DiagramSummary {
  diagramId: string;
  name: string;
  version: number;
  updatedAt: string;
  tags: string[];
}

export interface ListOptions {
  /** 按名称模糊匹配（ilike） */
  search?: string;
  /** 必须包含这个标签 */
  tag?: string;
  sort?: 'updated' | 'name' | 'version';
  limit?: number;
  offset?: number;
}

export interface DiagramPage {
  rows: DiagramSummary[];
  /** 满足筛选条件的总数（用于分页） */
  total: number;
}

/**
 * 图列表（图库用）。
 *
 * 分页 + 名称模糊 + 标签包含 + 三种排序全部下推给 PostgREST；
 * 前端不做二次过滤 —— 图多了以后"先拉全量再过滤"等于没分页。
 */
export async function listDiagrams(options: ListOptions = {}): Promise<DiagramPage> {
  const { search, tag, sort = 'updated', limit = 12, offset = 0 } = options;

  let query = client()
    .from(TABLES.diagram)
    .select('diagram_id,name,version,updated_at,tags', { count: 'exact' })
    .eq('is_deleted', false);

  if (search && search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  if (tag) query = query.contains('tags', [tag]);

  if (sort === 'name') query = query.order('name', { ascending: true });
  else if (sort === 'version') query = query.order('version', { ascending: false });
  else query = query.order('updated_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + Math.max(0, limit - 1));
  if (error) fail('读取图列表失败', error);

  return {
    rows: (data ?? []).map((row) => ({
      diagramId: row.diagram_id as string,
      name: row.name as string,
      version: row.version as number,
      updatedAt: row.updated_at as string,
      tags: (row.tags as string[] | null) ?? [],
    })),
    total: count ?? 0,
  };
}

/** 图库里出现过的所有标签（去重后按字面排序） */
export async function listAllTags(): Promise<string[]> {
  const { data, error } = await client().from(TABLES.diagram).select('tags').eq('is_deleted', false);
  if (error) fail('读取标签失败', error);

  const set = new Set<string>();
  for (const row of data ?? []) {
    for (const tag of (row.tags as string[] | null) ?? []) set.add(tag);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 改图的标签（图库卡片里编辑，最多 12 个） */
export async function updateDiagramTags(diagramId: string, tags: string[]): Promise<void> {
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 12);
  const { error } = await client().from(TABLES.diagram).update({ tags: cleaned }).eq('diagram_id', diagramId);
  if (error) fail('保存标签失败', error);
}

/**
 * 写图级扩展字段（目前只有「全局锁定编辑」）。
 *
 * 走一次 REST update，不进保存函数 —— 这是**元数据**：不该占版本号、
 * 不该触发快照，也不该和画布内容抢冲突。
 * 没跑 `patch-diagram-ext.sql` 时这一列不存在，update 会报错：静默吞掉，
 * 锁定就只是本机状态（并留一条 console 提示），不影响画图。
 */
export async function persistDiagramExt(
  diagramId: string,
  extJson: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await client()
      .from(TABLES.diagram)
      .update({ ext_json: extJson })
      .eq('diagram_id', diagramId);
    if (error) {
      // 列不存在（PGRST204 / 42703）或权限问题：降级成本地状态
      console.warn('[arch] 图级扩展写入失败（锁定状态仅本机生效）：', error.message);
    }
  } catch (error) {
    console.warn('[arch] 图级扩展写入异常（锁定状态仅本机生效）', error);
  }
}

export interface LoadedDiagram {
  diagram: ArchitectureDiagram;
  issues: ValidationIssue[];
}

/**
 * 读一张完整图：主表 + 分组 + 节点 + 连线，四次并发查询后装配。
 *
 * 读回来的数据一律过一遍 validateDiagram（repair 模式）：
 * 库里可能存着旧版本或被手工改坏的行，宁可修可修项也不让画布崩掉。
 */
export async function loadDiagram(diagramId: string): Promise<LoadedDiagram> {
  const db = client();

  const [master, groups, nodes, edges] = await Promise.all([
    db.from(TABLES.diagram).select('*').eq('diagram_id', diagramId).eq('is_deleted', false).maybeSingle(),
    db.from(TABLES.group).select('*').eq('diagram_id', diagramId).eq('is_deleted', false),
    db.from(TABLES.node).select('*').eq('diagram_id', diagramId).eq('is_deleted', false),
    db.from(TABLES.edge).select('*').eq('diagram_id', diagramId).eq('is_deleted', false),
  ]);

  if (master.error) fail(`读取图 ${diagramId} 失败`, master.error);
  // 每人只看自己的图（RLS 按 creator_id = auth.uid()）：别人的图在这里和"不存在"一模一样，
  // 因为数据库根本不会返回那一行 —— 所以提示里要把"可能不是你的"说清楚，别让人以为数据没了。
  if (!master.data) throw new Error(`这张图不存在，或者不是你创建的（每人只能看到自己的图）：${diagramId}`);
  if (groups.error) fail('读取分组失败', groups.error);
  if (nodes.error) fail('读取节点失败', nodes.error);
  if (edges.error) fail('读取连线失败', edges.error);

  const raw = assembleDiagram(
    master.data as unknown as DiagramMasterRow,
    (groups.data ?? []) as unknown as DiagramGroupRow[],
    (nodes.data ?? []) as unknown as DiagramNodeRow[],
    (edges.data ?? []) as unknown as DiagramEdgeRow[],
  );

  const result = validateDiagram(raw, { repair: true });
  const repaired = result.diagram;
  if (!repaired) {
    const detail = result.errors.map((i) => `${i.code} ${i.path}: ${i.message}`).join('; ');
    throw new Error(`图数据不合法（已尝试修复）：${detail}`);
  }

  const parsed = parseDiagram(repaired);
  if (!parsed.success) {
    const detail = parsed.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join('; ');
    throw new Error(`修复后的图仍不合法：${detail}`);
  }

  return { diagram: repaired, issues: [...result.errors, ...result.warnings] };
}

/** 新建一张空图的数据库记录 —— 现在统一走 saveDiagram（baseVersion = null 即插入） */
export async function createDiagram(diagram: ArchitectureDiagram): Promise<SaveResult> {
  return saveDiagram(diagram, null);
}

/* ------------------------------------------------------------------ */
/* 图库（阶段 3）：改名 / 复制 / 删除                                    */
/* ------------------------------------------------------------------ */

/** 改名只动主表一行，不碰三张子表 */
export async function renameDiagram(diagramId: string, name: string): Promise<void> {
  const { error } = await client()
    .from(TABLES.diagram)
    .update({ name: name.trim() || '未命名架构图' })
    .eq('diagram_id', diagramId);
  if (error) throw new Error(error.message);
}

/**
 * 复制一张图：读出整图 → 换一套 id → 存成新图。
 *
 * 换 id 是必须的：主键冲突会被当作 update，把原图覆盖掉。
 */
export async function duplicateDiagram(diagramId: string): Promise<{ diagramId: string; name: string }> {
  const loaded = await loadDiagram(diagramId);
  const withNewIds = reissueIds({
    ...loaded.diagram,
    diagramId: '', // 由 createEmptyDiagram 的规则重编，见下
  } as ArchitectureDiagram);

  const copy = {
    ...withNewIds,
    diagramId: crypto.randomUUID(),
    name: `${loaded.diagram.name || '架构图'} 副本`,
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as ArchitectureDiagram;

  const saved = await saveDiagram(copy, null);
  if (!saved.ok) throw new Error(saved.message);
  return { diagramId: copy.diagramId, name: copy.name };
}

/** 删除 = 软删主表（子表留着，便于以后做恢复）；误删也能从快照回滚 */
export async function deleteDiagram(diagramId: string): Promise<void> {
  const { error } = await client()
    .from(TABLES.diagram)
    .update({ is_deleted: true })
    .eq('diagram_id', diagramId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* 保存                                                                */
/* ------------------------------------------------------------------ */

export type SaveResult =
  | { ok: true; version: number; savedAt: string; snapshot: boolean }
  | { ok: false; reason: 'version_conflict'; currentVersion?: number; message: string }
  | { ok: false; reason: 'missing_function'; message: string }
  | { ok: false; reason: 'missing_patch'; message: string }
  | { ok: false; reason: 'invalid'; message: string; paths: string[] }
  | { ok: false; reason: 'failed'; message: string };

interface RpcSaveResponse {
  diagramId: string;
  version: number;
  savedAt: string;
  snapshot: boolean;
}

/**
 * 整图保存：一次 RPC = 一个事务（版本校验 + 三表 upsert + 差集软删 + 条件快照）。
 *
 * `baseVersion` 为库里当前版本；传 null 表示强制覆盖（忽略冲突检查）。
 * 冲突时 Postgres 抛 `VERSION_CONFLICT`，这里转成结构化结果，交给 UI 决定
 * "重新载入"还是"覆盖保存"。
 */
export async function saveDiagram(
  diagram: ArchitectureDiagram,
  baseVersion: number | null,
): Promise<SaveResult> {
  // 前端闸：枚举 / 引用 / 数值 / 规模的硬错误直接拒，别放到数据库里撞约束 ——
  // 那边只会回一句 "violates foreign key constraint"，定位不到字段（D4）
  const check = validateDiagram(diagram, { repair: false });
  if (!check.ok) {
    const errors = check.errors.slice(0, 5);
    return {
      ok: false,
      reason: 'invalid',
      message: `数据不合法，已拒绝保存：${errors.map((e) => `${e.path}：${e.message}`).join('；')}`,
      paths: errors.map((e) => e.path),
    };
  }

  const { data, error } = await client().rpc('arch_save_diagram', {
    p_payload: toSavePayload(diagram),
    p_base_version: baseVersion,
  });

  if (error) {
    const message = error.message ?? String(error);
    if (message.includes('VERSION_CONFLICT')) {
      const match = /库内版本\s+(\d+)/.exec(message);
      return {
        ok: false,
        reason: 'version_conflict',
        currentVersion: match ? Number(match[1]) : undefined,
        message,
      };
    }
    // 函数还没建（schema.sql 只跑了一部分）——单独一类，UI 给"重跑 SQL"的指引
    if (
      (error as { code?: string }).code === 'PGRST202' ||
      message.includes('arch_save_diagram')
    ) {
      return { ok: false, reason: 'missing_function', message };
    }
    return { ok: false, reason: 'failed', message };
  }

  const response = (Array.isArray(data) ? data[0] : data) as RpcSaveResponse | null;
  if (!response || typeof response.version !== 'number') {
    return { ok: false, reason: 'failed', message: '保存返回结构异常' };
  }

  return {
    ok: true,
    version: response.version,
    savedAt: response.savedAt,
    snapshot: response.snapshot,
  };
}

/**
 * 增量保存：只提交差异行（`diffPayload` 的结果）。
 *
 * 语义与整图保存一致（版本 +1、VERSION_CONFLICT、条件快照），
 * 但写入量 ≈ 本次改动量。函数还没建（用户没跑 patch-diagram.sql）时
 * 返回 `missing_patch`，由调用方回退到整图保存 —— 功能不因缺 SQL 而坏。
 */
export async function patchDiagram(
  diagram: ArchitectureDiagram,
  baseVersion: number,
  patch: PayloadPatch,
): Promise<SaveResult> {
  const check = validateDiagram(diagram, { repair: false });
  if (!check.ok) {
    const errors = check.errors.slice(0, 5);
    return {
      ok: false,
      reason: 'invalid',
      message: `数据不合法，已拒绝保存：${errors.map((e) => `${e.path}：${e.message}`).join('；')}`,
      paths: errors.map((e) => e.path),
    };
  }

  const { data, error } = await client().rpc('arch_patch_diagram', {
    p_diagram_id: diagram.diagramId,
    p_base_version: baseVersion,
    p_patch: patch,
  });

  if (error) {
    const message = error.message ?? String(error);
    if (message.includes('VERSION_CONFLICT')) {
      const match = /库内版本\s+(\d+)/.exec(message);
      return {
        ok: false,
        reason: 'version_conflict',
        currentVersion: match ? Number(match[1]) : undefined,
        message,
      };
    }
    const code = (error as { code?: string }).code;
    // 函数不存在 / PostgREST 缓存还没刷 → 回退整图保存
    if (code === 'PGRST202' || message.includes('arch_patch_diagram')) {
      return { ok: false, reason: 'missing_patch', message };
    }
    return { ok: false, reason: 'failed', message };
  }

  const response = (Array.isArray(data) ? data[0] : data) as RpcSaveResponse | null;
  if (!response || typeof response.version !== 'number') {
    return { ok: false, reason: 'failed', message: '增量保存返回结构异常' };
  }
  return {
    ok: true,
    version: response.version,
    savedAt: response.savedAt,
    snapshot: response.snapshot,
  };
}

/**
 * 转成函数入参。
 *
 * 只发需要的字段：`is_deleted` 之类由函数自己维护，前端不传，
 * 避免客户端一个手误把整张图软删掉。
 */
export function toSavePayload(diagram: ArchitectureDiagram) {
  return {
    diagramId: diagram.diagramId,
    schemaVersion: diagram.schemaVersion,
    name: diagram.name,
    description: diagram.description,
    projectId: diagram.projectId ?? null,
    creatorId: diagram.creatorId,
    viewport: diagram.viewport,
    groups: diagram.groups
      .filter((g) => !g.isDeleted)
      .map((g) => ({
        groupId: g.groupId,
        parentGroupId: g.parentGroupId ?? null,
        label: g.label,
        subLabel: g.subLabel,
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
    nodes: diagram.nodes
      .filter((n) => !n.isDeleted)
      .map((n) => ({
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
    edges: diagram.edges
      .filter((e) => !e.isDeleted)
      .map((e) => ({
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
}
