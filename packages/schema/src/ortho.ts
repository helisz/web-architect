import { INTERACTION } from './constants.js';
import { anchorPoint, isHorizontalAnchor, outwardVector, roundTo } from './geometry.js';
import type { Anchor, Point, Rect } from './types.js';

/**
 * 正交折线路由（规格 §11.3 step 1–4 + step 6）。
 *
 * 实现的是 MVP 版本：按锚点方向出线、2 个中间拐点、4px 圆角。
 * step 5「与中间节点相交时绕行」留到阶段 2（见 TODO），届时需要在
 * 这里接入空间网格，保持函数签名不变即可。
 *
 * TODO(阶段2): 冲突绕行 —— 扫描可视区节点矩形，把通道平移到最近可通行 slot。
 */

const GAP = INTERACTION.anchorGap;

/** 从矩形某条边的中点沿法线外扩一个间隙，作为连线的出入口 */
export function exitPoint(r: Rect, anchor: Anchor): Point {
  const p = anchorPoint(r, anchor);
  const v = outwardVector(anchor);
  return { x: p.x + v.x * GAP, y: p.y + v.y * GAP };
}

/** 去掉重复点与共线的中间点，保证 path 干净 */
export function simplifyPoints(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    deduped.push(p);
  }
  const out: Point[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = deduped[i]!;
    const next = deduped[i + 1];
    if (prev && next) {
      const collinear =
        (Math.abs(prev.x - cur.x) < 0.01 && Math.abs(cur.x - next.x) < 0.01) ||
        (Math.abs(prev.y - cur.y) < 0.01 && Math.abs(cur.y - next.y) < 0.01);
      if (collinear) continue;
    }
    out.push(cur);
  }
  return out;
}

/**
 * 计算连线折点集（不含圆角）。
 * 输入为两端节点矩形与锚点，输出从左/右/上/下任一方向出线的正交折线。
 */
export function orthoPoints(sr: Rect, sa: Anchor, tr: Rect, ta: Anchor): Point[] {
  const p0 = exitPoint(sr, sa);
  const p1 = exitPoint(tr, ta);
  const horizontalSource = isHorizontalAnchor(sa);
  const horizontalTarget = isHorizontalAnchor(ta);

  // 1) 同轴反向（right→left / left→right / top→bottom / bottom→top）
  if (horizontalSource === horizontalTarget) {
    const sameDirection = sa === ta;
    if (sameDirection) {
      // 同侧出线：绕出联合包围盒再折回，保证最后一段仍是垂直于该边的方向
      const outer = GAP * 5;
      const inner = GAP * 2;
      if (sa === 'right' || sa === 'left') {
        const edge = sa === 'right' ? Math.max(sr.x + sr.width, tr.x + tr.width) : Math.min(sr.x, tr.x);
        const sign = sa === 'right' ? 1 : -1;
        const xOuter = edge + sign * outer;
        const xInner = edge + sign * inner;
        const yDetour = Math.min(sr.y, tr.y) - outer;
        return simplifyPoints([
          p0,
          { x: xOuter, y: p0.y },
          { x: xOuter, y: yDetour },
          { x: xInner, y: yDetour },
          { x: xInner, y: p1.y },
          p1,
        ]);
      }
      const edge = sa === 'bottom' ? Math.max(sr.y + sr.height, tr.y + tr.height) : Math.min(sr.y, tr.y);
      const sign = sa === 'bottom' ? 1 : -1;
      const yOuter = edge + sign * outer;
      const yInner = edge + sign * inner;
      const xDetour = Math.min(sr.x, tr.x) - outer;
      return simplifyPoints([
        p0,
        { x: p0.x, y: yOuter },
        { x: xDetour, y: yOuter },
        { x: xDetour, y: yInner },
        { x: p1.x, y: yInner },
        p1,
      ]);
    }

    const dx = Math.abs(p1.x - p0.x);
    const dy = Math.abs(p1.y - p0.y);
    if (horizontalSource) {
      // right→left：优先在水平中点竖折
      if (dx >= dy) {
        const midX = (p0.x + p1.x) / 2;
        return simplifyPoints([p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1]);
      }
      const midY = (p0.y + p1.y) / 2;
      return simplifyPoints([p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1]);
    }
    if (dy >= dx) {
      const midY = (p0.y + p1.y) / 2;
      return simplifyPoints([p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1]);
    }
    const midX = (p0.x + p1.x) / 2;
    return simplifyPoints([p0, { x: midX, y: p0.y }, { x: midX, y: p1.y }, p1]);
  }

  // 2) 垂直方向对（如 right→top）：单拐点 (P1.x, P0.y)
  return simplifyPoints([p0, { x: p1.x, y: p0.y }, p1]);
}

