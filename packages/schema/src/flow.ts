/**
 * 流程（Flow）—— 模板配置与节点数据的纯逻辑（2026-11-08）。
 *
 * 这里只放**不依赖网络与 DOM** 的部分：类型、配置归一化、路径取值、
 * 占位符替换、URL 拼装、状态判定。真正发请求在 `apps/web/src/flow/runner.ts`，
 * 这样核心规则可以被单测覆盖，也方便以后换实现。
 */

/** 模板配置的版本号：结构发生变化时递增，旧配置在读取时归一化 */
export const FLOW_CONFIG_VERSION = 1;

export type FlowHttpMethod = 'GET' | 'POST';

/** 节点参数定义（用户建节点时填，URL / headers / body 里用 {{name}} 引用） */
export interface FlowParamSpec {
  /** 占位符里的名字，只允许字母数字下划线 */
  name: string;
  /** 界面上显示的中文标签 */
  label: string;
  /** 默认值 */
  default?: string;
  /** 是否必填 —— 必填但没填就不发请求，直接提示 */
  required?: boolean;
  /** 密钥类（token 等）：界面上以密码框显示 */
  secret?: boolean;
}

/** 一个键值对（header / query / body 字段） */
export interface FlowPair {
  key: string;
  value: string;
}

/** 展示字段：从返回数据里取哪个 key、显示成什么、是否高亮 */
export interface FlowFieldSpec {
  /** 取值路径，支持 `data.items[0].name` 或 `data.items.0.name` */
  path: string;
  /** 显示名称（可重命名）；空则用 path 的最后一段 */
  label: string;
  /** 高亮：默认展开显示，其余默认折叠 */
  highlight?: boolean;
}

/** 状态判定：取哪个 key，什么值算成功 / 失败，都不命中算未知 */
export interface FlowStatusRule {
  path: string;
  success: string[];
  failure: string[];
}

/** 数据源配置 */
export interface FlowDataSource {
  method: FlowHttpMethod;
  url: string;
  headers: FlowPair[];
  /** 仅 POST：请求体（按 JSON 对象下发） */
  body: FlowPair[];
  /** 超时（毫秒） */
  timeoutMs: number;
}

/** 系统跳转 */
export interface FlowSystemLink {
  label: string;
  url: string;
}

export interface FlowTemplateConfig {
  version: number;
  data: FlowDataSource;
  params: FlowParamSpec[];
  display: FlowFieldSpec[];
  status: FlowStatusRule;
  system: FlowSystemLink;
}

/* ------------------------------------------------------------------ *
 * 归一化
 * ------------------------------------------------------------------ */

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : value == null ? fallback : String(value);

const bool = (value: unknown): boolean => value === true;

const strList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => str(v).trim()).filter(Boolean) : [];

const pairs = (value: unknown): FlowPair[] =>
  Array.isArray(value)
    ? value
        .map((row) => ({ key: str((row as FlowPair)?.key).trim(), value: str((row as FlowPair)?.value) }))
        .filter((row) => row.key.length > 0)
    : [];

/** 参数名只留安全字符，避免 `{{a b}}` 这类没法解析的占位符 */
export function safeParamName(raw: string, index: number): string {
  const clean = raw.trim().replace(/[^\w]/g, '_');
  if (clean) return clean;
  return `p${index + 1}`;
}

/**
 * 把数据库里可能残缺 / 旧版本的 config 修成可用的结构。
 * 读的时候一律走这里，界面上就不用到处判空。
 */
export function normalizeTemplateConfig(raw: unknown): FlowTemplateConfig {
  const input = (raw ?? {}) as Partial<FlowTemplateConfig> & Record<string, unknown>;
  const data = (input.data ?? {}) as Partial<FlowDataSource>;

  return {
    version: FLOW_CONFIG_VERSION,
    data: {
      method: data.method === 'POST' ? 'POST' : 'GET',
      url: str(data.url).trim(),
      headers: pairs(data.headers),
      body: pairs(data.body),
      timeoutMs: Math.min(60000, Math.max(1000, Number(data.timeoutMs) || 10000)),
    },
    params: Array.isArray(input.params)
      ? input.params.map((row, index) => {
          const spec = (row ?? {}) as Partial<FlowParamSpec>;
          return {
            name: safeParamName(str(spec.name), index),
            label: str(spec.label).trim(),
            default: str(spec.default),
            required: bool(spec.required),
            secret: bool(spec.secret),
          };
        })
      : [],
    display: Array.isArray(input.display)
      ? input.display
          .map((row) => {
            const spec = (row ?? {}) as Partial<FlowFieldSpec>;
            return {
              path: str(spec.path).trim(),
              label: str(spec.label).trim(),
              highlight: bool(spec.highlight),
            };
          })
          .filter((row) => row.path.length > 0)
      : [],
    status: {
      path: str((input.status as Partial<FlowStatusRule>)?.path).trim(),
      success: strList((input.status as Partial<FlowStatusRule>)?.success),
      failure: strList((input.status as Partial<FlowStatusRule>)?.failure),
    },
    system: {
      label: str((input.system as Partial<FlowSystemLink>)?.label).trim(),
      url: str((input.system as Partial<FlowSystemLink>)?.url).trim(),
    },
  };
}

/** 新建模板时的空配置 */
export function emptyTemplateConfig(): FlowTemplateConfig {
  return normalizeTemplateConfig({
    data: { method: 'GET', url: '', headers: [], body: [], timeoutMs: 10000 },
    params: [],
    display: [],
    status: { path: '', success: ['ok', 'up', 'healthy'], failure: ['down', 'error', 'fail'] },
    system: { label: '', url: '' },
  });
}

