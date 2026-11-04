/**
 * 画布缩放的步进（用户 2026-11-04 定稿）。
 *
 * 以前 `+`/`-`、Ctrl+滚轮、Controls 按钮都是"当前值 ×1.2"，连按几下会落在
 * 87.3%、104.8% 这种数字上；再加上点一次 Fit view 就更乱，状态条上的百分比
 * 没法读。现在统一改成**固定 20% 档位**：20%、40% …… 400%，按一次就是下一档，
 * Fit view 之后（比如 87%）再按也是先对齐到最近的档位（→ 100%）。
 */

/** 一档 = 20% */
export const ZOOM_STEP = 0.2;
/** 最小档位（比 fit view 还能再小一点，但不再往 0.1 走） */
export const ZOOM_MIN = 0.2;
/** 最大档位 */
export const ZOOM_MAX = 4;
/**
 * 状态条上点「100%」要真的把画布缩放到 1:1。
 * 状态条在 ReactFlowProvider 外面拿不到 useReactFlow，用事件通知画布里的组件。
 */
export const ZOOM_RESET_EVENT = 'arch:zoom-reset';

/** 全部档位：0.2 / 0.4 / … / 4.0（整数运算，避免浮点累加出 0.6000000000000001） */
export const ZOOM_LEVELS: readonly number[] = Array.from(
  { length: Math.round((ZOOM_MAX - ZOOM_MIN) / ZOOM_STEP) + 1 },
  (_, i) => Math.round((ZOOM_MIN + i * ZOOM_STEP) * 10) / 10,
);

/**
 * 下一档缩放值。
 *
 * @param zoom 当前缩放（可能是 fit view 出来的 0.873 这种任何值）
 * @param direction +1 放大，-1 缩小
 * @returns 档位表里的下一个值；已经到头则原样返回当前值
 */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  if (!Number.isFinite(zoom)) return 1;
  const EPS = 1e-6;
  if (direction > 0) {
    const found = ZOOM_LEVELS.find((level) => level > zoom + EPS);
    return found ?? ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
  }
  const found = [...ZOOM_LEVELS].reverse().find((level) => level < zoom - EPS);
  return found ?? ZOOM_LEVELS[0]!;
}

/**
 * 缩放后保持"视口中心那个点"不动。
 *
 * ReactFlow 的 `setViewport` 只改 zoom 会以左上角为原点，画面会往左上"跑"；
 * 这里把中心点的流程坐标换算回去，交给调用方 setViewport。
 */
export function zoomAroundCenter(
  viewport: { x: number; y: number; zoom: number },
  nextZoomValue: number,
  size: { width: number; height: number },
): { x: number; y: number; zoom: number } {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const flowX = (cx - viewport.x) / viewport.zoom;
  const flowY = (cy - viewport.y) / viewport.zoom;
  return {
    x: cx - flowX * nextZoomValue,
    y: cy - flowY * nextZoomValue,
    zoom: nextZoomValue,
  };
}
