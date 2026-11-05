/**
 * 三家适配器：同一件事（把文字 + 一张图发给模型，要回 JSON）在三种协议下的写法。
 *
 * 这里只做「拼请求 / 解响应」这类纯函数，不碰 UI，也不读全局状态，
 * 所以可以用单测钉住请求体的形状（字段名写错是这类功能最常见的翻车点）。
 */

import { PROVIDER_META, type AiProfile, type AiProvider } from './types.js';

export interface AiRequest {
  url: string;
  init: RequestInit;
}

export interface ImagePayload {
  mime: string;
  /** 纯 base64，不带 data: 前缀 */
  data: string;
}

const PING_PROMPT = '这是一次连接测试，请只回复 pong。';

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** `data:image/png;base64,xxx` → { mime, data }；不是 data URL 就抛错 */
export function parseDataUrl(dataUrl: string): ImagePayload {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error('图片不是合法的 data URL');
  return { mime: match[1]!, data: match[2]! };
}

function jsonHeaders(extra: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...extra };
}

function requestBody(
  profile: AiProfile,
  prompt: string,
  image: ImagePayload | null,
  jsonMode: boolean,
): unknown {
  switch (profile.provider) {
    case 'anthropic': {
      const content: unknown[] = [{ type: 'text', text: prompt }];
      if (image) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mime, data: image.data },
        });
      }
      return {
        model: profile.model,
        max_tokens: 4096,
        temperature: profile.temperature,
        messages: [{ role: 'user', content }],
      };
    }
    case 'gemini': {
      const parts: unknown[] = [{ text: prompt }];
      if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
      return {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: profile.temperature,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      };
    }
    case 'openai-compatible':
    default: {
      const content: unknown[] = [{ type: 'text', text: prompt }];
      if (image) {
        content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } });
      }
      return {
        model: profile.model,
        temperature: profile.temperature,
        // 兼容端点里支持 response_format 的会返回纯 JSON；不支持的会忽略这个字段
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'user', content }],
      };
    }
  }
}

function endpoint(profile: AiProfile): string {
  const base = normalizeBaseUrl(profile.baseUrl) || PROVIDER_META[profile.provider].defaultBaseUrl;
  if (profile.provider === 'anthropic') return `${base}/v1/messages`;
  if (profile.provider === 'gemini') {
    const model = encodeURIComponent(profile.model.trim());
    const key = encodeURIComponent(profile.apiKey.trim());
    return `${base}/v1beta/models/${model}:generateContent?key=${key}`;
  }
  return `${base}/chat/completions`;
}

function headers(profile: AiProfile): Record<string, string> {
  if (profile.provider === 'anthropic') {
    return jsonHeaders({
      'x-api-key': profile.apiKey,
      'anthropic-version': '2023-06-01',
      // Claude 默认拒绝浏览器直连，带上这个头才会放行（官方提供的开关）
      'anthropic-dangerous-direct-browser-access': 'true',
    });
  }
  if (profile.provider === 'gemini') return jsonHeaders({});
  return jsonHeaders({ Authorization: `Bearer ${profile.apiKey}` });
}

function build(
  profile: AiProfile,
  prompt: string,
  image: ImagePayload | null,
  jsonMode: boolean,
): AiRequest {
  return {
    url: endpoint(profile),
    init: {
      method: 'POST',
      headers: headers(profile),
      body: JSON.stringify(requestBody(profile, prompt, image, jsonMode)),
    },
  };
}

export function buildPingRequest(profile: AiProfile): AiRequest {
  return build(profile, PING_PROMPT, null, false);
}

export function buildVisionRequest(
  profile: AiProfile,
  input: { prompt: string; image: ImagePayload },
): AiRequest {
  return build(profile, input.prompt, input.image, true);
}

/** 三种响应体里把助手文本抠出来；取不到就返回空串（上层据此判失败） */
export function extractAssistantText(provider: AiProvider, payload: unknown): string {
  const src = payload as Record<string, unknown> | null;
  if (!src) return '';
  if (provider === 'anthropic') {
    const content = Array.isArray(src.content) ? (src.content as Record<string, unknown>[]) : [];
    return content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('\n')
      .trim();
  }
  if (provider === 'gemini') {
    const candidates = Array.isArray(src.candidates) ? (src.candidates as Record<string, unknown>[]) : [];
    const first = candidates[0] as Record<string, unknown> | undefined;
    const content = first?.content as Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? (content.parts as Record<string, unknown>[]) : [];
    return parts
      .filter((part) => typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('\n')
      .trim();
  }
  const choices = Array.isArray(src.choices) ? (src.choices as Record<string, unknown>[]) : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
        ? String((part as { text: string }).text)
        : ''))
      .join('\n')
      .trim();
  }
  return '';
}

/** 从错误响应里挖一句人能看懂的话（各家的字段名不一样） */
export function describeHttpError(status: number, body: string): string {
  let detail = '';
  try {
    const parsed: unknown = JSON.parse(body);
    const src = parsed as Record<string, unknown>;
    const error = src.error;
    if (typeof error === 'string') detail = error;
    else if (error && typeof error === 'object') {
      const nested = error as Record<string, unknown>;
      if (typeof nested.message === 'string') detail = nested.message;
    } else if (typeof src.message === 'string') detail = src.message;
  } catch {
    detail = body.trim().slice(0, 160);
  }
  const head = `端点返回 ${status}`;
  return detail ? `${head}：${detail}` : head;
}

export type FetchLike = typeof fetch;

/**
 * 连接测试：只发一句 ping，不传图。
 *
 * 目的不是验证模型能不能看图（那要花钱且各家对最小尺寸要求不同），而是先确认
 * 「地址对不对、key 通不通、浏览器能不能连过去」——这三件事错了以后解析必然失败，
 * 而且报错信息长得很像，先分开排除省时间。
 */
export async function testProfile(
  profile: AiProfile,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<{ ok: boolean; message: string }> {
  const request = buildPingRequest(profile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
    const body = await response.text();
    if (!response.ok) return { ok: false, message: describeHttpError(response.status, body) };
    let payload: unknown = null;
    try {
      payload = JSON.parse(body);
    } catch {
      return { ok: false, message: '端点返回的不是 JSON，可能不是兼容的 API 地址' };
    }
    const text = extractAssistantText(profile.provider, payload);
    return text
      ? { ok: true, message: `连通，模型回了：${text.slice(0, 40)}` }
      : { ok: true, message: '端点连通（响应里没有文本，可能在思考或内容被过滤）' };
  } catch (err) {
    const error = err as Error;
    if (error.name === 'AbortError') return { ok: false, message: `超过 ${Math.round(timeoutMs / 1000)} 秒没有响应` };
    return {
      ok: false,
      message: `请求没能发出去（多半是该端点不允许浏览器跨域直连）：${error.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
