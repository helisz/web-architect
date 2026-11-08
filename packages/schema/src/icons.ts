import type { NodeType } from './types.js';

/**
 * 图标规则（用户指定 2026-11-04，同日批准方案 (a) 扩充 key 集合）：
 *
 * - 每个节点自动带 `extJson.iconKey`，值**只能**是下面这套预定义 key；
 * - 不生成 base64、不生成 url 形式的图标 —— 图标本体由前端图标集按 key 渲染，
 *   数据层只存这一个字符串，因此导出的 JSON 里不会出现任何图片数据。
 *
 * 这套映射是 Schema 的一部分：创建、修复、导入、导出都走同一份表。
 */

/** 允许的图标 key 全集（唯一合法取值） */
export const ALLOWED_ICON_KEYS = [
  // —— 用户指定的 10 个
  'tabler:shield-lock',
  'tabler:router',
  'devicon:kubernetes',
  'k8s:pod',
  'tabler:database',
  'tabler:arrow-right-square',
  'tabler:world',
  'tabler:typography',
  'tabler:cube',
  // —— 方案 (a) 补充的 6 个，用于拆开"一排方块 / 一排路由"的歧义
  'tabler:server',
  'tabler:server-2',
  'tabler:box',
  'tabler:network',
  'tabler:route',
  'tabler:plug-connected',
  /**
   * 2026-11-04 追加 4 个：
   * - `arch:nginx` / `arch:nginx-mono`：nginx 的「N」方块标记（自绘内联 path，
   *   不是原来的 NGINX 全称 wordmark）。**旧的 `devicon:nginx` 已从常用集移除**，
   *   老数据由 LEGACY_ICON_ALIASES 在渲染层映射成 arch:nginx；
   * - `tabler:letter-n`：纯字母 N，作备选；
   * - `tabler:stack-2`：集群/堆叠，给「集群」分组预设用。
   */
  'arch:nginx',
  'arch:nginx-mono',
  'tabler:letter-n',
  'tabler:stack-2',
  /**
   * 2026-11-06 追加 14 个：形状 / 流程图节点用。
   *
   * 都是 tabler 库里的基础几何与流程符号，不引入新图标库；形状在画布上并不画图标
   * （轮廓是自绘 SVG），这些 key 只服务于左侧组件库卡片和属性面板的常用图标行。
   */
  'tabler:rectangle',
  'tabler:square-rounded',
  'tabler:circle',
  'tabler:diamond',
  'tabler:triangle',
  'tabler:hexagon',
  'tabler:cylinder',
  'tabler:shape',
  'tabler:file-text',
  'tabler:arrow-big-right',
  'tabler:player-play',
  'tabler:git-branch',
  'tabler:settings',
  'tabler:circle-dot',
  'tabler:layout-navbar',
  'tabler:square-plus',
  'tabler:square-dashed',
  // 2026-11-07 档 2：把撞车图标拆开（新拖出来的节点用新图标）
  'tabler:arrows-split-2',
  'tabler:arrows-exchange',
  'tabler:plug',
  'tabler:heading',
  'tabler:note',
  'tabler:message-circle',
  'tabler:lock-access',
  'k8s:namespace',
  'k8s:deployment',
  'k8s:service',
  'k8s:ingress',
] as const;

export type IconKey = (typeof ALLOWED_ICON_KEYS)[number];

/** 未命中映射表的节点类型（以及未知类型）统一落这个 key */
export const DEFAULT_ICON_KEY: IconKey = 'tabler:cube';

/**
 * nodeType → iconKey，49 个类型全覆盖。
 *
 * 分组语义：
 * - 安全防护 → shield-lock；入口转发 → arrow-right-square；网络设备 → router / network / route / plug-connected
 * - 数据存储 → database；K8s 独有对象 → kubernetes（pod 用 cncf:pod）
 * - 计算资源 → server / server-2 / box；容器与区域 → cube
 * - 形状 / 流程图 → 基础几何符号（画布上轮廓自绘，图标只给组件库卡片看）
 */
/**
 * 分组（不是节点，是 DiagramGroup）的默认图标。
 * 2026-11-07：`group` / `zone` 两个"伪节点类型"下线后，这里单独给分组一个 key，
 * 别再借 `iconKeyFor('group')`。
 */
export const GROUP_ICON_KEY: IconKey = 'tabler:cube';

