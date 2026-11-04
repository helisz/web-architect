import type { Anchor, NodeType } from './types.js';

/* ------------------------------------------------------------------ */
/* 规模与字段约束（规格 §6.3 / §6.4）                                   */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  maxNodes: 2000,
  maxEdges: 5000,
  maxGroups: 200,
  maxGroupDepth: 3,
  labelMax: 255,
  subLabelMax: 500,
  diagramNameMax: 120,
  zoomMin: 0.1,
  zoomMax: 4,
  /** 坐标绝对值上限：防住 1e9 这类值把 SVG 撑爆（V6 只要求有限数，这里是工程护栏） */
  coordLimit: 100000,
  nodeMinWidth: 64,
  nodeMinHeight: 40,
  groupMinWidth: 120,
  groupMinHeight: 80,
  strokeWidthMin: 0.5,
  strokeWidthMax: 6,
} as const;

/* ------------------------------------------------------------------ */
/* 视觉 Token（规格 §3.4）                                             */
/* ------------------------------------------------------------------ */

export const TOKENS = {
  canvasBg: '#FAFAFA',
  gridLine: '#E8EAED',
  gridSize: 20,
  panelBg: '#FFFFFF',
  panelBorder: '#E5E7EB',
  primary: '#2563EB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  nodeBg: '#FFFFFF',
  nodeBorder: '#D1D5DB',
  radiusNode: 8,
  fontUi: 'Inter, system-ui, sans-serif',
  fontMono: 'JetBrains Mono, ui-monospace, monospace',
} as const;

/* ------------------------------------------------------------------ */
/* 语义色（规格 §3.5）                                                 */
/* ------------------------------------------------------------------ */

export type SemanticEdgeKind = 'external' | 'internal' | 'cluster' | 'management';

export interface SemanticEdgeStyle {
  kind: SemanticEdgeKind;
  label: string;
  strokeColor: string;
  strokeWidth: number;
  strokeDasharray: string | null;
}

export const SEMANTIC_EDGES: Record<SemanticEdgeKind, SemanticEdgeStyle> = {
  external: {
    kind: 'external',
    label: '外网 / 互联网流量',
    strokeColor: '#F59E0B',
    strokeWidth: 2,
    strokeDasharray: null,
  },
  internal: {
    kind: 'internal',
    label: '内部服务调用',
    strokeColor: '#8B5CF6',
    strokeWidth: 1.5,
    strokeDasharray: null,
  },
  cluster: {
    kind: 'cluster',
    label: '集群内部流量',
    strokeColor: '#10B981',
    strokeWidth: 1.5,
    strokeDasharray: null,
  },
  management: {
    kind: 'management',
    label: '管理 / 运维通道',
    strokeColor: '#64748B',
    strokeWidth: 1,
    strokeDasharray: '4,4',
  },
};

export interface ZonePalette {
  /** 'DMZ' | 'INTRANET' | 'EXTERNAL' 等语义别名 */
  key: string;
  label: string;
  bgColor: string;
  borderColor: string;
  titleColor: string;
}

export const ZONE_PALETTES: ZonePalette[] = [
  { key: 'dmz', label: 'DMZ ZONE', bgColor: '#F1F3F5', borderColor: '#D6D9DD', titleColor: '#374151' },
  { key: 'intranet', label: 'INTRANET', bgColor: '#EFF6FF', borderColor: '#BFDBFE', titleColor: '#1E3A8A' },
  { key: 'external', label: 'EXTERNAL', bgColor: '#FFF7ED', borderColor: '#FED7AA', titleColor: '#9A3412' },
];

/** 新建连线 / 新建分组的默认样式 */
export const EDGE_DEFAULTS = {
  edgeType: 'ortho' as const,
  /** 默认灰色：中性、不抢节点的视线；需要语义色时在面板里单独改 */
  strokeColor: '#6B7280',
  strokeWidth: 2,
  strokeDasharray: null,
  /** 新线默认单向箭头（指向目标端） */
  arrow: 'forward' as const,
};

export const GROUP_DEFAULTS = {
  bgColor: ZONE_PALETTES[0]!.bgColor,
  borderColor: ZONE_PALETTES[0]!.borderColor,
  titleColor: ZONE_PALETTES[0]!.titleColor,
  width: 420,
  height: 300,
  collapsedHeight: 40,
};

export const NODE_DEFAULTS = {
  bgColor: TOKENS.nodeBg,
  borderColor: TOKENS.nodeBorder,
  textColor: TOKENS.textPrimary,
  width: 160,
  height: 80,
};

/* ------------------------------------------------------------------ */
/* 左侧组件分类树（规格 §3.3）+ 默认尺寸（附录 B）                       */
/* ------------------------------------------------------------------ */

export interface ComponentSpec {
  nodeType: NodeType;
  label: string;
  width: number;
  height: number;
  defaultSubLabel: string;
}

export interface ComponentCategory {
  key: string;
  label: string;
  items: ComponentSpec[];
}

