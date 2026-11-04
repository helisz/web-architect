import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAIL_ANGLE,
  TAIL_LENGTH,
  angleFromOffset,
  edgePoint,
  normalizeAngle,
  tailAngleOf,
  tailGeometry,
} from '../src/canvas/tail.js';

/**
 * 气泡注释尖角：自由角度 + 根部贴边（用户 2026-11-04 要求 6）。
 *
 * 关键约束：**尖角必须从形状朝向的那条边射出**。左侧的尖角不能出现在右上角，
 * 所以断言都围绕"根部落在哪个边上"来写。
 */
describe('气泡尖角角度归一', () => {
  it('负角度回绕到 0–360', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
  });

  it('非数字落回默认值', () => {
    expect(normalizeAngle(Number.NaN)).toBe(DEFAULT_TAIL_ANGLE);
    expect(tailAngleOf(undefined)).toBe(DEFAULT_TAIL_ANGLE);
    expect(tailAngleOf({ tailAngle: 'oops' })).toBe(DEFAULT_TAIL_ANGLE);
  });

  it('从 extJson 读到的角度会被规整', () => {
    expect(tailAngleOf({ tailAngle: -45 })).toBe(315);
    expect(tailAngleOf({ tailAngle: 720 })).toBe(0);
  });
});

describe('尖角根部贴边', () => {
  const w = 200;
  const h = 100;

  it('朝右时根部在右边中点', () => {
    expect(edgePoint(w, h, 0)).toEqual({ x: 200, y: 50 });
  });

  it('朝左时根部在左边中点 —— 不会跑到右边去', () => {
    const p = edgePoint(w, h, 180);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(h / 2, 6);
  });

  it('朝下时根部在下边中点', () => {
    expect(edgePoint(w, h, 90)).toEqual({ x: 100, y: 100 });
  });

  it('朝左上时按"先碰到的边"射出：2:1 的宽扁矩形先在顶边出', () => {
    const p = edgePoint(w, h, 225);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.x).toBeCloseTo(50, 6);
  });

  it('左边界优先：窄高矩形左上方向从左边出（尖角真的从左侧射出）', () => {
    const p = edgePoint(100, 400, 190);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeLessThan(200);
  });

  it('尖端在根部外侧 TAIL_LENGTH 处', () => {
    const g = tailGeometry(w, h, 0);
    expect(g.tip.x).toBeCloseTo(200 + TAIL_LENGTH, 6);
    expect(g.tip.y).toBeCloseTo(50, 6);
  });

  it('底边两个点关于轴线对称', () => {
    const g = tailGeometry(w, h, 90);
    expect(g.baseA.x + g.baseB.x).toBeCloseTo(w, 6);
    expect(g.baseA.y).toBeCloseTo(h, 6);
    expect(g.baseB.y).toBeCloseTo(h, 6);
  });
});

describe('拖动反推角度', () => {
  it('指针在右侧 → 0°', () => {
    expect(angleFromOffset(10, 0)).toBe(0);
  });

  it('指针在下方 → 90°（屏幕坐标 y 向下）', () => {
    expect(angleFromOffset(0, 10)).toBe(90);
  });

  it('指针在左上 → 225° 附近', () => {
    expect(angleFromOffset(-10, -10)).toBe(225);
  });

  it('指针在圆心不产生 NaN', () => {
    expect(angleFromOffset(0, 0)).toBe(DEFAULT_TAIL_ANGLE);
  });
});
