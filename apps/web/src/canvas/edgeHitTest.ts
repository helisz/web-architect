/**
 * 框选连线用的几何命中（用户 2026-11-05）。
 *
 * 为什么需要这层：React Flow 的框选**只算节点**，连线是靠 `connectionLookup`
 * 把"与已选节点相连的边"顺带选上的（见 @xyflow/react 的 commitUserSelectionRect），
 * 它从不判断一条线是否穿过选框。所以"框里只有线"这种场景在 RF 里恒等于 0 选中。
 *
 * 做法：拿真实渲染出来的 `<path>` 采样成折线，再做「线段 × 矩形」相交。
 * 好处是直线 / 正交折线 / 贝塞尔一视同仁，不用把三种生成器再实现一遍。
 *
 * 这个文件的纯函数都有单测；只有 `edgeIdsInRect` 依赖 DOM。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 归一化两个角点成一个正矩形（框选可以从任意方向拉） */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectContains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/**
 * 线段与矩形是否相交（Liang–Barsky 裁剪）。
 *
 * 只看端点不够：一条长线可能整段跨过一个小选框，两个采样点都在框外。
 * 端点落在框内、穿过、贴着边走、整个在框内，都算命中。
 */
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.x, rect.x + rect.width - a.x, a.y - rect.y, rect.y + rect.height - a.y];
  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      // 平行于该边界：在外侧就整条不相交
      if (qi < 0) return false;
      continue;
    }
    const r = qi / pi;
    if (pi < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/** 折线（含单点）与矩形相交 */
export function polylineIntersectsRect(points: Point[], rect: Rect): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) return rectContains(rect, points[0]!);
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsRect(points[i]!, points[i + 1]!, rect)) return true;
  }
  return false;
}

/** 只要这两样能力，方便单测塞桩对象（真实实现是 SVGPathElement） */
export interface PathLike {
  getTotalLength(): number;
  getPointAtLength(offset: number): Point;
}

/**
 * 把一条 path 采样成折线。
 *
 * 采样密度按长度定（每 6px 一个点，2~48 个），既不会漏掉跨越，也不至于
 * 在一条 2000px 的曲线上撒几千个点。
 */
export function samplePath(path: PathLike, maxSamples = 48, step = 6): Point[] {
  let length = 0;
  try {
    length = path.getTotalLength();
  } catch {
    return [];
  }
  if (!Number.isFinite(length) || length <= 0) return [];
  const count = Math.max(2, Math.min(maxSamples, Math.ceil(length / step)));
  const out: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const point = path.getPointAtLength((length * i) / count);
    out.push({ x: point.x, y: point.y });
  }
  return out;
}

/**
 * 找出穿过了这块矩形（流程坐标）的所有连线 id。
 *
 * 先从 React Flow 渲染出的 `.react-flow__edge` 里取 `data-id` 和那条 path：
 * path 的坐标就是流程坐标（父级 `<g class="react-flow__viewport">` 负责平移缩放），
 * 所以矩形也用流程坐标，不用管缩放。
 */
export function edgeIdsInRect(container: ParentNode | null, rect: Rect): string[] {
  if (!container || rect.width <= 0 || rect.height <= 0) return [];
  const found: string[] = [];
  const groups = container.querySelectorAll<HTMLElement>('.react-flow__edge');
  groups.forEach((group) => {
    const id = group.getAttribute('data-id');
    if (!id) return;
    const path = group.querySelector<SVGPathElement>('.react-flow__edge-path');
    if (!path) return;
    // 粗筛：包围盒都不相交的直接跳过（几百条线时省掉大部分采样）
    let bbox: DOMRect | null = null;
    try {
      bbox = path.getBBox();
    } catch {
      bbox = null;
    }
    if (bbox && !rectsIntersect(rect, { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height })) return;
    if (polylineIntersectsRect(samplePath(path), rect)) found.push(id);
  });
  return found;
}
