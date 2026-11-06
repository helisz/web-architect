import { useEffect, useRef, useState } from 'react';
import { CLEAR_COLOR } from '@arch/schema';

/**
 * 固定色板（不做色轮、不做自定义取色）。
 *
 * 结构按产品给的"思维导图节点色板"执行，顺序和色值都不要随意调整：
 * 1. 节点背景色：3 行 × 6 格（中性 → 饱和 → 浅马卡龙）；
 *
 * 2026-11-06 改版：整板暖化。饱和行换成同暖度/同饱和度的 6 色（紫/青蓝/橄榄绿/赭黄/橙/砖红），
 * 浅色行是对应的 12% 淡色；中性行也换成暖灰。旧图里存的颜色不改，只是新选色从这里取。
 * 2. 节点边框色：2 行 × 6 格（中性 → 饱和）；
 * 3. 文字颜色：1 行 9 格，色块里带字母 A；
 * 4. 连线颜色：沿用饱和 + 中性，供线条用。
 *
 * `transparent` 只是 UI 的哨兵值（画棋盘格 + 斜杠），真正落到数据里的是
 * `#00000000`：Schema 只收 #RRGGBB(AA)，直接写 CSS 的 `transparent` 会被校验器拒掉。
 */

/** 第 1 行：透明 + 黑白灰 */
const NEUTRALS = ['transparent', '#000000', '#4A4A46', '#CFCEC7', '#F2F1EC', '#FFFFFF'] as const;
/** 第 2 行：饱和色 */
const SATURATED = ['#8F4FBF', '#3C6E9E', '#4F9A46', '#D9A21B', '#FC5D20', '#C4342B'] as const;
/** 第 3 行：浅马卡龙 */
const MACARON = ['#F0E4F7', '#E4ECF5', '#E7F2E4', '#FAF0D8', '#FDE6DB', '#F7E3E1'] as const;

export const NODE_BG_ROWS: readonly (readonly string[])[] = [NEUTRALS, SATURATED, MACARON];
export const NODE_BORDER_ROWS: readonly (readonly string[])[] = [NEUTRALS, SATURATED];

export const FONT_COLORS = [
  '#1A1A18',
  '#77766F',
  '#A3A29A',
  ...SATURATED,
] as const;

/** 连线不分深浅底，只用能看清的两种中性 + 饱和色 */
export const EDGE_COLORS = ['#A9A79E', '#000000', '#CFCEC7', ...SATURATED] as const;

export type ColorScope = 'font' | 'bg' | 'line' | 'edge';
/** 用来决定分组标题里写「节点」还是「分组」 */
export type ColorKind = 'node' | 'group' | 'edge';

export const FLAT_BG = NODE_BG_ROWS.flat();
export const FLAT_BORDER = NODE_BORDER_ROWS.flat();

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i;

