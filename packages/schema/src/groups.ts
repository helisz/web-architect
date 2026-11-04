import type { ArchitectureDiagram, DiagramGroup, DiagramNode, Point } from './types.js';

/**
 * 分组（泳道）几何与挂载规则。
 *
 * 规格 C1 的红线：**Schema 里子元素坐标永远是相对父组的局部坐标**，
 * 不能存绝对坐标，也不能在 toSchema 里做 abs()。
 * 因此"绝对坐标"只在本文件里临时算，用于命中判定与换组换算，
 * 绝不写回 Schema。
 */

/** 折叠后只留标题栏的高度（px）：标题 16 + 副文本两行 2×13 + 上边距 4（2026-11-04 第二批） */
export const GROUP_HEADER_HEIGHT = 46;
/** 只有一行标题时的标题栏高度（用户 2026-11-04：通用分组不显示副文本，高度按一行算） */
export const GROUP_HEADER_HEIGHT_SINGLE = 32;
/** 最多 3 层（顶层组算第 1 层） */
export const MAX_GROUP_DEPTH = 3;

/**
 * 分组标题栏是否只有一行。
 *
 * 用户 2026-11-04 拍板：结构区第一张卡（通用「分组」）**不支持副文本** ——
 * 建出来的组用 `extJson.singleLine` 标记，属性面板不给副文本输入框，
 * 标题栏也只按一行的高度画。带副文本的预设分组（服务器/集群/nginx）不受影响。
 */
export function isSingleLineGroup(group: { extJson?: Record<string, unknown> }): boolean {
  return group.extJson?.singleLine === true;
}

/** 标题栏实际高度：有副文本（且没被标成单行）才用两行的高度 */
export function groupHeaderHeight(group: {
  subLabel?: string;
  extJson?: Record<string, unknown>;
}): number {
  return group.subLabel && !isSingleLineGroup(group) ? GROUP_HEADER_HEIGHT : GROUP_HEADER_HEIGHT_SINGLE;
}

/**
 * 分组是否被锁定（用户 2026-11-04：分组也要能锁）。
 *
 * 存 `extJson.locked` 而不是新加数据库列：`ext_json` 本来就在保存 / 差异 / 快照链路里
 * 完整往返，加列要改 schema.sql + patch-diagram.sql 的 payload 与 upsert 字段表，
 * 而且用户必须重跑一遍 SQL 才能保存 —— 代价不值。
 *
 * 锁定后：不能拖动、不能缩放、不能改名、折叠三角隐藏、右键菜单只留「解锁」、
 * 属性面板只剩解锁按钮；**仍然可以选中**（用户明确要求）。
 */
export function isGroupLocked(group: { extJson?: Record<string, unknown> }): boolean {
  return group.extJson?.locked === true;
}

const byId = (groups: DiagramGroup[], groupId: string | null | undefined): DiagramGroup | null =>
  groupId ? (groups.find((g) => g.groupId === groupId) ?? null) : null;

/** 祖先链，由内向外：parent → grandparent → … */
export function groupAncestors(groups: DiagramGroup[], groupId: string | null | undefined): DiagramGroup[] {
  const chain: DiagramGroup[] = [];
  let current = byId(groups, groupId);
  const guard = new Set<string>();
  while (current) {
    if (guard.has(current.groupId)) break; // 脏数据成环时不要死循环
    guard.add(current.groupId);
    chain.push(current);
    current = byId(groups, current.parentGroupId);
  }
  return chain;
}

/** 组的绝对偏移 = 所有祖先（含自身父级）的 x/y 之和 */
export function groupOffset(groups: DiagramGroup[], groupId: string | null | undefined): Point {
  return groupAncestors(groups, groupId).reduce(
    (acc, g) => ({ x: acc.x + g.x, y: acc.y + g.y }),
    { x: 0, y: 0 },
  );
}

/** 组深度：顶层组 = 1，不属于任何组 = 0 */
export function groupDepth(groups: DiagramGroup[], groupId: string | null | undefined): number {
  return groupAncestors(groups, groupId).length;
}

/** maybeAncestorId 是否是 groupId 的祖先（或同一个） */
export function isAncestorOf(
  groups: DiagramGroup[],
  maybeAncestorId: string,
  groupId: string | null | undefined,
): boolean {
  return groupAncestors(groups, groupId).some((g) => g.groupId === maybeAncestorId);
}

/** 组的整体绝对矩形 */
export function groupAbsoluteRect(
  groups: DiagramGroup[],
  group: DiagramGroup,
): { x: number; y: number; width: number; height: number } {
  const offset = groupOffset(groups, group.parentGroupId);
  return { x: offset.x + group.x, y: offset.y + group.y, width: group.width, height: group.height };
}

/** 节点在画布上的绝对矩形（含组的祖先偏移） */
export function nodeAbsoluteRect(
  groups: DiagramGroup[],
  node: Pick<DiagramNode, 'x' | 'y' | 'width' | 'height' | 'groupId'>,
): { x: number; y: number; width: number; height: number } {
  const offset = groupOffset(groups, node.groupId);
  return { x: offset.x + node.x, y: offset.y + node.y, width: node.width, height: node.height };
}

