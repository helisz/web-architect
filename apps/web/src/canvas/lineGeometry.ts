/**
 * 自由线条（`nodeType: 'line'`）的几何计算（用户 2026-11-05）。
 *
 * 设计取舍：线条**不是**连线（edge 必须有两个节点），而是一种「外壳是节点」的装饰元素，
 * 所以两个端点存在 `extJson.line.a / b`（相对节点左上角），节点自己的 x/y/width/height
 * 永远等于「两端点包围盒再夹到 schema 最小尺寸」的结果。
 *
 * 这样做的好处：拖动线条、拖进分组、复制、撤销都不用额外处理 —— 端点跟着盒子走。
 * 只有拖端点时才需要整体重算盒子，见 `lineGeometry()`。
 */

import { EDGE_DASH_PRESETS } from '@arch/schema';

export interface Pt {
  x: number;
  y: number;
}

export interface LineData {
  a: Pt;
  b: Pt;
  /** 线宽（px） */
  width: number;
  /** 虚线样式：null = 实线；其余为 SVG strokeDasharray */
  dash: string | null;
}

/**
 * 虚线三档：直接复用连线的预设（实线 / 短虚线 / 长虚线），
 * 同一张图里线条和连线的虚线节奏才不会各说各话。
 */
export const LINE_DASH_PRESETS = EDGE_DASH_PRESETS;

export const LINE_DEFAULT_WIDTH = 2;
export const LINE_MIN_WIDTH = 0.5;
export const LINE_MAX_WIDTH = 6;

/** 属性面板里的常用粗细（用户 2026-11-05）：手填之外再给四个一键档位 */
export const LINE_WIDTH_PRESETS = [0.5, 1, 1.5, 2] as const;

/** 吸附步长：0 / 45 / 90 / 135 / 180… 用户要求「水平、垂直、45 度自动对齐」 */
export const SNAP_STEP_DEG = 45;
/** 自动吸附的角度容差；超过就保持自由角度 */
export const SNAP_TOLERANCE_DEG = 8;

export function clampLineWidth(value: number): number {
  if (!Number.isFinite(value)) return LINE_DEFAULT_WIDTH;
  return Math.min(LINE_MAX_WIDTH, Math.max(LINE_MIN_WIDTH, value));
}

/** 从节点的 extJson 里读出线条数据；坏数据一律退回默认值，不抛错 */
export function readLineData(extJson: Record<string, unknown> | undefined, width: number, height: number): LineData {
  const raw = extJson?.line as Partial<LineData> | undefined;
  const fallback: LineData = {
    a: { x: 2, y: Math.round(height / 2) },
    b: { x: Math.max(2, Math.round(width) - 2), y: Math.round(height / 2) },
    width: LINE_DEFAULT_WIDTH,
    dash: null,
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const point = (value: unknown, fallbackPoint: Pt): Pt => {
    const p = value as { x?: unknown; y?: unknown } | undefined;
    return typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)
      ? { x: p.x, y: p.y }
      : fallbackPoint;
  };
  const dash = raw.dash === undefined || raw.dash === null ? null : String(raw.dash);
  return {
    a: point(raw.a, fallback.a),
    b: point(raw.b, fallback.b),
    width: typeof raw.width === 'number' ? clampLineWidth(raw.width) : fallback.width,
    dash,
  };
}

export interface LineGeometry {
  /** 节点左上角（流程坐标） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 端点（相对节点左上角） */
  a: Pt;
  b: Pt;
}

/**
 * 由两个**流程坐标**端点算出节点盒子 + 相对端点。
 *
 * 盒子 = 端点包围盒，再夹到 schema 的最小尺寸（`LIMITS.nodeMinWidth/Height`，默认 64×40）；
 * 夹大之后把线居中放进去，免得贴着边导致手柄被裁。
 */
export function lineGeometry(a: Pt, b: Pt, minWidth = 64, minHeight = 40): LineGeometry {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const rawWidth = Math.abs(b.x - a.x);
  const rawHeight = Math.abs(b.y - a.y);
  const width = Math.max(minWidth, rawWidth);
  const height = Math.max(minHeight, rawHeight);
  // 线在夹大后的盒子里居中：多出来的空白平分到两侧
  const offsetX = (width - rawWidth) / 2;
  const offsetY = (height - rawHeight) / 2;
  return {
    x: left - offsetX,
    y: top - offsetY,
    width,
    height,
    a: { x: a.x - left + offsetX, y: a.y - top + offsetY },
    b: { x: b.x - left + offsetX, y: b.y - top + offsetY },
  };
}

/** 端点相对坐标 → 流程坐标 */
export function absoluteEndpoints(node: { x: number; y: number }, line: LineData): { a: Pt; b: Pt } {
  return {
    a: { x: node.x + line.a.x, y: node.y + line.a.y },
    b: { x: node.x + line.b.x, y: node.y + line.b.y },
  };
}

/** 线条长度与角度（角度以「向右为 0°，顺时针为正」计，范围 -180..180） */
export function lineInfo(a: Pt, b: Pt): { length: number; angle: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { length: Math.hypot(dx, dy), angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/**
 * 端点吸附：把拖到的地方按 45° 步长对齐。
 *
 * - `force`（按住 Shift）= 永远吸附到最近的 45° 倍数，偏多少都拉回去；
 * - 否则只在偏离 8° 以内才吸附，超过就保持自由角度（画斜线不别扭）。
 *
 * 吸附时保持长度不变，只改角度 —— 拖到哪里，线就多长。
 */
export function snapEndpoint(
  anchor: Pt,
  pointer: Pt,
  options: { force?: boolean; stepDeg?: number; toleranceDeg?: number } = {},
): Pt {
  const step = options.stepDeg ?? SNAP_STEP_DEG;
  const tolerance = options.toleranceDeg ?? SNAP_TOLERANCE_DEG;
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: anchor.x, y: anchor.y };

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const nearest = Math.round(angle / step) * step;
  const diff = Math.abs(angle - nearest);
  if (!options.force && diff > tolerance) return pointer;

  const rad = (nearest * Math.PI) / 180;
  // 四舍五入到 0.5px，避免拖出 12.0000000001 这种脏坐标
  const round = (value: number): number => Math.round(value * 2) / 2;
  return { x: round(anchor.x + Math.cos(rad) * length), y: round(anchor.y + Math.sin(rad) * length) };
}

/** 面板上显示的角度文案：吸附状态下给出「水平 / 垂直 / 45°」这类可读说法 */
export function describeAngle(angle: number): string {
  const normalized = ((angle % 360) + 360) % 360;
  const rounded = Math.round(normalized * 10) / 10;
  if (Math.abs(normalized) < 0.05 || Math.abs(normalized - 360) < 0.05) return '水平 0°';
  if (Math.abs(normalized - 90) < 0.05) return '垂直 90°';
  if (Math.abs(normalized - 180) < 0.05) return '水平 180°';
  if (Math.abs(normalized - 270) < 0.05) return '垂直 270°';
  return `${rounded}°`;
}
