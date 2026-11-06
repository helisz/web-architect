import { create } from 'zustand';

/**
 * 画布交互模式（用户 2026-11-05 第一批引入「拖动模式」，本批把状态提到模块级）。
 *
 * 为什么从 Canvas 的 `useState` 搬出来：
 * - 连线的**拖拽手柄**（换锚点 / 加折点）画在 `ArchEdge` 里，它需要知道
 *   当前是不是拖动模式（拖动模式下不响应），而 `ArchEdge` 和 `CanvasInner` 之间
 *   隔着 React Flow 的节点/连线映射，靠 props 传要污染 flow data 和缓存键；
 * - 它是纯会话状态：不进撤销栈、不进保存、刷新即失效。
 */
interface CanvasModeState {
  panMode: boolean;
  setPanMode: (on: boolean) => void;
  togglePanMode: () => void;
  /**
   * 正在拖一条新连线（2026-11-06）。
   *
   * 拖线时鼠标要横跨画布，浮在画布上的属性卡会挡住落点，而且选中态本身也会跟着变，
   * 属性卡一闪一闪很吵 —— 所以拖线期间把浮动面板整个藏起来，松手再显示。
   */
  connecting: boolean;
  setConnecting: (on: boolean) => void;
}

export const useCanvasMode = create<CanvasModeState>()((set) => ({
  panMode: false,
  setPanMode: (panMode) => set({ panMode }),
  togglePanMode: () => set((s) => ({ panMode: !s.panMode })),
  connecting: false,
  setConnecting: (connecting) => set({ connecting }),
}));