export const ICON_KEY_BY_NODE_TYPE: Record<NodeType, IconKey> = {
  // 网络安全
  firewall: 'tabler:shield-lock',
  vip: 'tabler:plug-connected',
  lb: 'tabler:arrows-split-2',
  vpn: 'tabler:lock-access',

  // 计算
  server: 'tabler:server',
  vm: 'tabler:server-2',
  container: 'tabler:box',
  // nginx 用「N」方块标记（原来指向 devicon 的全称 wordmark，字太小认不出）
  nginx: 'arch:nginx',
  proxy: 'tabler:arrows-exchange',

  // 容器编排
  'k8s-cluster': 'devicon:kubernetes',
  namespace: 'k8s:namespace',
  deployment: 'k8s:deployment',
  service: 'k8s:service',
  pod: 'k8s:pod',
  ingress: 'k8s:ingress',

  // 数据
  db: 'tabler:database',

  // 接入
  gateway: 'tabler:arrow-right-square',
  external: 'tabler:world',

  // 网络
  switch: 'tabler:network',
  router: 'tabler:router',
  link: 'tabler:plug',
  subnet: 'tabler:route',

  // 结构

  // 其他
  text: 'tabler:typography',
  // 文本类（2026-11-04）：标题 / 便利贴 / 气泡注释
  title: 'tabler:heading',
  sticky: 'tabler:note',
  annotation: 'tabler:message-circle',
  // 单行元素：默认不显示图标（高度 40 本来就不画），这里只给一个兜底 key
  element: 'tabler:typography',
  // 水平单行元素：横条图标，和竖排的 element 区分开
  'element-h': 'tabler:layout-navbar',
  // 自由线条：画布上不画图标，这个 key 只给左侧面板的卡片用
  line: 'tabler:route',

  // 形状（2026-11-06）：画布上不画图标，这里只决定组件库卡片上的小图
  'shape-rect': 'tabler:rectangle',
  'shape-round': 'tabler:square-rounded',
  'shape-circle': 'tabler:circle',
  'shape-diamond': 'tabler:diamond',
  'shape-triangle': 'tabler:triangle',
  'shape-hexagon': 'tabler:hexagon',
  'shape-cylinder': 'tabler:cylinder',
  // tabler 没有 parallelogram，挑一个"通用图形"占位（用户：拿不准就复用 tabler:shape）
  'shape-parallelogram': 'tabler:shape',
  'shape-document': 'tabler:file-text',
  // 箭头块不是圆形箭头，用实心大箭头更贴图形本身
  'shape-arrow': 'tabler:arrow-big-right',

  // 流程图（2026-11-06）：同样只给卡片用，画布上展示自绘轮廓
  'flow-start': 'tabler:player-play',
  'flow-predefined': 'tabler:settings',
  custom: 'tabler:cube',
};

/**
 * 历史图标 key 的别名表（用户 2026-11-05：nginx 的「N」标记要完全替换旧的全称 logo）。
 *
 * 老数据里 nginx 存的是品牌库的整词 wordmark（`devicon:nginx`），本地图集里已经删掉了它，
 * 直接渲染会掉回 `tabler:cube`。所以**渲染层**统一先查这张表：
 * 无论数据里是哪个旧 key，画出来都是手绘的六边形 N。
 *
 * 数据侧的彻底清理见 `supabase/patch-nginx-icon.sql`（把 ext_json.iconKey 刷成 arch:nginx）。
 */
export const LEGACY_ICON_ALIASES: Readonly<Record<string, IconKey>> = {
  'devicon:nginx': 'arch:nginx',
  'logos:nginx': 'arch:nginx',
  'simple-icons:nginx': 'arch:nginx',
  'cib:nginx': 'arch:nginx',
  'fa6-brands:nginx': 'arch:nginx',
};

const ALLOWED_SET = new Set<string>(ALLOWED_ICON_KEYS);

/**
 * `prefix:name` 的形状（前缀允许数字，如 k8s）。
 *
 * 注意：校验只看**形状**，不比对白名单——图标库里 7000+ 个图标，
 * 用户可以从选择器里挑任意一个，白名单只用来决定"常用那一排"放什么。
 */
const ICON_KEY_PATTERN = /^[a-z0-9]+:[a-z0-9-]+$/;

/** 是否为合法图标 key（形状合法、且不是内联图片） */
export function isIconKey(value: unknown): value is IconKey {
  if (typeof value !== 'string') return false;
  if (looksLikeEmbeddedImage(value)) return false;
  return ICON_KEY_PATTERN.test(value);
}

/** 是否为"常用"图标（属性面板默认展示的那一排） */
export function isCuratedIconKey(value: unknown): value is IconKey {
  return typeof value === 'string' && ALLOWED_SET.has(value);
}

/** 按节点类型取图标 key；未命中的未知类型 → tabler:cube */
export function iconKeyFor(nodeType: NodeType | string): IconKey {
  const mapped = ICON_KEY_BY_NODE_TYPE[nodeType as NodeType];
  return mapped ?? DEFAULT_ICON_KEY;
}

/**
 * 取节点实际生效的 iconKey。
 *
 * `extJson.iconKey` 合法就用它（允许手工覆盖），否则按 nodeType 重新推导。
 * 这样即使库里存着老数据或被人为改坏，渲染层也永远拿得到合法 key。
 */
export function resolveIconKey(node: {
  nodeType: NodeType | string;
  extJson?: Record<string, unknown>;
}): IconKey {
  const stored = node.extJson?.iconKey;
  if (typeof stored === 'string' && LEGACY_ICON_ALIASES[stored]) return LEGACY_ICON_ALIASES[stored];
  return isIconKey(stored) ? stored : iconKeyFor(node.nodeType);
}

/**
 * 该对象是否**关掉了图标**（用户 2026-11-04）。
 *
 * 做成 extJson 上的开关而不是删掉 iconKey：
 * 1. 校验器 V11 要求每个节点都必须有合法 iconKey，删了会被自动补回类型默认；
 * 2. 关掉再打开能原样恢复之前的图标。
 */
export function isIconHidden(item: { extJson?: Record<string, unknown> }): boolean {
  return item.extJson?.iconHidden === true;
}

/** 判断一个值是否是"内联图片"（base64 / data URI / http(s) URL）——本规则明确禁止 */
export function looksLikeEmbeddedImage(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://');
}


