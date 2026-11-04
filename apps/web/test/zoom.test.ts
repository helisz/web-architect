import { describe, expect, it } from 'vitest';
import { ZOOM_LEVELS, ZOOM_MAX, ZOOM_MIN, nextZoom, zoomAroundCenter } from '../src/canvas/zoom.js';

/**
 * 缩放档位（用户 2026-11-04 定稿）：
 * 点 +/− 与 Ctrl+滚轮都按固定 20% 走，Fit view 出来的 87% 也要先对齐到 100%。
 * 这些数字会直接显示在状态条上，算错就是"按了没反应 / 跳两档"。
 */
describe('ZOOM_LEVELS', () => {
  it('从 20% 到 400%，每档 20%', () => {
    expect(ZOOM_LEVELS[0]).toBe(0.2);
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(4);
    expect(ZOOM_LEVELS).toHaveLength(20);
    expect(ZOOM_LEVELS.slice(0, 5)).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('没有浮点毛刺（0.6 不是 0.6000000000000001）', () => {
    for (const level of ZOOM_LEVELS) {
      expect(String(level)).toMatch(/^\d(\.\d)?$/);
    }
  });

  it('边界值就是上下限', () => {
    expect(ZOOM_MIN).toBe(0.2);
    expect(ZOOM_MAX).toBe(4);
  });
});

describe('nextZoom', () => {
  it('100% 放大到 120%、缩小到 80%', () => {
    expect(nextZoom(1, 1)).toBe(1.2);
    expect(nextZoom(1, -1)).toBe(0.8);
  });

  it('正好在档位上不会原地不动', () => {
    expect(nextZoom(0.8, 1)).toBe(1);
    expect(nextZoom(1.2, -1)).toBe(1);
  });

  it('Fit view 出来的非档位值（0.873）先对齐到相邻档', () => {
    expect(nextZoom(0.873, 1)).toBe(1);
    expect(nextZoom(0.873, -1)).toBe(0.8);
  });

  it('0.9 放大 → 1.0，不会因为浮点误差跳过 1.0', () => {
    expect(nextZoom(0.9, 1)).toBe(1);
  });

  it('到顶 / 到底就停住', () => {
    expect(nextZoom(4, 1)).toBe(4);
    expect(nextZoom(0.2, -1)).toBe(0.2);
    expect(nextZoom(4.5, 1)).toBe(4);
    expect(nextZoom(0.1, -1)).toBe(0.2);
  });

  it('异常输入退回 100%', () => {
    expect(nextZoom(Number.NaN, 1)).toBe(1);
  });
});

describe('zoomAroundCenter', () => {
  it('缩放后视口中心对应的图坐标不变', () => {
    const viewport = { x: -120, y: -80, zoom: 0.8 };
    const size = { width: 1000, height: 600 };
    const before = {
      x: (size.width / 2 - viewport.x) / viewport.zoom,
      y: (size.height / 2 - viewport.y) / viewport.zoom,
    };
    const next = zoomAroundCenter(viewport, 1.2, size);
    expect(next.zoom).toBe(1.2);
    expect((size.width / 2 - next.x) / next.zoom).toBeCloseTo(before.x, 6);
    expect((size.height / 2 - next.y) / next.zoom).toBeCloseTo(before.y, 6);
  });

  it('中心在原点时平移量按比例放大', () => {
    // 视口中心 (50,50) 对应图坐标 (100,100)：放大到 2 倍后左上角要退到 -150
    expect(zoomAroundCenter({ x: -50, y: -50, zoom: 1 }, 2, { width: 100, height: 100 })).toEqual({
      x: -150,
      y: -150,
      zoom: 2,
    });
  });
});
