import { useMemo } from 'react';
import { create } from 'zustand';
import {
  COMPONENT_INDEX,
  EDGE_DEFAULTS,
  defaultDynamicCols,
  isDynamicGroup,
  layoutDynamicGroup,
  createEdge,
  createEmptyDiagram,
  createGroup,
  createNode,
  descendantGroupIds,
  diagramStats,
  groupAbsoluteRect,
  groupOffset,
  isEditLocked,
  isGroupLocked,
  MAX_GROUP_DEPTH,
  nodeAbsoluteRect,
  dissolveGroup,
  removeGroupLifting,
  setGroupParent,
  setNodeGroup,
  withEditLock,
  type Anchor,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type NodeType,
  type Point,
  type Viewport,
} from '@arch/schema';
import { alignRects, distributeRects, type AlignMode, type Rect } from '../canvas/align.js';
import type { LineGeometry } from '../canvas/lineGeometry.js';
import { persistDiagramExt } from '../data/diagramRepo.js';

const PREF_KEY = 'arch.ui.prefs';

/** 读本地 UI 偏好（图画布网格开关、连线默认样式等），坏数据不炸 */
function readPrefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readPref<T>(key: string, fallback: T): T {
  const value = readPrefs()[key];
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
    ? (value as T)
    : fallback;
}

function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), [key]: value }));
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

export type SaveState = 'saved' | 'saving' | 'dirty';

/**
 * 写者角色：同一张图只让一个标签页发保存请求。
 * `follower` 不自动保存，界面上会提示"另一个标签页正在编辑"。
 */
export type WriterRole = 'owner' | 'follower';

/** toast 的三种语气：info 中性提示、success 成功了、error 报错 */
export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}


export interface SaveConflict {
  currentVersion?: number;
  message: string;
}

interface DiagramStore {
  diagram: ArchitectureDiagram;
  saveState: SaveState;
  /** 单选（属性面板用）：多选时为 null */
  selectedId: string | null;
  /** 多选集合：框选 / Ctrl 点选得到 */
  selectedIds: string[];
  /** 待确认的删除（二次确认），确认后才真正删 */
  pendingDelete: { nodeIds: string[]; edgeIds: string[]; groupIds: string[] } | null;

  /** 启动状态：加载完成后才允许自动保存，避免把空图存进库 */
  booted: boolean;
  bootError: string | null;
  /** 版本冲突 / 保存失败 */
  conflict: SaveConflict | null;
  saveError: string | null;
  /** 保存函数缺失（schema.sql 没跑全）：允许编辑，但停止自动保存重试 */
  saveDisabled: boolean;
  /**
   * 本标签页对这张图是"写者"还是"跟随者"。
   *
   * 同一张图同时只让一个标签页发保存请求 —— 这是版本冲突最大的来源。
   * `follower` 不自动保存；一旦在本页真的动手改，会自动抢占（见 useAutosave）。
   */
  writerRole: WriterRole;
  /** 这张图在服务端是否已有行：false 时首次保存必须不带 baseVersion，否则会插出一条重复的图 */
  persisted: boolean;
  lastSavedAt: string | null;

  /** 命令栈（M2）：存整图快照，栈深 50 */
  past: ArchitectureDiagram[];
  future: ArchitectureDiagram[];
  undoKey: string | null;
  undoAt: number;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  /** 从服务端载入（persisted=true）还是本地新建（false）：决定首次保存要不要带基线版本 */
  setDiagram: (diagram: ArchitectureDiagram, options?: { persisted?: boolean }) => void;
  /** 回图库：把当前图从内存里卸掉（不删库），同时停掉自动保存 */
  closeDiagram: () => void;
  setBooted: (booted: boolean) => void;
  setBootError: (message: string | null) => void;
  rename: (name: string) => void;
  setViewport: (viewport: Viewport) => void;
  /** 全局锁定编辑（随图保存到 arch_diagram.ext_json） */
  setEditLocked: (locked: boolean) => void;
  select: (id: string | null) => void;
  /** 多选：按 ReactFlow 的 select 变更增量更新 */
  updateSelection: (add: string[], remove: string[]) => void;
  /** 选中集合（框选后批量删除用） */
  requestDelete: (ids: string[]) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;

