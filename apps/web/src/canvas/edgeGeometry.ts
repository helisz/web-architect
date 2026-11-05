import type { Anchor } from '@arch/schema';

/**
 * 连线路径几何：折点（waypoints）+ 三种线型的自绘路径。
 *
 * 为什么自己算：React Flow 只提供"两点一段"的生成器
 * （`getStraightPath` / `getSmoothStepPath` / `getBezierPath`），
 * 一旦线上有折点就必须自己拼 path —— 否则就得放弃折点功能。
 *
 * 数据存在 `edge.extJson.waypoints`，不需要数据库迁移
 * （extJson 是 jsonb，schema 是 z.record(string, unknown)）。
 */

export interface Pt {
  x: number;
  y: number;
}

export type EdgeKind = 'ortho' | 'straight' | 'bezier';

/** 折点上限：再多就把线画成一团乱麻，也挡住恶意/坏数据 */
export const MAX_WAYPOINTS = 12;
/** 与画布网格一致：拖折点时按 10px 吸附 */
export const SNAP_STEP = 10;
/** 折点坐标护栏，和 schema 的 coordLimit 对齐 */
const COORD_LIMIT = 100000;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 从 extJson 里读折点（坏值直接丢，不让一个 NaN 毁掉整条线） */
export function readWaypoints(extJson: unknown): Pt[] {
  if (!extJson || typeof extJson !== 'object') return [];
  const raw = (extJson as Record<string, unknown>).waypoints;
  if (!Array.isArray(raw)) return [];
  const out: Pt[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const x = Number((item as Record<string, unknown>).x);
    const y = Number((item as Record<string, unknown>).y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, x)),
      y: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, y)),
    });
    if (out.length >= MAX_WAYPOINTS) break;
  }
  return out;
}

/** 写回 extJson：裁到上限、去重（相邻 0.5px 内的点没意义） */
export function writeWaypoints(
  extJson: Record<string, unknown> | undefined,
  waypoints: Pt[],
): Record<string, unknown> {
  const cleaned: Pt[] = [];
  for (const p of waypoints) {
    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    cleaned.push({ x: round1(p.x), y: round1(p.y) });
    if (cleaned.length >= MAX_WAYPOINTS) break;
  }
  const next = { ...(extJson ?? {}) };
  if (cleaned.length === 0) delete next.waypoints;
  else next.waypoints = cleaned;
  return next;
}

export function snap(value: number, step = SNAP_STEP): number {
  return Math.round(value / step) * step;
}

/** 直线折线：`M … L …`，拐角用 5px 圆角（直角太硬，圆角也不影响端点位置） */
function polylinePath(points: Pt[], radius: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`;
  let d = `M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (radius <= 0 || inLen < 1 || outLen < 1) {
      d += ` L ${round1(cur.x)} ${round1(cur.y)}`;
      continue;
    }
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const p1 = { x: cur.x - ((cur.x - prev.x) / inLen) * r, y: cur.y - ((cur.y - prev.y) / inLen) * r };
    const p2 = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L ${round1(p1.x)} ${round1(p1.y)} Q ${round1(cur.x)} ${round1(cur.y)} ${round1(p2.x)} ${round1(p2.y)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L ${round1(last.x)} ${round1(last.y)}`;
  return d;
}

/**
 * 正交折线：每两个折点之间走"先横后纵"或"先纵后横"。
 *
 * 选择规则（让线头看起来是从节点边上"长出来"的）：
 * - 从源锚点出来的第一段：源锚点在左右 → 先横；在上下 → 先纵；
 * - 收进目标锚点前的最后一段：目标锚点在左右 → 先纵（最后一段横着进来）；上下 → 先横；
 * - 中间段：默认"先横后纵"，避免连续同向折角。
 */
export function orthoPoints(
  points: Pt[],
  sourceAnchor: Anchor,
  targetAnchor: Anchor,
): Pt[] {
  if (points.length < 2) return points;
  const horizontal = (a: Anchor): boolean => a === 'left' || a === 'right';
  const out: Pt[] = [points[0]!];

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) {
      out.push(b);
      continue;
    }
    const isFirst = i === 0;
    const isLast = i === points.length - 2;
    const hFirst = isFirst ? horizontal(sourceAnchor) : isLast ? !horizontal(targetAnchor) : true;
    let corner: Pt;
    if (isFirst) {
      corner = hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    } else if (isLast && !hFirst) {
      corner = { x: b.x, y: a.y };
    } else {
      // 共用中点，避免出现"一步三折"
      corner = hFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
    }
    out.push(corner, b);
  }
  return out;
}

/** Catmull-Rom → 三次贝塞尔：曲线穿过每个折点（不是被折点"拉偏"） */
function catmullRomPath(points: Pt[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`;
  if (points.length === 2) {
    const [a, b] = points as [Pt, Pt];
    return `M ${round1(a.x)} ${round1(a.y)} L ${round1(b.x)} ${round1(b.y)}`;
  }
  let d = `M ${round1(points[0]!.x)} ${round1(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${round1(c1.x)} ${round1(c1.y)} ${round1(c2.x)} ${round1(c2.y)} ${round1(p2.x)} ${round1(p2.y)}`;
  }
  return d;
}

