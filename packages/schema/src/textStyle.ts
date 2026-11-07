import type { NodeType } from './types.js';

/**
 * 节点文字样式（用户 2026-11-04 拍板，2026-11-04 第二批调整）。
 *
 * 存在 `extJson` 里（`fontSize` / `bold` / `italic` / `underline` / `align` / `valign`），
 * 不加数据库列：ext_json 本来就在保存/差异/回滚链路里完整往返，加列反而要重跑 SQL。
 *
 * 取值规则：`extJson` 里有合法值就用，否则回落到**按 nodeType 的默认**：
 * - 普通节点 **12px / 500 字重**（用户："节点标题 12px 500 字重"）
 * - 文本节点里的「标题」仍是 28px 加粗（上一批拍板的"全部 28px"只针对标题类）
 * - 副文本更小一号（10px，等宽字体），由组件各自指定，不走这里
 */

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;

/** 字重：常规 400 / 中等 500 / 加粗 700（B 按钮只管 700 与类型默认之间切换） */
export type FontWeight = 400 | 500 | 700;

/** 水平对齐 */
export type TextAlign = 'left' | 'center' | 'right';
/** 垂直对齐 */
export type TextVAlign = 'top' | 'middle' | 'bottom';

export interface TextStyle {
  fontSize: number;
  /** 是否加粗（B 按钮）；实际字重见 weight */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** 最终生效的字重：加粗 = 700，否则用类型的默认字重 */
  weight: FontWeight;
  align: TextAlign;
  valign: TextVAlign;
}

interface TypeDefault extends Partial<Omit<TextStyle, 'weight'>> {
  weight?: FontWeight;
}

/** 按节点类型的默认文字样式 */
const DEFAULTS: Partial<Record<NodeType, TypeDefault>> = {
  // 标题：大号加粗，左对齐、垂直居中（保持既有观感）
  // 标题默认加粗（→700）；取消加粗后落到常规文本的 500
  title: { fontSize: 28, bold: true, weight: 500, align: 'left', valign: 'middle' },
  // 文本类：左对齐、从顶部排（便利贴/注释/纯文本都是"写内容"的）
  text: { fontSize: 12, weight: 400, align: 'left', valign: 'middle' },
  sticky: { fontSize: 12, weight: 400, align: 'left', valign: 'top' },
  annotation: { fontSize: 12, weight: 400, align: 'left', valign: 'top' },
  // 单行元素与所有图形节点：12px / 500，水平垂直都居中
  element: { fontSize: 12, align: 'center', valign: 'middle' },
  // 水平单行元素：图标在左，默认左对齐（对齐按钮会把图标和文字当成一个整体）
  'element-h': { fontSize: 12, align: 'left', valign: 'middle' },
};

const BASE: Required<Omit<TextStyle, 'weight'>> & { weight: FontWeight } = {
  fontSize: 12,
  bold: false,
  italic: false,
  underline: false,
  weight: 500,
  align: 'center',
  valign: 'middle',
};

function clampSize(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return BASE.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, rounded));
}

const ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];
const VALIGNS: readonly TextVAlign[] = ['top', 'middle', 'bottom'];

/** 取某个对象实际生效的文字样式 */
export function textStyleOf(
  nodeType: NodeType | string,
  extJson?: Record<string, unknown>,
): TextStyle {
  const defaults = { ...BASE, ...(DEFAULTS[nodeType as NodeType] ?? {}) };
  const raw = extJson?.fontSize;
  const fontSize =
    typeof raw === 'number' && Number.isFinite(raw)
      ? clampSize(raw)
      : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
        ? clampSize(Number(raw))
        : defaults.fontSize;
  const bold = typeof extJson?.bold === 'boolean' ? extJson.bold : defaults.bold;
  const rawAlign = extJson?.align;
  const rawVAlign = extJson?.valign;
  return {
    fontSize,
    bold,
    italic: typeof extJson?.italic === 'boolean' ? extJson.italic : defaults.italic,
    underline: typeof extJson?.underline === 'boolean' ? extJson.underline : defaults.underline,
    // 加粗永远覆盖默认字重；不加粗时用类型默认（普通节点 500，文本类 400）
    weight: bold ? 700 : (defaults.weight ?? 400),
    align: ALIGNS.includes(rawAlign as TextAlign) ? (rawAlign as TextAlign) : defaults.align,
    valign: VALIGNS.includes(rawVAlign as TextVAlign)
      ? (rawVAlign as TextVAlign)
      : defaults.valign,
  };
}

/** 解析面板输入的字号：非法值返回 null（调用方保持原样） */
export function parseFontSize(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return clampSize(value);
}

/** 样式改动允许写的键（避免把 iconKey 之类冲掉，也只收认识的字段） */
export type TextStylePatch = Partial<
  Pick<TextStyle, 'fontSize' | 'bold' | 'italic' | 'underline' | 'align' | 'valign'>
>;

/** 把面板上的改动合并进 extJson（保留 iconKey 等其它键） */
export function withTextStyle(
  extJson: Record<string, unknown> | undefined,
  patch: TextStylePatch,
): Record<string, unknown> {
  return { ...(extJson ?? {}), ...patch };
}

/** CSS 用的字体样式：组件里直接 spread，避免 Tailwind 拿不到动态字号 */
export function textStyleCss(style: TextStyle): {
  fontSize: string;
  fontWeight: number;
  fontStyle: 'italic' | 'normal';
  textDecoration: string;
  textAlign: TextAlign;
  justifyContent: 'flex-start' | 'center' | 'flex-end';
  alignItems: 'flex-start' | 'center' | 'flex-end';
} {
  return {
    fontSize: `${style.fontSize}px`,
    fontWeight: style.weight,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textAlign: style.align,
    justifyContent: horizontalToFlex(style.align),
    alignItems: verticalToFlex(style.valign),
  };
}

export function horizontalToFlex(align: TextAlign): 'flex-start' | 'center' | 'flex-end' {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
}

export function verticalToFlex(valign: TextVAlign): 'flex-start' | 'center' | 'flex-end' {
  return valign === 'top' ? 'flex-start' : valign === 'bottom' ? 'flex-end' : 'center';
}
