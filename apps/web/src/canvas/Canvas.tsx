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
  SEMANTIC_EDGES,
  groupOffset,
  hitGroup,
  isAncestorOf,
  isHiddenByCollapse,
  nodeAbsoluteRect,
  rectContainsPoint,
} from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { GROUP_MIME, NODE_TYPE_MIME } from '../components/ComponentPanel.js';
import { toFlowEdges, toFlowNodes, type ArchFlowNode, type SwimlaneFlowNode } from './flowMapping.js';
import { ArchNode } from './ArchNode.js';
import { SwimlaneNode } from './SwimlaneNode.js';
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
  const showGrid = useDiagramStore((s) => s.showGrid);
  const setViewport = useDiagramStore((s) => s.setViewport);

  const { screenToFlowPosition, getViewport, setViewport: applyViewport } = useReactFlow();

  // Schema → ReactFlow：每次 diagram 变化重建，ReactFlow 内部按 id diff
  // 多选高亮交给 ReactFlow 的 selected 标记（框选/Ctrl 点选都由它维护）
  const nodes = useMemo(() => toFlowNodes(diagram, selectedIds), [diagram, selectedIds]);
  const edges = useMemo(() => toFlowEdges(diagram), [diagram]);

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

  // 记录起线节点：松手时如果落在某个节点身上，自动接到最近的一边
  const connectFrom = useRef<string | null>(null);
  const onConnectStart = useCallback((_event: unknown, params: { nodeId: string | null }) => {
    connectFrom.current = params.nodeId;
  }, []);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const sourceId = connectFrom.current;
      connectFrom.current = null;
      if (!sourceId) return;

      const touch = 'changedTouches' in event ? event.changedTouches[0] : undefined;
      const clientX = touch?.clientX ?? (event as MouseEvent).clientX;
      const clientY = touch?.clientY ?? (event as MouseEvent).clientY;
      if (clientX === undefined || clientY === undefined) return;

      const point = screenToFlowPosition({ x: clientX, y: clientY });

      // 指针下最上层的节点（跳过自己），按最近的一边接上
      const target = [...diagram.nodes]
        .filter((n) => n.nodeId !== sourceId && !isHiddenByCollapse(diagram.groups, n.groupId))
        .map((n) => ({ node: n, rect: nodeAbsoluteRect(diagram.groups, n) }))
        .filter(({ rect }) => rectContainsPoint(rect, point))
        .pop();

      if (!target) return;
      const anchor = nearestAnchor(point, target.rect);
      addEdge(sourceId, target.node.nodeId, anchor, anchor);
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
      // 落点对齐指针中心：拖拽时视觉上更符合"放在这里"
      const target = hitGroup(diagram.groups, point);
      const offset = target ? groupOffset(diagram.groups, target.groupId) : { x: 0, y: 0 };
      const size = { width: 160, height: 80 };
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
  const onNodeDragStop = useCallback<OnNodeDrag<ArchFlowNode | SwimlaneFlowNode>>(
    (_event, node) => {
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

  return (
    <div
      ref={wrapperRef}
      className={`h-full w-full ${spaceHeld ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
    <ReactFlow
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
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      onPaneClick={() => select(null)}
      deleteKeyCode={['Delete', 'Backspace']}
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
    </div>
  );
}

/** 画布外壳：网格、提示与语义色图例都挂在这里 */
export function Canvas() {
  const nodeCount = useDiagramStore((s) => s.diagram.nodes.length);
  const showGrid = useDiagramStore((s) => s.showGrid);
  const toggleGrid = useDiagramStore((s) => s.toggleGrid);

  return (
    <main className="relative min-w-0 flex-1 bg-[var(--canvas-bg)]">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>

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

      <SemanticLegend />
    </main>
  );
}

/** 连线语义色基线（规格 §3.5），M2 起由属性面板复用 */
function SemanticLegend() {
  return (
    <div className="absolute bottom-3 left-3 z-10 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)]/95 p-2.5 text-[11px]">
      <div className="mb-1.5 font-semibold text-[var(--text-secondary)]">连线语义色</div>
      <ul className="space-y-1">
        {Object.values(SEMANTIC_EDGES).map((style) => (
          <li key={style.kind} className="flex items-center gap-2">
            <span
              className="inline-block w-6 rounded"
              style={{
                background: style.strokeColor,
                height: Math.max(style.strokeWidth, 1),
                opacity: style.strokeDasharray ? 0.75 : 1,
              }}
            />
            <span className="text-[var(--text-secondary)]">
              {style.label} · {style.strokeWidth}px
              {style.strokeDasharray ? ' 虚线' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}










