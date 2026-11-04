import { describe, expect, it } from 'vitest';
import {
  RectIndex,
  buildOrthoPath,
  exitPoint,
  labelAnchorPoint,
  orthoPoints,
  segmentHitsRect,
  simplifyPoints,
  toRoundedPath,
} from '../src/ortho.js';
import type { Rect } from '../src/types.js';

const source: Rect = { x: 0, y: 0, width: 160, height: 80 }; // 中心 (80,40)
const target: Rect = { x: 400, y: 200, width: 160, height: 80 }; // 中心 (480,240)

describe('exitPoint 出入口外扩', () => {
  it('right 锚点外扩 8px', () => {
    expect(exitPoint(source, 'right')).toEqual({ x: 168, y: 40 });
  });
  it('top 锚点外扩 8px（向上为负）', () => {
    expect(exitPoint(source, 'top')).toEqual({ x: 80, y: -8 });
  });
});

describe('orthoPoints 折点数量', () => {
  it('right→left 且水平距离更大：2 个中间拐点', () => {
    const pts = orthoPoints(source, 'right', target, 'left');
    expect(pts).toHaveLength(4);
    // 两个拐点 x 相同，位于两点水平中点
    expect(pts[1]!.x).toBe(pts[2]!.x);
    expect(pts[1]!.x).toBeCloseTo((168 + 392) / 2, 5);
    // 起终点 y 各自保持
    expect(pts[1]!.y).toBeCloseTo(40, 5);
    expect(pts[2]!.y).toBeCloseTo(240, 5);
  });

  it('right→top 垂直方向对：单拐点', () => {
    const pts = orthoPoints(source, 'right', target, 'top');
    expect(pts).toHaveLength(3);
    expect(pts[1]).toEqual({ x: 480, y: 40 });
  });

  it('right→right 同侧出线：绕出联合包围盒再折回', () => {
    const pts = orthoPoints(source, 'right', { x: 320, y: 0, width: 160, height: 80 }, 'right');
    expect(pts).toHaveLength(6);
    // 转折通道必须在两个矩形右边缘之外
    expect(pts[1]!.x).toBeGreaterThan(480);
    // 绕行段在两个矩形上方
    expect(pts[2]!.y).toBeLessThan(0);
    // 最后一段水平进入右锚点
    expect(pts[5]!.y).toBeCloseTo(pts[4]!.y, 5);
    expect(pts[5]!.x).toBeLessThan(pts[4]!.x);
  });

  it('bottom→top 竖直方向：2 个拐点', () => {
    const pts = orthoPoints(source, 'bottom', target, 'top');
    expect(pts).toHaveLength(4);
  });

  it('反向（target→source 方向）仍然只产生正交线段', () => {
    const pts = orthoPoints(target, 'left', source, 'right');
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const orthogonal = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
      expect(orthogonal).toBe(true);
    }
  });
});

describe('simplifyPoints', () => {
  it('去掉重复点与共线中间点', () => {
    const pts = simplifyPoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(pts).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
    ]);
  });
});

describe('toRoundedPath', () => {
  it('生成 M/L 路径，拐角处用 Q 圆角', () => {
    const d = toRoundedPath(orthoPoints(source, 'right', target, 'left'));
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain('Q ');
    expect(d).toContain(' L ');
    expect(d).not.toContain('NaN');
    expect(d).not.toContain('Infinity');
  });

  it('直线段不产生圆角命令', () => {
    const d = toRoundedPath([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    expect(d).toBe('M 0 0 L 100 0');
  });

  it('圆角半径不超过相邻段长的一半', () => {
    // 短段 6px，半径 4 应被压到 3
    const d = toRoundedPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 6 },
        { x: 200, y: 6 },
      ],
      4,
    );
    expect(d).toContain('Q 100 0 100 3');
    expect(d).toContain('Q 100 6 103 6');
  });
});

