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
  nodeBorder: '#D6D5CF',
  radiusNode: 4,
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
    strokeColor: '#C97A12',
    strokeWidth: 2,
    strokeDasharray: null,
  },
  internal: {
    kind: 'internal',
    label: '内部服务调用',
    strokeColor: '#8F4FBF',
    strokeWidth: 1.5,
    strokeDasharray: null,
  },
  cluster: {
    kind: 'cluster',
    label: '集群内部流量',
    strokeColor: '#4F9A46',
    strokeWidth: 1.5,
    strokeDasharray: null,
  },
  management: {
    kind: 'management',
    label: '管理 / 运维通道',
    strokeColor: '#6E6A62',
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
  { key: 'dmz', label: 'DMZ ZONE', bgColor: '#F2F1EC', borderColor: '#D6D5CF', titleColor: '#4A4A46' },
  { key: 'intranet', label: 'INTRANET', bgColor: '#FFF2EC', borderColor: '#FFC0A4', titleColor: '#B23A0B' },
  { key: 'external', label: 'EXTERNAL', bgColor: '#FDF3E7', borderColor: '#E8C79A', titleColor: '#8A5320' },
];

/**
 * 色板里「清除背景 / 清除边框」那一格在数据里的值。
 *
 * Schema 只收 `#RRGGBB` / `#RRGGBBAA`（规格 §6.4 V5），所以透明不能写成 CSS 的
 * `transparent`，统一用全透明黑 `#00000000`：渲染上是透明，落库和导出都是合法十六进制。
 */
export const CLEAR_COLOR = '#00000000';
/** 旧数据 / 手写 JSON 里可能出现的"透明"写法，读入时统一换成 {@link CLEAR_COLOR} */
export const CLEAR_COLORS = ['transparent', 'none', 'clear'];

/** 新建连线 / 新建分组的默认样式 */
export const EDGE_DEFAULTS = {
  edgeType: 'ortho' as const,
  /** 默认灰色：中性、不抢节点的视线；需要语义色时在面板里单独改 */
  strokeColor: '#AFACA2',
  strokeWidth: 2,
  strokeDasharray: null,
  /**
   * 新线默认**单向箭头**，箭头指向目标端（箭头跟着拖线方向走）。
   *
   * 用户 2026-11-04 改定：以前默认 `none`（规格 §5.2 规则 3 的老口径），
   * 实际用起来"谁指向谁"看不清，改回默认带箭头。老图里的 `arrow` 是显式存的，
   * 不会被这个默认值改掉。
   */
  arrow: 'forward' as const,
};

/**
 * 线型虚线档位（用户 2026-11-04：只要实线 / 短虚线 / 长虚线，默认实线）。
 *
 * 存的是 SVG `stroke-dasharray` 字符串（null = 实线），属性面板只给这三档。
 * 老数据里可能有 `4,4` / `2 3` / `12 4 2 4` 之类的自定义值，
 * `dashPresetOf` 会把它们归到 `custom`，面板只提示不覆盖。
 */
export const EDGE_DASH_PRESETS = [
  { key: 'solid', label: '实线', value: null },
  { key: 'short', label: '短虚线', value: '6 4' },
  { key: 'long', label: '长虚线', value: '12 8' },
] as const;

export type DashPresetKey = (typeof EDGE_DASH_PRESETS)[number]['key'] | 'custom';

const DASH_KEY_BY_VALUE = new Map<string, DashPresetKey>(
  EDGE_DASH_PRESETS.filter((p) => p.value !== null).map((p) => [p.value as string, p.key]),
);

/** 当前 dasharray 属于哪一档（空 = 实线，认不出的老值 = custom） */
export function dashPresetOf(value: string | null | undefined): DashPresetKey {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized === '') return 'solid';
  return DASH_KEY_BY_VALUE.get(normalized) ?? 'custom';
}

export const GROUP_DEFAULTS = {
  bgColor: ZONE_PALETTES[0]!.bgColor,
  borderColor: ZONE_PALETTES[0]!.borderColor,
  titleColor: ZONE_PALETTES[0]!.titleColor,
  width: 420,
  height: 300,
  collapsedHeight: 40,
};

/**
 * 左侧「结构」区里的分组预设：拖进画布直接得到一个带图标、带副文本的框。
 *
 * 都是**普通分组**，只是三件默认值不同（名称 / 副文本 / 图标），拖进去之后
 * 和手动建的分组完全等价 —— 可改名、可换图标、可嵌套、可放节点。
 */
export interface GroupPreset {
  key: string;
  /** 卡片上的名字 */
  label: string;
  /** 建出来的分组名 */
  groupLabel: string;
  subLabel: string;
  iconKey: string;
  width: number;
  height: number;
  bgColor: string;
  borderColor: string;
  titleColor: string;
}

export const GROUP_PRESETS: GroupPreset[] = [
  {
    key: 'server',
    label: '服务器',
    groupLabel: '服务器',
    subLabel: '物理机 / 虚拟机',
    iconKey: 'tabler:server',
    width: 420,
    height: 300,
    bgColor: ZONE_PALETTES[0]!.bgColor,
    borderColor: ZONE_PALETTES[0]!.borderColor,
    titleColor: ZONE_PALETTES[0]!.titleColor,
  },
  {
    key: 'cluster',
    label: '集群',
    groupLabel: '集群',
    subLabel: '多副本 / 高可用',
    iconKey: 'tabler:stack-2',
    width: 460,
    height: 320,
    bgColor: ZONE_PALETTES[1]!.bgColor,
    borderColor: ZONE_PALETTES[1]!.borderColor,
    titleColor: ZONE_PALETTES[1]!.titleColor,
  },
  {
    key: 'nginx',
    label: 'nginx',
    groupLabel: 'nginx',
    subLabel: '反向代理 / 负载均衡',
    iconKey: 'arch:nginx',
    width: 420,
    height: 300,
    bgColor: '#F3F1E9',
    borderColor: '#CFCBB8',
    titleColor: '#1F7A44',
  },
];

