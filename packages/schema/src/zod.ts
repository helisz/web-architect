import { z } from 'zod';
import { LIMITS } from './constants.js';
import { ANCHORS, ARROW_TYPES, EDGE_TYPES, NODE_TYPES } from './types.js';
import type { Anchor, ArrowType, EdgeType, NodeType, ValidationIssue } from './types.js';

/* ------------------------------------------------------------------ */
/* 基础校验器：刻意不用 zod 的 format 校验，避免版本差异带来的行为漂移     */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** 规格 §6.4 V5：6 位或 8 位十六进制 */
export const COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const uuidSchema = z.string().regex(UUID_RE, '必须是 UUID（8-4-4-4-12 十六进制）');
export const colorSchema = z.string().regex(COLOR_RE, '必须是 #RRGGBB 或 #RRGGBBAA');

/** 规格 §6.4 V6：拒绝 NaN / Infinity / 字符串 */
const finiteNumber = (min?: number, max?: number) => {
  let s = z.number().refine(Number.isFinite, '必须是有限数');
  if (min !== undefined) s = s.refine((v) => v >= min, `不得小于 ${min}`);
  if (max !== undefined) s = s.refine((v) => v <= max, `不得大于 ${max}`);
  return s;
};

const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), '必须是 ISO 8601 时间字符串');

const extJsonSchema = z.record(z.string(), z.unknown());

/** 坐标：有限数 + 工程量级护栏（±100000） */
const coordNumber = () => finiteNumber(-LIMITS.coordLimit, LIMITS.coordLimit);

const nodeTypeValues = NODE_TYPES as unknown as [NodeType, ...NodeType[]];
const edgeTypeValues = EDGE_TYPES as unknown as [EdgeType, ...EdgeType[]];
const anchorValues = ANCHORS as unknown as [Anchor, ...Anchor[]];
const arrowValues = ARROW_TYPES as unknown as [ArrowType, ...ArrowType[]];

/* ------------------------------------------------------------------ */
/* 实体                                                                */
/* ------------------------------------------------------------------ */

export const viewportSchema = z.object({
  x: finiteNumber(),
  y: finiteNumber(),
  zoom: finiteNumber(LIMITS.zoomMin, LIMITS.zoomMax),
});

export const groupSchema = z.object({
  groupId: uuidSchema,
  diagramId: uuidSchema,
  parentGroupId: uuidSchema.nullable().optional(),
  label: z.string().max(LIMITS.labelMax),
  x: coordNumber(),
  y: coordNumber(),
  width: finiteNumber(LIMITS.groupMinWidth),
  height: finiteNumber(LIMITS.groupMinHeight),
  bgColor: colorSchema,
  borderColor: colorSchema,
  titleColor: colorSchema,
  collapsed: z.boolean(),
  sort: z.number().int().refine(Number.isFinite, '必须是有限数'),
  extJson: extJsonSchema.optional(),
  isDeleted: z.boolean(),
});

export const nodeSchema = z.object({
  nodeId: uuidSchema,
  diagramId: uuidSchema,
  groupId: uuidSchema.nullable().optional(),
  label: z.string().max(LIMITS.labelMax),
  subLabel: z.string().max(LIMITS.subLabelMax),
  nodeType: z.enum(nodeTypeValues),
  x: coordNumber(),
  y: coordNumber(),
  width: finiteNumber(LIMITS.nodeMinWidth),
  height: finiteNumber(LIMITS.nodeMinHeight),
  bgColor: colorSchema,
  borderColor: colorSchema,
  textColor: colorSchema,
  locked: z.boolean(),
  visible: z.boolean(),
  sort: z.number().int().refine(Number.isFinite, '必须是有限数'),
  extJson: extJsonSchema.optional(),
  isDeleted: z.boolean(),
});

export const edgeSchema = z.object({
  edgeId: uuidSchema,
  diagramId: uuidSchema,
  sourceNodeId: uuidSchema,
  targetNodeId: uuidSchema,
  label: z.string().max(LIMITS.labelMax).optional(),
  strokeColor: colorSchema,
  strokeWidth: finiteNumber(LIMITS.strokeWidthMin, LIMITS.strokeWidthMax),
  strokeDasharray: z.string().max(32).nullable().optional(),
  edgeType: z.enum(edgeTypeValues),
  sourceAnchor: z.enum(anchorValues).nullable().optional(),
  targetAnchor: z.enum(anchorValues).nullable().optional(),
  arrow: z.enum(arrowValues),
  sort: z.number().int().refine(Number.isFinite, '必须是有限数'),
  extJson: extJsonSchema.optional(),
  isDeleted: z.boolean(),
});

export const diagramSchema = z.object({
  diagramId: uuidSchema,
  schemaVersion: z.string().regex(/^\d+\.\d+$/, '必须是 "主版本.次版本" 形式'),
  name: z.string().min(1, '图名不能为空').max(LIMITS.diagramNameMax),
  description: z.string(),
  projectId: z.string().max(64).optional(),
  tags: z.array(z.string()).optional(),
  version: z.number().int().refine((v) => v >= 1, 'version 从 1 起'),
  creatorId: z.string().min(1),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  viewport: viewportSchema,
  groups: z.array(groupSchema),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

/** 请求体：PUT 全量保存 */
export const saveDiagramRequestSchema = z.object({
  baseVersion: z.number().int().optional(),
  diagram: diagramSchema,
});

export const PATCH_BODY_KEYS = [
  'groupsUpsert',
  'groupsDeleteIds',
  'nodesUpsert',
  'nodesDeleteIds',
  'edgesUpsert',
  'edgesDeleteIds',
] as const;

export const patchSchema = z.object({
  requestId: uuidSchema,
  baseVersion: z.number().int(),
  viewport: viewportSchema.optional(),
  groupsUpsert: z.array(groupSchema).optional(),
  groupsDeleteIds: z.array(uuidSchema).optional(),
  nodesUpsert: z.array(nodeSchema).optional(),
  nodesDeleteIds: z.array(uuidSchema).optional(),
  edgesUpsert: z.array(edgeSchema).optional(),
  edgesDeleteIds: z.array(uuidSchema).optional(),
});

/* ------------------------------------------------------------------ */
/* 路径格式化 + 解析入口                                                */
/* ------------------------------------------------------------------ */

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`;
    else if (out === '') out = String(seg);
    else out += `.${String(seg)}`;
  }
  return out || '$';
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  errors: ValidationIssue[];
}

/** 结构校验（第一道闸）。语义 / 引用校验见 validate.ts */
export function parseDiagram(input: unknown): ParseResult<unknown> {
  const r = diagramSchema.safeParse(input);
  if (r.success) return { success: true, data: r.data, errors: [] };
  return {
    success: false,
    errors: r.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      code: 'SCHEMA_INVALID',
      message: issue.message,
    })),
  };
}
