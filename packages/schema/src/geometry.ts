import type { Anchor, Point, Rect } from './types.js';

/** 端点沿边的默认位置：0.5 = 中点（= Handle 所在位置） */
export const ANCHOR_MID = 0.5;

/** 网格单位：端点沿边吸附用（与画布 10px 吸附一致） */
export const ANCHOR_GRID = 10;

/**
 * 取矩形某条边上的点（2026-11-08：端点不再只能是中点）。
 *
 * `at` 是沿边比例：上下边沿 x 走、左右边沿 y 走，0 = 起点、1 = 终点、0.5 = 中点。
 * 脏数据（NaN / 越界）夹到合法区间，不会把线甩到节点外面。
 */
export function anchorPoint(r: Rect, anchor: Anchor, at: number = ANCHOR_MID): Point {
  const t = Number.isFinite(at) ? Math.min(1, Math.max(0, at)) : ANCHOR_MID;
  switch (anchor) {
    case 'top':
      return { x: r.x + r.width * t, y: r.y };
    case 'bottom':
      return { x: r.x + r.width * t, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height * t };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height * t };
  }
}

/**
 * 把画布上的点投影到矩形边框上（拖端点 / 拖线落在节点身上时用）。
 *
 * - 先按"离哪条边最近"选边（和手柄吸附同一套判据）；
 * - 再把坐标投影到那条边，并**吸附到网格**（默认 10px），比例由吸附后的坐标反算；
 * - 比例会被夹在 0..1，所以贴角时端点落在角上而不是跑出去。
 */
export function projectToAnchor(
  r: Rect,
  p: Point,
  grid: number = ANCHOR_GRID,
): { anchor: Anchor; at: number } {
  const snap = (value: number): number =>
    grid > 0 ? Math.round(value / grid) * grid : value;

  const dLeft = Math.abs(p.x - r.x);
  const dRight = Math.abs(p.x - (r.x + r.width));
  const dTop = Math.abs(p.y - r.y);
  const dBottom = Math.abs(p.y - (r.y + r.height));
  const min = Math.min(dLeft, dRight, dTop, dBottom);

  // 判边顺序沿用旧的 nearestAnchor：左右优先于上下（角上并列时行为不变）
  if (min === dLeft || min === dRight) {
    const anchor: Anchor = min === dLeft ? 'left' : 'right';
    const y = Math.min(r.y + r.height, Math.max(r.y, snap(p.y)));
    return { anchor, at: r.height > 0 ? (y - r.y) / r.height : ANCHOR_MID };
  }
  const anchor: Anchor = min === dTop ? 'top' : 'bottom';
  const x = Math.min(r.x + r.width, Math.max(r.x, snap(p.x)));
  return { anchor, at: r.width > 0 ? (x - r.x) / r.width : ANCHOR_MID };
}

/** 读边上存的比例（`extJson.sourceAt / targetAt`），脏数据回落到中点 */
export function readEdgeAnchorAt(
  extJson: Record<string, unknown> | undefined,
  end: 'source' | 'target',
): number {
  const raw = extJson?.[end === 'source' ? 'sourceAt' : 'targetAt'];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return ANCHOR_MID;
  return Math.min(1, Math.max(0, raw));
}

/** 锚点朝外的单位方向向量 */
export function outwardVector(anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

export const isHorizontalAnchor = (a: Anchor): boolean => a === 'left' || a === 'right';

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectFrom(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

/** 把矩形按四边向内收缩 shrink（用于"内缩 6px 判定"） */
export function shrinkRect(r: Rect, shrink: number): Rect {
  return {
    x: r.x + shrink,
    y: r.y + shrink,
    width: Math.max(0, r.width - shrink * 2),
    height: Math.max(0, r.height - shrink * 2),
  };
}

export function rectsIntersect(a: Rect, b: Rect, shrink = 0): boolean {
  const aa = shrink ? shrinkRect(a, shrink) : a;
  const bb = shrink ? shrinkRect(b, shrink) : b;
  return (
    aa.x < bb.x + bb.width &&
    aa.x + aa.width > bb.x &&
    aa.y < bb.y + bb.height &&
    aa.y + aa.height > bb.y
  );
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function roundTo(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** 内容包围盒 + 可选外边距 */
export function boundingBox(rects: Rect[], padding = 0): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}
