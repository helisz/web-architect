import { INTERACTION } from './constants.js';
import { anchorPoint, isHorizontalAnchor, outwardVector, roundTo } from './geometry.js';
import type { Anchor, Point, Rect } from './types.js';

/**
 * 正交折线路由（规格 §11.3）。
 *
 * step 1–4：按锚点方向出线、2 个中间拐点（同侧出线绕联合包围盒）。
 * step 5：冲突绕行 —— 与中间节点相交时把通道平移到最近的可通行空隙。
 * step 6：4px 圆角（`toRoundedPath`）。
 *
 * 绕行实现：先按基础规则算一条，若被节点挡住就枚举"候选通道"（所有障碍边界
 * ± 12px + 中点），打分取最优 —— 代价 = 折线长度 + 相交惩罚。障碍多时用
 * 空间网格（`RectIndex`）按路径包围盒取相关矩形，避免每条边扫全图。
 */

const GAP = INTERACTION.anchorGap;

/**
 * 判定遮挡时的内缩量。
 *
 * 规格 §11.3 写的是 6px（容忍贴边），但实测会放过"从节点上边缘塞进去 4px"的路线，
 * 视觉上线和节点边框糊在一起。这里按 0 内缩判定：真·压住才算压住，
 * 贴边（切线恰好落在边框上）由于用严格不等号仍然不算命中。
 */
const BLOCK_INSET = 0;
/** 绕行通道与障碍边界的安全距离 */
const CHANNEL_MARGIN = 12;
/** 每个方向最多试几条候选通道（避免大图里候选爆炸） */
const MAX_CHANNELS = 12;
/** 评分惩罚：压住一个节点 / 压住自身两端 */
const HIT_PENALTY = 5_000;
const SOLID_PENALTY = 50_000;

/* ------------------------------------------------------------------ */
/* 空间网格：按包围盒取相关矩形                                          */
/* ------------------------------------------------------------------ */

/** 均匀网格索引；单元格 240px，与节点量级相当 */
export class RectIndex {
  private readonly cell: number;
  private readonly buckets = new Map<string, Rect[]>();
  private readonly seen = new Set<Rect>();

  constructor(rects: readonly Rect[], cell = 240) {
    this.cell = cell;
    for (const rect of rects) {
      if (this.seen.has(rect)) continue;
      this.seen.add(rect);
      const x1 = Math.floor(rect.x / cell);
      const x2 = Math.floor((rect.x + rect.width) / cell);
      const y1 = Math.floor(rect.y / cell);
      const y2 = Math.floor((rect.y + rect.height) / cell);
      for (let cx = x1; cx <= x2; cx += 1) {
        for (let cy = y1; cy <= y2; cy += 1) {
          const key = `${cx}:${cy}`;
          const bucket = this.buckets.get(key);
          if (bucket) bucket.push(rect);
          else this.buckets.set(key, [rect]);
        }
      }
    }
  }

  /** 与 area 有交集的矩形（去重，顺序稳定） */
  query(area: Rect): Rect[] {
    const out: Rect[] = [];
    const hit = new Set<Rect>();
    const x1 = Math.floor(area.x / this.cell);
    const x2 = Math.floor((area.x + area.width) / this.cell);
    const y1 = Math.floor(area.y / this.cell);
    const y2 = Math.floor((area.y + area.height) / this.cell);
    for (let cx = x1; cx <= x2; cx += 1) {
      for (let cy = y1; cy <= y2; cy += 1) {
        for (const rect of this.buckets.get(`${cx}:${cy}`) ?? []) {
          if (hit.has(rect)) continue;
          hit.add(rect);
          if (rect.x <= area.x + area.width && rect.x + rect.width >= area.x && rect.y <= area.y + area.height && rect.y + rect.height >= area.y) {
            out.push(rect);
          }
        }
      }
    }
    return out;
  }
}

/** 数组不大时直接线性扫；大了才建索引（按数组身份缓存，同一批矩形只建一次） */
const indexCache = new WeakMap<readonly Rect[], RectIndex>();

function queryRect(rects: readonly Rect[], area: Rect): Rect[] {
  if (rects.length < 48) {
    return rects.filter(
      (r) => r.x <= area.x + area.width && r.x + r.width >= area.x && r.y <= area.y + area.height && r.y + r.height >= area.y,
    );
  }
  let index = indexCache.get(rects);
  if (!index) {
    index = new RectIndex(rects);
    indexCache.set(rects, index);
  }
  return index.query(area);
}

/* ------------------------------------------------------------------ */
/* 几何工具                                                            */
/* ------------------------------------------------------------------ */

function boundingBox(points: Point[], pad = 0): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

const sameRect = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 0.01 &&
  Math.abs(a.y - b.y) < 0.01 &&
  Math.abs(a.width - b.width) < 0.01 &&
  Math.abs(a.height - b.height) < 0.01;

/** 正交线段是否与矩形相交（inset 内缩后判定；贴边不算） */
export function segmentHitsRect(a: Point, b: Point, rect: Rect, inset = 0): boolean {
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  if (right <= left || bottom <= top) return false;

  if (Math.abs(a.y - b.y) < 0.01) {
    const y = a.y;
    if (y <= top || y >= bottom) return false;
    const [x1, x2] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
    return x2 > left && x1 < right;
  }
  if (Math.abs(a.x - b.x) < 0.01) {
    const x = a.x;
    if (x <= left || x >= right) return false;
    const [y1, y2] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
    return y2 > top && y1 < bottom;
  }
  return false;
}

interface Score {
  /** 遮挡惩罚（0 = 完全畅通） */
  penalty: number;
  length: number;
}

