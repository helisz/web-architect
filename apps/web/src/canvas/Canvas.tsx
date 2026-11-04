import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnNodeDrag,
  type Viewport as FlowViewport,
} from '@xyflow/react';
import type { NodeType } from '@arch/schema';
import {
  COMPONENT_INDEX,
  NODE_DEFAULTS,
  groupOffset,
  hitGroup,
  isAncestorOf,
  isHiddenByCollapse,
  nodeAbsoluteRect,
  rectContainsPoint,
} from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useTransfer } from '../hooks/useTransfer.js';
import { ContextMenu, type MenuNode } from '../components/ContextMenu.js';
import {
  buildBlankMenu,
  buildEdgeMenu,
  buildGroupMenu,
  buildNodeMenu,
  setMenuEnv,
  type MenuEnv,
} from './contextMenus.js';
import { GROUP_MIME, NODE_TYPE_MIME } from '../components/ComponentPanel.js';
import { toFlowEdges, toFlowNodes, visibleObstacles, type ArchFlowNode, type SwimlaneFlowNode } from './flowMapping.js';
import { ArchNode } from './ArchNode.js';
import { SwimlaneNode } from './SwimlaneNode.js';
import { AlignToolbar } from '../components/AlignToolbar.js';
import { SearchDialog } from '../components/SearchDialog.js';
import { LayerPanel } from '../components/LayerPanel.js';
import { OrthoEdge } from './OrthoEdge.js';

const nodeTypes = { archNode: ArchNode, swimlane: SwimlaneNode };
const edgeTypes = { orthoEdge: OrthoEdge };

/** 吸附网格（px）：背景线密度与吸附粒度保持一致 */
export const SNAP_GRID: [number, number] = [10, 10];
/** 连线手柄的命中半径：比视觉圆点大一圈，拖到节点附近就能接上 */
export const CONNECTION_RADIUS = 36;

/** 吸附取整 */
const snap = (value: number): number => Math.round(value / SNAP_GRID[0]) * SNAP_GRID[0];

/** 按松手位置判断落在节点的哪一边（取最近的一侧） */
function nearestAnchor(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): 'top' | 'right' | 'bottom' | 'left' {
  const dx = point.x - (rect.x + rect.width / 2);
  const dy = point.y - (rect.y + rect.height / 2);
  const normalizedX = Math.abs(dx) / Math.max(1, rect.width / 2);
  const normalizedY = Math.abs(dy) / Math.max(1, rect.height / 2);
  if (normalizedX > normalizedY) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'bottom' : 'top';
}

/** 拖线起点手柄 → 锚点；拿不到（中键/脚本触发）时退回右边 */
function anchorOfHandle(handleId: string | null): 'top' | 'right' | 'bottom' | 'left' {
  return handleId === 'top' || handleId === 'right' || handleId === 'bottom' || handleId === 'left'
    ? handleId
    : 'right';
}

function CanvasInner() {
  const diagram = useDiagramStore((s) => s.diagram);
  const addNode = useDiagramStore((s) => s.addNode);
  const addGroup = useDiagramStore((s) => s.addGroup);
  const moveNode = useDiagramStore((s) => s.moveNode);
  const resizeNode = useDiagramStore((s) => s.resizeNode);

  const moveGroup = useDiagramStore((s) => s.moveGroup);
  const resizeGroup = useDiagramStore((s) => s.resizeGroup);
  const reparentNode = useDiagramStore((s) => s.reparentNode);
  const reparentGroup = useDiagramStore((s) => s.reparentGroup);
  const addEdge = useDiagramStore((s) => s.addEdge);

  const select = useDiagramStore((s) => s.select);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const updateSelection = useDiagramStore((s) => s.updateSelection);
  const requestDelete = useDiagramStore((s) => s.requestDelete);
  // 确认框开着时不再接受 Delete，避免一次按键堆两个待删清单
  const deleting = useDiagramStore((s) => s.pendingDelete !== null);
  const showGrid = useDiagramStore((s) => s.showGrid);
  const setViewport = useDiagramStore((s) => s.setViewport);

  const { screenToFlowPosition, getViewport, setViewport: applyViewport, fitView } = useReactFlow();

  // 右键菜单位置与内容（四套菜单在 contextMenus.ts 里组装）
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuNode[] } | null>(null);
  const { exportJson, exportPng } = useTransfer();
  const setCursor = useDiagramStore((s) => s.setCursor);
  // 节点移动结束后，边延迟这么久再补算（躲开连续移动的中间帧）
