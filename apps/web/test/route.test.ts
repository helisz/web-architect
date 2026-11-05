import { describe, expect, it } from 'vitest';
import { diagramHash, GALLERY_HASH, readRoute } from '../src/lib/route.js';

/**
 * hash 路由（用户 2026-11-05 改版）：
 * `#/gallery` → 图库；`#/d/<diagramId>` → 某一张图；其它地址都收敛到图库。
 * 这里只测纯函数，不碰 window —— 认错了会把用户带到一张空图上。
 */
describe('readRoute', () => {
  it('没有 hash 时是图库', () => {
    expect(readRoute('')).toEqual({ kind: 'gallery' });
  });

  it('`#/gallery` 是图库（规范地址）', () => {
    expect(readRoute(GALLERY_HASH)).toEqual({ kind: 'gallery' });
    expect(GALLERY_HASH).toBe('#/gallery');
  });

  it('老地址 `#/` 仍然能落到图库（由 normalizeHash 改写成 #/gallery）', () => {
    expect(readRoute('#/')).toEqual({ kind: 'gallery' });
  });

  it('`#/d/<uuid>` 打开那张图', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute(`#/d/${id}`)).toEqual({ kind: 'diagram', diagramId: id });
  });

  it('忽略 id 后面的查询串和多余分隔符', () => {
    expect(readRoute('#/d/abc123?x=1')).toEqual({ kind: 'diagram', diagramId: 'abc123' });
    expect(readRoute('#/d/abc123#top')).toEqual({ kind: 'diagram', diagramId: 'abc123' });
  });

  it('id 太短或不像 id 就当图库，别硬载入一张不存在的图', () => {
    expect(readRoute('#/d/a')).toEqual({ kind: 'gallery' });
    expect(readRoute('#/d/')).toEqual({ kind: 'gallery' });
    expect(readRoute('#/d/有中文')).toEqual({ kind: 'gallery' });
  });

  it('不认识的 hash 一律回图库（少一个白屏来源）', () => {
    expect(readRoute('#/wat')).toEqual({ kind: 'gallery' });
    expect(readRoute('#d/abc123')).toEqual({ kind: 'gallery' });
    // 老书签里常见的 `#/gallery/` 结尾多一个斜杠
    expect(readRoute('#/gallery/')).toEqual({ kind: 'gallery' });
  });
});

describe('diagramHash', () => {
  it('拼出来的 hash 能被 readRoute 原样读回', () => {
    const id = '371eba88-1234-4abc-8def-0123456789ab';
    expect(readRoute(diagramHash(id))).toEqual({ kind: 'diagram', diagramId: id });
  });
});
