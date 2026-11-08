import {
  buildRequest,
  evaluateStatus,
  displayValue,
  readPath,
  type FlowNodeStatus,
  type FlowTemplateConfig,
} from '@arch/schema';

/**
 * 流程节点的请求执行（2026-11-08）。
 *
 * 纯前端直连目标系统（ADR-0004：没有自建后端），所以：
 * - 目标系统必须放开 CORS，否则浏览器直接拦掉，这里拿不到任何响应；
 * - 失败原因要翻译成用户看得懂的话（"跨域被拦"而不是 "TypeError: Failed to fetch"）；
 * - 超时用 AbortController，不依赖目标系统的行为。
 */

export interface RunResult {
  /** HTTP 状态码；网络层失败（CORS / DNS / 超时）时为 null */
  httpStatus: number | null;
  /** 解析后的 JSON；不是 JSON 时放原文 */
  payload: unknown;
  /** 原始文本（调试面板要显示原样返回） */
  rawText: string;
  /** 耗时（毫秒） */
  elapsedMs: number;
  /** 失败时的可读原因 */
  error: string | null;
  /** 状态点判定 */
  status: FlowNodeStatus;
  /** 已按 display 配置取好的字段 */
  fields: { path: string; label: string; value: string; highlight: boolean }[];
}

const statusText = (code: number): string => {
  if (code >= 500) return `目标系统出错（HTTP ${code}）`;
  if (code === 404) return 'URL 不存在（HTTP 404），检查模板里的地址';
  if (code === 401 || code === 403) return `没有权限（HTTP ${code}），检查令牌 / 请求头`;
  if (code >= 400) return `请求被拒绝（HTTP ${code}）`;
  return `HTTP ${code}`;
};

/**
 * 把 fetch 的异常翻译成用户能照着排查的话。
 *
 * 浏览器出于安全考虑**不会告诉前端**具体是哪种网络错误，所以只能按经验给提示。
 */
export function explainNetworkError(error: unknown, url: string): string {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'AbortError') return '请求超时，没等到响应（可在模板里调大超时时间）';

  const target = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  })();

  return [
    '请求发不出去，最常见的原因是目标系统没放开跨域（CORS）。',
    `需要 ${target} 返回 Access-Control-Allow-Origin（允许本站域名），`,
    '并允许你用的请求方法 / 自定义请求头；如果是 https 页面请求 http 地址，浏览器也会拦。',
  ].join('');
}

/** 一分钟内重复点击不需要缓存，这里不做缓存，纯发请求 */
export async function runNodeRequest(
  config: FlowTemplateConfig,
  params: Record<string, string>,
): Promise<RunResult> {
  const request = buildRequest(config, params);
  const started = performance.now();

  if (!request.url) {
    return {
      httpStatus: null,
      payload: null,
      rawText: '',
      elapsedMs: 0,
      error: '模板里还没填「数据」URL',
      status: 'error',
      fields: [],
    };
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), config.data.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      // 不携带 cookie：目标系统多半不是同一个域，带了反而会触发更严的 CORS 预检
      credentials: 'omit',
    });

    const rawText = await response.text();
    const elapsedMs = Math.round(performance.now() - started);

    let payload: unknown = rawText;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      // 不是 JSON 就保留原文，调试面板里能看
    }

    const fields = config.display.map((field) => ({
      path: field.path,
      label: field.label || field.path,
      value: displayValue(readPath(payload, field.path)),
      highlight: field.highlight === true,
    }));

    if (!response.ok) {
      return {
        httpStatus: response.status,
        payload,
        rawText,
        elapsedMs,
        error: statusText(response.status),
        status: 'error',
        fields,
      };
    }

    return {
      httpStatus: response.status,
      payload,
      rawText,
      elapsedMs,
      error: null,
      status: evaluateStatus(config, payload),
      fields,
    };
  } catch (cause) {
    return {
      httpStatus: null,
      payload: null,
      rawText: '',
      elapsedMs: Math.round(performance.now() - started),
      error: explainNetworkError(cause, request.url),
      status: 'error',
      fields: [],
    };
  } finally {
    window.clearTimeout(timer);
  }
}

/** 参数是否填齐（必填项没填就不发请求，省一次必然失败的调用） */
export function missingParams(
  config: FlowTemplateConfig,
  params: Record<string, string>,
): string[] {
  return config.params
    .filter((spec) => spec.required && !(params[spec.name] ?? '').trim())
    .map((spec) => spec.label || spec.name);
}

/** 参数默认值：模板声明里的 default 打底，节点自己存的值覆盖 */
export function resolveParams(
  config: FlowTemplateConfig,
  saved: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const spec of config.params) merged[spec.name] = spec.default ?? '';
  for (const [key, value] of Object.entries(saved ?? {})) {
    if (typeof value === 'string') merged[key] = value;
  }
  return merged;
}
