/**
 * 三家适配器的请求形状单测（用户 2026-11-05）。
 *
 * 这类适配器最容易错的是字段名和鉴权头，而错了以后要花真金白银才能发现，
 * 所以这里把「URL 拼法 / 头 / 图片字段名」全部钉死。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildPingRequest,
  buildVisionRequest,
  describeHttpError,
  extractAssistantText,
  normalizeBaseUrl,
  parseDataUrl,
  testProfile,
} from '../src/ai/providers.js';
import { createAiProfile, type AiProfile } from '../src/ai/types.js';

const profileOf = (provider: AiProfile['provider']): AiProfile => ({
  ...createAiProfile(provider),
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o',
  apiKey: 'sk-test',
  temperature: 0,
});

const image = { mime: 'image/png', data: 'AAAABBBB' };

describe('请求拼装', () => {
  it('openai 兼容：Bearer 头 + image_url + response_format', () => {
    const profile = profileOf('openai-compatible');
    const { url, init } = buildVisionRequest(profile, { prompt: '解析', image });
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe('gpt-4o');
    expect(body.response_format).toEqual({ type: 'json_object' });
    const content = (body.messages as { content: unknown[] }[])[0]!.content as Record<string, unknown>[];
    expect(content[0]).toEqual({ type: 'text', text: '解析' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAAABBBB' },
    });
  });

  it('anthropic：x-api-key + 版本头 + 浏览器直连头 + base64 image source', () => {
    const profile = profileOf('anthropic');
    const { url, init } = buildVisionRequest(profile, { prompt: '解析', image });
    expect(url).toBe('https://api.example.com/v1/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const content = (body.messages as { content: Record<string, unknown>[] }[])[0]!.content;
    expect(content[0]).toEqual({ type: 'text', text: '解析' });
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAABBBB' },
    });
  });

  it('gemini：key 进 query，图片用 inline_data', () => {
    const profile = profileOf('gemini');
    const { url, init } = buildVisionRequest(profile, { prompt: '解析', image });
    expect(url).toBe('https://api.example.com/v1/v1beta/models/gpt-4o:generateContent?key=sk-test');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const parts = (body.contents as { parts: Record<string, unknown>[] }[])[0]!.parts;
    expect(parts[0]).toEqual({ text: '解析' });
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'AAAABBBB' } });
    const config = body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe('application/json');
  });

  it('ping 请求不带图片', () => {
    const { init } = buildPingRequest(profileOf('openai-compatible'));
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const content = (body.messages as { content: unknown[] }[])[0]!.content as Record<string, unknown>[];
    expect(content).toHaveLength(1);
    expect(body.response_format).toBeUndefined();
    expect(body.response_format ?? null).toBeNull();
  });

  it('baseUrl 结尾斜杠被去掉', () => {
    expect(normalizeBaseUrl('https://x.test/v1///')).toBe('https://x.test/v1');
  });

  it('data URL 解析出 mime 与纯 base64', () => {
    expect(parseDataUrl('data:image/jpeg;base64,ZZZ')).toEqual({ mime: 'image/jpeg', data: 'ZZZ' });
    expect(() => parseDataUrl('https://x.test/a.png')).toThrow();
  });
});

describe('响应解析', () => {
  it('openai：字符串与分段数组两种 content 都支持', () => {
    expect(
      extractAssistantText('openai-compatible', { choices: [{ message: { content: ' hi ' } }] }),
    ).toBe('hi');
    expect(
      extractAssistantText('openai-compatible', {
        choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }],
      }),
    ).toBe('a\nb');
  });

  it('anthropic：只拼 type=text 的分段', () => {
    expect(
      extractAssistantText('anthropic', {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', id: 'x' },
        ],
      }),
    ).toBe('hello');
  });

  it('gemini：candidates[0].content.parts', () => {
    expect(
      extractAssistantText('gemini', { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    ).toBe('ok');
  });

  it('结构不对返回空串而不是抛错', () => {
    expect(extractAssistantText('openai-compatible', null)).toBe('');
    expect(extractAssistantText('gemini', {})).toBe('');
  });

  it('错误体里能挖出厂商的 message', () => {
    expect(describeHttpError(401, '{"error":{"message":"bad key"}}')).toBe('端点返回 401：bad key');
    expect(describeHttpError(500, 'boom')).toBe('端点返回 500：boom');
    expect(describeHttpError(429, '')).toBe('端点返回 429');
  });
});

describe('连接测试', () => {
  it('成功时报告模型回的内容', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }), { status: 200 }),
    );
    const result = await testProfile(profileOf('openai-compatible'), fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('pong');
  });

  it('HTTP 错误带出状态码与原因', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
    );
    const result = await testProfile(profileOf('openai-compatible'), fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('401');
    expect(result.message).toContain('invalid api key');
  });

  it('网络/跨域失败给出可读提示', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await testProfile(profileOf('openai-compatible'), fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('跨域');
  });

  it('超时按 AbortError 处理', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const result = await testProfile(
      profileOf('openai-compatible'),
      fetchImpl as unknown as typeof fetch,
      5,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('秒');
  });
});
