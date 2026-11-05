import { describe, expect, it } from 'vitest';
import {
  MAX_WAYPOINTS,
  buildPath,
  pointAt,
  midpointInsertIndex,
  orthoPoints,
  readWaypoints,
  snap,
  writeWaypoints,
  type Pt,
} from '../src/canvas/edgeGeometry.js';

const A: Pt = { x: 100, y: 100 };
const B: Pt = { x: 300, y: 100 };

/** 解析 path 里的坐标对，用来验证"路径真的穿过这些点" */
function coordsOf(d: string): Pt[] {
  const out: Pt[] = [];
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

describe('readWaypoints / writeWaypoints', () => {
  it('读不到就返回空数组，坏值直接丢掉', () => {
    expect(readWaypoints(undefined)).toEqual([]);
    expect(readWaypoints({})).toEqual([]);
    expect(readWaypoints({ waypoints: 'x' })).toEqual([]);
    expect(readWaypoints({ waypoints: [{ x: 1, y: 2 }, { x: 'a', y: 3 }, { x: 4, y: 5 }] })).toEqual([
      { x: 1, y: 2 },
      { x: 4, y: 5 },
    ]);
  });

  it('写回时去重、留一位小数、空数组就删掉键', () => {
    expect(writeWaypoints({ iconKey: 'x' }, [])).toEqual({ iconKey: 'x' });
    const written = writeWaypoints(undefined, [
      { x: 10.04, y: 20.06 },
      { x: 10.1, y: 20.06 },
    ]);
    expect(written.waypoints).toEqual([{ x: 10, y: 20.1 }]);
  });

  it('折点数量有上限，超出的丢掉', () => {
    const many = Array.from({ length: MAX_WAYPOINTS + 5 }, (_, i) => ({ x: i * 40, y: 0 }));
    expect(readWaypoints({ waypoints: many })).toHaveLength(MAX_WAYPOINTS);
    expect((writeWaypoints(undefined, many).waypoints as Pt[]).length).toBe(MAX_WAYPOINTS);
  });

  it('吸附到 10px 网格', () => {
    expect(snap(23)).toBe(20);
    expect(snap(26)).toBe(30);
    expect(snap(-4)).toBe(-0);
  });
});

describe('orthoPoints', () => {
  it('斜着走的两点之间补一个直角拐点，且横段竖直段都不为零', () => {
    const points = orthoPoints([A, { x: 300, y: 240 }], 'right', 'left');
    expect(points).toHaveLength(3);
    const [p0, p1, p2] = points as [Pt, Pt, Pt];
    expect(p0).toEqual(A);
    expect(p1.x).toBe(p2.x); // 先横后纵：拐点与终点同列
    expect(p1.y).toBe(p0.y);
  });

  it('已经横平竖直的点不额外加拐点', () => {
    expect(orthoPoints([A, B], 'right', 'left')).toEqual([A, B]);
  });

  it('源锚点在上下时先竖着出来', () => {
    const points = orthoPoints([A, { x: 300, y: 240 }], 'top', 'left');
    expect(points[1]).toEqual({ x: A.x, y: 240 });
  });
});

describe('buildPath', () => {
  const points: Pt[] = [A, { x: 200, y: 40 }, B];

  it('直线：路径穿过所有折点', () => {
    const { d, points: used } = buildPath('straight', points, 'right', 'left');
    const coords = coordsOf(d);
    expect(used).toEqual(points);
    for (const p of points) expect(coords.some((c) => c.x === p.x && c.y === p.y)).toBe(true);
    expect(d.startsWith('M 100 100')).toBe(true);
  });

  it('正交：输出点全是横竖段（每段只有一个坐标在变）', () => {
    const { d, points: used } = buildPath('ortho', points, 'right', 'left');
    expect(used.length).toBeGreaterThan(points.length);
    for (let i = 0; i < used.length - 1; i += 1) {
      const a = used[i]!;
      const b = used[i + 1]!;
      expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true);
    }
    expect(coordsOf(d)[0]).toEqual(A);
  });

  it('曲线：用三次贝塞尔穿过折点', () => {
    const { d } = buildPath('bezier', points, 'right', 'left');
    expect(d).toContain('C');
    const coords = coordsOf(d);
    for (const p of points) expect(coords.some((c) => c.x === p.x && c.y === p.y)).toBe(true);
  });

  it('标注点落在路径中间（不是端点）', () => {
    const straight = buildPath('straight', points, 'right', 'left');
    expect(straight.labelPoint.x).toBeGreaterThan(A.x);
    expect(straight.labelPoint.x).toBeLessThan(B.x);
    const ortho = buildPath('ortho', points, 'right', 'left');
    expect(Number.isFinite(ortho.labelPoint.x)).toBe(true);
    const bezier = buildPath('bezier', points, 'right', 'left');
    expect(bezier.labelPoint.x).toBeGreaterThan(A.x);
    expect(bezier.labelPoint.x).toBeLessThan(B.x);
  });

  it('两个点在曲线模式下退化成直线（不生成奇怪的弧）', () => {
    const { d } = buildPath('bezier', [A, B], 'right', 'left');
    expect(d).toBe('M 100 100 L 300 100');
  });
});

describe('midpointInsertIndex', () => {
  it('没有折点时插在 0（第一个折点）', () => {
    expect(midpointInsertIndex([A, B])).toBe(0);
  });

  it('中点落在哪一段就插在那一段之后', () => {
    const far = { x: 900, y: 100 };
    expect(midpointInsertIndex([A, { x: 200, y: 40 }, far])).toBe(1);
    expect(midpointInsertIndex([A, { x: 700, y: 40 }, far])).toBe(0);
  });
});
describe('pointAt', () => {
  it('按长度取 1/4 与 1/2 处的点（加折点的小＋会放在 1/4，避开标注文字）', () => {
    const line: Pt[] = [A, B];
    expect(pointAt('straight', line, 0.5)).toEqual({ x: 200, y: 100 });
    expect(pointAt('straight', line, 0.25)).toEqual({ x: 150, y: 100 });
  });

  it('正交线用展开后的拐点算：1/4 落在第一段横线上', () => {
    const built = buildPath('ortho', [A, { x: 300, y: 240 }], 'right', 'left');
    const quarter = pointAt('ortho', built.points, 0.25);
    expect(Number.isFinite(quarter.x)).toBe(true);
    expect(quarter.y).toBe(A.y);
  });

  it('曲线也能取点，且落在起终点之间', () => {
    const built = buildPath('bezier', [A, { x: 200, y: 40 }, B], 'right', 'left');
    const mid = pointAt('bezier', built.points, 0.5);
    expect(mid.x).toBeGreaterThan(A.x);
    expect(mid.x).toBeLessThan(B.x);
  });
});