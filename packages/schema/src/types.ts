/**
 * 统一数据模型 —— 前端 / API / DB 共用同一套结构（规格 §6.2）。
 *
 * 铁律：任何环节不得做字段改名或结构嵌套转换。
 * 唯一允许的转换是 DB 列的 snake_case ⇄ 对象字段的 camelCase 一一对应（见 convert.ts）。
 */

/** 顶层：一张完整架构图 */
export interface ArchitectureDiagram {
  diagramId: string; // UUID v4
  schemaVersion: string; // "1.0"，用于兼容处理
  name: string; // 图名，≤120 字
  description: string; // 说明，可空串
  projectId?: string; // 归属项目/业务线
  tags?: string[]; // 检索标签
  version: number; // 版本号，从 1 起，每次成功保存 +1
  creatorId: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  viewport: Viewport;
  groups: DiagramGroup[];
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface Viewport {
  x: number; // 画布平移偏移
  y: number;
  zoom: number; // 0.1 ~ 4
}

/** 分组 / 泳道 */
export interface DiagramGroup {
  groupId: string; // UUID v4
  diagramId: string;
  parentGroupId?: string | null; // 嵌套父组，顶级为 null
  label: string; // "DMZ ZONE"
  /** 相对画布（顶级）或相对父组（嵌套）的局部坐标 */
  x: number;
  y: number;
  width: number;
  height: number;
  bgColor: string; // #RRGGBB 或 #RRGGBBAA
  borderColor: string;
  titleColor: string;
  collapsed: boolean;
  sort: number; // 层级，越大越靠上
  extJson?: Record<string, unknown>;
  isDeleted: boolean; // 软删标记（API 输出恒为 false）
}

/** 节点 */
export interface DiagramNode {
  nodeId: string; // UUID v4
  diagramId: string;
  groupId?: string | null; // 归属分组
  label: string; // 主标题
  subLabel: string; // 副文本，用 \n 分行
  nodeType: NodeType;
  /** 属于分组时为相对父组的局部坐标（对应 ReactFlow parentId 语义） */
  x: number;
  y: number;
  width: number;
  height: number;
  bgColor: string;
  borderColor: string;
  textColor: string;
  locked: boolean;
  visible: boolean;
  sort: number;
  extJson?: Record<string, unknown>; // 常用键：iconKey, ip, port, env, owner, spec, replicas
  isDeleted: boolean;
}

export const NODE_TYPES = [
  'firewall',
  'waf',
  'vip',
  'lb',
  'vpn',
  'ids',
  'server',
  'vm',
  'container',
  'nginx',
  'proxy',
  'k8s-cluster',
  'namespace',
  'deployment',
  'service',
  'pod',
  'ingress',
  'db',
  'gateway',
  'external',
  'switch',
  'router',
  'link',
  'subnet',
  'group',
  'zone',
  'text',
  'legend',
  'custom',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_TYPES = ['ortho', 'bezier', 'straight'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const ANCHORS = ['top', 'bottom', 'left', 'right'] as const;
export type Anchor = (typeof ANCHORS)[number];

export const ARROW_TYPES = ['none', 'forward', 'backward', 'both'] as const;
export type ArrowType = (typeof ARROW_TYPES)[number];

/** 连线 */
export interface DiagramEdge {
  edgeId: string; // UUID v4
  diagramId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string; // 线上标注，如 "443/TLS"
  strokeColor: string;
  strokeWidth: number; // 1 / 1.5 / 2 / 3
  strokeDasharray?: string | null; // null=实线；"4,4" 虚线
  edgeType: EdgeType;
  sourceAnchor?: Anchor | null;
  targetAnchor?: Anchor | null;
  arrow: ArrowType;
  sort: number;
  extJson?: Record<string, unknown>;
  isDeleted: boolean;
}

/* ------------------------------------------------------------------ */
/* 校验结果类型                                                        */
/* ------------------------------------------------------------------ */

export interface ValidationIssue {
  /** 字段路径，如 edges[3].targetNodeId */
  path: string;
  /** 机器可读错误码，如 REF_NOT_FOUND */
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** repair 模式下的修复后结果；非 repair 模式下与输入等价 */
  diagram?: ArchitectureDiagram;
}

/** 矩形，供正交路由与命中判定使用 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}


