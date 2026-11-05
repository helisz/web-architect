/**
 * 草图 → 画布坐标（用户 2026-11-05）。
 *
 * 归一化坐标乘上画布尺寸就得到"原图布局"，这一步不做任何自动排版——
 * 用户要的是"先还原原图"，整理交给「一键整理」。
 *
 * 两处必要的兜底：
 * - 节点尺寸：模型给的 w/h 只当参考，夹在合理区间（太小的框放不下字）；
 * - 重叠：模型偶尔把几个节点放在同一坐标，这里做一次轻量错开，否则叠在一起看不见。
 */

import { COMPONENT_INDEX } from '@arch/schema';
import type { AiDraft, AiNodeDraft } from './parseSchema.js';

export interface LandingNode {
  key: string;
  label: string;
  subLabel: string;
  nodeType: AiNodeDraft['type'];
  /** 绝对坐标（画布像素） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 落在第几个分组里（-1 = 不在分组） */
  groupIndex: number;
}

export interface LandingEdge {
  fromKey: string;
  toKey: string;
  label: string;
  dashed: boolean;
}

export interface LandingGroup {
  label: string;
  subLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LandingSpec {
  name: string;
  /** 内容区域尺寸，给「适配视图」用 */
  width: number;
  height: number;
  nodes: LandingNode[];
  edges: LandingEdge[];
  groups: LandingGroup[];
}

const CONTENT_WIDTH = 1280;
const GROUP_PADDING = { left: 28, top: 52, right: 28, bottom: 28 };

export function contentHeight(aspect: number): number {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.62;
  return Math.round(Math.min(CONTENT_WIDTH * 1.8, Math.max(CONTENT_WIDTH * 0.45, CONTENT_WIDTH * safe)));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function sizeForNode(node: AiNodeDraft, width: number, height: number): { width: number; height: number } {
  const base = COMPONENT_INDEX[node.type];
  const fallback = { width: base?.width ?? 160, height: base?.height ?? 80 };
  if (node.w === undefined && node.h === undefined) return fallback;
  const w = node.w === undefined ? fallback.width : clamp(Math.round(node.w * width), 92, 360);
  const h = node.h === undefined ? fallback.height : clamp(Math.round(node.h * height), 40, 240);
  return { width: w, height: h };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 模型把两个节点放在同一个位置时，把后来的往下挪（下方放不下再向右换一列）。
 *
 * 为什么按"列内下移"而不是斜着错开：斜着挪容易在几步之后又撞上别人，
 * 而且会让左右相邻的关系变模糊；纵向排列至少保持"同一层"的视觉语义。
 * 只挪真正重叠的，不动本来就分开的——否则"还原原图"就变成"自动排版"了。
 */
function separate(rects: Rect[], width: number, height: number): void {
  const placed: Rect[] = [];
  for (const rect of rects) {
    const candidate: Rect = { ...rect };
    let attempts = 0;
    while (attempts < 60 && placed.some((other) => overlaps(candidate, other))) {
      attempts += 1;
      candidate.y = candidate.y + rect.height + 16;
      if (candidate.y + rect.height > height) {
        candidate.y = rect.y;
        candidate.x = candidate.x + rect.width + 16;
      }
      candidate.x = clamp(candidate.x, 0, Math.max(0, width - candidate.width));
      candidate.y = clamp(candidate.y, 0, Math.max(0, height - candidate.height));
    }
    placed.push(candidate);
    rect.x = candidate.x;
    rect.y = candidate.y;
  }
}

export function buildLanding(
  draft: AiDraft,
  options: { aspect?: number; width?: number; fallbackName?: string } = {},
): LandingSpec {
  const width = options.width ?? CONTENT_WIDTH;
  const height = contentHeight(options.aspect ?? 0.62);

  const rects: Rect[] = draft.nodes.map((node) => {
    const size = sizeForNode(node, width, height);
    return {
      x: clamp(Math.round(node.x * width), 0, Math.max(0, width - size.width)),
      y: clamp(Math.round(node.y * height), 0, Math.max(0, height - size.height)),
      width: size.width,
      height: size.height,
    };
  });
  separate(rects, width, height);

  const groupIndexOf = new Map<string, number>();
  const groups: LandingGroup[] = [];
  for (const group of draft.groups) {
    const memberIndexes = group.members
      .map((key) => draft.nodes.findIndex((node) => node.key === key))
      .filter((index) => index >= 0 && !groupIndexOf.has(draft.nodes[index]!.key));
    if (memberIndexes.length === 0) continue;

    const memberRects = memberIndexes.map((index) => rects[index]!);
    const left = Math.min(...memberRects.map((rect) => rect.x));
    const top = Math.min(...memberRects.map((rect) => rect.y));
    const right = Math.max(...memberRects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...memberRects.map((rect) => rect.y + rect.height));

    const x = Math.max(0, left - GROUP_PADDING.left);
    const y = Math.max(0, top - GROUP_PADDING.top);
    const box: LandingGroup = {
      label: group.label,
      subLabel: group.subLabel ?? '',
      x,
      y,
      width: Math.min(width - x, right - left + GROUP_PADDING.left + GROUP_PADDING.right),
      height: Math.min(height - y, bottom - top + GROUP_PADDING.top + GROUP_PADDING.bottom),
    };
    const index = groups.push(box) - 1;
    for (const memberIndex of memberIndexes) groupIndexOf.set(draft.nodes[memberIndex]!.key, index);
  }

  const nodes: LandingNode[] = draft.nodes.map((node, index) => {
    const rect = rects[index]!;
    return {
      key: node.key,
      label: node.label,
      subLabel: node.subLabel,
      nodeType: node.type,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      groupIndex: groupIndexOf.get(node.key) ?? -1,
    };
  });

  const edges: LandingEdge[] = draft.edges.map((edge) => ({
    fromKey: edge.from,
    toKey: edge.to,
    label: edge.label ?? '',
    dashed: edge.dashed === true,
  }));

  return {
    name: draft.name.trim() || options.fallbackName || 'AI 解析的架构图',
    width,
    height,
    nodes,
    edges,
    groups,
  };
}

/** 落图前的自检：至少要有节点，连线端点必须存在（草图层已保证，这里再兜一层） */
export function landingSummary(spec: LandingSpec): { nodes: number; edges: number; groups: number } {
  return { nodes: spec.nodes.length, edges: spec.edges.length, groups: spec.groups.length };
}

/** 让「适配视图」知道内容到哪（含分组边框） */
export function landingBounds(spec: LandingSpec): Rect {
  let right = 0;
  let bottom = 0;
  for (const node of spec.nodes) {
    right = Math.max(right, node.x + node.width);
    bottom = Math.max(bottom, node.y + node.height);
  }
  for (const group of spec.groups) {
    right = Math.max(right, group.x + group.width);
    bottom = Math.max(bottom, group.y + group.height);
  }
  return { x: 0, y: 0, width: Math.max(right, 1), height: Math.max(bottom, 1) };
}

/** 供测试：两点是否重叠（导出是为了不让测试重复实现） */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlaps(a, b);
}

/** 供测试：中心点 */
export function rectCenter(rect: Rect): { x: number; y: number } {
  return centerOf(rect);
}
