/**
 * 「新建」时的两条路（用户 2026-11-05）：空白画布 / AI 解析一张已有的图。
 *
 * 为什么做成弹窗而不是两个按钮：图库里「新建架构图」是主操作，裂成两个按钮会
 * 让最常用的"空白"多花一次点击；弹窗里默认聚焦空白，回车就走老路。
 */

import { useEffect } from 'react';

export type NewDiagramChoice = 'blank' | 'ai';

export function NewDiagramDialog({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (choice: NewDiagramChoice) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="anim-backdrop fixed inset-0 z-50 grid place-items-center bg-black/30"
      role="dialog"
      aria-modal
      aria-label="新建架构图"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="anim-window w-[520px] rounded-lg bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold">新建架构图</p>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          空白画布从零开始；AI 解析会把上传的架构图还原成可编辑的节点和连线。
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            autoFocus
            onClick={() => onChoose('blank')}
            className="group rounded-lg border border-[var(--panel-border)] p-3 text-left hover:border-[var(--primary)] hover:bg-[var(--accent-50)]"
          >
            <span className="mb-1.5 grid h-8 w-8 place-items-center rounded border border-[var(--panel-border)] text-[var(--text-secondary)] group-hover:border-[var(--primary)] group-hover:text-[var(--primary)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M4 4h16v16H4z" />
                <path d="M12 8v8M8 12h8" />
              </svg>
            </span>
            <span className="block text-[13px] font-medium">空白画布</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-secondary)]">
              从组件库拖节点，自己画（和以前一样）
            </span>
          </button>

          <button
            type="button"
            onClick={() => onChoose('ai')}
            className="group rounded-lg border border-[var(--panel-border)] p-3 text-left hover:border-[var(--primary)] hover:bg-[var(--accent-50)]"
          >
            <span className="mb-1.5 grid h-8 w-8 place-items-center rounded border border-[var(--panel-border)] text-[var(--text-secondary)] group-hover:border-[var(--primary)] group-hover:text-[var(--primary)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6z" />
                <path d="M17.5 14l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
              </svg>
            </span>
            <span className="block text-[13px] font-medium">AI 解析架构图</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-secondary)]">
              上传/粘贴一张架构图，识别成可编辑的节点和连线
            </span>
          </button>
        </div>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
