import { type Edge, type Node } from '@xyflow/react';
import {
  groupHeaderHeight,
  isGroupLocked,
  isHiddenByCollapse,
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

export interface ArchEdgeData extends Record<string, unknown> {
  edge: DiagramEdge;
  /**
   * 全图节点的绝对矩形（不含自己两端），供正交路由做冲突绕行。
   * 同一次 toFlowEdges 里所有边共享同一个数组引用 —— 路由内部按引用缓存空间网格。
   */
  obstacles?: Rect[];
}

/** 三种线型（ortho / bezier / straight）共用一支自绘组件 */
export type ArchFlowEdge = Edge<ArchEdgeData, 'archEdge'>;

/** 组折叠后只显示标题栏；Schema 里的 height 仍是展开高度（C9），不能改 */
export function displayGroupHeight(group: DiagramGroup): number {
  // 折叠后只剩标题栏：单行分组 32px，带副文本的 42px
  return group.collapsed ? groupHeaderHeight(group) : group.height;
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
      const locked = isGroupLocked(g);
      const flow: SwimlaneFlowNode = {
        id: g.groupId,
        type: 'swimlane',
        position: { x: g.x, y: g.y },
        // width/height 必须给：MiniMap 用 nodeHasDimensions() 判断，只给 style 会整块空白
        width: g.width,
        height,
        style: { width: g.width, height },
        data: { group: g },
        selected,
        parentId: g.parentGroupId ?? undefined,
        // 分组永远在普通节点下面，避免挡住节点
        zIndex: 0,
        // 锁定的分组不能拖（但可以选中，用户 2026-11-04）
        draggable: !locked,
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
        // 同上：MiniMap 不认 style 里的尺寸
        width: n.width,
        height: n.height,
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

/**
 * Schema → ReactFlow 连线。
 *
 * 路由由 React Flow 的标准 `getSmoothStepPath` / `getBezierPath` / `getStraightPath`
 * 负责（见 ArchEdge），**不再需要障碍数组**：自研的绕行逻辑会掰出多余折角，
 * 已被用户否掉。原来每帧扫一遍节点算 obstacles 的开销也一起省了。
 */
export function toFlowEdges(diagram: ArchitectureDiagram, selectedIds: readonly string[] = []): Edge[] {
  const visible = new Set<string>(
    diagram.nodes
      .filter((n) => !n.isDeleted && n.visible && !isHiddenByCollapse(diagram.groups, n.groupId))
      .map((n) => n.nodeId),
  );
  // 分组也是合法端点（用户 2026-11-04）：父组折叠后自己也跟着藏起来
  for (const g of diagram.groups) {
    if (!isHiddenByCollapse(diagram.groups, g.parentGroupId)) visible.add(g.groupId);
  }

  return diagram.edges
    .filter((e) => !e.isDeleted)
    // 端点被折叠藏起来时，线也一起隐藏（否则会连到不存在的节点）
    .filter((e) => visible.has(e.sourceNodeId) && visible.has(e.targetNodeId))
    .map((e) => {
      return {
        id: e.edgeId,
        selected: selectedIds.includes(e.edgeId),
        // 三种线型都走同一个自绘组件：端点贴节点边框、箭头尺寸固定
        type: 'archEdge',
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
        // 箭头由 ArchEdge 按 data.edge.arrow 画（marker 需要跟线颜色走，见 ArchEdge）
        data: { edge: e },
      } as Edge;
    });
}

export function anchorOf(handleId: string | null | undefined): Anchor {
  return handleId === 'top' || handleId === 'right' || handleId === 'bottom' || handleId === 'left'
    ? handleId
    : 'right';
}


