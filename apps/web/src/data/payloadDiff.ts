import type { toSavePayload } from './diagramRepo.js';

/**
 * 增量保存的差异计算（纯函数，可单测）。
 *
 * 输入是前后两次 `toSavePayload` 的结果，输出 `arch_patch_diagram` 的 p_patch：
 * 只带变化过的行 + 被删掉的 id。整图保存每次要重写三张表，
 * 而拖一个节点实际只改一行 —— 这就是 PATCH 的意义。
 */

export type SavePayload = ReturnType<typeof toSavePayload>;
type GroupRow = SavePayload['groups'][number];
type NodeRow = SavePayload['nodes'][number];
type EdgeRow = SavePayload['edges'][number];

export interface RowPatch<T> {
  upsert: T[];
  delete: string[];
}

export interface PayloadPatch {
  diagram?: {
    schemaVersion?: string;
    name?: string;
    description?: string;
    projectId?: string | null;
    viewport?: { x: number; y: number; zoom: number };
  };
  groups?: RowPatch<GroupRow>;
  nodes?: RowPatch<NodeRow>;
  edges?: RowPatch<EdgeRow>;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function diffRows<T extends Record<string, unknown>>(
  prev: readonly T[],
  next: readonly T[],
  idKey: keyof T & string,
): RowPatch<T> {
  const before = new Map<string, string>();
  for (const row of prev) before.set(String(row[idKey]), JSON.stringify(row));

  const upsert: T[] = [];
  const nextIds = new Set<string>();
  for (const row of next) {
    const id = String(row[idKey]);
    nextIds.add(id);
    if (before.get(id) !== JSON.stringify(row)) upsert.push(row);
  }

  const remove: string[] = [];
  for (const id of before.keys()) if (!nextIds.has(id)) remove.push(id);

  return { upsert, delete: remove };
}

/** 分组必须先父后子写入（parent_group_id 有外键）；不在本次 upsert 里的父级视为 0 层 */
function sortGroupsParentFirst(rows: GroupRow[]): GroupRow[] {
  const byId = new Map(rows.map((row) => [row.groupId, row]));
  const depthOf = (id: string, guard = 0): number => {
    const row = byId.get(id);
    if (!row || !row.parentGroupId || guard > 8) return 0;
    return 1 + depthOf(row.parentGroupId, guard + 1);
  };
  return [...rows].sort((a, b) => depthOf(a.groupId) - depthOf(b.groupId));
}

const isEmptyPatch = (patch: PayloadPatch): boolean =>
  patch.diagram === undefined &&
  (patch.groups?.upsert.length ?? 0) === 0 &&
  (patch.groups?.delete.length ?? 0) === 0 &&
  (patch.nodes?.upsert.length ?? 0) === 0 &&
  (patch.nodes?.delete.length ?? 0) === 0 &&
  (patch.edges?.upsert.length ?? 0) === 0 &&
  (patch.edges?.delete.length ?? 0) === 0;

/**
 * 计算差异。返回 `{}` 表示"没有需要写库的变化"，
 * 调用方可以据此跳过这次网络请求。
 */
export function diffPayload(prev: SavePayload | null, next: SavePayload): PayloadPatch {
  const patch: PayloadPatch = {};

  if (prev) {
    const diagram: NonNullable<PayloadPatch['diagram']> = {};
    if (prev.schemaVersion !== next.schemaVersion) diagram.schemaVersion = next.schemaVersion;
    if (prev.name !== next.name) diagram.name = next.name;
    if (prev.description !== next.description) diagram.description = next.description;
    if ((prev.projectId ?? null) !== (next.projectId ?? null)) diagram.projectId = next.projectId ?? null;
    if (!same(prev.viewport, next.viewport)) diagram.viewport = next.viewport;
    if (Object.keys(diagram).length > 0) patch.diagram = diagram;
  } else {
    // 没有基线（首次保存）→ 交给整图保存，这里不负责
    return {};
  }

  const groups = diffRows(prev.groups, next.groups, 'groupId');
  groups.upsert = sortGroupsParentFirst(groups.upsert);
  if (groups.upsert.length > 0 || groups.delete.length > 0) patch.groups = groups;

  const nodes = diffRows(prev.nodes, next.nodes, 'nodeId');
  if (nodes.upsert.length > 0 || nodes.delete.length > 0) patch.nodes = nodes;

  const edges = diffRows(prev.edges, next.edges, 'edgeId');
  if (edges.upsert.length > 0 || edges.delete.length > 0) patch.edges = edges;

  return isEmptyPatch(patch) ? {} : patch;
}

/** 空补丁 = 没有需要写库的改动 */
export const isEmpty = isEmptyPatch;