  /** 画布编辑动作（M1） */
  addNode: (
    nodeType: NodeType,
    position: Point,
    groupId?: string | null,
    /** 组件库预设条目的默认文案 / 尺寸（不传就用类型自身的默认值） */
    defaults?: Partial<Pick<DiagramNode, 'label' | 'subLabel' | 'width' | 'height'>>,
  ) => DiagramNode;
  moveNode: (nodeId: string, position: Point) => void;
  resizeNode: (nodeId: string, size: { width: number; height: number }) => void;
  /** 批量改尺寸（多选统一宽高）：只改节点，整批算一步撤销 */
  resizeNodes: (ids: string[], size: Partial<{ width: number; height: number }>) => void;
  /** 线条专用：端点一动，盒子跟着重算（x/y/width/height 与 extJson.line.a/b 必须一起写） */
  setLineGeometry: (nodeId: string, geometry: LineGeometry) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (
    sourceId: string,
    targetId: string,
    sourceAnchor: string,
    targetAnchor: string,
    /** 沿边比例（0..1）：不传就是中点。2026-11-08 起端点可以停在边框任意位置 */
    anchorAt?: { sourceAt?: number; targetAt?: number },
  ) => void;
  removeEdge: (edgeId: string) => void;
  /** 属性面板用：局部更新单个节点 / 连线 */
  patchNode: (nodeId: string, patch: Partial<DiagramNode>) => void;
  patchEdge: (edgeId: string, patch: Partial<DiagramEdge>) => void;
  /** 分组（M2） */
  addGroup: (position: Point, overrides?: Partial<DiagramGroup>) => DiagramGroup;
  moveGroup: (groupId: string, position: Point) => void;
  resizeGroup: (groupId: string, size: { width: number; height: number }) => void;
  patchGroup: (groupId: string, patch: Partial<DiagramGroup>) => void;
  /** 删除分组：子组一起删，节点提升到上一层（不删内容） */
  removeGroup: (groupId: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  /** 拖进/拖出分组：换算局部坐标，屏幕位置不变（C1） */
  reparentNode: (nodeId: string, groupId: string | null) => void;

  /* ---------------- 组合 / 取消组合（2026-11-08） ---------------- */
  /** Ctrl/Cmd+G：把当前选区包进一个新分组；返回新组 id */
  groupSelection: () => string | null;
  /** Ctrl/Cmd+Shift+G：只解散选区里最外层的分组（嵌套子组保留） */
  ungroupSelection: () => void;

  /* ---------------- 动态容器（2026-11-07） ---------------- */
  /** 批量添加弹层当前对着哪个容器；null = 关闭 */
  batchTarget: string | null;
  openBatch: (groupId: string | null) => void;
  /**
   * 往动态容器里批量加节点：每行一个，整批算一步撤销。
   * 返回真正创建的节点数（空行会被跳过）。
   */
  batchAddToDynamic: (groupId: string, labels: string[], nodeType: 'element' | 'element-h') => number;
  reparentGroup: (groupId: string, parentGroupId: string | null) => void;

  /** 保存链路（M2） */
  markDirty: () => void;
  markSaving: () => void;
  markSaved: () => void;
  applySaved: (version: number, savedAt: string) => void;
  setConflict: (conflict: SaveConflict | null) => void;
  setSaveError: (message: string | null) => void;
  setSaveDisabled: (disabled: boolean) => void;
  setWriterRole: (role: WriterRole) => void;

  /** 一次性提示：画布底部居中的 toast，几秒后自动消失（时长见 ToastHost） */
  toasts: ToastItem[];
  /** toast 自增 id（不用 Date.now，避免同一毫秒重复） */
  toastSeq: number;
  pushToast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;

  /** 画布网格开关（右上角可切，本地记住） */
  showGrid: boolean;
  toggleGrid: () => void;

  /** 连线全局配置：只影响新建的线，可一键应用到全部 */
  edgeDefaults: { edgeType: DiagramEdge['edgeType']; strokeWidth: number };
  setEdgeDefaults: (patch: Partial<{ edgeType: DiagramEdge['edgeType']; strokeWidth: number }>) => void;
  applyEdgeDefaultsToAll: () => void;

  /* ---------------- 阶段 2：批量编辑 / 层级 / 剪贴板 ---------------- */

  /** 6 种对齐：以选中集合的整体外框为准，精度 1px */
  alignSelection: (mode: AlignMode) => void;
  /** 2 种等距分布：首尾不动，中间按等间隙摆 */
  distributeSelection: (axis: 'horizontal' | 'vertical') => void;
  /** 置顶 / 置底（写 sort；节点与分组共用一套层级） */
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  /** 图层面板拖拽排序：按"从最上层到最下层"的顺序重写 sort */
  setLayerOrder: (orderedIds: string[]) => void;
  /** 锁定 / 解锁（只对节点生效：锁上后不可拖动，仍可选中、可连线） */
  toggleLock: (ids: string[]) => void;
  selectAll: () => void;
  copySelection: () => void;
  pasteClipboard: (offset?: Point) => void;
  clipboard: { nodes: DiagramNode[]; edges: DiagramEdge[]; groups: DiagramGroup[] } | null;

  /** 搜索定位后的 2 秒高亮 */
  highlightId: string | null;
  setHighlight: (id: string | null) => void;

  /** 状态栏坐标（flow 坐标；离开画布为 null） */
  cursor: Point | null;
  setCursor: (cursor: Point | null) => void;

  /** 右键"重命名/编辑"：请求某个元素进入行内编辑 */
  editRequestId: string | null;
  requestEdit: (id: string | null) => void;

  /** 解组：只拆这一层，子分组与节点提升到上一层（内容全留） */
  ungroup: (groupId: string) => void;

  /** 版本历史抽屉 / 图库视图 */
  versionOpen: boolean;
  setVersionOpen: (open: boolean) => void;

  /** Ctrl+F 搜索面板 / 图层面板开关 */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  layerPanelOpen: boolean;
  setLayerPanelOpen: (open: boolean) => void;
  /** 左侧组件库是否展开（用户 2026-11-05：整栏可隐藏，顶栏按钮唤出） */
  componentPanelOpen: boolean;
  setComponentPanelOpen: (open: boolean) => void;
}

const applyNode = (
  diagram: ArchitectureDiagram,
  nodeId: string,
  patch: Partial<DiagramNode>,
): ArchitectureDiagram => ({
  ...diagram,
  nodes: diagram.nodes.map((n) => (n.nodeId === nodeId ? { ...n, ...patch } : n)),
});

/* ------------------------------------------------------------------ */
/* 命令栈                                                              */
/* ------------------------------------------------------------------ */

/** 栈深上限（规格 §5.5） */
const HISTORY_LIMIT = 50;
/** 同一手势内的连续修改合并成一步（拖拽/连续输入） */
const COALESCE_MS = 800;

interface HistoryCarrier {
  diagram: ArchitectureDiagram;
  past: ArchitectureDiagram[];
  future: ArchitectureDiagram[];
  undoKey: string | null;
  undoAt: number;
}

interface HistoryPatch {
  past: ArchitectureDiagram[];
  future: ArchitectureDiagram[];
  undoKey: string | null;
  undoAt: number;
}

/**
 * 记录一步历史。
 *
 * 规则：
 * - 换了操作对象或超过 800ms → 新压一步；
 * - 同一手势内（同一个 key 且间隔很短）→ 不重复压栈，撤销点停在手势开始前。
 * 这样"拖一个节点 60 次 moveNode"只会产生 1 步撤销。
 */
function withHistory(state: HistoryCarrier, key: string): HistoryPatch | { undoAt: number } {
  const now = Date.now();
  if (state.undoKey === key && now - state.undoAt < COALESCE_MS) {
    return { undoAt: now };
  }
  return {
    past: [...state.past, state.diagram].slice(-HISTORY_LIMIT),
    future: [],
    undoKey: key,
    undoAt: now,
  };
}

/** 撤销/重做后，选中对象可能已经不存在了 */
function keepValidSelection(diagram: ArchitectureDiagram, selectedId: string | null): string | null {
  if (!selectedId) return null;
  const exists =
    diagram.nodes.some((n) => n.nodeId === selectedId) ||
    diagram.edges.some((e) => e.edgeId === selectedId) ||
    diagram.groups.some((g) => g.groupId === selectedId);
  return exists ? selectedId : null;
}

/* ------------------------------------------------------------------ */
/* 对齐 / 分布用的选中项快照                                            */
/* ------------------------------------------------------------------ */

interface SelectionItem {
  id: string;
  kind: 'node' | 'group';
  /** 绝对包围盒（跨分组比较要用绝对坐标） */
  rect: Rect;
  /** 存回来的局部坐标（节点在组内时是相对父组） */
  local: Point;
}

/** 把选中项换算成"绝对包围盒 + 局部坐标"；连线不参与对齐 */
function collectSelection(state: Pick<DiagramStore, 'diagram' | 'selectedIds'>): SelectionItem[] {
  const { diagram, selectedIds } = state;
  const items: SelectionItem[] = [];
  for (const id of selectedIds) {
    const node = diagram.nodes.find((n) => n.nodeId === id);
    if (node) {
      items.push({
        id,
        kind: 'node',
        rect: nodeAbsoluteRect(diagram.groups, node),
        local: { x: node.x, y: node.y },
      });
      continue;
    }
    const group = diagram.groups.find((g) => g.groupId === id);
    if (group) {
      items.push({
        id,
        kind: 'group',
        rect: groupAbsoluteRect(diagram.groups, group),
        local: { x: group.x, y: group.y },
      });
    }
  }
  return items;
}

/**
 * 把节点与分组的 sort 重排成 0..N-1。
 *
 * 层级操作如果一直 +1/-1，值会越跑越远（甚至跑成负数），
 * 而 ReactFlow 的 zIndex 直接用它 —— 统一在每次层级变更后归一化。
 */
function renumberSorts(diagram: ArchitectureDiagram): ArchitectureDiagram {
  const entries = [
    ...diagram.nodes.map((n) => ({ id: n.nodeId, sort: n.sort })),
    ...diagram.groups.map((g) => ({ id: g.groupId, sort: g.sort })),
  ].sort((a, b) => a.sort - b.sort);
  const rank = new Map(entries.map((entry, index) => [entry.id, index]));
  return {
    ...diagram,
    nodes: diagram.nodes.map((n) => ({ ...n, sort: rank.get(n.nodeId) ?? n.sort })),
    groups: diagram.groups.map((g) => ({ ...g, sort: rank.get(g.groupId) ?? g.sort })),
  };
}

/** 按每个元素的位移量改写坐标（对齐 / 分布共用；1px 取整） */function applyMoves(
  state: Pick<DiagramStore, 'diagram' | 'past' | 'future' | 'undoKey' | 'undoAt'>,
  items: SelectionItem[],
  deltas: { dx: number; dy: number }[],
  key: string,
): Pick<DiagramStore, 'diagram' | 'saveState'> & Partial<HistoryPatch> {
  let diagram = state.diagram;
  items.forEach((item, index) => {
    const delta = deltas[index];
    if (!delta || (delta.dx === 0 && delta.dy === 0)) return;
    const x = Math.round(item.local.x + delta.dx);
    const y = Math.round(item.local.y + delta.dy);
    if (item.kind === 'node') {
      diagram = {
        ...diagram,
        nodes: diagram.nodes.map((n) => (n.nodeId === item.id ? { ...n, x, y } : n)),
      };
      return;
    }
    diagram = {
      ...diagram,
      groups: diagram.groups.map((g) => (g.groupId === item.id ? { ...g, x, y } : g)),
    };
  });
  return { ...withHistory(state, key), diagram, saveState: 'dirty' };
}

/** 真正执行删除：连线 → 节点 → 分组（removeGroupLifting 会把剩余子节点提上一层） */
function applyDeletion(
  state: Pick<DiagramStore, 'diagram' | 'past' | 'future' | 'undoKey' | 'undoAt'>,
  pending: { nodeIds: string[]; edgeIds: string[]; groupIds: string[] },
): Pick<DiagramStore, 'diagram' | 'saveState' | 'pendingDelete' | 'selectedId' | 'selectedIds'> & Partial<HistoryPatch> {
  let diagram = state.diagram;
  const nodeSet = new Set(pending.nodeIds);
  const edgeSet = new Set(pending.edgeIds);
  // 分组也是连线端点（用户 2026-11-04）：删掉分组时，挂在它身上的线一起走
  const groupSet = new Set(pending.groupIds);
  diagram = {
    ...diagram,
    edges: diagram.edges.filter(
      (e) =>
        !edgeSet.has(e.edgeId) &&
        !nodeSet.has(e.sourceNodeId) &&
        !nodeSet.has(e.targetNodeId) &&
        !groupSet.has(e.sourceNodeId) &&
        !groupSet.has(e.targetNodeId),
    ),
    nodes: diagram.nodes.filter((n) => !nodeSet.has(n.nodeId)),
  };
  for (const groupId of pending.groupIds) {
    diagram = removeGroupLifting(diagram, groupId);
  }
  const removed = pending.nodeIds.length + pending.edgeIds.length + pending.groupIds.length;
  return {
    ...withHistory(state as HistoryCarrier, `delete:${removed}`),
    diagram,
    saveState: 'dirty',
    pendingDelete: null,
    selectedId: null,
    selectedIds: [],
  };
}

/** 组自身深度：顶层 = 1（与 MAX_GROUP_DEPTH 口径一致） */
function countDepth(groups: DiagramGroup[], groupId: string): number {
  let depth = 0;
  let current: string | null | undefined = groupId;
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    depth += 1;
    current = groups.find((g) => g.groupId === current)?.parentGroupId ?? null;
  }
  return depth;
}

