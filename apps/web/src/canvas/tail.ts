/**
 * 气泡注释的尖角几何（纯函数，好单测）。
 *
 * 尖角方向用**自由角度**表示：0° 指向右，90° 指向下（屏幕坐标 y 向下），
 * 逆时针为正。渲染时从节点矩形中心沿该方向射一条射线，**与矩形边界的交点**
 * 就是尖角的根部 —— 所以左侧的尖角天然从形状左侧射出，不会跑到右上角去。
 *
 * 数据存在节点的 `extJson.tailAngle`（数字，度）。缺失或非法时用默认值。
 */
export const DEFAULT_TAIL_ANGLE = 135;
/** 尖角长度（px），固定值：不做拖拽长度，避免和缩放手柄抢手势 */
export const TAIL_LENGTH = 14;
/** 尖角根部两个角点之间的半宽（px） */
export const TAIL_HALF_WIDTH = 7;

export interface Point {
  x: number;
  y: number;
}

export interface TailGeometry {
  /** 尖角根部在矩形边界上的两个点 */
  baseA: Point;
  baseB: Point;
  /** 尖角尖端（矩形外） */
  tip: Point;
}

/** 把任意角度规整到 [0, 360) */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_TAIL_ANGLE;
  const wrapped = angle % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** 中心沿 angle 方向的射线与矩形 (w × h) 边界的交点 */
export function edgePoint(width: number, height: number, angle: number): Point {
  const rad = (normalizeAngle(angle) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfW = width / 2;
  const halfH = height / 2;
  // 到左右边界 / 上下边界各要多少倍方向向量，取小的那个
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: halfW + dx * t, y: halfH + dy * t };
}

/** 计算尖角三角形；节点尺寸变化时重新算，保证根部始终贴边 */
export function tailGeometry(width: number, height: number, angle: number): TailGeometry {
  const base = edgePoint(width, height, angle);
  const rad = (normalizeAngle(angle) * Math.PI) / 180;
  // 垂直于方向的单位向量，用来把根部摊开成一段"底边"
  const perpX = -Math.sin(rad);
  const perpY = Math.cos(rad);
  return {
    baseA: { x: base.x + perpX * TAIL_HALF_WIDTH, y: base.y + perpY * TAIL_HALF_WIDTH },
    baseB: { x: base.x - perpX * TAIL_HALF_WIDTH, y: base.y - perpY * TAIL_HALF_WIDTH },
    tip: { x: base.x + Math.cos(rad) * TAIL_LENGTH, y: base.y + Math.sin(rad) * TAIL_LENGTH },
  };
}

/**
 * 由"指针相对节点中心的位置"反推角度（拖动尖角手柄时用）。
 *
 * 传入的是屏幕像素偏移即可：画布缩放是等比的，比例不变，角度一样。
 */
export function angleFromOffset(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return DEFAULT_TAIL_ANGLE;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return normalizeAngle(Math.round(deg));
}

/** 从节点 extJson 里读角度，非法/缺失就落回默认值 */
export function tailAngleOf(extJson: Record<string, unknown> | undefined): number {
  const raw = extJson?.tailAngle;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_TAIL_ANGLE;
  return normalizeAngle(raw);
}