/** 折线（含正交展开后的点）上按长度取任意比例的位置 */
function polylinePointAt(points: Pt[], ratio: number): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push(len);
    total += len;
  }
  if (total < 0.001) return points[0]!;
  let remain = total * ratio;
  for (let i = 0; i < segs.length; i += 1) {
    const len = segs[i]!;
    if (remain <= len) {
      const t = len < 0.001 ? 0 : remain / len;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remain -= len;
  }
  return points[points.length - 1]!;
}

/** 折线中点：标注就钉在这里 */
function polylineMidpoint(points: Pt[]): Pt {
  return polylinePointAt(points, 0.5);
}

/** 贝塞尔曲线上的采样点（每段 40 个），用来按长度求中点/任意比例 */
function bezierSamples(points: Pt[], steps = 40): Pt[] {
  const samples: Pt[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const idx = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    const local = t * (points.length - 1) - idx;
    const p0 = points[idx - 1] ?? points[idx]!;
    const p1 = points[idx]!;
    const p2 = points[idx + 1]!;
    const p3 = points[idx + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    const mt = 1 - local;
    samples.push({
      x: mt ** 3 * p1.x + 3 * mt ** 2 * local * c1.x + 3 * mt * local ** 2 * c2.x + local ** 3 * p2.x,
      y: mt ** 3 * p1.y + 3 * mt ** 2 * local * c1.y + 3 * mt * local ** 2 * c2.y + local ** 3 * p2.y,
    });
  }
  return samples;
}

/** 贝塞尔中点：沿曲线采样找长度一半的位置 */
function bezierMidpoint(points: Pt[]): Pt {
  if (points.length < 3) return polylineMidpoint(points);
  return polylineMidpoint(bezierSamples(points));
}

/**
 * 线上任意比例处的点（`ratio` = 0..1，按长度算）。
 * 用来放"加折点"的小＋：线有标注时放在 1/4 处，免得盖住文字。
 */
export function pointAt(kind: EdgeKind, points: Pt[], ratio: number): Pt {
  if (kind === 'bezier' && points.length >= 3) return polylinePointAt(bezierSamples(points), ratio);
  return polylinePointAt(points, ratio);
}

export interface EdgeGeometryResult {
  d: string;
  /** 标注点（线的中点，按长度算） */
  labelPoint: Pt;
  /** 实际用于绘制的点序列（含端点与正交展开的拐点），画手柄/调试都用它 */
  points: Pt[];
}

/**
 * 生成带折点的路径。
 *
 * `points` 必须已经包含两端锚点（起点、终点），折点在中间。
 * 只有两个点时不走"折点逻辑"，让调用方退回 React Flow 的官方生成器
 * （保证无折点的线和以前逐像素一致）。
 */
export function buildPath(kind: EdgeKind, points: Pt[], sourceAnchor: Anchor, targetAnchor: Anchor): EdgeGeometryResult {
  if (kind === 'bezier') {
    return { d: catmullRomPath(points), labelPoint: bezierMidpoint(points), points };
  }
  if (kind === 'straight') {
    return { d: polylinePath(points, 5), labelPoint: polylineMidpoint(points), points };
  }
  const expanded = orthoPoints(points, sourceAnchor, targetAnchor);
  return { d: polylinePath(expanded, 5), labelPoint: polylineMidpoint(expanded), points: expanded };
}
/**
 * "从线上某个位置加折点"应该插在 waypoints 的第几位。
 * `points` = [起点, ...折点, 终点]，找出该位置落在哪一段，插入点就是那一段之后。
 */
export function midpointInsertIndex(points: Pt[], ratio = 0.5): number {
  if (points.length < 2) return 0;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segs.push(len);
    total += len;
  }
  if (total < 0.001) return Math.max(0, points.length - 2);
  let remain = total * ratio;
  for (let i = 0; i < segs.length; i += 1) {
    if (remain <= segs[i]!) return i;
    remain -= segs[i]!;
  }
  return Math.max(0, points.length - 2);
}