const EDGE_CATCHUP_MS = 180;

const cursorFrame = useRef<number | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);

  // Schema → ReactFlow：每次 diagram 变化重建，ReactFlow 内部按 id diff
  // 多选高亮交给 ReactFlow 的 selected 标记（框选/Ctrl 点选都由它维护）
  const nodes = useMemo(() => toFlowNodes(diagram, selectedIds), [diagram, selectedIds]);
  // 拖动期间冻结障碍数组：未被拖动的节点位置没变，边就不用整批重算绕行
  const [dragging, setDragging] = useState(false);
  const frozenObstacles = useRef<ReturnType<typeof visibleObstacles> | null>(null);
  const liveObstacles = useMemo(() => visibleObstacles(diagram), [diagram]);
  const edgeObstacles = dragging && frozenObstacles.current ? frozenObstacles.current : liveObstacles;

  /**
   * 非拖拽式的"节点在动"（键盘微调、属性面板改坐标、批量对齐）也要冻结 edges。
   *
   * 判据很窄：节点数量/尺寸/顺序都没变，只是 x/y 变了 —— 这种情况下位置变化
   * 一定来自一次移动操作，冻结 180ms 让边在动完后再补算。增删节点/改尺寸不会
   * 走到这里，所以不会出现"新边要等 180ms 才出现"的怪现象。
   */
  const lastNodes = useRef(diagram.nodes);
  const [movingNodes, setMovingNodes] = useState(false);
  useEffect(() => {
    const prev = lastNodes.current;
    lastNodes.current = diagram.nodes;
    if (prev === diagram.nodes || prev.length !== diagram.nodes.length) return;

    let positionChanged = false;
    for (let i = 0; i < prev.length; i += 1) {
      const before = prev[i]!;
      const after = diagram.nodes[i]!;
      if (before.nodeId !== after.nodeId || before.width !== after.width || before.height !== after.height) return;
      if (before.x !== after.x || before.y !== after.y) positionChanged = true;
    }
    if (!positionChanged) return;

    setMovingNodes(true);
    const timer = setTimeout(() => setMovingNodes(false), EDGE_CATCHUP_MS);
    return () => clearTimeout(timer);
  }, [diagram.nodes]);

  const frozen = dragging || movingNodes;
  /**
   * 拖动/移动期间直接复用上一批 edges。
   *
   * 边长什么样不靠 props 推：`OrthoEdge` 用 `useInternalNode` 订阅节点内部位置，
   * 被拖动的节点一动，相邻边自己就会重画。所以整批重建 edges（1000 条 → 1000 次
   * 组件重渲染 + 路径计算）纯属浪费 —— 冻结后连算都不算，帧时间从 ~138ms 降到十几毫秒。
   */
  const edgesRef = useRef<ReturnType<typeof toFlowEdges> | null>(null);
  const computedEdges = useMemo(
    () => (frozen && edgesRef.current ? edgesRef.current : toFlowEdges(diagram, selectedIds, edgeObstacles)),
    [frozen, diagram, selectedIds, edgeObstacles],
  );
  if (!frozen) edgesRef.current = computedEdges;
  const edges = frozen && edgesRef.current ? edgesRef.current : computedEdges;

  const groupIds = useMemo(() => new Set(diagram.groups.map((g) => g.groupId)), [diagram.groups]);

  // 空格按住才能拖动画布（Figma 式）；松手立刻恢复
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isTyping(event.target)) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') setSpaceHeld(false);
    };
    const onBlur = (): void => setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // 普通滚轮 = 上下平移；Ctrl/Cmd + 滚轮交给 ReactFlow 缩放
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const onWheelNative = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const { x, y, zoom } = getViewport();
      applyViewport({ x, y: y - (event.deltaY / zoom) * 0.9, zoom });
    };
    element.addEventListener('wheel', onWheelNative, { passive: false });
    return () => element.removeEventListener('wheel', onWheelNative);
  }, [applyViewport, getViewport]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const added: string[] = [];
      const removed: string[] = [];
      const toDelete: string[] = [];

      for (const change of changes) {
        const id = 'id' in change ? change.id : '';
        if (!id) continue;
        const isGroup = groupIds.has(id);
        if (change.type === 'position' && change.position) {
          if (isGroup) moveGroup(id, change.position);
          else moveNode(id, change.position);
        } else if (change.type === 'dimensions' && change.dimensions && change.resizing) {
          // 只在用户拖拽 resize 手柄时写回；初次测量不算。尺寸同样吸附到网格
          const size = { width: snap(change.dimensions.width), height: snap(change.dimensions.height) };
          if (isGroup) resizeGroup(id, size);
          else resizeNode(id, size);
        } else if (change.type === 'select') {
          if ('selected' in change && change.selected) added.push(id);
          else removed.push(id);
        } else if (change.type === 'remove') {
          // 删除一律走二次确认，不在这里真删
          toDelete.push(id);
        }
      }

      if (added.length || removed.length) updateSelection(added, removed);
      if (toDelete.length) requestDelete(toDelete);
    },
    [groupIds, moveGroup, moveNode, resizeGroup, resizeNode, updateSelection, requestDelete],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const added: string[] = [];
      const removed: string[] = [];
      const toDelete: string[] = [];
      for (const change of changes) {
        if (!('id' in change) || !change.id) continue;
        if (change.type === 'select') {
          if ('selected' in change && change.selected) added.push(change.id);
          else removed.push(change.id);
        } else if (change.type === 'remove') {
          toDelete.push(change.id);
        }
      }
      if (added.length || removed.length) updateSelection(added, removed);
      if (toDelete.length) requestDelete(toDelete);
    },
    [updateSelection, requestDelete],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      addEdge(connection.source, connection.target, connection.sourceHandle ?? 'right', connection.targetHandle ?? 'left');
    },
    [addEdge],
  );

  // 记录起线节点与起点手柄：松手时如果落在某个节点身上，自动接到最近的一边
  const connectFrom = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  // 本次拖拽开始时的连线数：用来判断"松手时是不是已经连上了"，
  // 避免 onConnect 和下面的自动吸附各建一条（历史上出现过一次拖出两条箭头）
  const edgesAtStart = useRef(0);

  const onConnectStart = useCallback(
    (_event: unknown, params: { nodeId: string | null; handleId?: string | null }) => {
      connectFrom.current = params.nodeId ? { nodeId: params.nodeId, handleId: params.handleId ?? null } : null;
      edgesAtStart.current = useDiagramStore.getState().diagram.edges.length;
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const from = connectFrom.current;
      connectFrom.current = null;
      if (!from) return;

      // 正常落到手柄上时 onConnect 已经建过线了，这里直接收手
      if (useDiagramStore.getState().diagram.edges.length > edgesAtStart.current) return;

      const touch = 'changedTouches' in event ? event.changedTouches[0] : undefined;
      const clientX = touch?.clientX ?? (event as MouseEvent).clientX;
      const clientY = touch?.clientY ?? (event as MouseEvent).clientY;
      if (clientX === undefined || clientY === undefined) return;

      const point = screenToFlowPosition({ x: clientX, y: clientY });

      // 指针下最上层的节点（跳过自己），按最近的一边接上
      const target = [...diagram.nodes]
        .filter((n) => n.nodeId !== from.nodeId && !isHiddenByCollapse(diagram.groups, n.groupId))
        .map((n) => ({ node: n, rect: nodeAbsoluteRect(diagram.groups, n) }))
        .filter(({ rect }) => rectContainsPoint(rect, point))
        .pop();

      if (!target) return;
      // 源端用"你实际拖出的那个手柄"，不能拿目标端的一边顶替，
      // 否则从任意手柄拖出来都变成同一条线（曾经的 bug）。
      // 目标端按"朝向起点的那个边"接上：落在节点中间时不至于随机挑一边。
      const sourceAnchor = anchorOfHandle(from.handleId);
      const sourceNode = diagram.nodes.find((n) => n.nodeId === from.nodeId);
      const sourceRect = sourceNode ? nodeAbsoluteRect(diagram.groups, sourceNode) : null;
      const targetAnchor = sourceRect
        ? nearestAnchor({ x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 }, target.rect)
        : nearestAnchor(point, target.rect);
      addEdge(from.nodeId, target.node.nodeId, sourceAnchor, targetAnchor);
    },
    [addEdge, diagram.groups, diagram.nodes, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // 1) 拖进来的是"分组"：建框，落点即框的左上角附近（居中更像"框住这里"）
      const isGroup = event.dataTransfer.getData(GROUP_MIME) === 'group';
      if (isGroup) {
        const size = { width: 360, height: 240 };
        const target = hitGroup(diagram.groups, point);
        const offset = target ? groupOffset(diagram.groups, target.groupId) : { x: 0, y: 0 };
        const created = addGroup(
          { x: point.x - offset.x - size.width / 2, y: point.y - offset.y - size.height / 2 },
          { width: size.width, height: size.height },
        );
        // 拖进另一个分组里 = 嵌套（上限 3 层，超出会被 store 拒绝）
        if (target) reparentGroup(created.groupId, target.groupId);
        return;
      }

      // 2) 普通节点
      const nodeType = event.dataTransfer.getData(NODE_TYPE_MIME) as NodeType;
      if (!nodeType) return;
      // 落点对齐指针中心：拖拽时视觉上更符合"放在这里"。
      // 尺寸按组件表取默认值 —— 交换机/路由器是 120×60，用统一的 160×80 会偏出十几像素。
      const target = hitGroup(diagram.groups, point);
      const offset = target ? groupOffset(diagram.groups, target.groupId) : { x: 0, y: 0 };
      const spec = COMPONENT_INDEX[nodeType];
      const size = { width: spec?.width ?? NODE_DEFAULTS.width, height: spec?.height ?? NODE_DEFAULTS.height };
      addNode(
        nodeType,
        {
          x: point.x - offset.x - size.width / 2,
          y: point.y - offset.y - size.height / 2,
        },
        target?.groupId ?? null,
      );
    },
    [addGroup, addNode, diagram.groups, reparentGroup, screenToFlowPosition],
  );

  /**
   * 拖拽结束：按"节点中心"决定是否换组。
   *
   * ReactFlow 给的 position 对子节点而言是相对父级的，所以要用组偏移换算回绝对坐标再判定；
   * 换组后由 setNodeGroup 把坐标换回新父级的局部坐标，屏幕上位置不变（C1）。
   */
  /**
   * 拖拽开始：冻结当前障碍数组。
   * 拖动期间节点位置每帧都变，但"障碍"只对被拖的那一个节点有影响 ——
   * 冻结后其余边入参不变，`OrthoEdge` 里的路径缓存直接命中，节点多了也不掉帧。
   */
  const onNodeDragStart = useCallback(() => {
    frozenObstacles.current = liveObstacles;
    setDragging(true);
  }, [liveObstacles]);

  const onNodeDragStop = useCallback<OnNodeDrag<ArchFlowNode | SwimlaneFlowNode>>(
    (_event, node) => {
      // 先解冻：松手后要按最新位置重算一次绕行
      frozenObstacles.current = null;
      setDragging(false);

      const local = { x: node.position.x, y: node.position.y };
      const parentId = node.parentId ?? null;
      const isGroup = groupIds.has(node.id);

      // 先把最终位置落进 store：onNodesChange 的最后一帧可能还没派发到这里，
      // 直接拿 store 里的旧坐标换算会出现"松手瞬间跳一下"。
      if (isGroup) moveGroup(node.id, local);
      else moveNode(node.id, local);

      const state = useDiagramStore.getState();
      const groups = state.diagram.groups;
      const offset = groupOffset(groups, parentId);

      if (isGroup) {
        const group = groups.find((g) => g.groupId === node.id);
        if (!group) return;
        const center = {
          x: offset.x + local.x + group.width / 2,
          y: offset.y + local.y + group.height / 2,
        };
        // 可以拖进别的分组，但不能进自己或自己的后代（会成环）
        const exclude = [node.id, ...groups.filter((g) => isAncestorOf(groups, node.id, g.groupId)).map((g) => g.groupId)];
        const target = hitGroup(groups, center, exclude);
        const nextParent = target?.groupId ?? null;
        if (nextParent !== parentId) reparentGroup(node.id, nextParent);
        return;
      }

      const current = state.diagram.nodes.find((n) => n.nodeId === node.id);
      if (!current) return;
      const center = {
        x: offset.x + local.x + current.width / 2,
        y: offset.y + local.y + current.height / 2,
      };
      const target = hitGroup(groups, center);
      if ((target?.groupId ?? null) !== parentId) reparentNode(node.id, target?.groupId ?? null);
    },
    [groupIds, moveGroup, moveNode, reparentGroup, reparentNode],
  );

  const onMoveEnd = useCallback(
    (_: unknown, viewport: FlowViewport) => setViewport(viewport),
    [setViewport],
  );

  /* ---------------- 右键菜单 ---------------- */

  const menuEnv = useCallback(
    (event: { clientX: number; clientY: number }): MenuEnv => ({
      flowPoint: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      fitView: () => void fitView({ padding: 0.12, duration: 260 }),
      resetZoom: () => {
        const { x, y } = getViewport();
        applyViewport({ x, y, zoom: 1 }, { duration: 200 });
      },
      exportJson: () => void exportJson(),
      exportPng: () => void exportPng(),
    }),
    [applyViewport, exportJson, exportPng, fitView, getViewport, screenToFlowPosition],
  );

  const openMenu = useCallback((event: { clientX: number; clientY: number }, items: MenuNode[]) => {
    setMenuEnv(menuEnv(event));
    setMenu({ x: event.clientX, y: event.clientY, items });
  }, [menuEnv]);

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: { id: string }) => {
      event.preventDefault();
      const state = useDiagramStore.getState();
      if (!state.selectedIds.includes(node.id)) state.select(node.id);
      const group = state.diagram.groups.find((g) => g.groupId === node.id);
      if (group) {
        openMenu(event, buildGroupMenu(group));
        return;
      }
      const target = state.diagram.nodes.find((n) => n.nodeId === node.id);
      if (target) openMenu(event, buildNodeMenu(target));
    },
    [openMenu],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      const state = useDiagramStore.getState();
      state.select(edge.id);
      const target = state.diagram.edges.find((e) => e.edgeId === edge.id);
      if (target) openMenu(event, buildEdgeMenu(target));
    },
    [openMenu],
  );

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      useDiagramStore.getState().select(null);
      openMenu(event as React.MouseEvent, buildBlankMenu());
    },
    [openMenu],
  );

  /** 状态栏坐标：rAF 节流，避免每次 mousemove 都推一次 store */
  const onPointerMove = useCallback(
    (event: React.MouseEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY };
      if (cursorFrame.current !== null) return;
      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = null;
        const point = lastPointer.current;
        if (!point) return;
        setCursor(screenToFlowPosition({ x: point.x, y: point.y }));
      });
    },
    [screenToFlowPosition, setCursor],
  );

  const onPointerLeave = useCallback(() => {
    lastPointer.current = null;
    setCursor(null);
  }, [setCursor]);

  return (
    <div
      ref={wrapperRef}
      className={`h-full w-full ${spaceHeld ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onMouseMove={onPointerMove}
      onMouseLeave={onPointerLeave}
    >
    <ReactFlow
      // 节点超过 300 个时只渲染视口内的节点（规格 §11.4）；小图不启用，
      // 免得拖出视口边缘时出现"元素消失又出现"的观感抖动
      onlyRenderVisibleElements={diagram.nodes.length >= 300}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      // Loose：任意 Handle 都能起线/接收，四边皆可（规格 §4.2 建线）
      connectionMode={ConnectionMode.Loose}
      // 吸附：元素按 10px 网格对齐（背景栅格密度与之保持一致）
      snapToGrid
      snapGrid={SNAP_GRID}
      // 交互（2026-11-04 定稿）：空白拖拽不平移，按住空格才拖动画布；
      // 滚轮只在 Ctrl/Cmd 时缩放，普通滚轮上下平移（见上面的 wheel 监听）。
      panOnDrag={spaceHeld}
      panActivationKeyCode="Space"
      // 空白处拖动 = 框选（多选）；按住空格则变成平移
      selectionOnDrag={!spaceHeld}
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      zoomOnScroll={false}
      zoomActivationKeyCode={['Control', 'Meta']}
      zoomOnPinch
      zoomOnDoubleClick={false}
      // 手柄命中半径放大，拖到节点附近就能接上
      connectionRadius={CONNECTION_RADIUS}
      defaultViewport={diagram.viewport}
      minZoom={0.1}
      maxZoom={4}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectStart={onConnectStart}
      onConnectEnd={onConnectEnd}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      onPaneClick={() => select(null)}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      deleteKeyCode={deleting ? null : ['Delete', 'Backspace']}
      proOptions={{ hideAttribution: false }}
      className="bg-transparent"
    >
      {/* 规格 §5.1：网格，1px 细线，无渐变（吸附密度翻倍 → 10px，颜色调淡） */}
      {showGrid && <Background variant={BackgroundVariant.Lines} gap={SNAP_GRID[0]} size={1} color="#F1F2F4" />}
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => (n.type === 'archNode' ? '#D1D5DB' : '#EEF1F4')}
        maskColor="rgba(250,250,250,0.7)"
        style={{ width: 160, height: 110 }}
      />
    </ReactFlow>
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    <SearchDialog />
    </div>
  );
}

/** 画布外壳：网格与空状态提示都挂在这里 */
export function Canvas() {
  const nodeCount = useDiagramStore((s) => s.diagram.nodes.length);
  const showGrid = useDiagramStore((s) => s.showGrid);
  const toggleGrid = useDiagramStore((s) => s.toggleGrid);

  return (
    <main className="relative min-w-0 flex-1 bg-[var(--canvas-bg)]">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
      <AlignToolbar />
      <LayerPanel />

      {/* 右上角：网格开关（本地记忆） */}
      <button
        type="button"
        onClick={toggleGrid}
        title={showGrid ? '隐藏网格' : '显示网格'}
        className={`absolute right-3 top-3 z-20 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] shadow-sm ${
          showGrid
            ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
            : 'border-[var(--panel-border)] bg-[var(--panel-bg)] text-[var(--text-secondary)]'
        }`}
      >
        <span className="grid h-3 w-3 place-items-center">
          <span
            className="h-3 w-3 rounded-[2px] border"
            style={{
              borderColor: showGrid ? 'var(--primary)' : 'var(--text-secondary)',
              backgroundImage: showGrid
                ? 'repeating-linear-gradient(0deg, var(--primary) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, var(--primary) 0 1px, transparent 1px 3px)'
                : 'none',
            }}
          />
        </span>
        网格
      </button>
      {nodeCount === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-lg border border-dashed border-[#D1D5DB] bg-white/80 px-6 py-5 text-center">
            <p className="text-sm font-semibold">从左侧面板拖一个组件到这里</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              拖拽节点边缘的小圆点即可连线 · 空格 + 拖动平移 · Ctrl + 滚轮缩放 · Delete 删除
            </p>
          </div>
        </div>
      )}

    </main>
  );
}













