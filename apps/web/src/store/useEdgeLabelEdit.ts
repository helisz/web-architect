import { create } from 'zustand';

/**
 * 「双击连线改标注」的编辑态（用户 2026-11-05）。
 *
 * 为什么不塞进 diagramStore：
 * - 它是纯 UI 瞬时状态，不该进撤销栈、更不该进保存；
 * - 连线是 React Flow 的渲染对象，编辑态若进 flow data 会污染 WeakMap 缓存键，
 *   一个开关就要把整条边重新映射，反而更慢。
 *
 * 所以单独放一个最小 store：Canvas 双击时 `start(edgeId)`，ArchEdge 自己订阅
 * 「我是不是正在被编辑」。
 */
interface EdgeLabelEditState {
  editingEdgeId: string | null;
  start: (edgeId: string) => void;
  stop: () => void;
}

export const useEdgeLabelEdit = create<EdgeLabelEditState>()((set) => ({
  editingEdgeId: null,
  start: (editingEdgeId) => set({ editingEdgeId }),
  stop: () => set({ editingEdgeId: null }),
}));
