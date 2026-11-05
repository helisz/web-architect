import { describe, expect, it } from 'vitest';
import {
  absoluteEndpoints,
  clampLineWidth,
  describeAngle,
  LINE_MAX_WIDTH,
  LINE_MIN_WIDTH,
  LINE_WIDTH_PRESETS,
  lineGeometry,
  lineInfo,
  readLineData,
  snapEndpoint,
  type Pt,
} from '../src/canvas/lineGeometry.js';

/**
 * 自由线条的几何单测（用户 2026-11-05）。
 *
 * 两条容易写错的规则都在这里钉住：
 * 1. 端点存在 extJson 里、盒子由端点推导 → 拖完端点盒子不能漂；
 * 2. 45° 吸附只在容差内生效，Shift 强制吸附。
 */

const pt = (x: number, y: number): Pt => ({ x, y });

describe('lineGeometry（盒子由端点推导）', () => {
  it('水平线：高度夹到最小值，线垂直居中', () => {
    const geo = lineGeometry(pt(100, 200), pt(300, 200));
    expect(geo).toEqual({ x: 100, y: 180, width: 200, height: 40, a: { x: 0, y: 20 }, b: { x: 200, y: 20 } });
  });

  it('竖直线：宽度夹到最小值，线水平居中', () => {
    const geo = lineGeometry(pt(200, 100), pt(200, 300));
    expect(geo).toEqual({ x: 168, y: 100, width: 64, height: 200, a: { x: 32, y: 0 }, b: { x: 32, y: 200 } });
  });

  it('反向拖动（从右下往左上）也得到同样的盒子', () => {
    const forward = lineGeometry(pt(100, 100), pt(260, 180));
    const backward = lineGeometry(pt(260, 180), pt(100, 100));
    expect(backward.x).toBe(forward.x);
    expect(backward.y).toBe(forward.y);
    expect(backward.width).toBe(forward.width);
    expect(backward.height).toBe(forward.height);
    expect(backward.a).toEqual(forward.b);
    expect(backward.b).toEqual(forward.a);
  });

  it('45° 线：盒子是正方形，端点在两个对角上', () => {
    const geo = lineGeometry(pt(0, 0), pt(100, 100));
    expect(geo).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(geo.a).toEqual({ x: 0, y: 0 });
    expect(geo.b).toEqual({ x: 100, y: 100 });
  });

  it('端点按流程坐标反算回来必须一致（不能漂）', () => {
    const start = { x: 40, y: 260 };
    const geo = lineGeometry(pt(40, 260), pt(77, 300));
    const abs = absoluteEndpoints({ x: geo.x, y: geo.y }, { a: geo.a, b: geo.b, width: 2, dash: null });
    expect(abs.a).toEqual(pt(40, 260));
    expect(abs.b).toEqual(pt(77, 300));
    expect(start).toBeDefined();
  });
});

describe('snapEndpoint（45° 吸附）', () => {
  const anchor = pt(0, 0);

  it('接近水平时吸到 0°，长度不变', () => {
    const snapped = snapEndpoint(anchor, pt(200, 8)); // 2.29°
    expect(snapped.y).toBe(0);
    expect(snapped.x).toBeCloseTo(200, 0);
  });

  it('接近 45° 时吸到 45°', () => {
    const snapped = snapEndpoint(anchor, pt(100, 96)); // 43.8°
    expect(Math.abs(snapped.x - snapped.y)).toBeLessThan(0.01);
  });

  it('偏离超过容差就保持原样（能画任意角度）', () => {
    const pointer = pt(100, 40); // 21.8°
    expect(snapEndpoint(anchor, pointer)).toEqual(pointer);
  });

  it('Shift 强制吸附：偏 31° 也拉回最近的 45° 倍数', () => {
    const pointer = pt(100, 60); // 30.96°，最近的是 45°
    const snapped = snapEndpoint(anchor, pointer, { force: true });
    const angle = (Math.atan2(snapped.y, snapped.x) * 180) / Math.PI;
    expect(Math.round(angle)).toBe(45);
  });

  it('负方向（左上）也能吸到 180° / -135°', () => {
    const left = snapEndpoint(anchor, pt(-200, 4));
    expect(left.y).toBe(0);
    expect(left.x).toBeCloseTo(-200, 0);
    const upLeft = snapEndpoint(anchor, pt(-100, -101), { force: true });
    expect(Math.round((Math.atan2(upLeft.y, upLeft.x) * 180) / Math.PI)).toBe(-135);
  });

  it('几乎零长度时不动（避免 NaN）', () => {
    expect(snapEndpoint(anchor, pt(0, 0.000001))).toEqual(anchor);
  });

  it('吸附结果保留一位小数的精度，不产生脏坐标', () => {
    const snapped = snapEndpoint(anchor, pt(100, 3));
    expect(snapped.x).toBe(Math.round(snapped.x * 2) / 2);
    expect(snapped.y).toBe(Math.round(snapped.y * 2) / 2);
  });
});

describe('readLineData（坏数据兜底）', () => {
  it('没有 extJson.line 时给一条居中水平线', () => {
    expect(readLineData(undefined, 200, 40)).toEqual({
      a: { x: 2, y: 20 },
      b: { x: 198, y: 20 },
      width: 2,
      dash: null,
    });
  });

  it('正常数据原样读出，线宽夹到范围内', () => {
    const data = readLineData({ line: { a: { x: 0, y: 0 }, b: { x: 50, y: 50 }, width: 99, dash: '6 4' } }, 64, 64);
    expect(data.a).toEqual({ x: 0, y: 0 });
    expect(data.width).toBe(6);
    expect(data.dash).toBe('6 4');
    expect(clampLineWidth(Number.NaN)).toBe(2);
  });

  it('端点写成字符串/NaN 时退回默认值，不抛错', () => {
    const data = readLineData({ line: { a: { x: 'a', y: null }, b: { x: 10, y: 10 } } }, 120, 40);
    expect(data.a).toEqual({ x: 2, y: 20 });
    expect(data.b).toEqual({ x: 10, y: 10 });
  });
});

describe('lineInfo / describeAngle', () => {
  it('长度与角度', () => {
    expect(lineInfo(pt(0, 0), pt(100, 0))).toEqual({ length: 100, angle: 0 });
    expect(Math.round(lineInfo(pt(0, 0), pt(0, 100)).angle)).toBe(90);
  });

  it('角度文案', () => {
    expect(describeAngle(0)).toBe('水平 0°');
    expect(describeAngle(90)).toBe('垂直 90°');
    expect(describeAngle(180)).toBe('水平 180°');
    expect(describeAngle(270)).toBe('垂直 270°');
    expect(describeAngle(45)).toBe('45°');
    expect(describeAngle(-45)).toBe('315°');
  });
});

describe('LINE_WIDTH_PRESETS（面板快选档位）', () => {
  it('四个常用档位都在允许区间内，且不会被夹取', () => {
    expect(LINE_WIDTH_PRESETS).toEqual([0.5, 1, 1.5, 2]);
    for (const preset of LINE_WIDTH_PRESETS) {
      expect(preset).toBeGreaterThanOrEqual(LINE_MIN_WIDTH);
      expect(preset).toBeLessThanOrEqual(LINE_MAX_WIDTH);
      expect(clampLineWidth(preset)).toBe(preset);
    }
  });
});