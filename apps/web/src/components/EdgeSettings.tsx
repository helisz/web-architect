import { useEffect, useRef, useState } from 'react';
import { EDGE_DEFAULTS, EDGE_TYPES } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 连线全局配置（线型 + 线宽）。
 *
 * 改的是"以后新建的线"的默认值；已有连线要统一的话点"应用到全部连线"。
 * 选择记在 localStorage，刷新后还在。
 */
export function EdgeSettings() {
  const edgeDefaults = useDiagramStore((s) => s.edgeDefaults);
  const setEdgeDefaults = useDiagramStore((s) => s.setEdgeDefaults);
  const applyAll = useDiagramStore((s) => s.applyEdgeDefaultsToAll);
  const edgeCount = useDiagramStore((s) => s.diagram.edges.length);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="连线全局配置（只影响新建的线）"
        className={`rounded border px-2.5 py-1 text-xs ${
          open
            ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
            : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[#F9FAFB]'
        }`}
      >
        连线设置
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-40 w-56 rounded-lg border border-[var(--panel-border)] bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] font-semibold text-[var(--text-secondary)]">新建连线的默认样式</p>

          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">线型</label>
          <select
            value={edgeDefaults.edgeType}
            onChange={(e) => setEdgeDefaults({ edgeType: e.target.value as typeof edgeDefaults.edgeType })}
            className="mb-2 w-full rounded border border-[var(--panel-border)] px-2 py-1 text-xs"
          >
            {EDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t === 'ortho' ? '正交折线' : t === 'bezier' ? '贝塞尔曲线' : '直线'}
              </option>
            ))}
          </select>

          <label className="mb-1 block text-[11px] text-[var(--text-secondary)]">
            线宽 <span className="mono">{edgeDefaults.strokeWidth}px</span>
          </label>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={edgeDefaults.strokeWidth}
            onChange={(e) => setEdgeDefaults({ strokeWidth: Number(e.target.value) })}
            className="mb-3 w-full"
          />

          <button
            type="button"
            disabled={edgeCount === 0}
            onClick={() => {
              applyAll();
              setOpen(false);
            }}
            className="w-full rounded border border-[var(--panel-border)] px-2 py-1 text-[11px] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-40"
          >
            应用到全部 {edgeCount} 条连线
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
            默认：灰 #6B7280 / {EDGE_DEFAULTS.strokeWidth}px / 无箭头
          </p>
        </div>
      )}
    </div>
  );
}
