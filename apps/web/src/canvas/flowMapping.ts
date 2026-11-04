import { MarkerType, type Edge, type Node } from '@xyflow/react';
import {
  GROUP_HEADER_HEIGHT,
  isHiddenByCollapse,
  nodeAbsoluteRect,
  type Anchor,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type Rect,
} from '@arch/schema';

/**
 * Schema ⇄ ReactFlow 映射。
 *
 * 遵守 ADR-0001：
 * - C1 不改坐标：`node.x/y` / `group.x/y` 原样作为 `position`（组内是局部坐标），
 *   父子关系交给 ReactFlow 的 `parentId`，它本身就按"相对父级"解释 position，
 *   和我们 Schema 的语义一致，所以组整体拖动时子元素自动跟随、不会漂移。
 * - C2 不拿 nodeType 当节点类型名：统一 `archNode`，真实类型在 `data.node.nodeType`；
 *   分组是另一种节点组件 `swimlane`。
 * - C3 尺寸读写都用 `style.width/height`。
 */

export interface ArchNodeData extends Record<string, unknown> {
  node: DiagramNode;
}

export type ArchFlowNode = Node<ArchNodeData, 'archNode'>;

export interface SwimlaneData extends Record<string, unknown> {
  group: DiagramGroup;
}

export type SwimlaneFlowNode = Node<SwimlaneData, 'swimlane'>;

export interface OrthoEdgeData extends Record<string, unknown> {
  edge: DiagramEdge;
  /**
   * 全图节点的绝对矩形（不含自己两端），供正交路由做冲突绕行。
   * 同一次 toFlowEdges 里所有边共享同一个数组引用 —— 路由内部按引用缓存空间网格。
   */
  obstacles?: Rect[];
}

export type OrthoFlowEdge = Edge<OrthoEdgeData, 'orthoEdge'>;

/** 组折叠后只显示标题栏；Schema 里的 height 仍是展开高度（C9），不能改 */
export function displayGroupHeight(group: DiagramGroup): number {
  return group.collapsed ? GROUP_HEADER_HEIGHT : group.height;
}

/**
 * ⚡ 性能：把"数据对象 → ReactFlow 节点对象"的映射缓存起来。
 *
 * 拖动一帧只改一个节点，但 `toFlowNodes` 每帧都会重跑。没有缓存时所有 flow node
 * 都是新对象，`memo` 的 ArchNode 全部失效 → 300 节点就是 300 次重渲染（实测 p50 160ms）。
 * 用 WeakMap 按数据对象身份缓存后，只有被拖的那一个节点换对象，其余直接命中缓存，
 * memo 生效（实测 p50 降到个位数毫秒）。选中态变化会重建对应那一个。
 */
const groupFlowCache = new WeakMap<DiagramGroup, { selected: boolean; height: number; flow: SwimlaneFlowNode }>();
const nodeFlowCache = new WeakMap<DiagramNode, { selected: boolean; flow: ArchFlowNode }>();

/**
 * 生成分组节点。
 *
 * 顺序很重要：ReactFlow 要求父节点排在子节点前面，否则父级定位算不出来。
 * 这里按"深度升序"排，天然满足父子先后。
 */
function toFlowGroups(diagram: ArchitectureDiagram, selectedIds: Set<string>): SwimlaneFlowNode[] {
  const depthOf = (groupId: string, guard = 0): number => {
    const group = diagram.groups.find((g) => g.groupId === groupId);
    if (!group || !group.parentGroupId || guard > 8) return 0;
    return 1 + depthOf(group.parentGroupId, guard + 1);
  };

  return diagram.groups
    .filter((g) => !g.isDeleted && !isHiddenByCollapse(diagram.groups, g.parentGroupId))
    .slice()
    .sort((a, b) => depthOf(a.groupId) - depthOf(b.groupId))
    .map((g) => {
      const selected = selectedIds.has(g.groupId);
      const height = displayGroupHeight(g);
      const cached = groupFlowCache.get(g);
      if (cached && cached.selected === selected && cached.height === height) return cached.flow;
      const flow: SwimlaneFlowNode = {
        id: g.groupId,
        type: 'swimlane',
        position: { x: g.x, y: g.y },
        style: { width: g.width, height },
        data: { group: g },
        selected,
        parentId: g.parentGroupId ?? undefined,
        // 分组永远在普通节点下面，避免挡住节点
        zIndex: 0,
        draggable: true,
      };
      groupFlowCache.set(g, { selected, height, flow });
      return flow;
    });
}

