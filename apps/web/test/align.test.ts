import { describe, expect, it } from 'vitest';
import { alignRects, boundingBox, distributeRects, type Rect } from '../src/canvas/align.js';

const rect = (x: number, y: number, width = 100, height = 60): Rect => ({ x, y, width, height });

describe('对齐', () => {
  it('左对齐把所有人贴到最左边那个的左边', () => {
    const rects = [rect(10, 0), rect(50, 100), rect(120, 200)];
    const deltas = alignRects(rects, 'left');
    expect(deltas.map((d) => d.dx)).toEqual([0, -40, -110]);
    expect(deltas.every((d) => d.dy === 0)).toBe(true);
  });

  it('右对齐 / 居中按整体外框算', () => {
    const rects = [rect(0, 0, 100, 60), rect(40, 0, 60, 60)];
    // 右边界 100：第一个本来就贴右，第二个右边界也是 100 → 不动；居中差 -20
    expect(alignRects(rects, 'right').map((d) => d.dx)).toEqual([0, 0]);
    const wider = [rect(0, 0, 100, 60), rect(40, 0, 40, 60)];
    expect(alignRects(wider, 'centerX').map((d) => d.dx)).toEqual([0, -10]);
    expect(alignRects(wider, 'right').map((d) => d.dx)).toEqual([0, 20]);
  });

  it('垂直方向同理', () => {
    const rects = [rect(0, 0), rect(0, 90), rect(0, 30)];
    const deltas = alignRects(rects, 'top');
    expect(deltas.map((d) => d.dy)).toEqual([0, -90, -30]);
  });

  it('只有一个元素时不动（自己对齐自己没有意义）', () => {
    expect(alignRects([rect(5, 5)], 'left')).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('外框计算', () => {
    expect(boundingBox([rect(10, 20, 50, 30), rect(100, 5, 20, 200)])).toEqual({
      x: 10,
      y: 5,
      width: 110,
      height: 200,
    });
  });
});

describe('等距分布', () => {
  it('首尾不动，中间按等间隙摆放', () => {
    // 三个 100 宽的元素：第一个在 0，最后一个在 400（右边界 500）
    // 总跨度 500，元素占 300，剩 200 分两个空隙 → 每个 100
    const rects = [rect(0, 0), rect(60, 0), rect(400, 0)];
    const deltas = distributeRects(rects, 'horizontal');
    expect(deltas[0]).toEqual({ dx: 0, dy: 0 });
    expect(deltas[2]).toEqual({ dx: 0, dy: 0 });
    expect(deltas[1]!.dx).toBe(140);
  });

  it('少于 3 个不分布', () => {
    expect(distributeRects([rect(0, 0), rect(300, 0)], 'horizontal')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
  });

  it('宽度不同也能算出相等间隙', () => {
    const rects = [rect(0, 0, 40, 20), rect(50, 0, 160, 20), rect(400, 0, 40, 20)];
    const deltas = distributeRects(rects, 'horizontal');
    // 跨度 440，占用 240，剩 200 分两段 = 100
    const after = rects.map((r, i) => r.x + deltas[i]!.dx);
    expect(after[1]).toBe(0 + 40 + 100);
    expect(after[0]).toBe(0);
    expect(after[2]).toBe(400);
    // 间隙 100 与 100
    const gap1 = after[1]! - (after[0]! + 40);
    const gap2 = after[2]! - (after[1]! + 160);
    expect(gap1).toBeCloseTo(gap2, 6);
  });

  it('垂直方向按 y 排', () => {
    const rects = [rect(0, 0, 50, 40), rect(0, 20, 50, 40), rect(0, 300, 50, 40)];
    const deltas = distributeRects(rects, 'vertical');
    expect(deltas[0]).toEqual({ dx: 0, dy: 0 });
    expect(deltas[2]).toEqual({ dx: 0, dy: 0 });
    expect(deltas[1]!.dy).toBeGreaterThan(0);
  });
});