/** 子树高度：只有自己 = 1，带一层子组 = 2 */
function countSubtreeHeight(groups: DiagramGroup[], groupId: string): number {
  const children = groups.filter((g) => g.parentGroupId === groupId);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map((c) => countSubtreeHeight(groups, c.groupId)));
}

/**
 * 画布数据 store。
 *
 * 只存"一份 Schema"：任何编辑都直接改 ArchitectureDiagram，
 * 不引入第二套 UI 专用结构（规格 §0.1 的红线）。
 * 命令栈在 M2 拆成独立 store，这里先留接口位。
 */

/**
 * 锁定编辑时把「改图」的写入全部挡在 store 这一层（用户 2026-11-04 第二批）。
 *
 * 判断依据很朴素：一次 set 里如果 `diagram` 换了新对象，就算"改图"。
 * 选中、开关面板、视口这些只动 UI / viewport 的写入不受影响；
 * 折叠分组与切换锁定自己是例外（纯浏览行为 / 元数据），用 `bypassLock` 放行。
 *
 * 放在这一层而不是逐个动作里，是因为动作有三十多个，漏一个就是"锁了还能改"。
 */
let bypassLock = false;
function withLockBypass<T>(fn: () => T): T {
  const previous = bypassLock;
  bypassLock = true;
  try {
    return fn();
  } finally {
    bypassLock = previous;
  }
}

