/**
 * 模型返回的 JSON → 我们自己的「草图」（用户 2026-11-05）。
 *
 * 模型给的是近似值，这一层只做三件事：把结构捋顺（缺字段补默认值）、把
 * 明显不合法的东西丢掉并记下来、把 `type` 归一到我们支持的节点类型上。
 * 真正的几何换算在 `landing.ts`，这里不碰像素。
 *
 * 坐标约定：`x/y` 是 0–1 的**归一化**值，原点在图片左上角，指节点左上角；
 * 节点尺寸可以不给，给了也只在合理范围内采用（模型经常把尺寸猜得很离谱）。
 */

import { NODE_TYPES, type NodeType } from '@arch/schema';

/** 允许模型指派的节点类型（不含线条/便利贴/文本这类特殊件） */
export const AI_NODE_TYPES = [
  'firewall',
  'vip',
  'lb',
  'vpn',
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
  'subnet',
  'custom',
] as const satisfies readonly NodeType[];

export type AiNodeType = (typeof AI_NODE_TYPES)[number];

/** 模型常写的同义词 → 我们的类型 */
const TYPE_ALIASES: Record<string, AiNodeType> = {
  firewall: 'firewall',
  vip: 'vip',
  'virtual-ip': 'vip',
  lb: 'lb',
  loadbalancer: 'lb',
  'load-balancer': 'lb',
  vpn: 'vpn',
  server: 'server',
  host: 'server',
  machine: 'server',
  vm: 'vm',
  'virtual-machine': 'vm',
  container: 'container',
  docker: 'container',
  nginx: 'nginx',
  proxy: 'proxy',
  kubernetes: 'k8s-cluster',
  k8s: 'k8s-cluster',
  'k8s-cluster': 'k8s-cluster',
  namespace: 'namespace',
  deployment: 'deployment',
  service: 'service',
  svc: 'service',
  pod: 'pod',
  ingress: 'ingress',
  db: 'db',
  database: 'db',
  storage: 'db',
  gateway: 'gateway',
  'api-gateway': 'gateway',
  external: 'external',
  internet: 'external',
  client: 'external',
  user: 'external',
  switch: 'switch',
  router: 'router',
  subnet: 'subnet',
  vpc: 'subnet',
  custom: 'custom',
  module: 'custom',
  component: 'custom',
  app: 'custom',
  application: 'custom',
};

/**
 * 按关键词猜类型。顺序有讲究：先匹配更"专业"的词（waf 里也有"防火墙"），
 * 再落到通用词（服务器 / 服务）。
 */
const KEYWORD_RULES: Array<{ type: AiNodeType; words: string[] }> = [
  // 2026-11-06：waf / ids 类型已删除，这类词统一落到防火墙，避免整条识别结果被丢掉
  { type: 'firewall', words: ['防火墙', 'firewall', '安全组', 'fw', 'waf', 'ids', 'ips', '入侵检测', '入侵防御', '堡垒机', 'web应用防火墙'] },
  { type: 'vip', words: ['vip', '虚拟ip', '虚拟 ip', '浮动ip', '浮动 ip'] },
  { type: 'lb', words: ['负载均衡', 'load balancer', 'loadbalancer', 'slb', 'elb', 'f5', 'haproxy', 'lvs', '负载'] },
  { type: 'nginx', words: ['nginx'] },
  { type: 'proxy', words: ['反向代理', '正向代理', '代理', 'proxy', 'squid'] },
  { type: 'vpn', words: ['vpn', '专线', 'ipsec', 'openvpn', 'wireguard'] },
  { type: 'ingress', words: ['ingress'] },
  { type: 'k8s-cluster', words: ['kubernetes', 'k8s', '容器集群'] },
  { type: 'namespace', words: ['namespace', '命名空间'] },
  { type: 'deployment', words: ['deployment', '工作负载', '副本集', 'statefulset', 'daemonset'] },
  { type: 'pod', words: ['pod'] },
  { type: 'gateway', words: ['网关', 'gateway', 'gateway api'] },
  { type: 'db', words: ['数据库', 'mysql', 'postgres', 'oracle', 'sqlserver', 'mongo', 'redis', '缓存', 'elasticsearch', 'clickhouse', 'tidb', 'oss', '对象存储', '存储', 'database', 'db'] },
  { type: 'container', words: ['docker', '容器', 'container', '镜像'] },
  { type: 'vm', words: ['虚拟机', '云主机', 'ec2', 'ecs', 'vm'] },
  { type: 'switch', words: ['交换机', 'switch'] },
  { type: 'router', words: ['路由器', 'router'] },
  { type: 'subnet', words: ['子网', '网段', 'subnet', 'vpc'] },
  { type: 'external', words: ['互联网', 'internet', '外网', '公网', '用户', 'client', '客户端', 'cdn', 'dns', '第三方', '浏览器', 'app端', '移动端'] },
  { type: 'server', words: ['服务器', '主机', 'server', '物理机', '中间件', 'web服务器', 'web 服务器'] },
];

