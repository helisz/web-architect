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
  'devicon:nginx',
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
] as const;

export type IconKey = (typeof ALLOWED_ICON_KEYS)[number];

/** 未命中映射表的节点类型（以及未知类型）统一落这个 key */
export const DEFAULT_ICON_KEY: IconKey = 'tabler:cube';

/**
 * nodeType → iconKey，32 个类型全覆盖。
 *
 * 分组语义：
 * - 安全防护 → shield-lock；入口转发 → arrow-right-square；网络设备 → router / network / route / plug-connected
 * - 数据存储 → database；K8s 独有对象 → kubernetes（pod 用 cncf:pod）
 * - 计算资源 → server / server-2 / box；容器与区域 → cube
 */
export const ICON_KEY_BY_NODE_TYPE: Record<NodeType, IconKey> = {
  // 网络安全
  firewall: 'tabler:shield-lock',
  waf: 'tabler:shield-lock',
  vip: 'tabler:plug-connected',
  lb: 'tabler:arrow-right-square',
  vpn: 'tabler:shield-lock',
  ids: 'tabler:shield-lock',

  // 计算
  server: 'tabler:server',
  vm: 'tabler:server-2',
  container: 'tabler:box',
  nginx: 'devicon:nginx',
  proxy: 'tabler:arrow-right-square',

  // 容器编排
  'k8s-cluster': 'devicon:kubernetes',
  namespace: 'devicon:kubernetes',
  deployment: 'devicon:kubernetes',
  service: 'devicon:kubernetes',
  pod: 'k8s:pod',
  ingress: 'tabler:arrow-right-square',

  // 数据
  db: 'tabler:database',

  // 接入
  gateway: 'tabler:arrow-right-square',
  external: 'tabler:world',

  // 网络
  switch: 'tabler:network',
  router: 'tabler:router',
  link: 'tabler:arrow-right-square',
  subnet: 'tabler:route',

  // 结构
  group: 'tabler:cube',
  zone: 'tabler:cube',

  // 其他
  text: 'tabler:typography',
  legend: 'tabler:typography',
  custom: 'tabler:cube',
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
  return isIconKey(stored) ? stored : iconKeyFor(node.nodeType);
}

/** 判断一个值是否是"内联图片"（base64 / data URI / http(s) URL）——本规则明确禁止 */
export function looksLikeEmbeddedImage(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  return v.startsWith('data:') || v.startsWith('http://') || v.startsWith('https://');
}