function toRgb(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const raw = m[1]!;
  const v =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/**
 * 旧数据里的自定义颜色：挑一个最接近的色板颜色高亮，不改数据本身。
 *
 * 透明有两种存法都要认：UI 哨兵 `transparent`，以及真正落库的 `#00000000`。
 * 后者 alpha 为 00，按"清除"格高亮，不能当成"黑色"。
 */
export function nearestColor(value: string, palette: readonly string[]): string | null {
  const target = value.trim().toLowerCase();
  if (!target || target === 'transparent' || target === 'none' || target === 'clear') {
    return palette.includes('transparent') ? 'transparent' : null;
  }
  if (/^#[0-9a-f]{6}00$/.test(target)) {
    return palette.includes('transparent') ? 'transparent' : null;
  }
  const rgb = toRgb(target);
  if (!rgb) return null;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of palette) {
    if (candidate === 'transparent') continue;
    const c = toRgb(candidate);
    if (!c) continue;
    const distance = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** 哨兵值 → 真正写进 Schema 的值（透明一律是全透明黑，不能是 CSS 的 transparent） */
export function colorToStore(color: string): string {
  return color === 'transparent' ? CLEAR_COLOR : color;
}

/** 透明格：浅灰棋盘 + 一道斜杠，一眼看出是"清除" */
const CLEAR_BG =
  'repeating-conic-gradient(#FFFFFF 0% 25%, #E7E6E1 0% 50%) 0 0 / 7px 7px, linear-gradient(135deg, transparent 44%, #A3A29A 44% 56%, transparent 56%)';

function Swatch({
  color,
  active,
  mode,
  onPick,
  title,
}: {
  color: string;
  active: boolean;
  mode: 'font' | 'block';
  onPick: () => void;
  title: string;
}) {
  const isClear = color === 'transparent';
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onPick}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold leading-none transition ${
        active
          ? 'ring-2 ring-[var(--primary)] ring-offset-1'
          : 'ring-1 ring-black/15 hover:ring-2 hover:ring-black/25'
      }`}
      style={{
        background: isClear ? CLEAR_BG : mode === 'font' ? '#FFFFFF' : color,
      }}
    >
      {mode === 'font' ? <span style={{ color }}>A</span> : null}
    </button>
  );
}

export interface ColorTarget {
  scope: ColorScope;
  value: string;
  onChange: (color: string) => void;
}

interface Section {
  scope: ColorScope;
  title: string;
  rows: readonly (readonly string[])[];
  mode: 'font' | 'block';
  palette: readonly string[];
}

function sectionsFor(kind: ColorKind): Section[] {
  if (kind === 'edge') {
    return [
      { scope: 'edge', title: '线条颜色', rows: [EDGE_COLORS], mode: 'block', palette: EDGE_COLORS },
    ];
  }
  const prefix = kind === 'group' ? '分组' : '节点';
  return [
    { scope: 'bg', title: `${prefix}背景色`, rows: NODE_BG_ROWS, mode: 'block', palette: FLAT_BG },
    { scope: 'line', title: `${prefix}边框色`, rows: NODE_BORDER_ROWS, mode: 'block', palette: FLAT_BORDER },
    { scope: 'font', title: '文字颜色', rows: [FONT_COLORS], mode: 'font', palette: FONT_COLORS },
  ];
}

function swatchTitle(color: string, scope: ColorScope): string {
  if (color !== 'transparent') return color;
  return scope === 'line' ? '透明（清除边框）' : '透明（清除背景）';
}

/**
 * 一个「颜色」按钮管一个对象的所有颜色：点开后气泡里按
 * 【背景色】【边框色】【文字颜色】三组依次铺开，色块为圆形，选中项蓝色圆环。
 */
export function ColorField({ targets, kind = 'node' }: { targets: ColorTarget[]; kind?: ColorKind }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = targets.find((t) => t.scope === 'bg') ?? targets[0];
  const previewIsClear = !preview || preview.value === 'transparent' || /^#[0-9a-fA-F]{6}00$/.test(preview.value.trim());
  const summary =
    kind === 'edge' ? '线条颜色' : kind === 'group' ? '标题 / 背景 / 边框' : '文字 / 背景 / 边框';

  return (
    <div className="mb-3" ref={boxRef}>
      <div className="mb-1 text-[11px] text-[var(--text-secondary)]">颜色</div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs ${
          open ? 'border-[var(--primary)]' : 'border-[var(--panel-border)] hover:border-[var(--primary)]'
        }`}
      >
        <span
          className="grid h-5 w-5 place-items-center rounded-full border border-black/10 text-[12px] font-semibold"
          style={{ background: previewIsClear ? '#fff' : preview.value }}
        >
          <span style={{ color: targets.find((t) => t.scope === 'font')?.value ?? '#000' }}>A</span>
        </span>
        <span className="flex-1 text-[var(--text-secondary)]">{summary}</span>
        <span className="text-[10px] text-[var(--text-secondary)]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-1 w-max min-w-[212px] max-w-[260px] space-y-2.5 rounded-md border border-[var(--panel-border)] bg-white p-2.5 shadow-lg">
          {sectionsFor(kind).map((section) => {
            const target = targets.find((t) => t.scope === section.scope);
            if (!target) return null;
            const active = nearestColor(target.value, section.palette);
            return (
              <div key={section.scope}>
                <div className="mb-1 text-[10px] font-medium text-[var(--text-secondary)]">{section.title}</div>
                <div className="space-y-1">
                  {section.rows.map((row, rowIndex) => (
                    <div key={`${section.scope}-${rowIndex}`} className="flex flex-wrap gap-1.5">
                      {row.map((color) => (
                        <Swatch
                          key={`${section.scope}-${rowIndex}-${color}`}
                          color={color}
                          mode={section.mode}
                          active={active === color}
                          title={swatchTitle(color, section.scope)}
                          onPick={() => target.onChange(colorToStore(color))}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