function contains(rect: { x: number; y: number; width: number; height: number }, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * 命中判定：某个绝对坐标点落在哪个组的**内容区**里（最深优先）。
 * exclude 用来排除被拖动对象自己及其后代，避免自己套自己。
 */
export function hitGroup(
  groups: DiagramGroup[],
  point: Point,
  excludeIds: string[] = [],
): DiagramGroup | null {
  const hidden = new Set(excludeIds);
  const candidates = groups
    .filter((g) => !hidden.has(g.groupId) && !g.collapsed)
    .filter((g) => {
      // 命中体 = 整个组框（标题栏也算），这样"拖到标题上"也能进组
      const rect = groupAbsoluteRect(groups, g);
      return contains(rect, point);
    });
  if (candidates.length === 0) return null;
  // 取层级最深的那个
  return candidates.sort((a, b) => groupDepth(groups, b.groupId) - groupDepth(groups, a.groupId))[0]!;
}

/**
 * 这个容器（组）是否处于折叠的祖先之下。
 *
 * 语义要点：传入的 groupId 是"元素所属的容器"，
 * - 传 `node.groupId`  → 节点直属的那个组自己折叠了，节点就该隐藏；
 * - 传 `child.parentGroupId` → 只看父级及以上，子组自己折叠不算自己被藏。
 * 所以这里**包含自身**，调用方按需传组自己的 id 或它的父级 id。
 */
export function isHiddenByCollapse(groups: DiagramGroup[], groupId: string | null | undefined): boolean {
  return groupAncestors(groups, groupId).some((g) => g.collapsed);
}

/** 组的所有后代 id（子组 + 孙组） */
export function descendantGroupIds(groups: DiagramGroup[], groupId: string): string[] {
  const result: string[] = [];
  const walk = (parentId: string): void => {
    for (const g of groups) {
      if (g.parentGroupId === parentId) {
        result.push(g.groupId);
        walk(g.groupId);
      }
    }
  };
  walk(groupId);
  return result;
}

/**
 * 把节点挂到目标组（null = 拉到画布顶层）。
 *
 * 屏幕位置保持不变：先算出绝对坐标，再减去新父级的偏移。
 * 这是 C1 唯一允许做坐标换算的地方。
 */
export function setNodeGroup(
  diagram: ArchitectureDiagram,
  nodeId: string,
  targetGroupId: string | null | undefined,
): ArchitectureDiagram {
  const node = diagram.nodes.find((n) => n.nodeId === nodeId);
  if (!node || node.groupId === targetGroupId) return diagram;

  const absolute = nodeAbsoluteRect(diagram.groups, node);
  const offset = groupOffset(diagram.groups, targetGroupId);

  return {
    ...diagram,
    nodes: diagram.nodes.map((n) =>
      n.nodeId === nodeId
        ? { ...n, groupId: targetGroupId, x: absolute.x - offset.x, y: absolute.y - offset.y }
        : n,
    ),
  };
}

/** 把子组挂到目标组（同样保持屏幕位置） */
export function setGroupParent(
  diagram: ArchitectureDiagram,
  groupId: string,
  targetParentId: string | null,
): ArchitectureDiagram {
  const group = diagram.groups.find((g) => g.groupId === groupId);
  if (!group || group.parentGroupId === targetParentId) return diagram;
  // 不能挂到自己的后代里（会成环）
  if (targetParentId && isAncestorOf(diagram.groups, groupId, targetParentId)) return diagram;

  const absolute = groupAbsoluteRect(diagram.groups, group);
  const offset = groupOffset(diagram.groups, targetParentId);

  return {
    ...diagram,
    groups: diagram.groups.map((g) =>
      g.groupId === groupId
        ? { ...g, parentGroupId: targetParentId, x: absolute.x - offset.x, y: absolute.y - offset.y }
        : g,
    ),
  };
}

/**
 * 删除组：组本身和它的子组一起消失，但**里面的节点提升到上一层**（保留屏幕位置），
 * 不让"删个框"顺手把内容一起删掉。
 */
export function removeGroupLifting(diagram: ArchitectureDiagram, groupId: string): ArchitectureDiagram {
  const group = diagram.groups.find((g) => g.groupId === groupId);
  if (!group) return diagram;

  const doomed = new Set([groupId, ...descendantGroupIds(diagram.groups, groupId)]);
  const target = group.parentGroupId;
  const offset = groupOffset(diagram.groups, target);

  // 先把所有受影响的节点换算到目标父级的坐标系下
  const nodes = diagram.nodes.map((node) => {
    if (!node.groupId || !doomed.has(node.groupId)) return node;
    const absolute = nodeAbsoluteRect(diagram.groups, node);
    return { ...node, groupId: target, x: absolute.x - offset.x, y: absolute.y - offset.y };
  });

  return { ...diagram, nodes, groups: diagram.groups.filter((g) => !doomed.has(g.groupId)) };
}



