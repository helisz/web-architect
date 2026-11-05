import { describe, expect, it } from 'vitest';
import {
  edgeIdsInRect,
  polylineIntersectsRect,
  rectContains,
  rectFromPoints,
  rectsIntersect,
  samplePath,
  segmentIntersectsRect,
  type PathLike,
  type Point,
  type Rect,
} from '../src/canvas/edgeHitTest.js';

/**
 * 框选连线的几何判定单测（用户 2026-11-05）。
 *
 * 这一层是补 React Flow 的缺口：RF 只按节点框选，连线是"跟着节点走"的，
 * 所以"框住一段线身"能不能选中，全看这里的判定对不对。
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const pt = (x: number, y: number): Point => ({ x, y });

describe('rectFromPoints', () => {
  it('任意方向拉框都归一化成正矩形', () => {
    expect(rectFromPoints(pt(100, 80), pt(20, 30))).toEqual(rect(20, 30, 80, 50));
    expect(rectFromPoints(pt(20, 30), pt(100, 80))).toEqual(rect(20, 30, 80, 50));
    expect(rectFromPoints(pt(50, 50), pt(50, 50))).toEqual(rect(50, 50, 0, 0));
  });
});

describe('segmentIntersectsRect', () => {
  const box = rect(100, 100, 100, 100);

  it('线段穿过矩形（两端都在外面）算命中', () => {
    expect(segmentIntersectsRect(pt(0, 150), pt(300, 150), box)).toBe(true);
    expect(segmentIntersectsRect(pt(150, 0), pt(150, 300), box)).toBe(true);
  });

  it('两端都在框内算命中；整个线段落在框内也算', () => {
    expect(segmentIntersectsRect(pt(120, 120), pt(180, 170), box)).toBe(true);
  });

  it('长线跨过小框但两端都在远处，也命中（只看端点会漏）', () => {
    const tiny = rect(148, 148, 6, 6);
    expect(segmentIntersectsRect(pt(0, 0), pt(400, 400), tiny)).toBe(true);
  });

  it('完全在框外不命中（横向/纵向/斜向）', () => {
    expect(segmentIntersectsRect(pt(0, 50), pt(300, 50), box)).toBe(false);
    expect(segmentIntersectsRect(pt(50, 0), pt(50, 300), box)).toBe(false);
    expect(segmentIntersectsRect(pt(0, 0), pt(99, 99), box)).toBe(false);
  });

  it('贴着边线（正好压边）算命中，差 1px 就不算', () => {
    expect(segmentIntersectsRect(pt(0, 100), pt(300, 100), box)).toBe(true);
    expect(segmentIntersectsRect(pt(0, 99.5), pt(300, 99.5), box)).toBe(false);
  });

  it('水平线段与框同高时也不误判（平行边界的除零分支）', () => {
    expect(segmentIntersectsRect(pt(90, 150), pt(110, 150), box)).toBe(true);
    expect(segmentIntersectsRect(pt(90, 150), pt(99, 150), box)).toBe(false);
  });

  it('零长度线段按点处理', () => {
    expect(segmentIntersectsRect(pt(150, 150), pt(150, 150), box)).toBe(true);
    expect(segmentIntersectsRect(pt(10, 10), pt(10, 10), box)).toBe(false);
  });
});

describe('polylineIntersectsRect', () => {
  const box = rect(100, 100, 100, 100);

  it('空折线不命中，单点看落点', () => {
    expect(polylineIntersectsRect([], box)).toBe(false);
    expect(polylineIntersectsRect([pt(150, 150)], box)).toBe(true);
    expect(polylineIntersectsRect([pt(10, 10)], box)).toBe(false);
  });

  it('正交折线：只有中间那一段穿过框时也命中', () => {
    const staircase = [pt(40, 160), pt(130, 160), pt(130, 40)];
    expect(polylineIntersectsRect(staircase, box)).toBe(true);
  });

  it('折线绕开框（U 形）不命中', () => {
    const detour = [pt(60, 60), pt(60, 260), pt(260, 260), pt(260, 60)];
    expect(polylineIntersectsRect(detour, box)).toBe(false);
  });
});

describe('rectContains / rectsIntersect', () => {
  const box = rect(100, 100, 50, 50);
  it('点在框内/边界', () => {
    expect(rectContains(box, pt(125, 125))).toBe(true);
    expect(rectContains(box, pt(100, 100))).toBe(true);
    expect(rectContains(box, pt(150, 150))).toBe(true);
    expect(rectContains(box, pt(150.5, 150))).toBe(false);
  });
  it('包围盒相交（粗筛用）', () => {
    expect(rectsIntersect(box, rect(140, 140, 100, 100))).toBe(true);
    expect(rectsIntersect(box, rect(160, 160, 10, 10))).toBe(false);
    expect(rectsIntersect(box, rect(100, 100, 0, 0))).toBe(true);
  });
});

describe('samplePath', () => {
  /** 直线桩：从 (0,0) 到 (length,0)，等价于一条水平 path */
  const linePath = (length: number): PathLike => ({
    getTotalLength: () => length,
    getPointAtLength: (offset) => ({ x: Math.max(0, Math.min(length, offset)), y: 0 }),
  });

  it('按长度采样，首尾点必须包含', () => {
    const samples = samplePath(linePath(120), 48, 6);
    expect(samples.length).toBe(21); // ceil(120/6)=20 段 → 21 个点
    expect(samples[0]).toEqual(pt(0, 0));
    expect(samples.at(-1)).toEqual(pt(120, 0));
  });

  it('采样点数量有上下界（短线和超长曲线都不失控）', () => {
    expect(samplePath(linePath(4), 48, 6).length).toBe(3); // 最少 2 段
    expect(samplePath(linePath(100000), 48, 6).length).toBe(49); // 最多 48 段
  });

  it('长度非法 / 取长度抛错时退回空数组', () => {
    expect(samplePath(linePath(0))).toEqual([]);
    expect(samplePath({ getTotalLength: () => Number.NaN, getPointAtLength: () => pt(0, 0) })).toEqual([]);
    const broken: PathLike = {
      getTotalLength: () => {
        throw new Error('detached');
      },
      getPointAtLength: () => pt(0, 0),
    };
    expect(samplePath(broken)).toEqual([]);
  });

  it('采样出来的折线能判定"框住中段"', () => {
    const samples = samplePath(linePath(300));
    expect(polylineIntersectsRect(samples, rect(140, -5, 20, 10))).toBe(true);
    expect(polylineIntersectsRect(samples, rect(140, 40, 20, 10))).toBe(false);
  });
});

