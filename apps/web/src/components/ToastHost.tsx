import { useEffect } from 'react';
import { useDiagramStore, type ToastItem, type ToastKind } from '../store/useDiagramStore.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 一次性提示（toast）。
 *
 * 用户 2026-11-04 定稿：`提醒 / 报错` 这类**说完就完**的信息走 toast；
 * 需要人做决定的（版本冲突、跟随者、保存不可用）仍然用顶部 banner。
 *
 * 位置选在画布底部居中：顶部有 banner，左下是状态条，右下是 MiniMap，只有这里不打架。
 */
const TONE: Record<ToastKind, { box: string; icon: 'close' | 'database' | 'history' }> = {
  // 2026-11-07：所有浮层统一半透明 —— toast 保留语义色，只把底色降到 70% + 高斯模糊
  info: { box: 'border-[#BAE6FD]/70 bg-[#F0F9FF]/70 text-[#075985]', icon: 'history' },
  success: { box: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-700', icon: 'history' },
  error: { box: 'border-[#F5C2C7]/70 bg-[#FEF3F2]/70 text-[#B42318]', icon: 'close' },
};

const LIFETIME_MS: Record<ToastKind, number> = { info: 4000, success: 3500, error: 7000 };

function ToastRow({ toast }: { toast: ToastItem }) {
  const dismissToast = useDiagramStore((s) => s.dismissToast);
  const tone = TONE[toast.kind];

  useEffect(() => {
    const handle = setTimeout(() => dismissToast(toast.id), LIFETIME_MS[toast.kind]);
    return () => clearTimeout(handle);
  }, [toast.id, toast.kind, dismissToast]);

  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`anim-pop pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-md border px-3 py-2 text-[12px] leading-5 shadow-sm backdrop-blur-[20px] backdrop-saturate-150 ${tone.box}`}
    >
      <span className="min-w-0 flex-1">{toast.text}</span>
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        title="关闭提示"
        aria-label="关闭提示"
        className="-mr-1 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded opacity-60 hover:opacity-100"
      >
        <ToolIcon name="close" size={12} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useDiagramStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-8 left-1/2 z-50 flex w-[min(92vw,560px)] -translate-x-1/2 flex-col items-center gap-2"
    >
      {toasts.slice(-4).map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
