import { describe, expect, it } from 'vitest';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  parseFontSize,
  textStyleCss,
  textStyleOf,
  withTextStyle,
} from '../src/textStyle.js';

describe('textStyleOf', () => {
  it('标题默认 28px 加粗（用户 2026-11-04 拍板：全部 28px）', () => {
    const style = textStyleOf('title');
    expect(style.fontSize).toBe(28);
    expect(style.bold).toBe(true);
    expect(style.italic).toBe(false);
    expect(style.underline).toBe(false);
  });

  it('普通节点默认 13px 不加粗', () => {
    const style = textStyleOf('server');
    expect(style.fontSize).toBe(13);
    expect(style.bold).toBe(false);
  });

  it('extJson 覆盖默认值', () => {
    const style = textStyleOf('title', { fontSize: 18, bold: false, italic: true, underline: true });
    expect(style).toEqual({ fontSize: 18, bold: false, italic: true, underline: true });
  });

  it('字号越界会被夹到 8–72', () => {
    expect(textStyleOf('server', { fontSize: 4 }).fontSize).toBe(FONT_SIZE_MIN);
    expect(textStyleOf('server', { fontSize: 400 }).fontSize).toBe(FONT_SIZE_MAX);
  });

  it('字号是字符串（老数据 / 手写 JSON）也能认', () => {
    expect(textStyleOf('server', { fontSize: '20' }).fontSize).toBe(20);
  });

  it('非法字号回落到类型默认，不返回 NaN', () => {
    expect(textStyleOf('title', { fontSize: 'abc' }).fontSize).toBe(28);
    expect(textStyleOf('server', { fontSize: Number.NaN }).fontSize).toBe(13);
  });

  it('布尔字段只认真正的 boolean，其它值回落默认', () => {
    expect(textStyleOf('server', { bold: 'yes' }).bold).toBe(false);
    expect(textStyleOf('title', { bold: 0 }).bold).toBe(true);
  });

  it('单行元素默认 13px，不带加粗', () => {
    expect(textStyleOf('element')).toMatchObject({ fontSize: 13, bold: false });
  });
});

describe('parseFontSize', () => {
  it('整数原样返回，小数取整', () => {
    expect(parseFontSize('18')).toBe(18);
    expect(parseFontSize('18.6')).toBe(19);
  });

  it('空串 / 非数字返回 null（调用方保持原值，避免输入过程被清空）', () => {
    expect(parseFontSize('')).toBeNull();
    expect(parseFontSize('  ')).toBeNull();
    expect(parseFontSize('px')).toBeNull();
  });

  it('越界也夹到区间内', () => {
    expect(parseFontSize('1')).toBe(FONT_SIZE_MIN);
    expect(parseFontSize('999')).toBe(FONT_SIZE_MAX);
  });
});

describe('withTextStyle', () => {
  it('保留 extJson 里的其它键（iconKey 等）', () => {
    const next = withTextStyle({ iconKey: 'tabler:server', iconHidden: true }, { fontSize: 16 });
    expect(next).toEqual({ iconKey: 'tabler:server', iconHidden: true, fontSize: 16 });
  });

  it('extJson 为空也能用', () => {
    expect(withTextStyle(undefined, { bold: true })).toEqual({ bold: true });
  });
});

describe('textStyleCss', () => {
  it('转成可直接用的内联样式', () => {
    expect(textStyleCss({ fontSize: 28, bold: true, italic: true, underline: true })).toEqual({
      fontSize: '28px',
      fontWeight: 700,
      fontStyle: 'italic',
      textDecoration: 'underline',
    });
  });

  it('不加粗时是 400，而不是继承父级', () => {
    expect(textStyleCss({ fontSize: 13, bold: false, italic: false, underline: false }).fontWeight).toBe(400);
  });
});
