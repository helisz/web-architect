import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ControlButton,
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
  GROUP_PRESETS,
  NODE_DEFAULTS,
  groupOffset,
  isEditLocked,
  hitGroup,
  isAncestorOf,
  isHiddenByCollapse,
  groupAbsoluteRect,
  nodeAbsoluteRect,
  rectContainsPoint,
} from '@arch/schema';
import { useDiagramStats, useDiagramStore } from '../store/useDiagramStore.js';
import { saveLocalViewport } from '../data/viewportPrefs.js';
import { useTransfer } from '../hooks/useTransfer.js';
import { ContextMenu, type MenuNode } from '../components/ContextMenu.js';
import { ToolIcon } from '../components/ToolIcons.js';
import {
  buildBlankMenu,
  buildEdgeMenu,
  buildGroupMenu,
  buildNodeMenu,
  setMenuEnv,
  type MenuEnv,
} from './contextMenus.js';
import { GROUP_MIME, NODE_TYPE_MIME } from '../components/ComponentPanel.js';
import { toFlowEdges, toFlowNodes, type ArchFlowNode, type SwimlaneFlowNode } from './flowMapping.js';
import { ArchNode } from './ArchNode.js';
import { SwimlaneNode } from './SwimlaneNode.js';
import { AlignToolbar } from '../components/AlignToolbar.js';
import { SearchDialog } from '../components/SearchDialog.js';
import { LayerPanel } from '../components/LayerPanel.js';
import { useEdgeLabelEdit } from '../store/useEdgeLabelEdit.js';
import { useCanvasMode } from '../store/useCanvasMode.js';
import { ArchEdge } from './ArchEdge.js';
import { edgeIdsInRect, rectFromPoints } from './edgeHitTest.js';
import { ArchConnectionLine } from './ArchConnectionLine.js';
import { nextZoom, zoomAroundCenter, ZOOM_RESET_EVENT } from './zoom.js';
import { peekStagedImport, takeStagedImport } from '../ai/staging.js';

