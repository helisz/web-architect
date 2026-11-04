import { describe, expect, it } from 'vitest';
import { BG_LIGHT, BG_SOLID, FONT_COLORS, nearestColor } from '../src/components/ColorField.js';

describe('飞书风格固定色板', () => {
  it('字体 8 色、浅底 8 格（首格透明）、实底 8 色', () => {
    expect(FONT_COLORS).toHaveLength(8);
    expect(BG_LIGHT).toHaveLength(8);
    expect(BG_SOLID).toHaveLength(8);
    expect(BG_LIGHT[0]).toBe('transparent');
    expect(FONT_COLORS[0]).toBe('#000000');
    expect(BG_SOLID[0]).toBe('#E5E6EB');
  });

  it('色板里的颜色都能精确命中自己', () => {
    for (const color of FONT_COLORS) expect(nearestColor(color, FONT_COLORS)).toBe(color);
    for (const color of BG_SOLID) expect(nearestColor(color, BG_SOLID)).toBe(color);
    expect(nearestColor('transparent', BG_LIGHT)).toBe('transparent');
  });

  it('旧数据里的自定义颜色映射到最近的格子（不改数据）', () => {
    // 接近极浅白
    expect(nearestColor('#FFFFFF', BG_LIGHT)).toBe('#F5F6F7');
    // 接近浅天蓝
    expect(nearestColor('#C0CFEE', BG_LIGHT)).toBe('#C5D2EC');
    // 接近正红
    expect(nearestColor('#F04E45', BG_SOLID)).toBe('#F54A45');
    // 3 位缩写也能认
    expect(nearestColor('#000', FONT_COLORS)).toBe('#000000');
  });

  it('无法解析的写法不会崩，只是不高亮', () => {
    expect(nearestColor('rgb(1,2,3)', FONT_COLORS)).toBeNull();
    expect(nearestColor('', BG_SOLID)).toBeNull();
  });
});
