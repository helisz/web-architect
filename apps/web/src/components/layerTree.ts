import { isGroupLocked } from '@arch/schema';
import type { DiagramGroup, DiagramNode } from '@arch/schema';

/**
 * 图层面板的"树 → 扁平行"算法（纯函数，便于单测）。
 *
 * 规则：
 * - 分组按 `parentGroupId` 嵌套，先画分组再画它里面的节点（分组是容器，永远在节点下面）；
 * - 同一层内按 `sort` 从大到小（和画布遮挡顺序一致）；
 * - 收起的组不展开子项，但行上仍然带着 `childCount` 说明里面有多少元素。
 */
export interface LayerRow {
  id: string;
  kind: 'node' | 'group';
  label: string;
  depth: number;
  locked: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  childCount: number;
}

export function buildLayerRows(
  groups: readonly DiagramGroup[],
  nodes: readonly DiagramNode[],
  collapsed: ReadonlySet<string>,
): LayerRow[] {
  const out: LayerRow[] = [];

  const walk = (parentId: string | null, depth: number): void => {
    const childGroups = groups
      .filter((g) => (g.parentGroupId ?? null) === parentId)
      .sort((a, b) => b.sort - a.sort);
    const childNodes = nodes
      .filter((n) => (n.groupId ?? null) === parentId)
      .sort((a, b) => b.sort - a.sort);

    for (const g of childGroups) {
      const subGroups = groups.filter((x) => x.parentGroupId === g.groupId).length;
      const subNodes = nodes.filter((x) => x.groupId === g.groupId).length;
      const isCollapsed = collapsed.has(g.groupId);
      out.push({
        id: g.groupId,
        kind: 'group',
        label: g.label || '未命名分组',
        depth,
        locked: isGroupLocked(g),
        hasChildren: subGroups + subNodes > 0,
        collapsed: isCollapsed,
        childCount: subGroups + subNodes,
      });
      if (!isCollapsed) walk(g.groupId, depth + 1);
    }

    for (const n of childNodes) {
      out.push({
        id: n.nodeId,
        kind: 'node',
        label: n.label || n.nodeType,
        depth,
        locked: n.locked,
        hasChildren: false,
        collapsed: false,
        childCount: 0,
      });
    }
  };

  walk(null, 0);
  return out;
}

/**
 * 目标组是否是拖拽对象自己或自己的后代（用来挡住"把组拖进自己里面"）。
 * 数据本来不该成环，这里仍然带 guard，坏数据也不会把面板转死。
 */
export function isSelfOrDescendant(
  groups: readonly DiagramGroup[],
  dragId: string,
  targetId: string,
): boolean {
  let cursor: string | null = targetId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === dragId) return true;
    if (guard.has(cursor)) return false;
    guard.add(cursor);
    cursor = groups.find((g) => g.groupId === cursor)?.parentGroupId ?? null;
  }
  return false;
}

/** 分组的层数（顶层 = 1），越界判断用 */
export function groupDepth(groups: readonly DiagramGroup[], groupId: string | null): number {
  let depth = 0;
  let cursor: string | null = groupId;
  const guard = new Set<string>();
  while (cursor) {
    if (guard.has(cursor)) break;
    guard.add(cursor);
    depth += 1;
    cursor = groups.find((g) => g.groupId === cursor)?.parentGroupId ?? null;
  }
  return depth;
}

/** 某个分组连同后代一共几层，配合 MAX_GROUP_DEPTH 判断能不能再往下塞 */
export function subtreeHeight(groups: readonly DiagramGroup[], groupId: string): number {
  const children = groups.filter((g) => g.parentGroupId === groupId);
  return 1 + Math.max(0, ...children.map((g) => subtreeHeight(groups, g.groupId)));
}