describe('labelAnchorPoint', () => {
  it('取最长水平段中点（两段等长时取第一段）', () => {
    const pts = orthoPoints(source, 'right', target, 'left');
    const p = labelAnchorPoint(pts);
    // 水平段：168→280（长 112）与 280→392（长 112），取第一段中点
    expect(p.x).toBeCloseTo((168 + 280) / 2, 5);
    expect(p.y).toBeCloseTo(40, 5);
  });

  it('无水平段时回落到垂直段', () => {
    const p = labelAnchorPoint([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
    expect(p).toEqual({ x: 0, y: 50 });
  });
});

/* ------------------------------------------------------------------ */
/* 阶段 2：冲突绕行                                                    */
/* ------------------------------------------------------------------ */

const left: Rect = { x: 0, y: 0, width: 160, height: 80 }; // right 出线 → (168,40)
const right: Rect = { x: 400, y: 0, width: 160, height: 80 }; // left 进线 → (392,40)
const blocker: Rect = { x: 250, y: 0, width: 100, height: 80 }; // 正好压在两节点之间

const segments = (pts: { x: number; y: number }[]) =>
  pts.slice(1).map((b, i) => [pts[i]!, b] as const);

describe('冲突绕行（ortho step 5）', () => {
  it('无障碍时就是一条直线，与基础路由一致', () => {
    const pts = orthoPoints(left, 'right', right, 'left');
    expect(pts).toEqual(orthoPoints(left, 'right', right, 'left', []));
    expect(pts).toHaveLength(2);
    expect(pts[0]!.y).toBeCloseTo(pts[1]!.y, 5);
  });

  it('中间节点挡住去路时自动绕行，且没有线段压住它', () => {
    const pts = orthoPoints(left, 'right', right, 'left', [blocker]);
    expect(pts.length).toBeGreaterThan(2);
    for (const [a, b] of segments(pts)) {
      expect(segmentHitsRect(a, b, blocker, 6)).toBe(false);
      // 仍然保持正交
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
    }
    // 绕行通道贴着障碍外侧 12px，而不是绕到很远
    const ys = pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-12.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(92.01);
  });

  it('两端节点自身不算障碍（线段从边框出发不算压住）', () => {
    const pts = orthoPoints(left, 'right', right, 'left', [left, right]);
    expect(pts).toHaveLength(2);
  });

  it('远离路径的节点不影响结果', () => {
    const far: Rect = { x: 0, y: 2000, width: 160, height: 80 };
    expect(orthoPoints(left, 'right', right, 'left', [far])).toEqual(orthoPoints(left, 'right', right, 'left'));
  });

  it('buildOrthoPath 透传障碍：path 不含压线', () => {
    const { points, d } = buildOrthoPath(left, 'right', right, 'left', [blocker]);
    expect(d.startsWith('M ')).toBe(true);
    for (const [a, b] of segments(points)) expect(segmentHitsRect(a, b, blocker, 6)).toBe(false);
  });
});

describe('RectIndex 空间网格', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 500, y: 500, width: 100, height: 100 },
    { x: -300, y: 200, width: 50, height: 50 },
    { x: 1000, y: -400, width: 200, height: 60 },
  ];

  it('按包围盒取到相交矩形，顺序稳定', () => {
    const index = new RectIndex(rects);
    expect(index.query({ x: -50, y: -50, width: 200, height: 200 })).toEqual([rects[0]]);
    expect(index.query({ x: 400, y: 400, width: 300, height: 300 })).toEqual([rects[1]]);
    expect(index.query({ x: 0, y: 0, width: 1200, height: 600 })).toEqual([rects[0], rects[1]]);
    expect(index.query({ x: 5000, y: 5000, width: 10, height: 10 })).toEqual([]);
  });

  it('跨单元格的矩形不会漏（负坐标也覆盖）', () => {
    const index = new RectIndex(rects, 64);
    expect(index.query(rects[2]!)).toEqual([rects[2]]);
    expect(index.query({ x: -320, y: 180, width: 90, height: 90 })).toEqual([rects[2]]);
  });

  it('2000 个矩形 × 200 次查询仍在预算内（走索引）', () => {
    const many: Rect[] = Array.from({ length: 2000 }, (_, i) => ({
      x: (i % 50) * 240,
      y: Math.floor(i / 50) * 160,
      width: 160,
      height: 80,
    }));
    const started = performance.now();
    let hit = 0;
    for (let i = 0; i < 200; i += 1) {
      const pts = orthoPoints(left, 'right', right, 'left', many);
      hit += pts.length;
    }
    const elapsed = performance.now() - started;
    expect(hit).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
  });
});

