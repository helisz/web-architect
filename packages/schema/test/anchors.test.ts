import { describe, expect, it } from 'vitest';
import { ANCHOR_MID, anchorPoint, projectToAnchor, readEdgeAnchorAt } from '../src/index.js';

const rect = { x: 100, y: 50, width: 200, height: 80 };

describe('连线端点沿边位置（2026-11-08）', () => {
  it('不传比例时就是四边中点（老数据行为不变）', () => {
    expect(anchorPoint(rect, 'top')).toEqual({ x: 200, y: 50 });
    expect(anchorPoint(rect, 'right')).toEqual({ x: 300, y: 90 });
    expect(ANCHOR_MID).toBe(0.5);
  });

  it('按比例取边上的点：上下边沿 x、左右边沿 y', () => {
    expect(anchorPoint(rect, 'top', 0.25)).toEqual({ x: 150, y: 50 });
    expect(anchorPoint(rect, 'bottom', 1)).toEqual({ x: 300, y: 130 });
    expect(anchorPoint(rect, 'left', 0.5)).toEqual({ x: 100, y: 90 });
    expect(anchorPoint(rect, 'right', 0)).toEqual({ x: 300, y: 50 });
  });

  it('脏比例会被夹到 0..1', () => {
    expect(anchorPoint(rect, 'top', -3)).toEqual({ x: 100, y: 50 });
    expect(anchorPoint(rect, 'top', 9)).toEqual({ x: 300, y: 50 });
    expect(anchorPoint(rect, 'top', Number.NaN)).toEqual({ x: 200, y: 50 });
  });

  it('投影：按最近的边吸附，并吸到 10px 网格', () => {
    // 点在顶部附近偏左 → top 边，x 吸到 150
    expect(projectToAnchor(rect, { x: 152, y: 44 })).toEqual({ anchor: 'top', at: 0.25 });
    // 点在右侧附近偏下 → right 边，y 吸到 120
    expect(projectToAnchor(rect, { x: 312, y: 118 })).toEqual({ anchor: 'right', at: 0.875 });
  });

  it('投影落在角上时比例是 0 或 1，不会越界', () => {
    const corner = projectToAnchor(rect, { x: -20, y: -20 });
    expect(corner.anchor).toBe('top');
    expect(corner.at).toBe(0);
  });

  it('读 extJson 里的比例：缺失/脏数据回落中点', () => {
    expect(readEdgeAnchorAt(undefined, 'source')).toBe(0.5);
    expect(readEdgeAnchorAt({ sourceAt: 0.25 }, 'source')).toBe(0.25);
    expect(readEdgeAnchorAt({ sourceAt: 'x' }, 'source')).toBe(0.5);
    expect(readEdgeAnchorAt({ targetAt: 2 }, 'target')).toBe(1);
  });
});