export const NODE_DEFAULTS = {
  bgColor: TOKENS.nodeBg,
  borderColor: TOKENS.nodeBorder,
  textColor: TOKENS.textPrimary,
  width: 160,
  height: 80,
};

/**
 * 文本类节点的默认样式（2026-11-04）。
 *
 * 标题/文本默认「无边框无底色」，便利贴默认米黄，注释默认白底灰边 ——
 * 都只是建节点时的初始值，之后照样能用取色板改。
 * 用 '#00000000' 而不是 'transparent'：颜色字段只认 #RRGGBB(AA)。
 */
export const TEXT_NODE_STYLE: Partial<
  Record<NodeType, { bgColor?: string; borderColor?: string; textColor?: string }>
> = {
  title: { bgColor: '#00000000', borderColor: '#00000000', textColor: '#111827' },
  text: { bgColor: '#00000000', borderColor: '#00000000', textColor: '#374151' },
  sticky: { bgColor: '#FFF7C2', borderColor: '#EFD98A', textColor: '#4A3A00' },
  annotation: { bgColor: '#FFFFFF', borderColor: '#9CA3AF', textColor: '#374151' },
  // 自由线条：底色/边框都透明，颜色用 borderColor（属性面板里显示成「颜色」）
  line: { bgColor: '#00000000', borderColor: '#4B5563', textColor: '#374151' },
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
    /*
     * 形状（2026-11-06 用户新增）。
     *
     * 放在分类树最前面是有意的：画架构图时「先摆框、再连线」是最高频的动作，
     * 形状比业务图标更常用。尺寸按人眼观感分别给：圆要方一点才像圆，
     * 三角形/圆柱偏宽，其余统一 160×100 —— 全部写进 COMPONENT_INDEX，
     * 拖进来和右键新建拿到的默认尺寸保持一致。
     */
    key: 'shape',
    label: '形状',
    items: [
      spec('shape-rect', '直角矩形', 160, 100),
      spec('shape-round', '圆角矩形', 160, 100),
      spec('shape-circle', '圆形', 120, 120),
      spec('shape-diamond', '菱形', 140, 120),
      spec('shape-triangle', '三角形', 140, 120),
      spec('shape-hexagon', '六边形', 160, 100),
      spec('shape-cylinder', '圆柱', 140, 110),
      spec('shape-parallelogram', '平行四边形', 160, 100),
      spec('shape-document', '文档', 160, 100),
      spec('shape-arrow', '箭头块', 160, 100),
    ],
  },
  {
    /*
     * 流程图（2026-11-06 用户新增）。
     *
     * 与形状共用一套轮廓渲染：默认就带 label（开始/处理/判断…），副文本留空 ——
     * 流程节点通常只写一个词，留空比塞一行占位说明干净。开始/结束用胶囊、
     * 连接点用小圆，尺寸按图形本身的比例给，而不是统一 160×80。
     */
    key: 'flow',
    label: '流程图',
    items: [
      spec('flow-start', '开始', 160, 60),
      spec('flow-process', '处理', 160, 80),
      spec('flow-decision', '判断', 160, 80),
      spec('flow-data', '数据', 160, 80),
      spec('flow-document', '文档', 160, 80),
      spec('flow-predefined', '预定义过程', 160, 80),
      spec('flow-connector', '连接点', 64, 64),
    ],
  },
  {
    key: 'security',
    label: '网络安全',
    items: [
      spec('firewall', '防火墙', 160, 80),
      spec('vip', 'VIP', 140, 70, 'VIP: x.x.x.x'),
      spec('lb', '负载均衡', 160, 80, ':80/:443'),
      spec('vpn', 'VPN 网关', 160, 80),
    ],
  },
  {
    // 文本类：标题 / 文本 / 便利贴 / 注释。
    // 这几个都是**真正的节点**（可连线、可进分组、可多选对齐），只是默认样式不同。
    key: 'text',
    label: '文本',
    items: [
      spec('title', '标题', 320, 48),
      spec('text', '文本', 240, 72),
      spec('sticky', '便利贴', 180, 160),
      spec('annotation', '注释', 200, 90),
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
      spec('legend', '图例', 220, 160),
    ],
  },
  {
    key: 'custom',
    label: '自定义',
    items: [spec('custom', '自定义卡片', 160, 80)],
  },
];

/**
 * 「结构」区末尾的节点卡（不进组件分类树）。
 *
 * 单行元素 = 普通节点（有边框、有底色、能连线、能进分组），只是默认 200×40：
 * 高度 <52 时图标本来就不画，副文本默认空 —— 于是视觉上就是"一行字 + 一个框"。
 */
export const STRUCTURE_NODE_SPECS: ComponentSpec[] = [spec('element', '单行元素', 200, 40), spec('line', '线条', 200, 40)];

/** nodeType → 默认尺寸 / 默认副文本，供拖入创建时使用 */
export const COMPONENT_INDEX: Record<NodeType, ComponentSpec> = Object.fromEntries(
  [...COMPONENT_CATEGORIES.flatMap((c) => c.items), ...STRUCTURE_NODE_SPECS].map((i) => [
    i.nodeType,
    i,
  ]),
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


