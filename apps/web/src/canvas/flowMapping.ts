import { MarkerType, type Edge, type Node } from '@xyflow/react';
import {
  GROUP_HEADER_HEIGHT,
  isHiddenByCollapse,
  type Anchor,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
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
}

export type OrthoFlowEdge = Edge<OrthoEdgeData, 'orthoEdge'>;

/** 组折叠后只显示标题栏；Schema 里的 height 仍是展开高度（C9），不能改 */
export function displayGroupHeight(group: DiagramGroup): number {
  return group.collapsed ? GROUP_HEADER_HEIGHT : group.height;
}

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
    .map((g) => ({
      id: g.groupId,
      type: 'swimlane' as const,
      position: { x: g.x, y: g.y },
      style: { width: g.width, height: displayGroupHeight(g) },
      data: { group: g },
      selected: selectedIds.has(g.groupId),
      parentId: g.parentGroupId ?? undefined,
      // 分组永远在普通节点下面，避免挡住节点
      zIndex: 0,
      draggable: true,
    }));
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
    .map((n) => ({
      id: n.nodeId,
      type: 'archNode' as const,
      position: { x: n.x, y: n.y },
      style: { width: n.width, height: n.height },
      data: { node: n },
      selected: selected.has(n.nodeId),
      draggable: !n.locked,
      parentId: n.groupId ?? undefined,
      // 节点盖在分组之上；sort 决定同层节点的遮挡关系（右键置顶/置底、图层面板）
      zIndex: 10 + n.sort,
    }));

  return [...groups, ...nodes];
}

export function toFlowEdges(diagram: ArchitectureDiagram, selectedIds: readonly string[] = []): Edge[] {
  const visible = new Set(
    diagram.nodes
      .filter((n) => !n.isDeleted && n.visible && !isHiddenByCollapse(diagram.groups, n.groupId))
      .map((n) => n.nodeId),
  );

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
        data: { edge: e },
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