export const useDiagramStore = create<DiagramStore>()((rawSet, get) => {
  /**
   * 一层薄包装：锁定编辑时丢弃所有"会换掉 diagram 对象"的写入。
   * 类型上跟着 zustand 的 set 走，内部用 unknown 兜住重载，避免在泛型上打架。
   */
  const set = ((partial: unknown, replace?: unknown) => {
    rawSet(((state: DiagramStore) => {
      const next =
        typeof partial === 'function'
          ? (partial as (s: DiagramStore) => Partial<DiagramStore>)(state)
          : (partial as Partial<DiagramStore>);
      if (next === state || next === undefined || next === null) return state as never;
      if (
        !bypassLock &&
        isEditLocked(state.diagram) &&
        next.diagram !== undefined &&
        next.diagram !== state.diagram
      ) {
        // 锁定中：整次写入丢掉（连同它的历史记录），界面保持原样
        return state as never;
      }
      return next as never;
    }) as never, replace as never);
  }) as typeof rawSet;
  return {
  diagram: createEmptyDiagram({ name: '未命名架构图' }),
  saveState: 'saved',
  selectedId: null,
  selectedIds: [],
  pendingDelete: null,
  batchTarget: null,
  booted: false,
  bootError: null,
  conflict: null,
  saveError: null,
  saveDisabled: false,
  writerRole: 'owner',
  toasts: [],
  /** toast 自增 id（不用 Date.now，避免同一毫秒重复） */
  toastSeq: 0,
  persisted: false,
  lastSavedAt: null,
  past: [],
  future: [],
  undoKey: null,
  undoAt: 0,

  setDiagram: (diagram, options) =>
    set({
      persisted: options?.persisted ?? false,
      // 从库里读出来的当然算已保存；本地新建/导入的还没写库，必须标脏让自动保存接手
      saveState: options?.persisted ? 'saved' : 'dirty',
      diagram,
      selectedId: null,
      selectedIds: [],
      pendingDelete: null,
      conflict: null,
      saveError: null,
      past: [],
      future: [],
      undoKey: null,
    }),
  setBooted: (booted) => set({ booted }),
  closeDiagram: () =>
    set({
      persisted: false,
      saveState: 'saved',
      diagram: createEmptyDiagram({ name: '未命名架构图' }),
      selectedId: null,
      selectedIds: [],
      pendingDelete: null,
      conflict: null,
      saveError: null,
      past: [],
      future: [],
      undoKey: null,
    }),
  setBootError: (bootError) => set({ bootError }),
  rename: (name) => set((s) => ({ diagram: { ...s.diagram, name }, saveState: 'dirty' })),
  // 视口只是浏览状态，锁定编辑时也要能平移缩放
  setViewport: (viewport) =>
    withLockBypass(() => set((s) => ({ diagram: { ...s.diagram, viewport } }))),

  setEditLocked: (locked) => {
    withLockBypass(() =>
      set((s) => ({
        diagram: { ...s.diagram, extJson: withEditLock(s.diagram.extJson, locked) },
        toasts: [
          ...s.toasts,
          {
            id: s.toastSeq + 1,
            kind: 'success' as const,
            text: locked ? '已锁定编辑：只能查看和选中，改动入口都关掉了' : '已解锁编辑：可以继续改图',
          },
        ],
        toastSeq: s.toastSeq + 1,
      })),
    );
    // 元数据不占版本号：直接写一行，失败就只影响"换设备还锁不锁"
    void persistDiagramExt(get().diagram.diagramId, get().diagram.extJson ?? {});
  },
  select: (selectedId) => set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),

  updateSelection: (add, remove) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      for (const id of add) next.add(id);
      for (const id of remove) next.delete(id);
      const selectedIds = [...next];
      // 属性面板只在"正好选中一个"时出现
      return { selectedIds, selectedId: selectedIds.length === 1 ? selectedIds[0]! : null };
    }),

  requestDelete: (ids) =>
    set((s) => {
      const nodeIds = ids.filter((id) => s.diagram.nodes.some((n) => n.nodeId === id));
      const edgeIds = ids.filter((id) => s.diagram.edges.some((e) => e.edgeId === id));
      const groupIds = ids.filter((id) => s.diagram.groups.some((g) => g.groupId === id));
      if (nodeIds.length + edgeIds.length + groupIds.length === 0) return s;
      const pending = { nodeIds, edgeIds, groupIds };
      // 只有"删分组"和"多选（≥2 个元素）"才弹二次确认，单个节点/连线直接删
      const needsConfirm = groupIds.length > 0 || ids.length > 1;
      return needsConfirm ? { pendingDelete: pending } : applyDeletion(s, pending);
    }),

  confirmDelete: () => set((s) => (s.pendingDelete ? applyDeletion(s, s.pendingDelete) : s)),

  cancelDelete: () => set({ pendingDelete: null }),

  addNode: (nodeType, position, groupId, defaults) => {
    const state = get();
    const node = createNode(nodeType, state.diagram.diagramId, position, {
      ...(groupId ? { groupId } : {}),
      ...(defaults ?? {}),
      // undefined 会把 createNode 里的默认值覆盖成 undefined，这里只保留有值的字段
      ...Object.fromEntries(Object.entries(defaults ?? {}).filter(([, value]) => value !== undefined)),
    });
    // 线条（用户 2026-11-05）：拖进来就是一条水平线，端点存相对坐标
    if (nodeType === 'line') {
      node.extJson = {
        ...(node.extJson ?? {}),
        line: {
          a: { x: 2, y: Math.round(node.height / 2) },
          b: { x: Math.max(2, node.width - 2), y: Math.round(node.height / 2) },
          width: 2,
          dash: null,
        },
      };
    }
    set((s) => ({
      ...withHistory(s, `add:${node.nodeId}`),
      diagram: { ...s.diagram, nodes: [...s.diagram.nodes, node] },
      selectedId: node.nodeId,
      selectedIds: [node.nodeId],
      saveState: 'dirty',
    }));
    return node;
  },

  moveNode: (nodeId, position) =>
    set((s) => ({
      ...withHistory(s, `move:${nodeId}`),
      diagram: applyNode(s.diagram, nodeId, { x: position.x, y: position.y }),
      saveState: 'dirty',
    })),

  resizeNodes: (ids, size) =>
    set((s) => {
      const set = new Set(ids);
      let changed = false;
      const nodes = s.diagram.nodes.map((n) => {
        if (!set.has(n.nodeId)) return n;
        const width = size.width !== undefined ? Math.max(24, Math.round(size.width)) : n.width;
        const height = size.height !== undefined ? Math.max(24, Math.round(size.height)) : n.height;
        if (width === n.width && height === n.height) return n;
        changed = true;
        return { ...n, width, height };
      });
      if (!changed) return s;
      return {
        ...withHistory(s, `resizeNodes:${ids.join(',')}`),
        diagram: { ...s.diagram, nodes },
        saveState: 'dirty',
      };
    }),

  resizeNode: (nodeId, size) =>
    set((s) => ({
      ...withHistory(s, `resize:${nodeId}`),
      diagram: applyNode(s.diagram, nodeId, { width: size.width, height: size.height }),
      saveState: 'dirty',
    })),

  setLineGeometry: (nodeId, geometry) =>
    set((s) => {
      const node = s.diagram.nodes.find((n) => n.nodeId === nodeId);
      if (!node) return s;
      // 端点与盒子必须一次写完：只改盒子会让线在框里漂
      const extJson = {
        ...(node.extJson ?? {}),
        line: {
          ...(node.extJson?.line as Record<string, unknown> | undefined),
          a: geometry.a,
          b: geometry.b,
        },
      };
      return {
        ...withHistory(s, `line:${nodeId}`),
        diagram: applyNode(s.diagram, nodeId, {
          x: geometry.x,
          y: geometry.y,
          width: geometry.width,
          height: geometry.height,
          extJson,
        }),
        saveState: 'dirty',
      };
    }),

  removeNode: (nodeId) =>
    set((s) => ({
      ...withHistory(s, `remove:${nodeId}`),
      diagram: {
        ...s.diagram,
        nodes: s.diagram.nodes.filter((n) => n.nodeId !== nodeId),
        // 连带删掉挂在它身上的连线（DB 侧也有 ON DELETE CASCADE）
        edges: s.diagram.edges.filter(
          (e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId,
        ),
      },
      selectedId: s.selectedId === nodeId ? null : s.selectedId,
      saveState: 'dirty',
    })),

  addEdge: (sourceId, targetId, sourceAnchor, targetAnchor, anchorAt) =>
    set((s) => {
      if (sourceId === targetId) return s;
      const exists = s.diagram.edges.some(
        (e) =>
          e.sourceNodeId === sourceId &&
          e.targetNodeId === targetId &&
          e.sourceAnchor === sourceAnchor &&
          e.targetAnchor === targetAnchor,
      );
      if (exists) return s;
      const edge = createEdge(s.diagram.diagramId, sourceId, targetId, {
        sourceAnchor: sourceAnchor as Anchor,
        targetAnchor: targetAnchor as Anchor,
        // 全局配置（线型 / 线宽）只作用于新建的线，已有连线不受影响
        edgeType: s.edgeDefaults.edgeType,
        strokeWidth: s.edgeDefaults.strokeWidth,
        // 落点沿边的位置（拖端点时才有；0.5 中点就不存，保持老数据干净）
        ...(anchorAt
          ? {
              extJson: {
                ...(typeof anchorAt.sourceAt === 'number' && Math.abs(anchorAt.sourceAt - 0.5) > 1e-4
                  ? { sourceAt: anchorAt.sourceAt }
                  : {}),
                ...(typeof anchorAt.targetAt === 'number' && Math.abs(anchorAt.targetAt - 0.5) > 1e-4
                  ? { targetAt: anchorAt.targetAt }
                  : {}),
              },
            }
          : {}),
      });
      return {
        ...withHistory(s, `edge:${edge.edgeId}`),
        diagram: { ...s.diagram, edges: [...s.diagram.edges, edge] },
        saveState: 'dirty',
      };
    }),

  removeEdge: (edgeId) =>
    set((s) => ({
      ...withHistory(s, `removeEdge:${edgeId}`),
      diagram: { ...s.diagram, edges: s.diagram.edges.filter((e) => e.edgeId !== edgeId) },
      selectedId: s.selectedId === edgeId ? null : s.selectedId,
      saveState: 'dirty',
    })),

  patchNode: (nodeId, patch) =>
    set((s) => ({
      ...withHistory(s, `patch:${nodeId}:${Object.keys(patch).join(',')}`),
      diagram: applyNode(s.diagram, nodeId, patch),
      saveState: 'dirty',
    })),

  patchEdge: (edgeId, patch) =>
    set((s) => ({
      ...withHistory(s, `patchEdge:${edgeId}:${Object.keys(patch).join(',')}`),
      diagram: {
        ...s.diagram,
        edges: s.diagram.edges.map((e) => (e.edgeId === edgeId ? { ...e, ...patch } : e)),
      },
      saveState: 'dirty',
    })),

  addGroup: (position, overrides) => {
    const state = get();
    const group = createGroup(state.diagram.diagramId, position, overrides ?? {});
    set((s) => ({
      ...withHistory(s, `addGroup:${group.groupId}`),
      diagram: { ...s.diagram, groups: [...s.diagram.groups, group] },
      selectedId: group.groupId,
      selectedIds: [group.groupId],
      saveState: 'dirty',
    }));
    return group;
  },

  moveGroup: (groupId, position) =>
    set((s) => ({
      ...withHistory(s, `moveGroup:${groupId}`),
      diagram: {
        ...s.diagram,
        groups: s.diagram.groups.map((g) =>
          g.groupId === groupId ? { ...g, x: position.x, y: position.y } : g,
        ),
      },
      saveState: 'dirty',
    })),

  resizeGroup: (groupId, size) =>
    set((s) => {
      const group = s.diagram.groups.find((g) => g.groupId === groupId);
      let diagram = {
        ...s.diagram,
        groups: s.diagram.groups.map((g) =>
          g.groupId === groupId ? { ...g, width: size.width, height: size.height } : g,
        ),
      };
      /*
       * 动态容器（2026-11-07）：宽度变了就按新宽度重排列数，并把高度顶到"刚好放得下"。
       * 这里用 growOnly 之外的语义 —— 高度取 max(用户拖的高度, 内容需要的高度)，
       * 所以往小拖只会触发重排（列数变少），不会把节点挤出容器。
       */
      if (group && isDynamicGroup(group)) {
        diagram = layoutDynamicGroup(diagram, groupId, { width: size.width, growOnly: true });
        // growOnly 保住了高度下限，但用户主动拉高时也要尊重：取两者更大
        diagram = {
          ...diagram,
          groups: diagram.groups.map((g) =>
            g.groupId === groupId ? { ...g, height: Math.max(g.height, size.height) } : g,
          ),
        };
      }
      return {
        ...withHistory(s, `resizeGroup:${groupId}`),
        diagram,
        saveState: 'dirty',
      };
    }),

  patchGroup: (groupId, patch) =>
    set((s) => {
      let diagram = {
        ...s.diagram,
        groups: s.diagram.groups.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)),
      };
      const group = diagram.groups.find((g) => g.groupId === groupId);
      // 动态容器：改标题/副文本会改标题栏高度，跟着重排（宽度不变，growOnly）
      if (group && isDynamicGroup(group)) {
        diagram = layoutDynamicGroup(diagram, groupId, { growOnly: true });
      }
      return {
        ...withHistory(s, `patchGroup:${groupId}:${Object.keys(patch).join(',')}`),
        diagram,
        saveState: 'dirty',
      };
    }),

  removeGroup: (groupId) =>
    set((s) => {
      const lifted = removeGroupLifting(s.diagram, groupId);
      if (lifted === s.diagram) return s;
      // 分组被删掉后，挂在它身上的连线就没有端点了，一起清掉
      const next = {
        ...lifted,
        edges: lifted.edges.filter(
          (e) => e.sourceNodeId !== groupId && e.targetNodeId !== groupId,
        ),
      };
      return {
        ...withHistory(s, `removeGroup:${groupId}`),
        diagram: next,
        selectedId: s.selectedId === groupId ? null : s.selectedId,
        saveState: 'dirty',
      };
    }),

  // 折叠只是浏览状态（不改几何数据），锁定编辑时仍然允许
  toggleGroupCollapsed: (groupId) =>
    withLockBypass(() =>
      set((s) => ({
        ...withHistory(s, `collapse:${groupId}`),
        diagram: {
          ...s.diagram,
          groups: s.diagram.groups.map((g) =>
            g.groupId === groupId ? { ...g, collapsed: !g.collapsed } : g,
          ),
        },
        saveState: 'dirty',
      })),
    ),

  /* —— 动态容器（2026-11-07） —— */

  openBatch: (groupId) => set({ batchTarget: groupId }),

  batchAddToDynamic: (groupId, labels, nodeType) => {
    const state = get();
    const group = state.diagram.groups.find((g) => g.groupId === groupId);
    if (!group || !isDynamicGroup(group)) return 0;

    const spec = COMPONENT_INDEX[nodeType];
    const clean = labels.map((line) => line.trim()).filter((line) => line.length > 0);
    if (clean.length === 0) return 0;

    const created = clean.map((label) =>
      createNode(nodeType, state.diagram.diagramId, { x: 0, y: 0 }, {
        groupId,
        label,
        subLabel: '',
        width: spec?.width ?? 200,
        height: spec?.height ?? 40,
      }),
    );

    set((s) => {
      // 先把新节点塞进图，再统一排版：列数按"容器里已有的 + 新加的"总数算接近方形
      const withNodes = { ...s.diagram, nodes: [...s.diagram.nodes, ...created] };
      const total = withNodes.nodes.filter((n) => !n.isDeleted && n.groupId === groupId).length;
      // 批量添加后容器精确贴合内容（上下左右正好 2 格），不保留旧尺寸
      const laid = layoutDynamicGroup(withNodes, groupId, {
        cols: defaultDynamicCols(total),
        fitWidth: true,
        growOnly: false,
      });
      return {
        ...withHistory(s, `batchAdd:${groupId}`),
        diagram: laid,
        selectedIds: created.map((n) => n.nodeId),
        selectedId: created.length === 1 ? created[0]!.nodeId : null,
        saveState: 'dirty',
      };
    });
    return created.length;
  },

  groupSelection: () => {
    const state = get();
    const { diagram, selectedIds } = state;
    if (selectedIds.length < 2) return null;

    // 只取"最外层"的选中项：父级也在选区里的话，跟着父级一起搬就行，别再单独搬一次
    const items = collectSelection({ diagram, selectedIds });
    if (items.length < 2) return null;

    const parentOf = (item: SelectionItem): string | null => {
      if (item.kind === 'node') {
        return diagram.nodes.find((n) => n.nodeId === item.id)?.groupId ?? null;
      }
      return diagram.groups.find((g) => g.groupId === item.id)?.parentGroupId ?? null;
    };
    const isInsideSelectedGroup = (item: SelectionItem): boolean => {
      const seen = new Set<string>();
      let current = parentOf(item);
      while (current && !seen.has(current)) {
        if (selectedIds.includes(current)) return true;
        seen.add(current);
        current = diagram.groups.find((g) => g.groupId === current)?.parentGroupId ?? null;
      }
      return false;
    };
    const outer = items.filter((item) => !isInsideSelectedGroup(item));
    if (outer.length < 1) return null;

    // 新组的父级 = 所有外层选中项的共同父级（没有就放顶层）
    const parents = new Set(outer.map((item) => parentOf(item) ?? ''));
    const parentId = parents.size === 1 ? ([...parents][0] || null) : null;

    // 嵌套深度上限：父级已经 3 层就不能再套
    if (parentId) {
      const depth = countDepth(diagram.groups, parentId);
      if (depth >= MAX_GROUP_DEPTH) {
        state.pushToast('已经是第 3 层分组了，不能再嵌套', 'info');
        return null;
      }
    }

    const minX = Math.min(...outer.map((item) => item.rect.x));
    const minY = Math.min(...outer.map((item) => item.rect.y));
    const maxX = Math.max(...outer.map((item) => item.rect.x + item.rect.width));
    const maxY = Math.max(...outer.map((item) => item.rect.y + item.rect.height));
    const pad = 16;
    // 纯组没有标题栏（用户 2026-11-08：Ctrl+G 建的是"就是个组"，不是分组组件）
    const header = 0;
    const offset = groupOffset(diagram.groups, parentId);

    const group = createGroup(diagram.diagramId, { x: minX - pad - offset.x, y: minY - header - pad - offset.y }, {
      width: maxX - minX + pad * 2,
      height: maxY - minY + header + pad * 2,
      label: '',
      // 纯组：无标题栏 / 名称 / 图标，平时不可见，悬停或选中才显形
      extJson: { bare: true },
      bgColor: '#00000000',
      borderColor: '#00000000',
      parentGroupId: parentId,
    });

    set((s) => {
      let next: ArchitectureDiagram = { ...s.diagram, groups: [...s.diagram.groups, group] };
      for (const item of outer) {
        if (item.kind === 'node') next = setNodeGroup(next, item.id, group.groupId);
        else next = setGroupParent(next, item.id, group.groupId);
      }
      return {
        ...withHistory(s, `group:${group.groupId}`),
        diagram: next,
        selectedId: group.groupId,
        selectedIds: [group.groupId],
        saveState: 'dirty',
      };
    });
    return group.groupId;
  },

  ungroupSelection: () =>
    set((s) => {
      const targets = s.selectedIds.filter((id) => s.diagram.groups.some((g) => g.groupId === id));
      if (targets.length === 0) return s;
      let diagram = s.diagram;
      for (const id of targets) {
        diagram = dissolveGroup(diagram, id);
        // 组没了，挂在它身上的连线也一起清掉
        diagram = {
          ...diagram,
          edges: diagram.edges.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id),
        };
      }
      return {
        ...withHistory(s, `ungroup:${targets.join(',')}`),
        diagram,
        selectedIds: [],
        selectedId: null,
        saveState: 'dirty',
      };
    }),

  reparentNode: (nodeId, groupId) =>
    set((s) => {
      // 嵌套上限 3 层：目标组本身已经 3 层深时不再接收
      if (groupId) {
        const depth = countDepth(s.diagram.groups, groupId);
        if (depth >= MAX_GROUP_DEPTH) return s;
      }
      let next = setNodeGroup(s.diagram, nodeId, groupId);
      if (next === s.diagram) return s;
      // 动态容器：拖进来 / 拖出去都要重排（用户 2026-11-07：手动拖入的也参与自动排版）
      const before = s.diagram.nodes.find((n) => n.nodeId === nodeId)?.groupId ?? null;
      for (const id of [groupId, before]) {
        if (!id) continue;
        const target = next.groups.find((g) => g.groupId === id);
        if (target && isDynamicGroup(target)) next = layoutDynamicGroup(next, id, { growOnly: true });
      }
      return { ...withHistory(s, `reparent:${nodeId}`), diagram: next, saveState: 'dirty' };
    }),

  reparentGroup: (groupId, parentGroupId) =>
    set((s) => {
      if (parentGroupId) {
        const depth = countDepth(s.diagram.groups, parentGroupId);
        if (depth + countSubtreeHeight(s.diagram.groups, groupId) > MAX_GROUP_DEPTH) return s;
      }
      const next = setGroupParent(s.diagram, groupId, parentGroupId);
      if (next === s.diagram) return s;
      return { ...withHistory(s, `reparentGroup:${groupId}`), diagram: next, saveState: 'dirty' };
    }),

  /* —— 阶段 2：对齐 / 分布 / 层级 / 锁定 / 剪贴板 —— */

  alignSelection: (mode) =>
    set((s) => {
      const items = collectSelection(s);
      if (items.length < 2) return s;
      const deltas = alignRects(items.map((item) => item.rect), mode);
      return applyMoves(s, items, deltas, `align:${mode}`);
    }),

  distributeSelection: (axis) =>
    set((s) => {
      const items = collectSelection(s);
      if (items.length < 3) return s;
      const deltas = distributeRects(items.map((item) => item.rect), axis);
      return applyMoves(s, items, deltas, `distribute:${axis}`);
    }),

  bringToFront: (ids) =>
    set((s) => {
      const targets = new Set(ids);
      const present = [...s.diagram.nodes.map((n) => n.nodeId), ...s.diagram.groups.map((g) => g.groupId)];
      const moved = present.filter((id) => targets.has(id));
      if (moved.length === 0) return s;
      const maxSort = Math.max(0, ...s.diagram.nodes.map((n) => n.sort), ...s.diagram.groups.map((g) => g.sort));
      const sortOf = new Map(moved.map((id, index) => [id, maxSort + 1 + index]));
      return {
        ...withHistory(s, 'layer:front'),
        diagram: renumberSorts({
          ...s.diagram,
          nodes: s.diagram.nodes.map((n) => (sortOf.has(n.nodeId) ? { ...n, sort: sortOf.get(n.nodeId)! } : n)),
          groups: s.diagram.groups.map((g) => (sortOf.has(g.groupId) ? { ...g, sort: sortOf.get(g.groupId)! } : g)),
        }),
        saveState: 'dirty',
      };
    }),

  sendToBack: (ids) =>
    set((s) => {
      const targets = new Set(ids);
      const present = [...s.diagram.nodes.map((n) => n.nodeId), ...s.diagram.groups.map((g) => g.groupId)];
      const moved = present.filter((id) => targets.has(id));
      if (moved.length === 0) return s;
      const minSort = Math.min(0, ...s.diagram.nodes.map((n) => n.sort), ...s.diagram.groups.map((g) => g.sort));
      // 顺序保持：第一个传进来的排最底，后面的依次往上
      const sortOf = new Map(moved.map((id, index) => [id, minSort - moved.length + index]));
      return {
        ...withHistory(s, 'layer:back'),
        diagram: renumberSorts({
          ...s.diagram,
          nodes: s.diagram.nodes.map((n) => (sortOf.has(n.nodeId) ? { ...n, sort: sortOf.get(n.nodeId)! } : n)),
          groups: s.diagram.groups.map((g) => (sortOf.has(g.groupId) ? { ...g, sort: sortOf.get(g.groupId)! } : g)),
        }),
        saveState: 'dirty',
      };
    }),

  setLayerOrder: (orderedIds) =>
    set((s) => {
      if (orderedIds.length === 0) return s;
      // 列表是从上到下：第一个 sort 最大
      const sortOf = new Map(orderedIds.map((id, index) => [id, orderedIds.length - index]));
      return {
        ...withHistory(s, 'layer:order'),
        diagram: renumberSorts({
          ...s.diagram,
          nodes: s.diagram.nodes.map((n) => (sortOf.has(n.nodeId) ? { ...n, sort: sortOf.get(n.nodeId)! } : n)),
          groups: s.diagram.groups.map((g) => (sortOf.has(g.groupId) ? { ...g, sort: sortOf.get(g.groupId)! } : g)),
        }),
        saveState: 'dirty',
      };
    }),

  toggleLock: (ids) =>
    set((s) => {
      const targets = new Set(ids);
      const nodes = s.diagram.nodes.filter((n) => targets.has(n.nodeId));
      const groups = s.diagram.groups.filter((g) => targets.has(g.groupId));
      if (nodes.length + groups.length === 0) return s;
      // 只要有一个没锁就全部锁上，全都锁了就全部解开（与节点原来的口径一致）
      const nextLocked = !(
        nodes.every((n) => n.locked) && groups.every((g) => isGroupLocked(g))
      );
      return {
        ...withHistory(s, `lock:${ids.join(',')}`),
        diagram: {
          ...s.diagram,
          nodes: s.diagram.nodes.map((n) => (targets.has(n.nodeId) ? { ...n, locked: nextLocked } : n)),
          groups: s.diagram.groups.map((g) =>
            targets.has(g.groupId)
              ? { ...g, extJson: { ...(g.extJson ?? {}), locked: nextLocked || undefined } }
              : g,
          ),
        },
        saveState: 'dirty',
      };
    }),

  selectAll: () =>
    set((s) => {
      const selectedIds = [
        ...s.diagram.nodes.map((n) => n.nodeId),
        ...s.diagram.groups.map((g) => g.groupId),
      ];
      return { selectedIds, selectedId: selectedIds.length === 1 ? selectedIds[0]! : null };
    }),

  clipboard: null,
  copySelection: () =>
    set((s) => {
      /*
       * 复制要**带上分组子树**（用户 2026-11-04 反馈 Ctrl+D 嵌套组丢内容）：
       * 选中一个分组时，它下面的子分组、以及这些组里的节点都要一起进剪贴板，
       * 否则粘出来的是个空框。子元素的父子关系原样保留，粘贴时再统一重映射。
       */
      const groupIds = new Set<string>();
      for (const g of s.diagram.groups) {
        if (!s.selectedIds.includes(g.groupId)) continue;
        groupIds.add(g.groupId);
        for (const child of descendantGroupIds(s.diagram.groups, g.groupId)) groupIds.add(child);
      }
      const nodes = s.diagram.nodes.filter(
        (n) => s.selectedIds.includes(n.nodeId) || (n.groupId != null && groupIds.has(n.groupId)),
      );
      const groups = s.diagram.groups.filter((g) => groupIds.has(g.groupId));
      if (nodes.length === 0 && groups.length === 0) return s;
      // 两端都在复制范围内的连线才带走
      const nodeIds = new Set(nodes.map((n) => n.nodeId));
      const edges = s.diagram.edges.filter(
        (e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
      );
      return { clipboard: { nodes, edges, groups } };
    }),

  pasteClipboard: (offset) =>
    set((s) => {
      const clip = s.clipboard;
      if (!clip || (clip.nodes.length === 0 && clip.groups.length === 0)) return s;
      const dx = offset?.x ?? 24;
      const dy = offset?.y ?? 24;
      const idMap = new Map<string, string>();
      const newId = (): string => crypto.randomUUID();
      const sourceGroups = s.diagram.groups;
      const copiedGroupIds = new Set(clip.groups.map((g) => g.groupId));

      // 1) 先把所有分组和节点的 id 分配好 —— 子分组可能排在父分组前面，一趟内查不到父 id；
      //    节点也必须在这里登记，否则下面 nodeId 取不到值会变成 undefined，
      //    库里校验直接报 `nodes[n].nodeId: expected string, received undefined`（用户 2026-11-05 反馈）。
      for (const g of clip.groups) idMap.set(g.groupId, newId());
      for (const n of clip.nodes) idMap.set(n.nodeId, newId());
      /*
       * 兜底：id 表必须覆盖剪贴板里的每一个元素。
       * 少一个，粘出来就带 undefined 的 id —— 画面上不一定马上看得出来，
       * 等保存 / 导出时才被 Zod 拦下（`nodes[n].nodeId: expected string`），
       * 那时已经进了草稿，表现成"节点莫名消失"。宁可在这里响亮地报错。
       */
      for (const item of [...clip.groups, ...clip.nodes]) {
        // 注意先判 nodeId：节点也有 groupId 字段，用 'groupId' in item 会误判成组
        const key = 'nodeId' in item ? item.nodeId : item.groupId;
        if (!key || !idMap.has(key)) throw new Error(`粘贴失败：${key || '(空 id)'} 没有分配到新 id`);
      }

      /*
       * 2) 位移规则：父分组**也被复制**时保持局部坐标（跟着父一起平移），
       *    父分组不在复制范围内时，先把局部坐标换算成绝对坐标，再整体 +24 ——
       *    否则嵌套层数越多，粘出来的位置偏得越多。
       */
      const groups = clip.groups.map((g) => {
        const parentCopied =
          g.parentGroupId != null && copiedGroupIds.has(g.parentGroupId);
        const base = parentCopied ? { x: 0, y: 0 } : groupOffset(sourceGroups, g.parentGroupId);
        // 父组也被复制时坐标一点不能动（否则相对父组又挪了一次）；否则换算成绝对坐标再偏移
        const shift = parentCopied ? { x: 0, y: 0 } : { x: dx, y: dy };
        return {
          ...g,
          groupId: idMap.get(g.groupId)!,
          // 父组没被一起复制时，落到顶层（否则会指向一个不存在的组）
          parentGroupId: g.parentGroupId ? (idMap.get(g.parentGroupId) ?? null) : null,
          x: g.x + base.x + shift.x,
          y: g.y + base.y + shift.y,
        };
      });

      // 3) 节点同理：父组被复制就保持局部坐标，否则换算成绝对坐标
      const nodes = clip.nodes.map((n) => {
        const groupCopied = n.groupId != null && copiedGroupIds.has(n.groupId);
        const base = groupCopied ? { x: 0, y: 0 } : groupOffset(sourceGroups, n.groupId);
        const shift = groupCopied ? { x: 0, y: 0 } : { x: dx, y: dy };
        return {
          ...n,
          nodeId: idMap.get(n.nodeId)!,
          groupId: n.groupId ? (idMap.get(n.groupId) ?? null) : null,
          x: n.x + base.x + shift.x,
          y: n.y + base.y + shift.y,
        };
      });
      const edges = clip.edges.map((e) => ({
        ...e,
        edgeId: newId(),
        sourceNodeId: idMap.get(e.sourceNodeId) ?? e.sourceNodeId,
        targetNodeId: idMap.get(e.targetNodeId) ?? e.targetNodeId,
      }));
      const selectedIds = [...groups.map((g) => g.groupId), ...nodes.map((n) => n.nodeId)];
      return {
        ...withHistory(s, `paste:${Date.now()}`),
        diagram: {
          ...s.diagram,
          groups: [...s.diagram.groups, ...groups],
          nodes: [...s.diagram.nodes, ...nodes],
          edges: [...s.diagram.edges, ...edges],
        },
        selectedIds,
        selectedId: selectedIds.length === 1 ? selectedIds[0]! : null,
        saveState: 'dirty',
      };
    }),

  highlightId: null,
  setHighlight: (highlightId) => set({ highlightId }),

  cursor: null,
  setCursor: (cursor) => set({ cursor }),

  editRequestId: null,
  requestEdit: (editRequestId) => set({ editRequestId }),

  versionOpen: false,
  setVersionOpen: (versionOpen) => set({ versionOpen }),

  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  layerPanelOpen: readPref('layerPanelOpen', false),
  componentPanelOpen: readPref('componentPanelOpen', true),
  setComponentPanelOpen: (componentPanelOpen) => {
    writePref('componentPanelOpen', componentPanelOpen);
    set({ componentPanelOpen });
  },
  setLayerPanelOpen: (layerPanelOpen) => {
    writePref('layerPanelOpen', layerPanelOpen);
    set({ layerPanelOpen });
  },

  ungroup: (groupId) =>
    set((s) => {
      const group = s.diagram.groups.find((g) => g.groupId === groupId);
      if (!group) return s;
      const parentId = group.parentGroupId ?? null;
      const offset = groupOffset(s.diagram.groups, parentId);
      // 只拆这一层：直属节点与直属子分组都提到上一层，坐标换算回父级坐标系
      const nodes = s.diagram.nodes.map((node) => {
        if (node.groupId !== groupId) return node;
        const absolute = nodeAbsoluteRect(s.diagram.groups, node);
        return { ...node, groupId: parentId, x: absolute.x - offset.x, y: absolute.y - offset.y };
      });
      const groups = s.diagram.groups
        .filter((g) => g.groupId !== groupId)
        .map((g) => {
          if (g.parentGroupId !== groupId) return g;
          const absolute = groupAbsoluteRect(s.diagram.groups, g);
          return { ...g, parentGroupId: parentId, x: absolute.x - offset.x, y: absolute.y - offset.y };
        });
      return {
        ...withHistory(s, `ungroup:${groupId}`),
        diagram: {
          ...s.diagram,
          nodes,
          groups,
          // 解组后这个分组不存在了，挂在它身上的连线一起清掉（否则就是悬空连线）
          edges: s.diagram.edges.filter(
            (e) => e.sourceNodeId !== groupId && e.targetNodeId !== groupId,
          ),
        },
        selectedId: s.selectedId === groupId ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((id) => id !== groupId),
        saveState: 'dirty',
      };
    }),

  /* —— 命令栈 —— */
  /**
   * 撤销 / 重做只回放"用户改的东西"。
   *
   * `version` 是服务端账本字段：历史快照里存的是当时的值，如果跟着回放，
   * "保存成功 → 撤销"会拿着旧版本号去提交，服务端按版本冲突（409）拒掉 —— 假冲突。
   * 所以这里一律沿用当前版本号。
   */
  undo: () =>
    set((s) => {
      const previous = s.past[s.past.length - 1];
      if (!previous) return s;
      return {
        diagram: { ...previous, version: s.diagram.version },
        past: s.past.slice(0, -1),
        future: [s.diagram, ...s.future].slice(0, HISTORY_LIMIT),
        selectedId: keepValidSelection(previous, s.selectedId),
      selectedIds: s.selectedIds.filter((id) => keepValidSelection(previous, id) !== null),
        undoKey: null,
        saveState: 'dirty',
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        diagram: { ...next, version: s.diagram.version },
        past: [...s.past, s.diagram].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        selectedId: keepValidSelection(next, s.selectedId),
        selectedIds: s.selectedIds.filter((id) => keepValidSelection(next, id) !== null),
        undoKey: null,
        saveState: 'dirty',
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  markDirty: () => set({ saveState: 'dirty' }),
  markSaving: () => set({ saveState: 'saving' }),
  markSaved: () => set({ saveState: 'saved' }),

  /** 保存成功：把服务端 version 写回 Schema（下次保存的基线就是它） */
  applySaved: (version, savedAt) =>
    set((s) => ({
      diagram: { ...s.diagram, version },
      saveState: 'saved',
      saveError: null,
      persisted: true,
      lastSavedAt: savedAt,
    })),

  setConflict: (conflict) => set({ conflict }),
  setSaveError: (saveError) => set({ saveError }),
  setSaveDisabled: (saveDisabled) => set({ saveDisabled }),
  setWriterRole: (writerRole) => set({ writerRole }),
  pushToast: (text, kind = 'info') =>
    set((s) => ({ toasts: [...s.toasts, { id: s.toastSeq + 1, kind, text }], toastSeq: s.toastSeq + 1 })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  showGrid: readPref('showGrid', true),
  toggleGrid: () =>
    set((state) => {
      writePref('showGrid', !state.showGrid);
      return { showGrid: !state.showGrid };
    }),

  edgeDefaults: {
    edgeType: readPref<DiagramEdge['edgeType']>('edgeType', EDGE_DEFAULTS.edgeType),
    strokeWidth: readPref('strokeWidth', EDGE_DEFAULTS.strokeWidth),
  },
  setEdgeDefaults: (patch) =>
    set((state) => {
      const next = { ...state.edgeDefaults, ...patch };
      writePref('edgeType', next.edgeType);
      writePref('strokeWidth', next.strokeWidth);
      return { edgeDefaults: next };
    }),
  applyEdgeDefaultsToAll: () =>
    set((state) => {
      const { edgeType, strokeWidth } = state.edgeDefaults;
      return {
        ...withHistory(state, 'edge-defaults:apply'),
        diagram: {
          ...state.diagram,
          edges: state.diagram.edges.map((edge) => ({ ...edge, edgeType, strokeWidth })),
        },
        saveState: 'dirty',
        toasts: [
          ...state.toasts,
          {
            id: state.toastSeq + 1,
            kind: 'success' as const,
            text: `已把当前连线的线型与线宽应用到全部 ${state.diagram.edges.length} 条连线`,
          },
        ],
        toastSeq: state.toastSeq + 1,
      };
    }),
  };
});

/**
 * 派生统计，供状态栏使用。
 *
 * 注意：不能在 selector 里直接 `diagramStats(s.diagram)` —— 那会每次返回新对象，
 * zustand v5 依赖 useSyncExternalStore，快照不稳定会触发 React 无限重渲染。
 */
export function useDiagramStats() {
  const diagram = useDiagramStore((s) => s.diagram);
  return useMemo(() => diagramStats(diagram), [diagram]);
}






