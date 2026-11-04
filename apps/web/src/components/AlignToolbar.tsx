import { useDiagramStore } from '../store/useDiagramStore.js';
import type { AlignMode } from '../canvas/align.js';

/**
 * 对齐与分布工具条（阶段 2 第 2 项）。
 *
 * 选中 ≥2 个元素时出现在画布顶部中间；连线和单个元素不显示，
 * 因为没有"对齐一个东西"这回事。
 */

const ALIGN: { mode: AlignMode; label: string; icon: JSX.Element }[] = [
  {
    mode: 'left',
    label: '左对齐',
    icon: (
      <g>
        <path d="M3 3v18" />
        <rect x="7" y="5" width="10" height="5" />
        <rect x="7" y="14" width="14" height="5" />
      </g>
    ),
  },
  {
    mode: 'centerX',
    label: '水平居中',
    icon: (
      <g>
        <path d="M12 3v18" />
        <rect x="5" y="5" width="14" height="5" />
        <rect x="8" y="14" width="8" height="5" />
      </g>
    ),
  },
  {
    mode: 'right',
    label: '右对齐',
    icon: (
      <g>
        <path d="M21 3v18" />
        <rect x="7" y="5" width="10" height="5" />
        <rect x="3" y="14" width="14" height="5" />
      </g>
    ),
  },
  {
    mode: 'top',
    label: '顶对齐',
    icon: (
      <g>
        <path d="M3 3h18" />
        <rect x="5" y="7" width="5" height="10" />
        <rect x="14" y="7" width="5" height="14" />
      </g>
    ),
  },
  {
    mode: 'centerY',
    label: '垂直居中',
    icon: (
      <g>
        <path d="M3 12h18" />
        <rect x="5" y="5" width="5" height="14" />
        <rect x="14" y="8" width="5" height="8" />
      </g>
    ),
  },
  {
    mode: 'bottom',
    label: '底对齐',
    icon: (
      <g>
        <path d="M3 21h18" />
        <rect x="5" y="7" width="5" height="10" />
        <rect x="14" y="3" width="5" height="14" />
      </g>
    ),
  },
];

export function AlignToolbar() {
  const count = useDiagramStore((s) => s.selectedIds.length);
  const alignSelection = useDiagramStore((s) => s.alignSelection);
  const distributeSelection = useDiagramStore((s) => s.distributeSelection);

  if (count < 2) return null;

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-[var(--panel-border)] bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="mr-1 px-1 text-[11px] text-[var(--text-secondary)]">已选 {count}</span>
      {ALIGN.map(({ mode, label, icon }) => (
        <button
          key={mode}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => alignSelection(mode)}
          className="grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            {icon}
          </svg>
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-[var(--panel-border)]" />
      <button
        type="button"
        title="水平等距分布（≥3 个）"
        aria-label="水平等距分布"
        disabled={count < 3}
        onClick={() => distributeSelection('horizontal')}
        className="grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 4v16M21 4v16" />
          <rect x="6" y="7" width="4" height="10" />
          <rect x="14" y="7" width="4" height="10" />
        </svg>
      </button>
      <button
        type="button"
        title="垂直等距分布（≥3 个）"
        aria-label="垂直等距分布"
        disabled={count < 3}
        onClick={() => distributeSelection('vertical')}
        className="grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 3h16M4 21h16" />
          <rect x="7" y="6" width="10" height="4" />
          <rect x="7" y="14" width="10" height="4" />
        </svg>
      </button>
    </div>
  );
}