/* ------------------------------------------------------------------ *
 * 取值
 * ------------------------------------------------------------------ */

/**
 * 按路径取值：`data.items[0].name`、`data.items.0.name`、`name` 都支持。
 * 取不到返回 undefined（调用方决定显示什么）。
 */
export function readPath(source: unknown, path: string): unknown {
  const clean = (path ?? '').trim();
  if (!clean) return undefined;
  // 中括号统一成点号：items[0] → items.0
  const segments = clean
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  let cursor: unknown = source;
  for (const segment of segments) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      cursor = cursor[index];
      continue;
    }
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** 取到的值转成可显示文本：对象/数组用 JSON，其它 String() */
export function displayValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/* ------------------------------------------------------------------ *
 * 占位符
 * ------------------------------------------------------------------ */

/** `{{name}}` → 参数值；没给值就替换成空串（不是留着占位符，避免请求 404） */
export function interpolate(template: string, params: Record<string, string>): string {
  return (template ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name: string) => params[name] ?? '');
}

/** 模板里声明了哪些占位符（用于界面上提示"这个参数没被用到"） */
export function placeholdersOf(template: string): string[] {
  const found = new Set<string>();
  for (const match of (template ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/* ------------------------------------------------------------------ *
 * URL 与请求
 * ------------------------------------------------------------------ */

export interface BuiltRequest {
  url: string;
  method: FlowHttpMethod;
  headers: Record<string, string>;
  /** 仅 POST 有：JSON 字符串 */
  body?: string;
}

/**
 * 按配置 + 参数拼出最终请求。
 * GET 会把 body 里的键值对并进 query（用户只配了一栏时也能用）。
 */
export function buildRequest(
  config: FlowTemplateConfig,
  params: Record<string, string>,
  extra: { page?: number; pageSize?: number } = {},
): BuiltRequest {
  const url = interpolate(config.data.url, params);
  const headers: Record<string, string> = {};

  for (const pair of config.data.headers) {
    headers[interpolate(pair.key, params)] = interpolate(pair.value, params);
  }

  const bodyPairs = config.data.body.map((pair) => ({
    key: interpolate(pair.key, params),
    value: interpolate(pair.value, params),
  }));

  if (config.data.method === 'POST') {
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
    const payload: Record<string, string> = {};
    for (const pair of bodyPairs) payload[pair.key] = pair.value;
    return { url, method: 'POST', headers, body: JSON.stringify(payload) };
  }

  // GET：把 body 栏的键值并进 query（保持简单：用户不必区分两栏）
  const query = bodyPairs.filter((pair) => pair.key);
  let finalUrl = url;
  if (query.length > 0) {
    const search = new URLSearchParams(query.map((pair) => [pair.key, pair.value] as [string, string]));
    finalUrl += (url.includes('?') ? '&' : '?') + search.toString();
  }
  if (extra.pageSize && extra.page != null) {
    finalUrl += (finalUrl.includes('?') ? '&' : '?') + `page=${extra.page}&pageSize=${extra.pageSize}`;
  }
  return { url: finalUrl, method: 'GET', headers };
}

/* ------------------------------------------------------------------ *
 * 状态判定
 * ------------------------------------------------------------------ */

export type FlowNodeStatus = 'success' | 'failure' | 'unknown' | 'loading' | 'error';

/**
 * 按 `status` 配置判定：先看失败（失败优先，避免 "ok" 恰好也在成功里时打架），
 * 都不命中就是未知。
 */
export function evaluateStatus(config: FlowTemplateConfig, payload: unknown): FlowNodeStatus {
  const path = config.status.path;
  if (!path) return 'unknown';
  const raw = readPath(payload, path);
  if (raw === undefined || raw === null) return 'unknown';
  const value = displayValue(raw).trim().toLowerCase();
  const failure = config.status.failure.map((v) => v.trim().toLowerCase());
  const success = config.status.success.map((v) => v.trim().toLowerCase());
  if (failure.includes(value)) return 'failure';
  if (success.includes(value)) return 'success';
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * 数据模型
 * ------------------------------------------------------------------ */

export interface FlowTemplate {
  templateId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  creatorId: string;
  config: FlowTemplateConfig;
  updatedAt: string;
}

export interface FlowNode {
  nodeId: string;
  flowId: string;
  templateId: string | null;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 该节点自己的参数值 */
  params: Record<string, string>;
  /** 建节点时的模板快照（模板改动不影响已有节点） */
  templateSnapshot: FlowTemplateConfig;
  extJson?: Record<string, unknown>;
  sort: number;
}

export interface FlowEdge {
  edgeId: string;
  flowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string;
  sourceAnchor?: string | null;
  targetAnchor?: string | null;
  strokeColor: string;
  strokeWidth: number;
  strokeDasharray?: string | null;
  extJson?: Record<string, unknown>;
  sort: number;
}

export interface Flow {
  flowId: string;
  name: string;
  description: string;
  version: number;
  viewport: { x: number; y: number; zoom: number };
  nodes: FlowNode[];
  edges: FlowEdge[];
  updatedAt: string;
}

/** 流程节点的默认尺寸（显示模式下要放下字段列表） */
export const FLOW_NODE_WIDTH = 300;
export const FLOW_NODE_HEIGHT = 200;