const nodeTypes = { archNode: ArchNode, swimlane: SwimlaneNode };
// 三种线型（正交 / 曲线 / 直线）都走同一支自绘线：端点统一贴节点边框，
// 曲线和直线内部仍是 ReactFlow 标准的 getBezierPath / getStraightPath。
const edgeTypes = { archEdge: ArchEdge };

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
  // 全局锁定：只读模式下关掉拖动/连线/删除等一切改写入口（store 里还有一层兜底）
  const editLocked = useDiagramStore((s) => isEditLocked(s.diagram));
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
  const applyAiImport = useDiagramStore((s) => s.applyAiImport);
  const pushToast = useDiagramStore((s) => s.pushToast);

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
  /*
   * 拖动模式（用户 2026-11-05）：画布右上角的 toggle，把「按住空格」变成常驻状态。
   * 打开后：拖空白处 = 平移画布，节点不可拖（避免误拖）；框选让位给平移。
   * 只存在内存里，不随图保存 —— 这是操作习惯，不是图的内容。
   */
  // 空格按住才能拖动画布（Figma 式）；松手立刻恢复
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panMode = useCanvasMode((s) => s.panMode);
  const panActive = panMode || spaceHeld;
  const startEdgeLabelEdit = useEdgeLabelEdit((s) => s.start);

  /**
   * AI 解析落图（用户 2026-11-05）：图库那边解析完成后把结果暂存在内存里，
   * 这里一挂载就整批写入 —— 撤销栈的上一格正是"空图"，所以 Ctrl+Z 一次清空。
   */
  const aiImportDone = useRef(false);
  useEffect(() => {
    if (aiImportDone.current) return;
    const staged = peekStagedImport();
    if (!staged) return;
    const spec = takeStagedImport(diagram.diagramId);
    if (!spec) return;
    aiImportDone.current = true;
    const applied = applyAiImport(spec);
    pushToast(
      `已落图：${applied.nodes} 个节点 / ${applied.edges} 条连线 / ${applied.groups} 个分组（Ctrl+Z 可整体撤销）`,
      'info',
    );
    // 等节点量完尺寸再适配，否则 fitView 按旧包围盒算，图会偏到角落
    window.setTimeout(() => void fitView({ padding: 0.14, duration: 320 }), 360);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram.diagramId]);
  // 拖动模式下整张图都不可拖（per-node draggable 会覆盖 ReactFlow 的 nodesDraggable）
  const nodes = useMemo(
    () => toFlowNodes(diagram, selectedIds, { draggable: !editLocked && !panMode }),
    [diagram, editLocked, panMode, selectedIds],
  );
  const [dragging, setDragging] = useState(false);

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
    () => (frozen && edgesRef.current ? edgesRef.current : toFlowEdges(diagram, selectedIds)),
    [frozen, diagram, selectedIds],
  );
  if (!frozen) edgesRef.current = computedEdges;
  const edges = frozen && edgesRef.current ? edgesRef.current : computedEdges;

  const groupIds = useMemo(() => new Set(diagram.groups.map((g) => g.groupId)), [diagram.groups]);

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

  // 普通滚轮 = 上下平移；Ctrl/Cmd + 滚轮 = 按 20% 档位缩放（用户 2026-11-04 定稿）
  const wrapperRef = useRef<HTMLDivElement>(null);
  /** 框选起点（框选连线用）：React Flow 在 onSelectionEnd 之前就把它的矩形清空了，只能自己记 */
  const selectDrag = useRef<{ x: number; y: number; snapshot: string[]; additive: boolean } | null>(null);
  const lastWheelStep = useRef(0);
  const stepZoomRef = useRef<(direction: 1 | -1) => void>(() => {});
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const onWheelNative = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        // 必须在捕获阶段就把事件截下来：d3-zoom 的 wheel 监听挂在里面的 pane 上，
        // 冒泡阶段处理的话它已经先缩过一次，档位就不再是 20% 的整数倍了。
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now();
        // 触控板一次手势会连发几十个 wheel 事件，节流一下，免得一口气跳好几档
        if (now - lastWheelStep.current < 160) return;
        lastWheelStep.current = now;
        stepZoomRef.current(event.deltaY < 0 ? 1 : -1);
        return;
      }
      event.preventDefault();
      const { x, y, zoom } = getViewport();
      applyViewport({ x, y: y - (event.deltaY / zoom) * 0.9, zoom });
    };
    element.addEventListener('wheel', onWheelNative, { passive: false, capture: true });
    return () => element.removeEventListener('wheel', onWheelNative, { capture: true });
  }, [applyViewport, getViewport]);

  /**
   * 缩放到下一档 20%（Ctrl+滚轮 与左下角 +/- 共用）。
   * 保持视口中心不动；已经到头就不再动。
   */
  const applyZoomLevel = useCallback(
    (target: number) => {
      const current = getViewport();
      if (Math.abs(target - current.zoom) < 1e-6) return;
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        applyViewport({ ...current, zoom: target }, { duration: 160 });
        return;
      }
      applyViewport(zoomAroundCenter(current, target, { width: rect.width, height: rect.height }), {
        duration: 160,
      });
    },
    [applyViewport, getViewport],
  );

  const stepZoom = useCallback(
    (direction: 1 | -1) => applyZoomLevel(nextZoom(getViewport().zoom, direction)),
    [applyZoomLevel, getViewport],
  );
  stepZoomRef.current = stepZoom;

  // 状态条上的「100%」在 provider 外面，用事件把"恢复 1:1"传进来
  useEffect(() => {
    const onReset = (): void => applyZoomLevel(1);
    window.addEventListener(ZOOM_RESET_EVENT, onReset);
    return () => window.removeEventListener(ZOOM_RESET_EVENT, onReset);
  }, [applyZoomLevel]);

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
        .map((n) => ({ id: n.nodeId, rect: nodeAbsoluteRect(diagram.groups, n) }))
        .filter(({ rect }) => rectContainsPoint(rect, point))
        .pop();

      /*
       * 没落在节点上时再试分组（用户 2026-11-04：分组也能当连线终点）。
       * 分组的手柄在边框上，容易被压在它上面的节点挡住，所以"松手落在分组身上"
       * 这条路径很实用：从节点手柄拖出来，放进分组内部就接上了。
       */
      const groupTarget = target
        ? null
        : [...diagram.groups]
            .filter(
              (g) => g.groupId !== from.nodeId && !isHiddenByCollapse(diagram.groups, g.parentGroupId),
            )
            .map((g) => ({ id: g.groupId, rect: groupAbsoluteRect(diagram.groups, g) }))
            .filter(({ rect }) => rectContainsPoint(rect, point))
            .pop();

      const endpoint = target ?? groupTarget;
      if (!endpoint) return;
      // 源端用"你实际拖出的那个手柄"，不能拿目标端的一边顶替，
      // 否则从任意手柄拖出来都变成同一条线（曾经的 bug）。
      // 目标端按"朝向起点的那个边"接上：落在节点中间时不至于随机挑一边。
      const sourceAnchor = anchorOfHandle(from.handleId);
      const sourceNode = diagram.nodes.find((n) => n.nodeId === from.nodeId);
      const sourceRect = sourceNode ? nodeAbsoluteRect(diagram.groups, sourceNode) : null;
      const targetAnchor = sourceRect
        ? nearestAnchor({ x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2 }, endpoint.rect)
        : nearestAnchor(point, endpoint.rect);
      addEdge(from.nodeId, endpoint.id, sourceAnchor, targetAnchor);
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
      // 锁定编辑时不吃任何拖入（面板拖组件、拖图片都算改图）
      if (editLocked) return;
      const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });

      // 1) 拖进来的是"分组"：建框，落点即框的左上角附近（居中更像"框住这里"）
      const groupPayload = event.dataTransfer.getData(GROUP_MIME);
      if (groupPayload) {
        // 载荷是 JSON 预设（服务器 / 集群 / nginx），通用分组传的是 'group'
        const preset =
          groupPayload === 'group'
            ? null
            : (GROUP_PRESETS.find((p) => p.key === groupPayload) ??
              (() => {
                try {
                  return JSON.parse(groupPayload) as (typeof GROUP_PRESETS)[number];
                } catch {
                  return null;
                }
              })());
        const size = preset
          ? { width: preset.width, height: preset.height }
          : { width: 360, height: 240 };
        const target = hitGroup(diagram.groups, point);
        const offset = target ? groupOffset(diagram.groups, target.groupId) : { x: 0, y: 0 };
        const created = addGroup(
          { x: point.x - offset.x - size.width / 2, y: point.y - offset.y - size.height / 2 },
          preset
            ? {
                width: size.width,
                height: size.height,
                label: preset.groupLabel,
                subLabel: preset.subLabel,
                bgColor: preset.bgColor,
                borderColor: preset.borderColor,
                titleColor: preset.titleColor,
                extJson: { iconKey: preset.iconKey },
              }
            : // 通用分组：用户要求它**不支持副文本**（标题栏只有一行），用 extJson 标记
              { width: size.width, height: size.height, extJson: { singleLine: true } },
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
    [addGroup, addNode, diagram.groups, editLocked, reparentGroup, screenToFlowPosition],
  );

  /**
   * 拖拽结束：按"节点中心"决定是否换组。
   *
   * ReactFlow 给的 position 对子节点而言是相对父级的，所以要用组偏移换算回绝对坐标再判定；
   * 换组后由 setNodeGroup 把坐标换回新父级的局部坐标，屏幕上位置不变（C1）。
   */
  /**
   * 拖拽开始/结束：拖动期间冻结 edges 的整批重建（边长什么样由 ArchEdge 自己按
   * 节点内部位置算，不需要每帧重算一遍），松手后再补一次以恢复选中态等。
   */
  const onNodeDragStart = useCallback(() => {
    setDragging(true);
  }, []);

  const onNodeDragStop = useCallback<OnNodeDrag<ArchFlowNode | SwimlaneFlowNode>>(
    (_event, node) => {
      // 先解冻：松手后按最新位置重算一遍
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
    (_: unknown, viewport: FlowViewport) => {
      setViewport(viewport);
      // 视口只存本地：平移/缩放不该占版本号，也不该单独触发一次写库
      saveLocalViewport(useDiagramStore.getState().diagram.diagramId, viewport);
    },
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

      // 锁定编辑时不给右键菜单：里面的每一项都是改图操作
      if (editLocked) return;
      if (!state.selectedIds.includes(node.id)) state.select(node.id);
      const group = state.diagram.groups.find((g) => g.groupId === node.id);
      if (group) {
        openMenu(event, buildGroupMenu(group));
        return;
      }
      const target = state.diagram.nodes.find((n) => n.nodeId === node.id);
      if (target) openMenu(event, buildNodeMenu(target));
    },
    [editLocked, openMenu],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: { id: string }) => {
      event.preventDefault();
      const state = useDiagramStore.getState();

      if (editLocked) return;
      state.select(edge.id);
      const target = state.diagram.edges.find((e) => e.edgeId === edge.id);
      if (target) openMenu(event, buildEdgeMenu(target));
    },
    [editLocked, openMenu],
  );

  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      useDiagramStore.getState().select(null);
      if (editLocked) return;
      openMenu(event as React.MouseEvent, buildBlankMenu());
    },
    [editLocked, openMenu],
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
      className={`h-full w-full ${panActive ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onMouseMove={onPointerMove}
      onMouseLeave={onPointerLeave}
      onPointerDownCapture={(event) => {
        // 只记「从画布空白处开始」的拖动：节点、连接手柄、控件上的按下都不算框选起点
        const target = event.target as HTMLElement;
        if (event.button !== 0 || panActive || !target.closest('.react-flow__pane')) return;
        selectDrag.current = {
          x: event.clientX,
          y: event.clientY,
          snapshot: [...useDiagramStore.getState().selectedIds],
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        };
      }}
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
      // 锁定编辑：节点不能拖、不能拉线，但还能选中/平移/缩放/搜索
      // 拖动模式下节点不能被拖走（用户 2026-11-05：只平移画布）
      nodesDraggable={!editLocked && !panMode}
      nodesConnectable={!editLocked}
      edgesReconnectable={!editLocked}
      // 吸附：元素按 10px 网格对齐（背景栅格密度与之保持一致）
      snapToGrid
      snapGrid={SNAP_GRID}
      // 交互（2026-11-04 定稿）：空白拖拽不平移，按住空格才拖动画布；
      // 滚轮只在 Ctrl/Cmd 时缩放，普通滚轮上下平移（见上面的 wheel 监听）。
      panOnDrag={panActive}
      panActivationKeyCode="Space"
      // 空白处拖动 = 框选（多选）；按住空格则变成平移
      selectionOnDrag={!panActive}
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      // 拖线预览：主色虚线 + 箭头（RF 默认那条 1px 淡灰线基本看不见）
      connectionLineComponent={ArchConnectionLine}
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
      onSelectionEnd={(event) => {
        /**
         * 框选收尾（用户 2026-11-05 定稿，规则 A）：
         * - 框里有节点/分组 → 只留节点与分组，把连线剔掉（框 10 个节点别顺手带上十几条线）；
         * - 框里**没有**节点/分组 → 自己按几何把穿过的连线选上（React Flow 不做这件事）。
         * Shift 框选 = 追加到原有选择（快照在 pointerdown 抓，RF 一开始框选就会清空选择）。
         */
        const drag = selectDrag.current;
        selectDrag.current = null;
        const state = useDiagramStore.getState();
        const selectedEdgeIds = state.diagram.edges
          .filter((e) => state.selectedIds.includes(e.edgeId))
          .map((e) => e.edgeId);
        const nodeOrGroupCount =
          state.diagram.nodes.filter((n) => state.selectedIds.includes(n.nodeId)).length +
          state.diagram.groups.filter((g) => state.selectedIds.includes(g.groupId)).length;

        if (nodeOrGroupCount > 0) {
          if (selectedEdgeIds.length > 0) state.updateSelection([], selectedEdgeIds);
          return;
        }
        if (!drag) return;

        const rect = rectFromPoints(
          screenToFlowPosition({ x: drag.x, y: drag.y }),
          screenToFlowPosition({ x: event.clientX, y: event.clientY }),
        );
        // 太小的拖动当点击，别让它变成一次"空框选"
        if (rect.width < 4 || rect.height < 4) return;

        const hit = edgeIdsInRect(wrapperRef.current, rect);
        const keep = drag.additive
          ? drag.snapshot.filter((id) => state.diagram.edges.some((e) => e.edgeId === id))
          : [];
        const target = [...new Set([...keep, ...hit])];
        const add = target.filter((id) => !state.selectedIds.includes(id));
        const remove = selectedEdgeIds.filter((id) => !target.includes(id));
        if (add.length > 0 || remove.length > 0) state.updateSelection(add, remove);
      }}
      onEdgeDoubleClick={(event, edge) => {
        // 双击连线 → 就地改标注（用户 2026-11-05）；只读态和拖动模式下不响应
        event.stopPropagation();
        if (editLocked || panActive) return;
        startEdgeLabelEdit(edge.id);
      }}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      deleteKeyCode={deleting || editLocked ? null : ['Delete', 'Backspace']}
      proOptions={{ hideAttribution: false }}
      className="bg-transparent"
    >
      {/* 规格 §5.1：网格。用户 2026-11-04 定稿：网点，间距与吸附一致（10px），点略深一点才看得清 */}
      {showGrid && <Background variant={BackgroundVariant.Dots} gap={SNAP_GRID[0]} size={1.4} color="#D9DCE1" />}
      {/* 缩放按钮自己画：ReactFlow 内置的 ± 是 "×1.2"，和状态条上的 20% 档位对不上 */}
      <Controls showZoom={false} showFitView={false} showInteractive={false}>
        <ControlButton onClick={() => stepZoom(1)} title="放大（+20%）" aria-label="放大">
          <ToolIcon name="plus" />
        </ControlButton>
        <ControlButton onClick={() => stepZoom(-1)} title="缩小（−20%）" aria-label="缩小">
          <ToolIcon name="minus" />
        </ControlButton>
        <ControlButton
          onClick={() => void fitView({ padding: 0.12, duration: 260 })}
          title="适配视图（Fit view）"
          aria-label="适配视图"
        >
          <ToolIcon name="fit" />
        </ControlButton>
      </Controls>
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => (n.type === 'archNode' ? '#D1D5DB' : '#EEF1F4')}
        maskColor="rgba(250,250,250,0.7)"
        style={{ width: 160, height: 110 }}
      />
    </ReactFlow>
    {/* 画布右上角：拖动模式 + 锁定编辑（用户 2026-11-05） */}
    <CanvasModeButtons />
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    <SearchDialog />
    </div>
  );
}

/**
 * 右上角三个开关（用户 2026-11-05）：
 *
 * - 左：图层（`layerPanelOpen`）—— 打开右侧树形图层面板；
 * - 中：拖动模式（`panMode`）—— 拖空白处平移画布、节点不可拖；等价于"一直按住空格"。
 * - 右：锁定编辑 —— 更彻底的只读（连框选/连线都不行），状态随图保存。
 *
 * 三个按钮都只有图标，含义放在 title / aria-label 里。
 */
function CanvasModeButtons() {
  const panMode = useCanvasMode((s) => s.panMode);
  const togglePanMode = useCanvasMode((s) => s.togglePanMode);
  const locked = useDiagramStore((s) => isEditLocked(s.diagram));
  const setEditLocked = useDiagramStore((s) => s.setEditLocked);
  const layerOpen = useDiagramStore((s) => s.layerPanelOpen);
  const setLayerPanelOpen = useDiagramStore((s) => s.setLayerPanelOpen);
  const base = 'grid h-8 w-8 place-items-center rounded-md border shadow-sm';
  const on = 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]';
  const off =
    'border-[var(--panel-border)] bg-white text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]';
  return (
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={layerOpen}
        aria-label={layerOpen ? '关闭图层' : '图层'}
        title="图层：分组层级 + 遮挡顺序"
        onClick={() => setLayerPanelOpen(!layerOpen)}
        className={`${base} ${layerOpen ? on : off}`}
      >
        <ToolIcon name="layers" size={16} />
      </button>
      <button
        type="button"
        aria-pressed={panMode}
        aria-label={panMode ? '退出拖动模式' : '拖动模式'}
        title={panMode ? '拖动模式：拖空白处平移画布（再点一下回到编辑）' : '拖动模式：拖空白处平移画布，节点不跟着动'}
        onClick={togglePanMode}
        className={`${base} ${panMode ? on : off}`}
      >
        <ToolIcon name="hand" size={16} />
      </button>
      <button
        type="button"
        aria-pressed={locked}
        aria-label={locked ? '解锁编辑' : '锁定编辑'}
        title={locked ? '已锁定：点一下恢复编辑' : '锁定编辑：防止误改（仍可查看、选中、平移缩放）'}
        onClick={() => setEditLocked(!locked)}
        className={`${base} ${locked ? on : off}`}
      >
        <ToolIcon name={locked ? 'lock' : 'unlock'} size={16} />
      </button>
    </div>
  );
}

/** 画布外壳：网格与左下角状态条都挂在这里（空状态提示已按用户 2026-11-05 要求删除） */
export function Canvas() {
  return (
    <main className="relative min-w-0 flex-1 bg-[var(--canvas-bg)]">
      <ReactFlowProvider>
        <CanvasInner />
      </ReactFlowProvider>
      <AlignToolbar />
      <LayerPanel />
      <CanvasStatus />
    </main>
  );
}

/**
 * 左下角状态条（用户 2026-11-04：去掉底部整条，内容塞到 Fit view 右边，
 * 无背景、小灰字、全部左对齐，不再左右分栏）。
 *
 * ReactFlow 的 Controls 贴左下角，宽约 32px，所以这里从 46px 处开始排。
 */
function CanvasStatus() {
  const zoom = useDiagramStore((s) => s.diagram.viewport.zoom);
  const schemaVersion = useDiagramStore((s) => s.diagram.schemaVersion);
  const cursor = useDiagramStore((s) => s.cursor);
  const stats = useDiagramStats();

  return (
    <div className="pointer-events-none absolute bottom-1 left-[76px] z-10 flex items-center gap-3 text-[11px] leading-4 text-[var(--text-secondary)]">
      <button
        type="button"
        // 真的把画布缩放到 1:1（以前只改了 store 里的副本，画面动都不动）
        onClick={() => window.dispatchEvent(new Event(ZOOM_RESET_EVENT))}
        className="mono pointer-events-auto rounded px-0.5 hover:text-[var(--text-primary)]"
        title="点击恢复 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <span className="mono" title="鼠标在画布上的坐标（10px 吸附）">
        x: {cursor ? Math.round(cursor.x) : '—'} / y: {cursor ? Math.round(cursor.y) : '—'}
      </span>
      <span>
        节点 {stats.nodeCount} · 连线 {stats.edgeCount} · 分组 {stats.groupCount}
      </span>
      <span className="mono">schema v{schemaVersion}</span>
      <span className="hidden xl:inline">空格拖动平移 · Ctrl+滚轮缩放 · Ctrl+F 搜索 · Delete 删除</span>
    </div>
  );
}