describe('edgeIdsInRect（DOM）', () => {
  /**
   * 造一个最小的假 DOM：容器里两条连线，一条横线穿过框，一条在远处。
   * 用手写的假元素而不是 jsdom 的 SVG —— jsdom 没有 getBBox/getTotalLength。
   */
  function fakeSvgPath(x1: number, y1: number, x2: number, y2: number) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    return {
      getBBox: () => ({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      }),
      getTotalLength: () => length,
      getPointAtLength: (offset: number) => {
        const t = length === 0 ? 0 : offset / length;
        return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
      },
    };
  }

  function fakeGroup(id: string, path: unknown) {
    return {
      getAttribute: (name: string) => (name === 'data-id' ? id : null),
      querySelector: (selector: string) => (selector === '.react-flow__edge-path' ? path : null),
    };
  }

  function fakeContainer(groups: unknown[]) {
    const container = {
      querySelectorAll: (selector: string) => (selector === '.react-flow__edge' ? groups : []),
    };
    return container as unknown as ParentNode;
  }

  it('只返回路径真的穿过选框的连线', () => {
    const container = fakeContainer([
      fakeGroup('edge-a', fakeSvgPath(0, 150, 400, 150)),
      fakeGroup('edge-b', fakeSvgPath(0, 500, 400, 500)),
      fakeGroup('edge-c', fakeSvgPath(170, 0, 170, 300)),
    ]);
    const hit = edgeIdsInRect(container, rect(140, 140, 60, 60));
    expect(hit.sort()).toEqual(['edge-a', 'edge-c']);
  });

  it('空选框 / 空容器 / 没有 path 都不炸', () => {
    expect(edgeIdsInRect(fakeContainer([]), rect(0, 0, 10, 10))).toEqual([]);
    expect(edgeIdsInRect(null, rect(0, 0, 10, 10))).toEqual([]);
    expect(edgeIdsInRect(fakeContainer([fakeGroup('x', fakeSvgPath(0, 0, 100, 0))]), rect(10, 10, 0, 0))).toEqual([]);
    expect(edgeIdsInRect(fakeContainer([fakeGroup('y', null)]), rect(0, 0, 100, 100))).toEqual([]);
  });
});
