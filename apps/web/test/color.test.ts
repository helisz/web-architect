import { describe, expect, it } from 'vitest';
import { CLEAR_COLOR } from '@arch/schema';
import {
  EDGE_COLORS,
  FLAT_BG,
  FLAT_BORDER,
  FONT_COLORS,
  NODE_BG_ROWS,
  NODE_BORDER_ROWS,
  colorToStore,
  nearestColor,
} from '../src/components/ColorField.js';

/**
 * 色板顺序与色值是产品给定的（思维导图节点色板），改版式可以，改顺序/色值要问。
 * 这里把"几行、每行几格、第几格是什么色"全钉住，避免以后调样式时误动数据。
 */
describe('固定色板（新版式）', () => {
  it('背景色 3 行 × 6 格，顺序：中性 → 饱和 → 浅马卡龙', () => {
    expect(NODE_BG_ROWS).toHaveLength(3);
    for (const row of NODE_BG_ROWS) expect(row).toHaveLength(6);
    expect(NODE_BG_ROWS[0]).toEqual(['transparent', '#000000', '#4A4A46', '#CFCEC7', '#F2F1EC', '#FFFFFF']);
    expect(NODE_BG_ROWS[1]).toEqual(['#8F4FBF', '#3C6E9E', '#4F9A46', '#D9A21B', '#FC5D20', '#C4342B']);
    expect(NODE_BG_ROWS[2]).toEqual(['#F0E4F7', '#E4ECF5', '#E7F2E4', '#FAF0D8', '#FDE6DB', '#F7E3E1']);
  });

  it('边框色 2 行 × 6 格，首格是"清除边框"', () => {
    expect(NODE_BORDER_ROWS).toHaveLength(2);
    for (const row of NODE_BORDER_ROWS) expect(row).toHaveLength(6);
    expect(NODE_BORDER_ROWS[0]).toEqual(['transparent', '#000000', '#4A4A46', '#CFCEC7', '#F2F1EC', '#FFFFFF']);
    expect(NODE_BORDER_ROWS[1]).toEqual(['#8F4FBF', '#3C6E9E', '#4F9A46', '#D9A21B', '#FC5D20', '#C4342B']);
  });

  it('文字颜色 1 行 9 格，默认第一个', () => {
    expect(FONT_COLORS).toEqual([
      '#1A1A18',
      '#77766F',
      '#A3A29A',
      '#8F4FBF',
      '#3C6E9E',
      '#4F9A46',
      '#D9A21B',
      '#FC5D20',
      '#C4342B',
    ]);
  });

  it('连线色板不含透明（线必须有颜色）', () => {
    expect(EDGE_COLORS).not.toContain('transparent');
    expect(EDGE_COLORS).toContain('#8F4FBF');
  });

  it('拍平后的色板长度对得上，且没有重复格', () => {
    expect(FLAT_BG).toHaveLength(18);
    expect(FLAT_BORDER).toHaveLength(12);
    expect(new Set(FLAT_BG).size).toBe(18);
    expect(new Set(FLAT_BORDER).size).toBe(12);
  });
});

describe('nearestColor', () => {
  it('色板里的颜色都能精确命中自己', () => {
    for (const color of FONT_COLORS) expect(nearestColor(color, FONT_COLORS)).toBe(color);
    for (const color of FLAT_BG) expect(nearestColor(color, FLAT_BG)).toBe(color);
    for (const color of FLAT_BORDER) expect(nearestColor(color, FLAT_BORDER)).toBe(color);
  });

  it('透明写法都归到 transparent 那一格', () => {
    expect(nearestColor('transparent', FLAT_BG)).toBe('transparent');
    expect(nearestColor('none', FLAT_BORDER)).toBe('transparent');
    expect(nearestColor('', FLAT_BG)).toBe('transparent');
  });

  it('旧数据里的自定义颜色映射到最近的格子（不改数据）', () => {
    // 旧面板的浅灰底色 → 新的极浅灰
    expect(nearestColor('#F5F6F7', FLAT_BG)).toBe('#F2F1EC');
    // 浅蓝底 → 新的浅马卡龙蓝
    expect(nearestColor('#E3EDFF', FLAT_BG)).toBe('#E4ECF5');
    // 旧的卡片蓝 #C5D2EC 在 RGB 距离上其实更接近中性灰，按最近原则落在浅灰格
    expect(nearestColor('#C5D2EC', FLAT_BG)).toBe('#CFCEC7');
    // 旧红色 → 新橙（#F54A45 在 RGB 距离上离橙比离砖红更近）
    expect(nearestColor('#F54A45', FLAT_BG)).toBe('#FC5D20');
    // 3 位缩写也能认
    expect(nearestColor('#000', FONT_COLORS)).toBe('#1A1A18');
    expect(nearestColor('#000', FLAT_BG)).toBe('#000000');
  });

  it('无法解析的写法不会崩，只是不高亮', () => {
    expect(nearestColor('rgb(1,2,3)', FONT_COLORS)).toBeNull();
    expect(nearestColor('hsl(0 0% 0%)', FLAT_BG)).toBeNull();
  });

  it('边框色板里没有的颜色会落到最近的格子', () => {
    // 旧边框墨绿 #10B981 → 最近的是新绿 #22C55E
    expect(nearestColor('#2E9E5B', FLAT_BORDER)).toBe('#4F9A46');
  });

  /* 透明：UI 用哨兵，数据用 #00000000，两边都要认 */
  it('清除格落到数据里是 #00000000，绝不是 CSS 的 transparent', () => {
    expect(colorToStore('transparent')).toBe('#00000000');
    expect(colorToStore('#FC5D20')).toBe('#FC5D20');
    expect(colorToStore(CLEAR_COLOR)).toBe('#00000000');
  });

  it('#00000000 反过来高亮到"清除"格，而不是黑色', () => {
    expect(CLEAR_COLOR).toBe('#00000000');
    expect(nearestColor('#00000000', FLAT_BG)).toBe('transparent');
    expect(nearestColor('#FFFFFF00', FLAT_BORDER)).toBe('transparent');
    // 不透明黑仍然高亮黑格
    expect(nearestColor('#000000', FLAT_BG)).toBe('#000000');
  });
});


