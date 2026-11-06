import { useState } from 'react';
import { clearGuestData, guestDiagramCount, loadAllGuestDiagrams, markGuestImportAsked } from '../data/guestRepo.js';
import { saveDiagram } from '../data/diagramRepo.js';
import { reissueIds } from '../data/transfer.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 登录后询问：要不要把游客期间画的图导入账号（用户 2026-11-05）。
 *
 * 为什么要重编 id：游客图是在本机生成的，万一和云端已有的 id 撞上，
 * `arch_save_diagram` 会当成"更新别人的图"直接失败。复用导入 JSON 的那套
 * `reissueIds`（分组/节点/连线全部换新，引用一并改写）。
 *
 * 导入成功才清空本机副本，失败什么都不动，用户还能再试。
 */
export function GuestImportDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useDiagramStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = guestDiagramCount();

  const dismiss = (): void => {
    markGuestImportAsked();
    onClose();
  };

  const runImport = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const diagrams = loadAllGuestDiagrams();
    const failed: string[] = [];
    for (const diagram of diagrams) {
      const copy = reissueIds(diagram);
      const result = await saveDiagram({ ...copy, name: diagram.name }, null);
      if (!result.ok) failed.push(`${diagram.name}：${result.message}`);
    }
    setBusy(false);
    if (failed.length > 0) {
      setError(`有 ${failed.length} 张没导进去（已跳过，本机数据保留）：${failed.slice(0, 2).join('；')}`);
      return;
    }
    clearGuestData();
    markGuestImportAsked();
    pushToast(`已导入 ${diagrams.length} 张游客图到你的账号（图库最前面）`, 'info');
    onClose();
  };

  if (total === 0) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" role="dialog" aria-modal aria-label="导入游客图">
      <div className="w-[400px] rounded-lg bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold">把游客期间的图导入账号？</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          本机有 <b className="text-[var(--text-primary)]">{total}</b> 张游客图。导入后会在你的账号里生成副本
          （id 重新编号，不会和已有图冲突），导入成功会清掉本机这份。
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1.5 text-[11px] text-[#B91C1C]">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-60"
          >
            先不了
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => void runImport()}
            disabled={busy}
            className="rounded bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-60"
          >
            {busy ? '导入中…' : `导入 ${total} 张`}
          </button>
        </div>
      </div>
    </div>
  );
}