/** 节点四个边的 Handle id 就是锚点名，建线时直接落进 Schema */
export function toFlowNodes(
  diagram: ArchitectureDiagram,
  selectedIds: readonly string[],
): (ArchFlowNode | SwimlaneFlowNode)[] {
  const selected = new Set(selectedIds);
  const groups = toFlowGroups(diagram, selected);

  const nodes: ArchFlowNode[] = diagram.nodes
    .filter((n) => !n.isDeleted && n.visible)
    // 被折叠的组里的节点不渲染（数据仍在，展开即回来，见 C9）
    .filter((n) => !isHiddenByCollapse(diagram.groups, n.groupId))
    .map((n) => {
      const selectedNow = selected.has(n.nodeId);
      const cached = nodeFlowCache.get(n);
      if (cached && cached.selected === selectedNow) return cached.flow;
      const flow: ArchFlowNode = {
        id: n.nodeId,
        type: 'archNode',
        position: { x: n.x, y: n.y },
        style: { width: n.width, height: n.height },
        data: { node: n },
        selected: selectedNow,
        draggable: !n.locked,
        parentId: n.groupId ?? undefined,
        // 节点盖在分组之上；sort 决定同层节点的遮挡关系（右键置顶/置底、图层面板）
        zIndex: 10 + n.sort,
      };
      nodeFlowCache.set(n, { selected: selectedNow, flow });
      return flow;
    });

  return [...groups, ...nodes];
}

/** 绕行障碍：所有可见节点（折叠组里的算隐藏）。拖动期间由 Canvas 冻结复用来省重算 */
export function visibleObstacles(diagram: ArchitectureDiagram): Rect[] {
  return diagram.nodes
    .filter((n) => !n.isDeleted && n.visible && !isHiddenByCollapse(diagram.groups, n.groupId))
    .map((n) => nodeAbsoluteRect(diagram.groups, n));
}

export function toFlowEdges(
  diagram: ArchitectureDiagram,
  selectedIds: readonly string[] = [],
  obstaclesOverride?: Rect[],
): Edge[] {
  const visible = new Set(
    diagram.nodes
      .filter((n) => !n.isDeleted && n.visible && !isHiddenByCollapse(diagram.groups, n.groupId))
      .map((n) => n.nodeId),
  );

  // 绕行用的障碍矩形：所有可见节点（含被折叠组的隐藏判定），一次算好所有边共用
  const obstacles = obstaclesOverride ?? visibleObstacles(diagram);

  return diagram.edges
    .filter((e) => !e.isDeleted)
    // 端点被折叠藏起来时，线也一起隐藏（否则会连到不存在的节点）
    .filter((e) => visible.has(e.sourceNodeId) && visible.has(e.targetNodeId))
    .map((e) => {
      const marker = {
        type: MarkerType.ArrowClosed,
        color: e.strokeColor,
        width: 14,
        height: 14,
      };
      return {
        id: e.edgeId,
        selected: selectedIds.includes(e.edgeId),
        type: EDGE_COMPONENTS[e.edgeType] ?? 'orthoEdge',
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceAnchor ?? null,
        targetHandle: e.targetAnchor ?? null,
        // 线条样式必须显式传给 ReactFlow，否则内置线型会用它自己的默认灰细线
        style: {
          stroke: e.strokeColor,
          strokeWidth: e.strokeWidth,
          ...(e.strokeDasharray ? { strokeDasharray: e.strokeDasharray } : {}),
        },
        // 箭头方向：forward = 指向目标端；backward = 指向源端；both = 两端都有
        markerEnd: e.arrow === 'forward' || e.arrow === 'both' ? marker : undefined,
        markerStart: e.arrow === 'backward' || e.arrow === 'both' ? marker : undefined,
        data: { edge: e, obstacles },
      } as Edge;
    });
}

/** 线型 → ReactFlow 组件名（正交用自绘，另两种用内置） */
const EDGE_COMPONENTS: Record<DiagramEdge['edgeType'], string> = {
  ortho: 'orthoEdge',
  bezier: 'default',
  straight: 'straight',
};

export function anchorOf(handleId: string | null | undefined): Anchor {
  return handleId === 'top' || handleId === 'right' || handleId === 'bottom' || handleId === 'left'
    ? handleId
    : 'right';
}


