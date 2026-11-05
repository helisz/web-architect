/**
 * 一次解析的完整调用链（用户 2026-11-05）。
 *
 * 顺序：准备图片 → 拼请求 → 发出去（带 90 秒超时和取消）→ 抠文本 → 转草图。
 * 只有"模型没给合法 JSON"才重试一次（多花一次钱），HTTP 错误、跨域、超时、取消
 * 都不重试——那些重试也一样会失败，只会让用户多等 90 秒。
 */

import { buildVisionRequest, describeHttpError, extractAssistantText, type FetchLike } from './providers.js';
import { buildParsePrompt, buildRepairPrompt } from './prompt.js';
import { AiDraftError, draftFromText, type AiDraft, type AiDraftIssues } from './parseSchema.js';
import type { PreparedImage } from './image.js';
import type { AiProfile } from './types.js';

export const PARSE_TIMEOUT_MS = 90_000;

export type ParseErrorCode = 'http' | 'network' | 'timeout' | 'cancelled' | 'bad-json' | 'empty';

export class AiParseError extends Error {
  readonly code: ParseErrorCode;
  constructor(message: string, code: ParseErrorCode) {
    super(message);
    this.name = 'AiParseError';
    this.code = code;
  }
}

export type ParseStage = 'request' | 'validate' | 'retry';

export interface ParseOptions {
  profile: AiProfile;
  image: PreparedImage;
  signal?: AbortSignal;
  onStage?: (stage: ParseStage, message: string) => void;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface ParseResult {
  draft: AiDraft;
  issues: AiDraftIssues;
  /** 实际请求次数（1 或 2） */
  attempts: number;
  model: string;
  elapsedMs: number;
  /** 模型原始输出长度，排查"是不是被截断"用 */
  rawLength: number;
}

function isAbort(error: unknown): boolean {
  return (error as Error)?.name === 'AbortError';
}

async function sendOnce(
  options: ParseOptions,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const { profile, image, onStage } = options;
  const request = buildVisionRequest(profile, {
    prompt,
    image: { mime: image.mime, data: image.dataUrl.slice(image.dataUrl.indexOf(',') + 1) },
  });
  onStage?.('request', '正在把图发给模型…');
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(request.url, { ...request.init, signal });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw new AiParseError(
      `请求没能发出去（多半是这个端点不允许浏览器跨域直连）：${(err as Error).message}`,
      'network',
    );
  }
  const body = await response.text();
  if (!response.ok) throw new AiParseError(describeHttpError(response.status, body), 'http');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new AiParseError('端点返回的不是 JSON，可能不是兼容的 API 地址', 'http');
  }
  const text = extractAssistantText(profile.provider, payload);
  if (!text) throw new AiParseError('模型没有返回文字内容（可能触发了内容过滤）', 'empty');
  return text;
}

export async function parseArchitectureImage(options: ParseOptions): Promise<ParseResult> {
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? PARSE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  const onStage = options.onStage ?? (() => {});
  try {
    const firstRaw = await sendOnce(options, buildParsePrompt(), controller.signal);
    onStage('validate', '正在检查识别结果…');
    try {
      const { draft, issues } = draftFromText(firstRaw);
      return {
        draft,
        issues,
        attempts: 1,
        model: options.profile.model,
        elapsedMs: Date.now() - startedAt,
        rawLength: firstRaw.length,
      };
    } catch (err) {
      if (!(err instanceof AiDraftError)) throw err;
      // 只有 JSON 结构问题值得再花一次钱
      onStage('retry', '格式不对，让模型再答一次…');
      const secondRaw = await sendOnce(options, buildRepairPrompt(firstRaw), controller.signal);
      onStage('validate', '正在检查识别结果…');
      try {
        const { draft, issues } = draftFromText(secondRaw);
        return {
          draft,
          issues,
          attempts: 2,
          model: options.profile.model,
          elapsedMs: Date.now() - startedAt,
          rawLength: secondRaw.length,
        };
      } catch (secondErr) {
        if (secondErr instanceof AiDraftError) {
          throw new AiParseError(`模型两次都没给出可用的 JSON：${secondErr.message}`, 'bad-json');
        }
        throw secondErr;
      }
    }
  } catch (err) {
    if (isAbort(err)) {
      if (options.signal?.aborted) throw new AiParseError('已取消解析', 'cancelled');
      throw new AiParseError(`超过 ${Math.round(timeoutMs / 1000)} 秒模型还没返回，点「重试」再试一次`, 'timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
