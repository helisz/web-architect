import { useCallback, useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { listSnapshots, loadSnapshotPayload, restoreSnapshot, saveManualSnapshot, type SnapshotSummary } from '../data/snapshotRepo.js';
import { loadDiagram } from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';

/**
 * 版本历史抽屉（阶段 3 · 快照与回滚）。
 *
 * 打开时拉一次快照列表；回滚前要二次确认（回滚是不可撤销的写库操作），
 * 回滚成功后重新从库里载入，并把增量保存的基线重置成新载入的内容。
 */
export function VersionDialog({ onClose }: { onClose: () => void }) {
  const diagramId = useDiagramStore((s) => s.diagram.diagramId);
  const version = useDiagramStore((s) => s.diagram.version);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const setSaveError = useDiagramStore((s) => s.setSaveError);
  const setNotice = useDiagramStore((s) => s.setNotice);

  const [rows, setRows] = useState<SnapshotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<SnapshotSummary | null>(null);
  const [snapshotName, setSnapshotName] = useState('');

  const refresh = useCallback(async () => {
    setRows(null);
    try {
      setRows(await listSnapshots(diagramId));
    } catch (err) {
      setError((err as Error).message);
      setRows([]);
    }
  }, [diagramId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rollback = async (snapshot: SnapshotSummary): Promise<void> => {
    setBusy(snapshot.snapshotId);
    setError(null);
    try {
      // 优先走 arch_restore_snapshot；函数没装时用 payload 走整图保存
      const payload = await loadSnapshotPayload(snapshot.snapshotId);
      if (!payload) throw new Error('这个快照没有内容');
      const result = await restoreSnapshot(snapshot.snapshotId, payload);
      if (!result.ok) throw new Error(result.message);

      const loaded = await loadDiagram(diagramId);
      setDiagram(loaded.diagram, { persisted: true });
      rememberSavedPayload(loaded.diagram);
      setNotice(`已回滚到 v${snapshot.version}，当前版本 v${result.version}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaveError(`回滚失败：${(err as Error).message}`);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  /** 手动把当前版本存成命名快照（C8） */
  const saveManual = async (): Promise<void> => {
    const label = snapshotName.trim() || `手动快照 v${version}`;
    setBusy('manual');
    setError(null);
    try {
      const outcome = await saveManualSnapshot(diagramId, version, label);
      setSnapshotName('');
      await refresh();
      setNotice(outcome.created ? `已保存快照「${label}」` : `v${version} 已有快照，已改名为「${label}」`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24" onMouseDown={onClose}>
      <div
        className="w-[520px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-2.5">
          <div>
            <h2 className="text-[13px] font-medium">版本历史</h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              当前 v{version} · 快照按「首次 / 每 5 版 / 距上次 ≥30 分钟」自动生成
            </p>
          </div>
          <button
            type="button"
            className="rounded px-1.5 text-[var(--text-secondary)] hover:bg-[#F3F4F6]"
            onClick={onClose}
            title="关闭（Esc）"
          >
            ✕
          </button>
        </div>

        {error && <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-4 py-2 text-[12px] text-[#B91C1C]">{error}</p>}

        {/* 手动快照：把当前版本命名存下来，和自动快照一起进列表 */}
        <div className="flex items-center gap-2 border-b border-[var(--panel-border)] bg-[#F9FAFB] px-4 py-2">
          <input
            className="min-w-0 flex-1 rounded border border-[var(--panel-border)] px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
            placeholder={`给 v${version} 起个名字，例如「上线前」`}
            value={snapshotName}
            onChange={(event) => setSnapshotName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && busy === null) void saveManual();
            }}
          />
          <button
            type="button"
            className="shrink-0 rounded bg-[var(--primary)] px-2.5 py-1 text-[12px] text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void saveManual()}
          >
            {busy === 'manual' ? '保存中…' : '存为快照'}
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {rows === null ? (
            <p className="px-4 py-6 text-center text-[12px] text-[var(--text-secondary)]">正在读取快照…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px] text-[var(--text-secondary)]">
              还没有快照。再保存几次（或等 30 分钟后再改一次）就会出现。
            </p>
          ) : (
            <ul>
              {rows.map((row) => (
                <li
                  key={row.snapshotId}
                  className="flex items-center gap-3 border-b border-[var(--panel-border)] px-4 py-2 last:border-b-0"
                >
                  {row.thumbnail ? (
                    <img
                      src={row.thumbnail}
                      alt={`v${row.version} 缩略图`}
                      className="h-[46px] w-[80px] shrink-0 rounded border border-[var(--panel-border)] bg-white object-contain"
                    />
                  ) : (
                    <div className="h-[46px] w-[80px] shrink-0 rounded border border-[var(--panel-border)] bg-[#F9FAFB]" />
                  )}
                  <span className="mono w-12 shrink-0 text-[12px] font-medium">v{row.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px]">{row.name}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {new Date(row.createdAt).toLocaleString('zh-CN')}
                      {row.counts && ` · ${row.counts.nodes} 节点 / ${row.counts.edges} 连线 / ${row.counts.groups} 分组`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[#F9FAFB]"
                    disabled={busy !== null}
                    onClick={() => setConfirming(row)}
                  >
                    {busy === row.snapshotId ? '回滚中…' : '回滚到这一版'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {confirming && (
          <div className="border-t border-[var(--panel-border)] bg-[#FFFBEB] px-4 py-2.5">
            <p className="text-[12px] text-[#92400E]">
              回滚会把整张图替换成 v{confirming.version} 的内容（版本号 +1，历史保留）。确定吗？
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-[var(--panel-border)] px-2 py-1 text-[11px] hover:bg-white"
                onClick={() => setConfirming(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-[var(--primary)] px-2 py-1 text-[11px] text-white hover:bg-[var(--primary-hover,#1D4ED8)]"
                onClick={() => void rollback(confirming)}
                disabled={busy !== null}
              >
                确认回滚
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