/** 生成带圆角的 SVG path（规格 §11.3 step 6：Q 命令，4px 圆角） */
export function toRoundedPath(points: Point[], radius = INTERACTION.cornerRadius): string {
  const pts = simplifyPoints(points);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${roundTo(pts[0]!.x)} ${roundTo(pts[0]!.y)}`;

  let d = `M ${roundTo(pts[0]!.x)} ${roundTo(pts[0]!.y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (inLen < 0.01 || outLen < 0.01) {
      d += ` L ${roundTo(cur.x)} ${roundTo(cur.y)}`;
      continue;
    }
    // 拐角处直角转 90°，r 不能超过相邻段长的一半
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = {
      x: cur.x - ((cur.x - prev.x) / inLen) * r,
      y: cur.y - ((cur.y - prev.y) / inLen) * r,
    };
    const b = {
      x: cur.x + ((next.x - cur.x) / outLen) * r,
      y: cur.y + ((next.y - cur.y) / outLen) * r,
    };
    d += ` L ${roundTo(a.x)} ${roundTo(a.y)}`;
    d += ` Q ${roundTo(cur.x)} ${roundTo(cur.y)} ${roundTo(b.x)} ${roundTo(b.y)}`;
  }
  const last = pts[pts.length - 1]!;
  d += ` L ${roundTo(last.x)} ${roundTo(last.y)}`;
  return d;
}

/**
 * 边标签挂载点：取最长水平段中点；无水平段则取最长垂直段中点（规格 §11.3 末段）。
 */
export function labelAnchorPoint(points: Point[]): Point {
  const pts = simplifyPoints(points);
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return pts[0]!;

  let bestHorizontal: { len: number; mid: Point } | null = null;
  let bestVertical: { len: number; mid: Point } | null = null;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (Math.abs(a.y - b.y) < 0.01) {
      const len = Math.abs(b.x - a.x);
      if (!bestHorizontal || len > bestHorizontal.len) bestHorizontal = { len, mid };
    } else if (Math.abs(a.x - b.x) < 0.01) {
      const len = Math.abs(b.y - a.y);
      if (!bestVertical || len > bestVertical.len) bestVertical = { len, mid };
    }
  }
  if (bestHorizontal) return bestHorizontal.mid;
  if (bestVertical) return bestVertical.mid;
  return pts[0]!;
}

/** 一步到位：节点矩形 + 锚点 → SVG path + 折点 */
export function buildOrthoPath(
  source: Rect,
  sourceAnchor: Anchor,
  target: Rect,
  targetAnchor: Anchor,
): { points: Point[]; d: string; labelPoint: Point } {
  const points = orthoPoints(source, sourceAnchor, target, targetAnchor);
  // 端点贴住节点边框：路由内部用外扩点算出入口方向，但首尾两点回到边框上，
  // 这样线和箭头不会与节点之间留一条缝。
  const touchStart = anchorPoint(source, sourceAnchor);
  const touchEnd = anchorPoint(target, targetAnchor);
  if (points.length >= 2) {
    points[0] = touchStart;
    points[points.length - 1] = touchEnd;
  }
  return { points, d: toRoundedPath(points), labelPoint: labelAnchorPoint(points) };
}
