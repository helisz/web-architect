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

  it('普通节点默认 12px / 500 字重（用户 2026-11-04 第二批）', () => {
    const style = textStyleOf('server');
    expect(style.fontSize).toBe(12);
    expect(style.bold).toBe(false);
    expect(style.weight).toBe(500);
    expect(style.align).toBe('center');
    expect(style.valign).toBe('middle');
  });

  it('标题不加粗时字重掉到 500，但仍比正文大一截', () => {
    const style = textStyleOf('title', { bold: false });
    expect(style.weight).toBe(500);
    expect(style.fontSize).toBe(28);
  });

  it('文本类默认左对齐、从上往下排', () => {
    expect(textStyleOf('sticky')).toMatchObject({ align: 'left', valign: 'top', fontSize: 12 });
    expect(textStyleOf('title')).toMatchObject({ align: 'left', valign: 'middle' });
  });

  it('对齐值可覆盖，非法值回落到类型默认', () => {
    expect(textStyleOf('server', { align: 'right', valign: 'top' })).toMatchObject({ align: 'right', valign: 'top' });
    expect(textStyleOf('server', { align: 'middle', valign: 'left' })).toMatchObject({ align: 'center', valign: 'middle' });
  });

  it('extJson 覆盖默认值', () => {
    const style = textStyleOf('title', { fontSize: 18, bold: false, italic: true, underline: true });
    expect(style).toMatchObject({ fontSize: 18, bold: false, italic: true, underline: true, weight: 500 });
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
    expect(textStyleOf('server', { fontSize: Number.NaN }).fontSize).toBe(12);
  });

  it('布尔字段只认真正的 boolean，其它值回落默认', () => {
    expect(textStyleOf('server', { bold: 'yes' }).bold).toBe(false);
    expect(textStyleOf('title', { bold: 0 }).bold).toBe(true);
  });

  it('单行元素默认 12px / 居中，不带加粗', () => {
    expect(textStyleOf('element')).toMatchObject({
      fontSize: 12,
      bold: false,
      align: 'center',
      valign: 'middle',
    });
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
    expect(textStyleCss(textStyleOf('title', { italic: true, underline: true }))).toEqual({
      fontSize: '28px',
      fontWeight: 700,
      fontStyle: 'italic',
      textDecoration: 'underline',
      textAlign: 'left',
      justifyContent: 'flex-start',
      alignItems: 'center',
    });
  });

  it('不加粗时用类型默认字重（普通节点 500，文本类 400），不继承父级', () => {
    expect(textStyleCss(textStyleOf('server')).fontWeight).toBe(500);
    expect(textStyleCss(textStyleOf('sticky')).fontWeight).toBe(400);
  });

  it('对齐映射成 flex 值', () => {
    const css = textStyleCss(textStyleOf('server', { align: 'right', valign: 'bottom' }));
    expect(css).toMatchObject({ justifyContent: 'flex-end', alignItems: 'flex-end', textAlign: 'right' });
  });
});
