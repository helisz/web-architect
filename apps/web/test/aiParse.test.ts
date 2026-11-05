/**
 * 解析调用链的单测（用户 2026-11-05）：重试策略是钱的问题，必须钉住。
 *
 * - 成功：只花一次钱（attempts=1）
 * - 模型给了非 JSON：再花一次（attempts=2），第二次还不行就报 bad-json
 * - HTTP 错误 / 网络错误 / 超时 / 取消：**一次都不重试**
 */

import { describe, expect, it, vi } from 'vitest';
import { AiParseError, parseArchitectureImage } from '../src/ai/parse.js';
import { createAiProfile, type AiProfile } from '../src/ai/types.js';
import type { PreparedImage } from '../src/ai/image.js';

const profile: AiProfile = {
  ...createAiProfile('openai-compatible'),
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  apiKey: 'sk-test',
};

const image: PreparedImage = {
  dataUrl: 'data:image/jpeg;base64,AAAA',
  mime: 'image/jpeg',
  width: 1200,
  height: 800,
  bytes: 3,
  originalBytes: 100,
  originalWidth: 1200,
  originalHeight: 800,
  fileName: 'arch.png',
};

const completion = (content: string): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const goodDraft = JSON.stringify({
  name: '测试图',
  nodes: [
    { key: 'a', label: 'A', type: 'server', x: 0.1, y: 0.1 },
    { key: 'b', label: 'B', type: 'db', x: 0.5, y: 0.5 },
  ],
  edges: [{ from: 'a', to: 'b', label: 'SQL' }],
  groups: [],
});

describe('parseArchitectureImage', () => {
  it('成功时只发一次请求，并带回草图', async () => {
    const fetchImpl = vi.fn(async () => completion(goodDraft));
    const stages: string[] = [];
    const result = await parseArchitectureImage({
      profile,
      image,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onStage: (stage) => stages.push(stage),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.draft.nodes).toHaveLength(2);
    expect(result.draft.edges[0]).toMatchObject({ from: 'a', to: 'b', label: 'SQL' });
    expect(result.model).toBe('gpt-4o');
    expect(stages).toContain('request');
    expect(stages).toContain('validate');
  });

  it('第一次不是 JSON：自动重试一次，第二次成功', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(completion('我看了一下，这张图里有三个服务'))
      .mockResolvedValueOnce(completion(goodDraft));
    const result = await parseArchitectureImage({ profile, image, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    // 第二次请求里带上了"重答"的提示
    const secondBody = JSON.parse(String((fetchImpl.mock.calls[1] as unknown[])[1] ? ((fetchImpl.mock.calls[1] as unknown[])[1] as RequestInit).body : '{}'));
    expect(JSON.stringify(secondBody)).toContain('上一次的输出无法解析');
  });

  it('两次都不是 JSON：报 bad-json，且只花两次钱', async () => {
    const fetchImpl = vi.fn(async () => completion('依然不是 JSON'));
    await expect(
      parseArchitectureImage({ profile, image, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'bad-json' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('HTTP 500 不重试，报出厂商原文', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'mock 炸了' } }), { status: 500 }),
    );
    await expect(
      parseArchitectureImage({ profile, image, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'http' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络/CORS 失败不重试，提示指向跨域', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await parseArchitectureImage({
      profile,
      image,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((err: unknown) => err as AiParseError);
    expect(error.code).toBe('network');
    expect(error.message).toContain('跨域');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('模型返回空内容时报 empty', async () => {
    const fetchImpl = vi.fn(async () => completion(''));
    await expect(
      parseArchitectureImage({ profile, image, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('超时映射成可读提示', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const error = await parseArchitectureImage({
      profile,
      image,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    }).catch((err: unknown) => err as AiParseError);
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('秒');
  });

  it('外部取消报 cancelled，不重试', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
          // 模拟用户 50ms 后点取消
          setTimeout(() => controller.abort(), 30);
        }),
    );
    const error = await parseArchitectureImage({
      profile,
      image,
      signal: controller.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((err: unknown) => err as AiParseError);
    expect(error.code).toBe('cancelled');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
