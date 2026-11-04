import { useEffect, useRef, useState } from 'react';

/**
 * 飞书风格的固定色板（不做色轮、不做自定义取色）。
 *
 * 三批颜色：
 * 1. 字体色：8 个深色，色块里带字母 A；
 * 2. 背景 · 浅底：第一格是 transparent（清除背景）；
 * 3. 背景 · 实底：8 个饱和色。
 */
export const FONT_COLORS = [
  '#000000',
  '#868686',
  '#D83931',
  '#DE7802',
  '#DC9B04',
  '#2EA121',
  '#245BDB',
  '#6425D0',
] as const;

export const BG_LIGHT = [
  'transparent',
  '#F5F6F7',
  '#FBBFBC',
  '#FED4A4',
  '#FFF67A',
  '#B7EDB1',
  '#C5D2EC',
  '#E0D9F2',
] as const;

export const BG_SOLID = [
  '#E5E6EB',
  '#A9AEB8',
  '#F54A45',
  '#FF8822',
  '#FFD600',
  '#39B54A',
  '#64A5FF',
  '#9D65E0',
] as const;

export type ColorRow = 'font' | 'light' | 'solid';
export type ColorScope = 'font' | 'bg' | 'line' | 'edge';

const ROWS_OF: Record<ColorScope, ColorRow[]> = {
  font: ['font'],
  bg: ['light', 'solid'],
  line: ['light', 'solid'],
  edge: ['solid'],
};

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

/** 旧数据里的自定义颜色：挑一个最接近的色板颜色高亮，不改数据本身 */
export function nearestColor(value: string, palette: readonly string[]): string | null {
  const target = value.trim().toLowerCase();
  if (!target || target === 'transparent' || target === 'none') {
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
      className={`grid h-6 w-6 place-items-center rounded-[3px] border text-[13px] font-semibold leading-none transition ${
        active
          ? 'border-[#245BDB] ring-2 ring-[#245BDB]/35'
          : 'border-black/10 hover:border-black/25 hover:ring-1 hover:ring-black/10'
      }`}
      style={{
        background: isClear
          ? 'repeating-linear-gradient(45deg, #fff 0 4px, #EDEFF2 4px 8px)'
          : color,
        color: mode === 'font' ? color : undefined,
      }}
    >
      {mode === 'font' ? (
        <span style={{ color }}>A</span>
      ) : isClear ? (
        <span className="text-[11px] text-[#B0B4BB]">／</span>
      ) : null}
    </button>
  );
}

export interface ColorTarget {
  scope: ColorScope;
  value: string;
  onChange: (color: string) => void;
}

function colorOfRow(row: ColorRow): readonly string[] {
  if (row === 'font') return FONT_COLORS;
  return row === 'light' ? BG_LIGHT : BG_SOLID;
}

function rowLabel(scope: ColorScope, row: ColorRow): string {
  if (row === 'font') return '字体颜色';
  if (scope === 'line') return row === 'light' ? '边框 · 浅底' : '边框 · 实底';
  if (scope === 'edge') return '线条颜色';
  return row === 'light' ? '背景 · 浅底' : '背景 · 实底';
}

/**
 * 一个「颜色」按钮管一个对象的所有颜色（字体 / 背景 / 边框或线条）：
 * 点开后气泡里从上到下依次是字体色、背景浅底、背景实底、边框浅底、边框实底。
 */
export function ColorField({ targets }: { targets: ColorTarget[] }) {
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
  const summary = targets.every((t) => t.scope === 'edge') ? '线条颜色' : '字体 / 背景 / 边框';

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
          className="grid h-5 w-5 place-items-center rounded-[3px] border border-black/10 text-[12px] font-semibold"
          style={{
            background:
              preview?.scope === 'bg' && preview.value !== 'transparent' ? preview.value : '#fff',
          }}
        >
          <span style={{ color: targets.find((t) => t.scope === 'font')?.value ?? '#000' }}>A</span>
        </span>
        <span className="flex-1 text-[var(--text-secondary)]">{summary}</span>
        <span className="text-[10px] text-[var(--text-secondary)]">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-1 space-y-2 rounded-md border border-[var(--panel-border)] bg-white p-2 shadow-lg">
          {targets.flatMap((target) =>
            ROWS_OF[target.scope].map((row) => {
              const palette = colorOfRow(row);
              const active = nearestColor(target.value, palette);
              return (
                <div key={`${target.scope}-${row}`}>
                  <div className="mb-1 text-[10px] text-[var(--text-secondary)]">{rowLabel(target.scope, row)}</div>
                  <div className="grid grid-cols-8 gap-1">
                    {palette.map((color) => (
                      <Swatch
                        key={color}
                        color={color}
                        mode={row === 'font' ? 'font' : 'block'}
                        active={active === color}
                        title={color === 'transparent' ? '透明（清除背景）' : color}
                        onPick={() => target.onChange(color)}
                      />
                    ))}
                  </div>
                </div>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}
