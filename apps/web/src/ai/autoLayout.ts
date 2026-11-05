/**
 * 一键整理（用户 2026-11-05）：按连线的层级把图排整齐，**保留分组归属**。
 *
 * 为什么不用现成的 dagre：我们的图不是纯 DAG —— 有分组嵌套、节点可以落在组里、
 * 连线可以指到组内节点，还有环（双向调用）。引入一个通用布局库之后再想"组内单独排、
 * 组当整体排"反而更难，这里按自己的数据模型写一份分层布局更直接。
 *
 * 算法（每层独立执行，组内递归）：
 * 1. 按连线做最长路径分层（有环时把环上的点压在同一层）；
 * 2. 同层按原来的 x 排序（整理前左右相邻的，整理后仍然相邻）；
 * 3. 每行水平居中、行间留固定间距；
 * 4. 分组的尺寸 = 组内内容包围盒 + 标题条 + 内边距；组的坐标 = 组内内容左上角 - 内边距。
 *
 * 只动位置和分组尺寸，不动连线端点、样式和层级关系。
 */

import { groupOffset, type ArchitectureDiagram, type DiagramEdge, type DiagramGroup, type DiagramNode } from '@arch/schema';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutGroupBox extends LayoutPoint {
  width: number;
  height: number;
}

export interface LayoutResult {
  /** nodeId → 绝对坐标（组内节点会在 apply 时换算回局部坐标） */
  nodes: Map<string, LayoutPoint>;
  /** groupId → 绝对坐标与尺寸 */
  groups: Map<string, LayoutGroupBox>;
}

const H_GAP = 56;
const V_GAP = 72;
/** 分组标题条高度（和渲染时的 padding 对齐） */
const GROUP_TITLE = 44;
const GROUP_PAD = { left: 24, right: 24, bottom: 20 };

interface Unit {
  key: string;
  kind: 'node' | 'group';
  node: DiagramNode | null;
  group: DiagramGroup | null;
  width: number;
  height: number;
  children: Unit[];
  edges: Array<[string, string]>;
  /** 本层排布后相对本层的坐标 */
  box: { x: number; y: number };
}

function isLiveNode(node: DiagramNode): boolean {
  return !node.isDeleted && node.visible;
}

function isLiveGroup(group: DiagramGroup): boolean {
  return !group.isDeleted;
}

/** 把一条边投影到本层的两个 unit 上：两端落在同一个 unit 里就不算这一层的边 */
function projectEdges(
  edges: DiagramEdge[],
  owner: (nodeId: string) => string | null,
  keys: Set<string>,
): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const edge of edges) {
    if (edge.isDeleted) continue;
    const from = owner(edge.sourceNodeId);
    const to = owner(edge.targetNodeId);
    if (!from || !to || from === to) continue;
    if (!keys.has(from) || !keys.has(to)) continue;
    result.push([from, to]);
  }
  return result;
}

/** 最长路径分层；有环时环上的节点都落在同一层（不会死循环） */
export function rankUnits(keys: string[], edges: Array<[string, string]>): Map<string, number> {
  const rank = new Map<string, number>(keys.map((key) => [key, 0]));
  const outgoing = new Map<string, string[]>(keys.map((key) => [key, []]));
  const indegree = new Map<string, number>(keys.map((key) => [key, 0]));
  for (const [from, to] of edges) {
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }

  const queue = keys.filter((key) => (indegree.get(key) ?? 0) === 0);
  const settled = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (settled.has(key)) continue;
    settled.add(key);
    for (const next of outgoing.get(key) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(key) ?? 0) + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) queue.push(next);
    }
  }

  // 环上的节点拿不到入度 0：按已有最高的前驱层 +1 落一层，保证不重叠在 0 层
  if (settled.size < keys.length) {
    let fallback = 0;
    for (const value of rank.values()) fallback = Math.max(fallback, value);
    for (const key of keys) {
      if (!settled.has(key)) rank.set(key, fallback + 1);
    }
  }
  return rank;
}

/** 本层排布：分层 → 行内居中 → 行高取最大值 */
function arrangeLevel(units: Unit[], edges: Array<[string, string]>): { width: number; height: number } {
  if (units.length === 0) return { width: 0, height: 0 };
  const rank = rankUnits(
    units.map((unit) => unit.key),
    edges,
  );

  const rows = new Map<number, Unit[]>();
  for (const unit of units) {
    const level = rank.get(unit.key) ?? 0;
    const list = rows.get(level) ?? [];
    list.push(unit);
    rows.set(level, list);
  }

  let cursorY = 0;
  let maxWidth = 0;
  for (const level of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(level)!;
    // 稳定排序：整理前越靠左，整理后越靠左
    row.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y || a.key.localeCompare(b.key));
    const rowWidth = row.reduce((sum, unit) => sum + unit.width, 0) + H_GAP * Math.max(0, row.length - 1);
    const rowHeight = Math.max(...row.map((unit) => unit.height));
    let cursorX = -rowWidth / 2;
    for (const unit of row) {
      unit.box = { x: cursorX, y: cursorY };
      cursorX += unit.width + H_GAP;
    }
    cursorY += rowHeight + V_GAP;
    maxWidth = Math.max(maxWidth, rowWidth);
  }

  // 归一化到 (0,0)：只挪本层的 unit，子层已经在自己那轮归过零了
  for (const unit of units) unit.box = { x: unit.box.x + maxWidth / 2, y: unit.box.y };
  return { width: maxWidth, height: Math.max(0, cursorY - V_GAP) };
}

