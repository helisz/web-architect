import { describe, expect, it } from 'vitest';
import { EDGE_DASH_PRESETS, EDGE_DEFAULTS, dashPresetOf } from '../src/constants.js';

describe('连线虚线档位（用户 2026-11-04：实线 / 短虚线 / 长虚线）', () => {
  it('只有三档，默认是实线', () => {
    expect(EDGE_DASH_PRESETS.map((p) => p.label)).toEqual(['实线', '短虚线', '长虚线']);
    expect(EDGE_DEFAULTS.strokeDasharray).toBeNull();
    expect(dashPresetOf(EDGE_DEFAULTS.strokeDasharray)).toBe('solid');
  });

  it('null / 空串 / 全空格都算实线', () => {
    expect(dashPresetOf(null)).toBe('solid');
    expect(dashPresetOf(undefined)).toBe('solid');
    expect(dashPresetOf('')).toBe('solid');
    expect(dashPresetOf('   ')).toBe('solid');
  });

  it('短虚线 / 长虚线按值识别，兼容多余空格与逗号写法', () => {
    expect(dashPresetOf('6 4')).toBe('short');
    expect(dashPresetOf('12 8')).toBe('long');
    expect(dashPresetOf('  6   4 ')).toBe('short');
  });

  it('老数据里的自定义虚线标成 custom，不被当成实线覆盖', () => {
    expect(dashPresetOf('4,4')).toBe('custom');
    expect(dashPresetOf('2 3')).toBe('custom');
    expect(dashPresetOf('12 4 2 4')).toBe('custom');
  });

  it('每个预设的 value 与 key 自洽', () => {
    for (const preset of EDGE_DASH_PRESETS) {
      expect(dashPresetOf(preset.value)).toBe(preset.key);
    }
  });
});
