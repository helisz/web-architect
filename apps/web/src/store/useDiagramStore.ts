import { useMemo } from 'react';
import { create } from 'zustand';
import {
  EDGE_DEFAULTS,
  createEdge,
  createEmptyDiagram,
  createGroup,
  createNode,
  diagramStats,
  MAX_GROUP_DEPTH,
  removeGroupLifting,
  setGroupParent,
  setNodeGroup,
  type Anchor,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type NodeType,
  type Point,
  type Viewport,
} from '@arch/schema';

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
  setBooted: (booted: boolean) => void;
  setBootError: (message: string | null) => void;
  rename: (name: string) => void;
  setViewport: (viewport: Viewport) => void;
  select: (id: string | null) => void;
  /** 多选：按 ReactFlow 的 select 变更增量更新 */
  updateSelection: (add: string[], remove: string[]) => void;
  /** 选中集合（框选后批量删除用） */
  requestDelete: (ids: string[]) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;

  /** 画布编辑动作（M1） */
  addNode: (nodeType: NodeType, position: Point, groupId?: string | null) => DiagramNode;
  moveNode: (nodeId: string, position: Point) => void;
  resizeNode: (nodeId: string, size: { width: number; height: number }) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (sourceId: string, targetId: string, sourceAnchor: string, targetAnchor: string) => void;
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
  reparentGroup: (groupId: string, parentGroupId: string | null) => void;

  /** 保存链路（M2） */
  markDirty: () => void;
  markSaving: () => void;
  markSaved: () => void;
  applySaved: (version: number, savedAt: string) => void;
  setConflict: (conflict: SaveConflict | null) => void;
  setSaveError: (message: string | null) => void;
  setSaveDisabled: (disabled: boolean) => void;
  /** 中性提示（例如导入时被自动修复了几处），不会被保存成功清掉 */
  notice: string | null;
  setNotice: (notice: string | null) => void;

  /** 画布网格开关（右上角可切，本地记住） */
  showGrid: boolean;
  toggleGrid: () => void;

  /** 连线全局配置：只影响新建的线，可一键应用到全部 */
  edgeDefaults: { edgeType: DiagramEdge['edgeType']; strokeWidth: number };
  setEdgeDefaults: (patch: Partial<{ edgeType: DiagramEdge['edgeType']; strokeWidth: number }>) => void;
  applyEdgeDefaultsToAll: () => void;
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

/** 真正执行删除：连线 → 节点 → 分组（removeGroupLifting 会把剩余子节点提上一层） */
function applyDeletion(
  state: Pick<DiagramStore, 'diagram' | 'past' | 'future' | 'undoKey' | 'undoAt'>,
  pending: { nodeIds: string[]; edgeIds: string[]; groupIds: string[] },
): Pick<DiagramStore, 'diagram' | 'saveState' | 'pendingDelete' | 'selectedId' | 'selectedIds'> & Partial<HistoryPatch> {
  let diagram = state.diagram;
  const nodeSet = new Set(pending.nodeIds);
  const edgeSet = new Set(pending.edgeIds);
  diagram = {
    ...diagram,
    edges: diagram.edges.filter(
      (e) => !edgeSet.has(e.edgeId) && !nodeSet.has(e.sourceNodeId) && !nodeSet.has(e.targetNodeId),
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
export const useDiagramStore = create<DiagramStore>()((set, get) => ({
  diagram: createEmptyDiagram({ name: '未命名架构图' }),
  saveState: 'saved',
  selectedId: null,
  selectedIds: [],
  pendingDelete: null,
  booted: false,
  bootError: null,
  conflict: null,
  saveError: null,
  saveDisabled: false,
  notice: null,
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
  setBootError: (bootError) => set({ bootError }),
  rename: (name) => set((s) => ({ diagram: { ...s.diagram, name }, saveState: 'dirty' })),
  setViewport: (viewport) => set((s) => ({ diagram: { ...s.diagram, viewport } })),
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

  addNode: (nodeType, position, groupId) => {
    const state = get();
    const node = createNode(nodeType, state.diagram.diagramId, position, groupId ? { groupId } : {});
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

  resizeNode: (nodeId, size) =>
    set((s) => ({
      ...withHistory(s, `resize:${nodeId}`),
      diagram: applyNode(s.diagram, nodeId, { width: size.width, height: size.height }),
      saveState: 'dirty',
    })),

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

  addEdge: (sourceId, targetId, sourceAnchor, targetAnchor) =>
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

  /* —— 分组 —— */
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
    set((s) => ({
      ...withHistory(s, `resizeGroup:${groupId}`),
      diagram: {
        ...s.diagram,
        groups: s.diagram.groups.map((g) =>
          g.groupId === groupId ? { ...g, width: size.width, height: size.height } : g,
        ),
      },
      saveState: 'dirty',
    })),

  patchGroup: (groupId, patch) =>
    set((s) => ({
      ...withHistory(s, `patchGroup:${groupId}:${Object.keys(patch).join(',')}`),
      diagram: {
        ...s.diagram,
        groups: s.diagram.groups.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)),
      },
      saveState: 'dirty',
    })),

  removeGroup: (groupId) =>
    set((s) => {
      const next = removeGroupLifting(s.diagram, groupId);
      if (next === s.diagram) return s;
      return {
        ...withHistory(s, `removeGroup:${groupId}`),
        diagram: next,
        selectedId: s.selectedId === groupId ? null : s.selectedId,
        saveState: 'dirty',
      };
    }),

  toggleGroupCollapsed: (groupId) =>
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

  reparentNode: (nodeId, groupId) =>
    set((s) => {
      // 嵌套上限 3 层：目标组本身已经 3 层深时不再接收
      if (groupId) {
        const depth = countDepth(s.diagram.groups, groupId);
        if (depth >= MAX_GROUP_DEPTH) return s;
      }
      const next = setNodeGroup(s.diagram, nodeId, groupId);
      if (next === s.diagram) return s;
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

  /* —— 命令栈 —— */
  undo: () =>
    set((s) => {
      const previous = s.past[s.past.length - 1];
      if (!previous) return s;
      return {
        diagram: previous,
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
        diagram: next,
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
  setNotice: (notice) => set({ notice }),

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
        notice: `已把当前连线的线型与线宽应用到全部 ${state.diagram.edges.length} 条连线`,
      };
    }),
}));

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











