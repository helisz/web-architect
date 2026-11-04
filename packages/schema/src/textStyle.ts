import type { NodeType } from './types.js';

/**
 * 节点文字样式（用户 2026-11-04 拍板）。
 *
 * 存在 `extJson` 里（`fontSize` / `bold` / `italic` / `underline`），不加数据库列：
 * ext_json 本来就在保存/差异/回滚链路里完整往返，加列反而要重跑 SQL。
 *
 * 取值规则：`extJson` 里有合法值就用，否则回落到**按 nodeType 的默认**——
 * 标题默认 28px 加粗（用户明确要求"全部 28px"），其余按原来的视觉尺寸，
 * 这样老图里没存过字号的对象也能拿到确定值，行为可预测。
 */

export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 72;

/** 字号阶梯（属性面板上的快捷档位；也接受手输） */
export const FONT_SIZE_PRESETS = [12, 14, 16, 20, 24, 28, 32, 40] as const;

export interface TextStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** 按节点类型的默认文字样式：标题 28px 加粗，其余保持原来的观感 */
const DEFAULTS: Partial<Record<NodeType, Partial<TextStyle>>> = {
  title: { fontSize: 28, bold: true },
  text: { fontSize: 13 },
  sticky: { fontSize: 13 },
  annotation: { fontSize: 12 },
  element: { fontSize: 13 },
};

const BASE: TextStyle = { fontSize: 13, bold: false, italic: false, underline: false };

function clampSize(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return BASE.fontSize;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, rounded));
}

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
  return {
    fontSize,
    bold: typeof extJson?.bold === 'boolean' ? extJson.bold : defaults.bold,
    italic: typeof extJson?.italic === 'boolean' ? extJson.italic : defaults.italic,
    underline: typeof extJson?.underline === 'boolean' ? extJson.underline : defaults.underline,
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

/** 把面板上的改动合并进 extJson（保留 iconKey 等其它键） */
export function withTextStyle(
  extJson: Record<string, unknown> | undefined,
  patch: Partial<TextStyle>,
): Record<string, unknown> {
  return { ...(extJson ?? {}), ...patch };
}

/** CSS 用的字体样式：组件里直接 spread，避免 Tailwind 拿不到动态字号 */
export function textStyleCss(style: TextStyle): {
  fontSize: string;
  fontWeight: number;
  fontStyle: 'italic' | 'normal';
  textDecoration: string;
} {
  return {
    fontSize: `${style.fontSize}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
  };
}