/** 先量尺寸（组要包住内容），再排布 */
function buildUnits(diagram: ArchitectureDiagram, parentGroupId: string | null): Unit[] {
  const nodes = diagram.nodes.filter((node) => isLiveNode(node) && (node.groupId ?? null) === parentGroupId);
  const groups = diagram.groups.filter(
    (group) => isLiveGroup(group) && (group.parentGroupId ?? null) === parentGroupId,
  );

  const units: Unit[] = nodes.map((node) => ({
    key: node.nodeId,
    kind: 'node',
    node,
    group: null,
    width: node.width,
    height: node.height,
    children: [],
    edges: [],
    box: { x: node.x, y: node.y },
  }));

  for (const group of groups) {
    const children = buildUnits(diagram, group.groupId);
    const childKeys = new Set(children.map((unit) => unit.key));
    const ownedBy = (nodeId: string): string | null => {
      const node = diagram.nodes.find((item) => item.nodeId === nodeId);
      if (!node) return null;
      return node.groupId === group.groupId ? node.nodeId : null;
    };
    const edges = projectEdges(diagram.edges, ownedBy, childKeys);
    const size = arrangeLevel(children, edges);
    units.push({
      key: group.groupId,
      kind: 'group',
      node: null,
      group,
      width: Math.max(size.width + GROUP_PAD.left + GROUP_PAD.right, 200),
      height: Math.max(size.height + GROUP_TITLE + GROUP_PAD.bottom, 140),
      children,
      edges,
      box: { x: group.x, y: group.y },
    });
  }
  return units;
}

/**
 * 计算整理后的位置。
 *
 * 组内节点输出的是**绝对坐标**；落库前要和分组原点做一次差（见 store 的
 * `applyAutoLayout`），否则组内坐标会被算两遍偏移。
 */
export function computeAutoLayout(diagram: ArchitectureDiagram): LayoutResult {
  const rootUnits = buildUnits(diagram, null);
  const keyOwner = new Map<string, string>();
  for (const unit of rootUnits) {
    if (unit.kind === 'node') keyOwner.set(unit.node!.nodeId, unit.key);
    else {
      const walk = (list: Unit[]): void => {
        for (const child of list) {
          if (child.kind === 'node') keyOwner.set(child.node!.nodeId, unit.key);
          else walk(child.children);
        }
      };
      walk(unit.children);
    }
  }
  const rootEdges = projectEdges(
    diagram.edges,
    (nodeId) => keyOwner.get(nodeId) ?? null,
    new Set(rootUnits.map((unit) => unit.key)),
  );
  arrangeLevel(rootUnits, rootEdges);

  const nodes = new Map<string, LayoutPoint>();
  const groups = new Map<string, LayoutGroupBox>();
  const emit = (units: Unit[], origin: LayoutPoint): void => {
    for (const unit of units) {
      const abs = { x: origin.x + unit.box.x, y: origin.y + unit.box.y };
      if (unit.kind === 'node') {
        nodes.set(unit.node!.nodeId, { x: Math.round(abs.x), y: Math.round(abs.y) });
        continue;
      }
      groups.set(unit.group!.groupId, {
        x: Math.round(abs.x),
        y: Math.round(abs.y),
        width: Math.round(unit.width),
        height: Math.round(unit.height),
      });
      // 组内内容从标题条下面、左边距里面开始
      emit(unit.children, { x: abs.x + GROUP_PAD.left, y: abs.y + GROUP_TITLE });
    }
  };
  emit(rootUnits, { x: 0, y: 0 });
  return { nodes, groups };
}

/** 整理前后的差异摘要，供提示语使用 */
export function layoutSummary(result: LayoutResult): { nodes: number; groups: number } {
  return { nodes: result.nodes.size, groups: result.groups.size };
}

/** 供测试与调用方换算：组内节点要减去组原点 */
export function toLocalPosition(absolute: LayoutPoint, group: LayoutGroupBox): LayoutPoint {
  return { x: absolute.x - group.x, y: absolute.y - group.y };
}

/** 组内节点的绝对位置（考虑嵌套） */
export function absoluteOfNode(diagram: ArchitectureDiagram, node: DiagramNode): LayoutPoint {
  const offset = groupOffset(diagram.groups, node.groupId ?? null);
  return { x: node.x + offset.x, y: node.y + offset.y };
}

/** 空图或只有连线时不需要整理 */
export function canAutoLayout(diagram: ArchitectureDiagram): boolean {
  return diagram.nodes.some(isLiveNode);
}
