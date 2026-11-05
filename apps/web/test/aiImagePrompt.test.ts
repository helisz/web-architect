/**
 * 图片预处理与提示词的单测（用户 2026-11-05）。
 *
 * 真正的 canvas 缩放在 node 环境里跑不了，这里只钉纯函数和提示词的关键约束；
 * 端到端的压缩行为由 CDP 探针在真实浏览器里验证过（1200×800 原图 → 尺寸不变、体积不涨）。
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_SIDE,
  dataUrlBytes,
  formatBytes,
  isAcceptedImageType,
  scaleForMaxSide,
} from '../src/ai/image.js';
import { buildParsePrompt, buildRepairPrompt, nodeCatalogText } from '../src/ai/prompt.js';
import { AI_NODE_TYPES } from '../src/ai/parseSchema.js';

describe('scaleForMaxSide', () => {
  it('长边超限才缩，等比', () => {
    expect(scaleForMaxSide(3000, 2000)).toEqual({ width: MAX_IMAGE_SIDE, height: 1024 });
    expect(scaleForMaxSide(2000, 3000)).toEqual({ width: 1024, height: MAX_IMAGE_SIDE });
  });

  it('本来就小就不动（不放大）', () => {
    expect(scaleForMaxSide(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('极端长条也能得到 ≥1 的边', () => {
    expect(scaleForMaxSide(10000, 3).height).toBe(1);
  });
});

describe('dataUrlBytes / formatBytes', () => {
  it('base64 体积估算（含 padding）', () => {
    expect(dataUrlBytes('data:image/png;base64,')).toBe(0);
    // "AAAA" = 3 字节；"AAA=" = 2 字节
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
  });

  it('人类可读的字节数', () => {
    expect(formatBytes(800)).toBe('800B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0MB');
  });

  it('只收图片类型', () => {
    expect(isAcceptedImageType('image/png')).toBe(true);
    expect(isAcceptedImageType('image/webp')).toBe(true);
    expect(isAcceptedImageType('application/pdf')).toBe(false);
  });
});

describe('提示词', () => {
  const prompt = buildParsePrompt();

  it('类型清单覆盖所有允许的类型，且给了中文说明', () => {
    const catalog = nodeCatalogText();
    for (const type of AI_NODE_TYPES) expect(catalog).toContain(type);
    expect(catalog).toContain('防火墙');
  });

  it('坐标必须是 0–1 归一化 + 左上角（这是我们和模型之间唯一的几何契约）', () => {
    expect(prompt).toContain('相对位置');
    expect(prompt).toContain('0');
    expect(prompt).toContain('左上角');
  });

  it('明确要求只输出 JSON、不许臆造', () => {
    expect(prompt).toContain('只输出一个 JSON 对象');
    expect(prompt).toContain('不要臆造');
  });

  it('重试提示会带上一次的输出片段，并强调纯 JSON', () => {
    const repair = buildRepairPrompt('```json\n{"nodes": []}\n```');
    expect(repair).toContain('上一次的输出无法解析');
    expect(repair).toContain('纯 JSON');
    expect(repair).toContain('{"nodes": []}');
  });
});
