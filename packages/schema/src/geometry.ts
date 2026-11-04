import type { Anchor, Point, Rect } from './types.js';

/** 取矩形四边中点（Handle 所在位置） */
export function anchorPoint(r: Rect, anchor: Anchor): Point {
  switch (anchor) {
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
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
