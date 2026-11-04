import { describe, expect, it } from 'vitest';
import { frameFromBounds } from '../src/export/exportPng.js';

describe('PNG 导出取景', () => {
  it('四周各留 40px，画布尺寸按内容 + 边距', () => {
    const frame = frameFromBounds({ x: 100, y: 50, width: 300, height: 200 }, 40);
    expect(frame.width).toBe(380);
    expect(frame.height).toBe(280);
    // 内容左上角被平移到 (40, 40)
    expect(frame.transform).toBe('translate(-60px, -10px) scale(1)');
  });

  it('负坐标也能完整入图（画布往左上方扩）', () => {
    const frame = frameFromBounds({ x: -68, y: -204, width: 1200, height: 700 }, 40);
    expect(frame.width).toBe(1280);
    expect(frame.height).toBe(780);
    expect(frame.transform).toBe('translate(108px, 244px) scale(1)');
  });

  it('小数尺寸向上取整，避免最后一行像素被裁', () => {
    const frame = frameFromBounds({ x: 0, y: 0, width: 100.2, height: 60.7 }, 40);
    expect(frame.width).toBe(181);
    expect(frame.height).toBe(141);
  });

  it('边距为 0 时就是内容本身', () => {
    const frame = frameFromBounds({ x: 10, y: 10, width: 100, height: 100 }, 0);
    expect(frame.width).toBe(100);
    expect(frame.height).toBe(100);
    expect(frame.transform).toBe('translate(-10px, -10px) scale(1)');
  });
});