/** 打分：压住中间节点一次 5000，压住两端节点一次 50000，另加折线长度 */
function scorePath(points: Point[], solids: Rect[], obstacles: readonly Rect[]): Score {
  let length = 0;
  let penalty = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    length += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (const rect of obstacles) {
      if (segmentHitsRect(a, b, rect, BLOCK_INSET)) penalty += HIT_PENALTY;
    }
    for (const rect of solids) {
      if (segmentHitsRect(a, b, rect, 0)) penalty += SOLID_PENALTY;
    }
  }
  return { penalty, length };
}

/* ------------------------------------------------------------------ */
/* 基础路由（step 1–4）                                                */
/* ------------------------------------------------------------------ */

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

/** 基础折线：不考虑中间节点遮挡（规格 step 1–4） */
function basicOrthoPoints(sr: Rect, sa: Anchor, tr: Rect, ta: Anchor): Point[] {
  const p0 = exitPoint(sr, sa);
  const p1 = exitPoint(tr, ta);
  const horizontalSource = isHorizontalAnchor(sa);
  const horizontalTarget = isHorizontalAnchor(ta);

  // 1) 同轴（right→left / right→right / top→bottom …）
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

/* ------------------------------------------------------------------ */
/* 冲突绕行（step 5）                                                  */
/* ------------------------------------------------------------------ */

/** 通道候选：中点优先，其余来自障碍边界 ± 安全距离，按离中点远近排序 */
function channelCandidates(mid: number, values: number[]): number[] {
  const unique = [...new Set(values.map((v) => Math.round(v * 100) / 100))];
  unique.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  return [mid, ...unique.filter((v) => Math.abs(v - mid) > 0.01)].slice(0, MAX_CHANNELS);
}

/**
 * 计算连线折点集（不含圆角）。
 *
 * `obstacles` 传入图中其它节点的矩形；为空时行为与纯规则路由完全一致。
 * 有障碍时枚举候选通道并打分，返回第一条"压得最少、最短"的折线。
 */
export function orthoPoints(
  sr: Rect,
  sa: Anchor,
  tr: Rect,
  ta: Anchor,
  obstacles: readonly Rect[] = [],
): Point[] {
  const basic = basicOrthoPoints(sr, sa, tr, ta);
  if (obstacles.length === 0) return basic;

  // 只有路径附近、且不是两端自己的矩形才可能挡路
  const nearby = queryRect(obstacles, boundingBox(basic, CHANNEL_MARGIN * 8)).filter(
    (r) => !sameRect(r, sr) && !sameRect(r, tr),
  );
  if (nearby.length === 0) return basic;

  const solids = [sr, tr];
  const basicScore = scorePath(basic, solids, nearby);
  if (basicScore.penalty === 0 && basic.length <= 6) return basic;

  const p0 = exitPoint(sr, sa);
  const p1 = exitPoint(tr, ta);
  const candidates: Point[][] = [basic];

  // Z 形（两个中间拐点）：竖直通道 / 水平通道
  const midX = (p0.x + p1.x) / 2;
  const midY = (p0.y + p1.y) / 2;
  const xs: number[] = [];
  const ys: number[] = [];
  const yBand = { min: Math.min(p0.y, p1.y) - CHANNEL_MARGIN, max: Math.max(p0.y, p1.y) + CHANNEL_MARGIN };
  const xBand = { min: Math.min(p0.x, p1.x) - CHANNEL_MARGIN, max: Math.max(p0.x, p1.x) + CHANNEL_MARGIN };
  for (const r of nearby) {
    if (r.y + r.height > yBand.min && r.y < yBand.max) {
      xs.push(r.x - CHANNEL_MARGIN, r.x + r.width + CHANNEL_MARGIN);
    }
    if (r.x + r.width > xBand.min && r.x < xBand.max) {
      ys.push(r.y - CHANNEL_MARGIN, r.y + r.height + CHANNEL_MARGIN);
    }
  }
  xs.push(Math.min(p0.x, p1.x) - CHANNEL_MARGIN * 3, Math.max(p0.x, p1.x) + CHANNEL_MARGIN * 3);
  ys.push(Math.min(p0.y, p1.y) - CHANNEL_MARGIN * 3, Math.max(p0.y, p1.y) + CHANNEL_MARGIN * 3);

  for (const x of channelCandidates(midX, xs)) {
    candidates.push(simplifyPoints([p0, { x, y: p0.y }, { x, y: p1.y }, p1]));
  }
  for (const y of channelCandidates(midY, ys)) {
    candidates.push(simplifyPoints([p0, { x: p0.x, y }, { x: p1.x, y }, p1]));
  }

  // L 形（单拐点），两个方向都试
  candidates.push(simplifyPoints([p0, { x: p1.x, y: p0.y }, p1]));
  candidates.push(simplifyPoints([p0, { x: p0.x, y: p1.y }, p1]));

  let best = basic;
  let bestScore = basicScore;
  for (const points of candidates) {
    const score = scorePath(points, solids, nearby);
    // 先比遮挡，再比长度；同分保留先出现的（基础路由优先）
    if (score.penalty < bestScore.penalty || (score.penalty === bestScore.penalty && score.length < bestScore.length - 0.01)) {
      best = points;
      bestScore = score;
    }
  }
  return best;
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

/** 一步到位：节点矩形 + 锚点 → SVG path + 折点（obstacles 参与冲突绕行） */
export function buildOrthoPath(
  source: Rect,
  sourceAnchor: Anchor,
  target: Rect,
  targetAnchor: Anchor,
  obstacles: readonly Rect[] = [],
): { points: Point[]; d: string; labelPoint: Point } {
  const points = orthoPoints(source, sourceAnchor, target, targetAnchor, obstacles);
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
