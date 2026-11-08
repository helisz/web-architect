import type { ArchitectureDiagram, DiagramGroup, DiagramNode, Point } from './types.js';
import { layoutDynamicItems } from './dynamicLayout.js';

/**
 * 分组（泳道）几何与挂载规则。
 *
 * 规格 C1 的红线：**Schema 里子元素坐标永远是相对父组的局部坐标**，
 * 不能存绝对坐标，也不能在 toSchema 里做 abs()。
 * 因此"绝对坐标"只在本文件里临时算，用于命中判定与换组换算，
 * 绝不写回 Schema。
 */

/** 标题栏高度（带副文本，px）：上边距 2 + 标题 16 + 副文本两行 2×10（用户 2026-11-04 第二批） */
export const GROUP_HEADER_HEIGHT = 38;
/** 只有一行标题时的标题栏高度（通用分组不显示副文本）：上边距 4 + 标题 16 + 余量 4 */
export const GROUP_HEADER_HEIGHT_SINGLE = 24;
/** 最多 3 层（顶层组算第 1 层） */
export const MAX_GROUP_DEPTH = 3;

/**
 * 分组标题栏是否只有一行。
 *
 * 2026-11-07 起它是**属性面板里那个「副文本」勾选框的反面**（字段名沿用 `singleLine`）：
 * - 勾上「副文本」→ singleLine 不设 → 标题栏显示副文本行，最小 38px；
 * - 取消勾选 → `extJson.singleLine = true` → 不显示副文本行，标题栏 24px（和通用「分组」一样）。
 *
 * 早先这条是"类型决定"的（通用分组不支持副文本、预设分组才支持），现在改成每个组自己选。
 */
export function isSingleLineGroup(group: { extJson?: Record<string, unknown> }): boolean {
  return group.extJson?.singleLine === true;
}

/** 10px 等宽字体下一个字符的估算宽度：CJK / 全角 10px，其余 6px */
const MONO_10_WIDE = 10;
const MONO_10_NARROW = 6;

function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += (ch.codePointAt(0) ?? 0) > 0x2e80 ? MONO_10_WIDE : MONO_10_NARROW;
  }
  return width;
}

/**
 * 副文本会占几行（10px 等宽字体，按标题栏剩余宽度估算）。
 *
 * 为什么估算而不是量 DOM：标题栏高度要同时喂给画布布局和 React Flow 的节点尺寸
 * （`displayGroupHeight`），两边必须用同一个纯函数得到同一个数，量 DOM 会引入时序差异。
 * 副文本本身有长度上限（LIMITS.subLabelMax），估算偏差最多半个字宽，不影响观感。
 */
export function groupSubLabelLines(group: { subLabel?: string; width: number }): number {
  const text = group.subLabel ?? '';
  if (!text.trim()) return 1;
  // 标题栏左右各 8px 内距，前面还有图标 14px + 间距 6px
  const avail = Math.max(40, group.width - 8 * 2 - 14 - 6);
  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(textWidth(line) / avail)), 0);
}

/**
 * 标题栏实际高度（用户 2026-11-07）：
 * - 没勾副文本 → 24px（只有一行标题，和通用「分组」一样高）；
 * - 勾了副文本 → 至少 38px（服务器那种），副文本每多一行 +10px。
 *
 * 行内构成：上内距 5 + 标题 16 + 间距 1 + 副文本 10×行数 + 下内距 4。
 */
