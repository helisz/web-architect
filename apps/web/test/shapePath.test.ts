import { describe, expect, it } from 'vitest';
import { NODE_TYPES } from '@arch/schema';
import { SHAPE_NODE_TYPES, isShapeNodeType, shapePath } from '../src/canvas/shapePath.js';

/**
 * 形状路径的守门测试（2026-11-06）。
 *
 * 只校验"能画出来"和"类型列表不跑偏"：路径是否正确、四个边中点是否贴合，
 * 需要真实浏览器算 SVG 几何，留给画布上的肉眼验收。
 */
describe('形状 / 流程图轮廓', () => {
  it('17 个轮廓类型都能生成合法的 SVG path', () => {
    for (const type of SHAPE_NODE_TYPES) {
      const geometry = shapePath(type, 160, 100);
      expect(geometry, `${type} 没有路径`).not.toBeNull();
      expect(geometry!.d.startsWith('M')).toBe(true);
      expect(geometry!.d.trimEnd().endsWith('Z')).toBe(true);
      expect(geometry!.d).not.toMatch(/NaN|undefined/);
      for (const line of geometry!.lines ?? []) {
        expect(line).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('形状类型全部来自 NODE_TYPES，普通节点不会误入轮廓分支', () => {
    for (const type of SHAPE_NODE_TYPES) expect(NODE_TYPES).toContain(type);
    // 2026-11-07 精简：10 个形状 + 2 个流程专属（开始 / 预定义过程）
    expect(SHAPE_NODE_TYPES).toHaveLength(12);
    expect(isShapeNodeType('shape-circle')).toBe(true);
    expect(isShapeNodeType('shape-diamond')).toBe(true);
    // 「判断」现在是组件库预设，落库类型是 shape-diamond，不再是独立类型
    expect(isShapeNodeType('flow-decision')).toBe(false);
    expect(isShapeNodeType('server')).toBe(false);
    expect(isShapeNodeType('line')).toBe(false);
  });

  it('宽高为 0 的脏数据也返回路径而不是 NaN', () => {
    for (const type of SHAPE_NODE_TYPES) {
      const geometry = shapePath(type, 0, 0);
      expect(geometry).not.toBeNull();
      expect(geometry!.d).not.toMatch(/NaN|undefined/);
    }
  });

  it('不认识的类型返回 null', () => {
    expect(shapePath('server', 160, 80)).toBeNull();
  });
});