export function inferNodeType(...texts: Array<string | null | undefined>): AiNodeType {
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  if (!haystack) return 'custom';
  for (const rule of KEYWORD_RULES) {
    if (rule.words.some((word) => haystack.includes(word))) return rule.type;
  }
  return 'custom';
}

export function coerceNodeType(raw: unknown, ...fallbackTexts: Array<string | null | undefined>): AiNodeType {
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase().replace(/\s+/g, '-');
    const byAlias = TYPE_ALIASES[normalized];
    if (byAlias) return byAlias;
    if ((AI_NODE_TYPES as readonly string[]).includes(normalized)) return normalized as AiNodeType;
    // 模型可能写中文类型名，交给关键词
    const byKeyword = inferNodeType(raw);
    if (byKeyword !== 'custom') return byKeyword;
  }
  return inferNodeType(...fallbackTexts);
}

export interface AiNodeDraft {
  key: string;
  label: string;
  subLabel: string;
  type: AiNodeType;
  /** 0–1 归一化坐标，指节点左上角 */
  x: number;
  y: number;
  /** 0–1 归一化宽高，可缺省 */
  w?: number;
  h?: number;
}

export interface AiEdgeDraft {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

export interface AiGroupDraft {
  label: string;
  subLabel?: string;
  /** 成员节点的 key */
  members: string[];
}

export interface AiDraft {
  name: string;
  nodes: AiNodeDraft[];
  edges: AiEdgeDraft[];
  groups: AiGroupDraft[];
}

export interface AiDraftIssues {
  droppedNodes: number;
  droppedEdges: number;
  unknownTypes: string[];
  repairedCoordinates: number;
}

export class AiDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiDraftError';
  }
}