const spec = (
  nodeType: NodeType,
  label: string,
  width: number,
  height: number,
  defaultSubLabel = '',
): ComponentSpec => ({ nodeType, label, width, height, defaultSubLabel });

export const COMPONENT_CATEGORIES: ComponentCategory[] = [
  {
    key: 'security',
    label: '网络安全',
    items: [
      spec('firewall', '防火墙', 160, 80),
      spec('waf', 'WAF', 160, 80, '443/TLS'),
      spec('vip', 'VIP', 140, 70, 'VIP: x.x.x.x'),
      spec('lb', '负载均衡', 160, 80, ':80/:443'),
      spec('vpn', 'VPN 网关', 160, 80),
      spec('ids', 'IDS/IPS', 160, 80),
    ],
  },
  {
    key: 'compute',
    label: '计算',
    items: [
      spec('server', '物理服务器', 160, 80),
      spec('vm', '虚拟机', 160, 80),
      spec('container', '容器', 140, 70),
      spec('nginx', 'Nginx', 160, 90, ':8080'),
      spec('proxy', '反向代理', 160, 90, ':8080'),
    ],
  },
  {
    key: 'orchestration',
    label: '容器编排',
    items: [
      spec('k8s-cluster', 'K8s Cluster', 200, 100, 'v1.28'),
      spec('namespace', 'Namespace', 320, 200),
      spec('deployment', 'Deployment', 160, 80),
      spec('service', 'Service', 160, 80),
      spec('pod', 'Pod', 140, 70, 'replicas: 3'),
      spec('ingress', 'Ingress', 160, 80),
    ],
  },
  {
    key: 'storage',
    label: '存储 / 数据',
    items: [
      spec('db', '数据库', 160, 90, ':3306'),
    ],
  },
  {
    key: 'middleware',
    label: '中间件 / 网关',
    items: [spec('gateway', 'API 网关', 160, 80)],
  },
  {
    key: 'external',
    label: '外部服务',
    items: [
      spec('external', '互联网 / 外部服务', 160, 80),
      spec('link', '专线', 140, 60),
    ],
  },
  {
    key: 'network',
    label: '网络设备',
    items: [
      spec('switch', '交换机', 120, 60),
      spec('router', '路由器', 120, 60),
      spec('subnet', '子网', 360, 220, '10.0.0.0/16'),
    ],
  },
  {
    key: 'structure',
    label: '结构件',
    items: [
      spec('group', '分组泳道', 420, 300),
      spec('zone', '区域框', 420, 300),
      spec('text', '注释文本', 200, 60),
      spec('legend', '图例', 220, 160),
    ],
  },
  {
    key: 'custom',
    label: '自定义',
    items: [spec('custom', '自定义卡片', 160, 80)],
  },
];

/** nodeType → 默认尺寸 / 默认副文本，供拖入创建时使用 */
export const COMPONENT_INDEX: Record<NodeType, ComponentSpec> = Object.fromEntries(
  COMPONENT_CATEGORIES.flatMap((c) => c.items).map((i) => [i.nodeType, i]),
) as Record<NodeType, ComponentSpec>;

/* ------------------------------------------------------------------ */
/* 交互常量                                                            */
/* ------------------------------------------------------------------ */

export const INTERACTION = {
  /** 建线时端点外扩距离（spec §11.3 step 2） */
  anchorGap: 8,
  /** 折线拐点圆角 */
  cornerRadius: 4,
  /** 拖到节点 12px 内自动吸附到最近 Handle */
  snapDistance: 12,
  /** 网格吸附阈值 */
  gridSnapThreshold: 8,
  /** 属性面板输入 → 落库防抖 */
  saveDebounceMs: 800,
  /** 命令栈深度 */
  historyLimit: 50,
  /** 分组内边距 */
  groupPadding: 24,
  /** 分组标题栏高度 */
  groupHeaderHeight: 44,
} as const;

/** 所有锚点的固定顺序，用于建线吸附时遍历 */
export const ANCHOR_ORDER: Anchor[] = ['top', 'right', 'bottom', 'left'];

/* ------------------------------------------------------------------ */
/* 数据库表名                                                          */
/* ------------------------------------------------------------------ */

/**
 * 物理表名。本项目与 toolbox 共用同一个 Supabase 项目（public schema），
 * 所有对象统一 `arch_` 前缀，避免命名冲突（ADR-0003）。
 * 前端仓储层与 supabase/schema.sql 都以此为准，禁止手写表名字符串。
 *
 * 规格 §7.3 原名 → 本库表名：
 *   architecture_diagram → arch_diagram
 *   diagram_group        → arch_group
 *   diagram_node         → arch_node
 *   diagram_edge         → arch_edge
 *   diagram_snapshot     → arch_snapshot
 */
export const TABLES = {
  diagram: 'arch_diagram',
  group: 'arch_group',
  node: 'arch_node',
  edge: 'arch_edge',
  snapshot: 'arch_snapshot',
} as const;


