/**
 * 对齐与分布（规格 §4.4 / 阶段 2 第 2 项）。
 *
 * 全部是纯函数：输入一批包围盒，输出每个元素的平移量。
 * 好处是"选了几个、是不是子节点"这些事留在 store 里处理，
 * 这里只关心几何，能单独测。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

export interface Delta {
  dx: number;
  dy: number;
}

const EMPTY: Delta = { dx: 0, dy: 0 };

/** 这批包围盒的整体外框 */
export function boundingBox(rects: readonly Rect[]): Rect | null {
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
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 对齐：以选中集合的整体外框为准。
 * 少于 2 个元素时没有意义，直接给零位移（不做"自己对齐自己"这种无效操作）。
 */
export function alignRects(rects: readonly Rect[], mode: AlignMode): Delta[] {
  if (rects.length < 2) return rects.map(() => EMPTY);
  const box = boundingBox(rects);
  if (!box) return rects.map(() => EMPTY);

  return rects.map((r) => {
    switch (mode) {
      case 'left':
        return { dx: box.x - r.x, dy: 0 };
      case 'centerX':
        return { dx: box.x + box.width / 2 - (r.x + r.width / 2), dy: 0 };
      case 'right':
        return { dx: box.x + box.width - (r.x + r.width), dy: 0 };
      case 'top':
        return { dx: 0, dy: box.y - r.y };
      case 'centerY':
        return { dx: 0, dy: box.y + box.height / 2 - (r.y + r.height / 2) };
      case 'bottom':
        return { dx: 0, dy: box.y + box.height - (r.y + r.height) };
      default:
        return EMPTY;
    }
  });
}

/**
 * 等距分布：首尾不动，中间元素的**间隙**相等。
 *
 * 为什么按间隙而不是按中心：宽度不一时按中心分布看起来会一边挤一边空。
 * 元素数量 < 3 时不做任何事（两个元素之间没有"分布"可言）。
 */
export function distributeRects(rects: readonly Rect[], axis: 'horizontal' | 'vertical'): Delta[] {
  if (rects.length < 3) return rects.map(() => EMPTY);
  const horizontal = axis === 'horizontal';

  const order = rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));

  const first = order[0]!.rect;
  const last = order[order.length - 1]!.rect;
  const sorted = order.map((entry) => entry.rect);

  const span = horizontal
    ? last.x + last.width - first.x
    : last.y + last.height - first.y;
  const used = sorted.reduce((sum, r) => sum + (horizontal ? r.width : r.height), 0);
  const gap = (span - used) / (sorted.length - 1);

  const deltas: Delta[] = rects.map(() => EMPTY);
  let cursor = horizontal ? first.x : first.y;
  order.forEach((entry, i) => {
    const r = entry.rect;
    if (i === 0 || i === order.length - 1) {
      cursor += (horizontal ? r.width : r.height) + gap;
      return;
    }
    const delta: Delta = horizontal ? { dx: cursor - r.x, dy: 0 } : { dx: 0, dy: cursor - r.y };
    deltas[entry.index] = delta;
    cursor += (horizontal ? r.width : r.height) + gap;
  });

  return deltas;
}