export function groupHeaderHeight(group: {
  subLabel?: string;
  width: number;
  extJson?: Record<string, unknown>;
}): number {
  if (isSingleLineGroup(group)) return GROUP_HEADER_HEIGHT_SINGLE;
  const lines = groupSubLabelLines(group);
  return Math.max(GROUP_HEADER_HEIGHT, 26 + 10 * lines);
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
/**
 * 动态分组 / 动态组（用户 2026-11-07）。
 *
 * 两者都是普通 `DiagramGroup`，只靠 extJson 标记：
 * - `dynamic: true` → 容器内子元素自动排版，容器里显示一个「＋」批量添加入口；
 * - `dashed: true` → 动态组：虚线框、名称在框外左上角、没有标题栏/副文本/折叠。
 *
 * 不新增数据库列：`ext_json` 本来就在保存 / 差异 / 快照链路里完整往返。
 */
export function isDynamicGroup(group: { extJson?: Record<string, unknown> }): boolean {
  return group.extJson?.dynamic === true;
}

/** 动态组（虚线框、名称在框外）—— 是动态分组的特例 */
export function isDynamicZone(group: { extJson?: Record<string, unknown> }): boolean {
  return group.extJson?.dynamic === true && group.extJson?.dashed === true;
}

/**
 * 动态容器内容区的内距：**2 个网格单位（20px）**
 * 用户 2026-11-08：子节点离外框上下左右都留 2 格，节点之间留 1 格（DYNAMIC_GAP）。
 */
export const DYNAMIC_PADDING = 20;

/**
 * 动态容器标题栏高度：动态组不占（名称画在框外），动态分组**向上取整到 10 的倍数**。
 *
 * 为什么取整：子节点离上边距是"标题栏 + 2 格内距"，如果标题栏是 24/38 这种非整格高度，
 * 子节点就会落在 44/58 —— 正好差半格，看起来没跟网格对齐（用户 2026-11-08 指出的问题）。
 */
export function dynamicHeaderHeight(group: {
  subLabel?: string;
  width: number;
  extJson?: Record<string, unknown>;
}): number {
  if (isDynamicZone(group)) return 0;
  return Math.ceil(groupHeaderHeight(group) / 10) * 10;
}

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




/* ------------------------------------------------------------------ */
/* 动态容器的排版落库（2026-11-07）                                     */
/* ------------------------------------------------------------------ */

/** 动态容器最小尺寸：刚开始"比较小"，加节点后自动长大 */
export const DYNAMIC_MIN_WIDTH = 240;
export const DYNAMIC_MIN_HEIGHT = 100;

/**
 * 按当前宽度重排动态容器里的子节点，并让容器高度至少放得下内容。
 *
 * - `width`：用这个宽度重排（拖动缩放时传新宽度）；不传就用容器当前宽度；
 * - `cols`：强制列数（批量添加后"接近方形"用）；不传就按宽度自动选最大可放下的列数；
 * - `fitWidth`：让容器宽度收缩到刚好包住内容（批量添加时用，不会低于 DYNAMIC_MIN_WIDTH）；
 * - `growOnly`：容器尺寸只增不减（用户手动拉大后不被批量添加缩回去）。
 *
 * 子节点坐标是**相对父组**的局部坐标（C1 红线），所以这里只写 x/y，不碰绝对坐标。
 */
export function layoutDynamicGroup(
  diagram: ArchitectureDiagram,
  groupId: string,
  options: { width?: number; cols?: number; fitWidth?: boolean; growOnly?: boolean } = {},
): ArchitectureDiagram {
  const group = diagram.groups.find((g) => g.groupId === groupId);
  if (!group || !isDynamicGroup(group)) return diagram;

  const children = diagram.nodes.filter((n) => !n.isDeleted && n.groupId === groupId);
  const headerH = dynamicHeaderHeight(group);
  const width = options.fitWidth ? group.width : (options.width ?? group.width);
  const innerWidth = Math.max(40, width - DYNAMIC_PADDING * 2);

  const layout = layoutDynamicItems(
    children.map((n) => ({ id: n.nodeId, width: n.width, height: n.height })),
    options.cols !== undefined ? { cols: options.cols } : { innerWidth },
  );

  const neededWidth = Math.max(DYNAMIC_MIN_WIDTH, layout.contentWidth + DYNAMIC_PADDING * 2);
  const neededHeight = Math.max(
    DYNAMIC_MIN_HEIGHT,
    headerH + DYNAMIC_PADDING * 2 + layout.contentHeight,
  );
  const nextWidth = options.fitWidth
    ? Math.max(neededWidth, options.growOnly ? width : 0)
    : width;
  const nextHeight = options.growOnly ? Math.max(group.height, neededHeight) : neededHeight;

  const posById = new Map(layout.slots.map((slot) => [slot.id, slot]));
  const originX = DYNAMIC_PADDING;
  const originY = headerH + DYNAMIC_PADDING;

  const nodes = diagram.nodes.map((n) => {
    const slot = posById.get(n.nodeId);
    if (!slot) return n;
    return { ...n, x: originX + slot.x, y: originY + slot.y };
  });

  return {
    ...diagram,
    groups: diagram.groups.map((g) =>
      g.groupId === groupId ? { ...g, width: nextWidth, height: nextHeight } : g,
    ),
    nodes,
  };
}