const MAX_NODES = 150;
const MAX_LABEL = 60;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asText(value: unknown, max = MAX_LABEL): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** 从模型输出里想办法拿到 JSON 对象：容忍 ```json 围栏、前后废话、尾逗号 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const candidates = [withoutFence];
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(withoutFence.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 再试一次：去掉对象/数组里多余的尾逗号
      try {
        return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
      } catch {
        /* 换下一个候选 */
      }
    }
  }
  throw new AiDraftError('模型返回的不是合法 JSON');
}

/**
 * 把（已经 JSON.parse 过的）对象整理成草图。
 * 宁可少几个元素也不要整张图失败，所以所有丢弃都计数、不抛错；
 * 只有"一个节点都没有"才算失败。
 */
export function normalizeDraft(raw: unknown): { draft: AiDraft; issues: AiDraftIssues } {
  const src = asRecord(raw);
  if (!src) throw new AiDraftError('模型返回的 JSON 不是一个对象');

  const issue: AiDraftIssues = { droppedNodes: 0, droppedEdges: 0, unknownTypes: [], repairedCoordinates: 0 };

  // 有些模型会包一层 {"diagram": {...}} / {"result": {...}}
  const wrapped = asRecord(src.diagram) ?? asRecord(src.result) ?? asRecord(src.data) ?? src;
  const rawNodes = Array.isArray(wrapped.nodes) ? wrapped.nodes : [];
  const rawEdges = Array.isArray(wrapped.edges) ? (wrapped.edges as unknown[]) : [];
  const rawGroups = Array.isArray(wrapped.groups) ? (wrapped.groups as unknown[]) : [];

  const nodes: AiNodeDraft[] = [];
  const usedKeys = new Set<string>();
  for (const item of rawNodes.slice(0, MAX_NODES)) {
    const node = asRecord(item);
    if (!node) {
      issue.droppedNodes += 1;
      continue;
    }
    const label = asText(node.label ?? node.name ?? node.text);
    if (!label) {
      issue.droppedNodes += 1;
      continue;
    }
    const xRaw = asNumber(node.x ?? node.left ?? node.cx);
    const yRaw = asNumber(node.y ?? node.top ?? node.cy);
    const x = xRaw === null ? 0.5 : clamp01(xRaw);
    const y = yRaw === null ? 0.5 : clamp01(yRaw);
    if (xRaw === null || yRaw === null || xRaw < 0 || xRaw > 1 || yRaw < 0 || yRaw > 1) {
      issue.repairedCoordinates += 1;
    }
    const key = asText(node.id ?? node.key ?? node.nameKey ?? label, 40) || `n${nodes.length + 1}`;
    let uniqueKey = key;
    let suffix = 2;
    while (usedKeys.has(uniqueKey)) {
      uniqueKey = `${key}#${suffix}`;
      suffix += 1;
    }
    usedKeys.add(uniqueKey);

    const rawType = node.type ?? node.nodeType ?? node.kind ?? node.category;
    const type = coerceNodeType(rawType, label, asText(node.subLabel ?? node.sublabel ?? node.description));
    if (typeof rawType === 'string' && !TYPE_ALIASES[rawType.trim().toLowerCase()]) {
      issue.unknownTypes.push(rawType.trim().slice(0, 20));
    }

    const draft: AiNodeDraft = {
      key: uniqueKey,
      label,
      subLabel: asText(node.subLabel ?? node.sublabel ?? node.description ?? node.note, 80),
      type,
      x,
      y,
    };
    const w = asNumber(node.w ?? node.width);
    const h = asNumber(node.h ?? node.height);
    if (w !== null && w > 0) draft.w = Math.min(0.45, w);
    if (h !== null && h > 0) draft.h = Math.min(0.45, h);
    nodes.push(draft);
  }

  if (nodes.length === 0) {
    throw new AiDraftError('模型说图里没有节点（可能图太模糊或不是架构图）');
  }

  const edges: AiEdgeDraft[] = [];
  const seenEdge = new Set<string>();
  for (const item of rawEdges) {
    const edge = asRecord(item);
    if (!edge) {
      issue.droppedEdges += 1;
      continue;
    }
    const from = asText(edge.from ?? edge.source ?? edge.src ?? edge.sourceId, 40);
    const to = asText(edge.to ?? edge.target ?? edge.dst ?? edge.targetId, 40);
    if (!usedKeys.has(from) || !usedKeys.has(to) || from === to) {
      issue.droppedEdges += 1;
      continue;
    }
    const signature = `${from}->${to}`;
    if (seenEdge.has(signature)) {
      issue.droppedEdges += 1;
      continue;
    }
    seenEdge.add(signature);
    const draft: AiEdgeDraft = { from, to };
    const label = asText(edge.label ?? edge.text ?? edge.protocol, 24);
    if (label) draft.label = label;
    if (edge.dashed === true || edge.style === 'dashed' || edge.dash === true) draft.dashed = true;
    edges.push(draft);
  }

  const groups: AiGroupDraft[] = [];
  for (const item of rawGroups) {
    const group = asRecord(item);
    if (!group) continue;
    const label = asText(group.label ?? group.name ?? group.title, 40);
    if (!label) continue;
    const rawMembers = Array.isArray(group.members) ? group.members : [];
    const members = rawMembers
      .map((member) => asText(member, 40))
      .filter((member) => usedKeys.has(member));
    if (members.length === 0) continue;
    const draft: AiGroupDraft = { label, members };
    const subLabel = asText(group.subLabel ?? group.description, 40);
    if (subLabel) draft.subLabel = subLabel;
    groups.push(draft);
  }

  const name = asText(wrapped.name ?? wrapped.title ?? src.name, 60);
  return { draft: { name, nodes, edges, groups }, issues: issue };
}

/** 一步到位：文本 → 草图（错误信息都是能直接给用户看的中文） */
export function draftFromText(text: string): { draft: AiDraft; issues: AiDraftIssues } {
  if (!text.trim()) throw new AiDraftError('模型返回了空内容');
  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    throw new AiDraftError('模型返回的不是合法 JSON');
  }
  return normalizeDraft(parsed);
}

/** 供 UI 与测试用：类型是否在我们支持的范围里 */
export function isAiNodeType(value: string): value is AiNodeType {
  return (AI_NODE_TYPES as readonly string[]).includes(value) && (NODE_TYPES as readonly string[]).includes(value);
}
