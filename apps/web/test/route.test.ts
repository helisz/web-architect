import { describe, expect, it } from 'vitest';
import {
  diagramHash,
  flowHash,
  FLOWS_HASH,
  GALLERY_HASH,
  HOME_HASH,
  readRoute,
  templateHash,
  TEMPLATES_HASH,
} from '../src/lib/route.js';

/**
 * hash 路由（2026-11-08 加入流程产品线）：
 * `#/home` 产品选择、`#/gallery` 图库、`#/d/<id>` 架构图、
 * `#/flows` 流程列表、`#/f/<id>` 流程、`#/templates` 模板库、`#/t/<id>` 模板编辑；
 * 其它地址一律回 `#/home`。
 */
describe('readRoute', () => {
  it('没有 hash 时是产品选择页', () => {
    expect(readRoute('')).toEqual({ kind: 'home' });
    expect(HOME_HASH).toBe('#/home');
  });

  it('各个规范地址都能认出来', () => {
    expect(readRoute(HOME_HASH)).toEqual({ kind: 'home' });
    expect(readRoute(GALLERY_HASH)).toEqual({ kind: 'gallery' });
    expect(readRoute(FLOWS_HASH)).toEqual({ kind: 'flows' });
    expect(readRoute(TEMPLATES_HASH)).toEqual({ kind: 'templates' });
  });

  it('`#/d/<uuid>` 打开那张架构图', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute(`#/d/${id}`)).toEqual({ kind: 'diagram', diagramId: id });
  });

  it('`#/f/<uuid>` 打开那张流程', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute(`#/f/${id}`)).toEqual({ kind: 'flow', flowId: id });
  });

  it('`#/t/<uuid>` 打开模板编辑器', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute(`#/t/${id}`)).toEqual({ kind: 'template', templateId: id });
  });

  it('三条详情路由互不串味（前缀只差一个字母）', () => {
    const id = 'abc123def456';
    expect(readRoute(`#/d/${id}`).kind).toBe('diagram');
    expect(readRoute(`#/f/${id}`).kind).toBe('flow');
    expect(readRoute(`#/t/${id}`).kind).toBe('template');
  });

  it('忽略 id 后面的查询串和多余分隔符', () => {
    expect(readRoute('#/d/abc123?x=1')).toEqual({ kind: 'diagram', diagramId: 'abc123' });
    expect(readRoute('#/f/abc123?x=1')).toEqual({ kind: 'flow', flowId: 'abc123' });
    expect(readRoute('#/d/abc123#top')).toEqual({ kind: 'diagram', diagramId: 'abc123' });
  });

  it('id 太短或不像 id 就当首页，别硬载入一条不存在的记录', () => {
    expect(readRoute('#/d/a')).toEqual({ kind: 'home' });
    expect(readRoute('#/d/')).toEqual({ kind: 'home' });
    expect(readRoute('#/f/a')).toEqual({ kind: 'home' });
    expect(readRoute('#/t/有中文')).toEqual({ kind: 'home' });
  });

  it('不认识的 hash 一律回首页（少一个白屏来源）', () => {
    expect(readRoute('#/wat')).toEqual({ kind: 'home' });
    expect(readRoute('#d/abc123')).toEqual({ kind: 'home' });
    // 老书签里常见的 `#/gallery/` 结尾多一个斜杠
    expect(readRoute('#/gallery/')).toEqual({ kind: 'home' });
  });
});

describe('拼 hash', () => {
  it('拼出来的 hash 能被 readRoute 原样读回', () => {
    const id = '371eba88-1234-4abc-8def-0123456789ab';
    expect(readRoute(diagramHash(id))).toEqual({ kind: 'diagram', diagramId: id });
    expect(readRoute(flowHash(id))).toEqual({ kind: 'flow', flowId: id });
    expect(readRoute(templateHash(id))).toEqual({ kind: 'template', templateId: id });
  });
});
