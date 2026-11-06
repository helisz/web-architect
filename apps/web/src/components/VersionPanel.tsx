import { useCallback, useEffect, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { listSnapshots, loadSnapshotPayload, restoreSnapshot, saveManualSnapshot, type SnapshotSummary } from '../data/snapshotRepo.js';
import { loadDiagram } from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 版本历史（规格 §3.3「版本与快照」）。
 *
 * 用户 2026-11-04 定稿：从居中模态改成**右侧停靠栏**，和属性面板共用右侧一列（同一时间只显示一个）。
 * 快照是整图载荷的快照，回滚 = 把那一版的内容灌回去（版本号 +1，历史不丢）；
 * 所以回滚后要重新 load 一次，并把内存里的保存基线跟着换掉。
 */
export function VersionPanel({ onClose }: { onClose: () => void }) {
  const diagramId = useDiagramStore((s) => s.diagram.diagramId);
  const version = useDiagramStore((s) => s.diagram.version);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const pushToast = useDiagramStore((s) => s.pushToast);

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

  const rollback = async (snapshot: SnapshotSummary): Promise<void> => {
    setBusy(snapshot.snapshotId);
    setError(null);
    try {
      // 禁用 arch_restore_snapshot：这里自己把 payload 灌回去
      const payload = await loadSnapshotPayload(snapshot.snapshotId);
      if (!payload) throw new Error('这一版快照内容缺失');
      const result = await restoreSnapshot(snapshot.snapshotId, payload);
      if (!result.ok) throw new Error(result.message);

      const loaded = await loadDiagram(diagramId);
      setDiagram(loaded.diagram, { persisted: true });
      rememberSavedPayload(loaded.diagram);
      pushToast(`已回滚到 v${snapshot.version}，当前为 v${result.version}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
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
      pushToast(outcome.created ? `已保存快照「${label}」` : `v${version} 已有快照，已改名为「${label}」`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="floating-panel right-[var(--panel-inset)] top-[var(--panel-inset)] bottom-[var(--panel-inset)] flex w-[300px] flex-col">
      <div className="flex items-start justify-between border-b border-[var(--panel-border)] px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium">版本历史</h2>
          <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
            当前 v{version} · 首次 / 每 5 版 / 距上次 ≥30 分钟自动存快照
          </p>
        </div>
        <button
          type="button"
          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          onClick={onClose}
          title="关闭版本栏"
          aria-label="关闭版本栏"
        >
          <ToolIcon name="close" size={14} />
        </button>
      </div>

      {/* 手动快照：把当前版本命名存下来，和自动快照一起进列表 */}
      <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] bg-[var(--bg-hover)] px-3 py-2">
        <input
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
          placeholder="给这版起个名字"
          value={snapshotName}
          onChange={(event) => setSnapshotName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && busy === null) void saveManual();
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded bg-[var(--primary)] px-2 py-1 text-[12px] text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void saveManual()}
        >
          {busy === 'manual' ? '保存中…' : '存快照'}
        </button>
      </div>

      {error && (
        <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-[11px] leading-4 text-[#B91C1C]">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <p className="px-3 py-6 text-center text-[12px] text-[var(--text-secondary)]">正在读取快照…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-5 text-[var(--text-secondary)]">
            还没有快照。
            <br />
            再保存几次（或 30 分钟后再改一次）就会出现。
          </p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.snapshotId} className="border-b border-[var(--panel-border)] px-3 py-2 last:border-b-0">
                <div className="flex items-start gap-2">
                  {row.thumbnail ? (
                    <img
                      src={row.thumbnail}
                      alt={`v${row.version} 缩略图`}
                      className="h-[36px] w-[62px] shrink-0 rounded border border-[var(--panel-border)] bg-white object-contain"
                    />
                  ) : (
                    <div className="h-[36px] w-[62px] shrink-0 rounded border border-[var(--panel-border)] bg-white" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px]">
                      <span className="mono mr-1 font-medium">v{row.version}</span>
                      {row.name}
                    </p>
                    <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
                      {new Date(row.createdAt).toLocaleString('zh-CN')}
                      {row.counts && ` · ${row.counts.nodes} 节点 / ${row.counts.edges} 连线 / ${row.counts.groups} 分组`}
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    className="rounded border border-[var(--panel-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
                    disabled={busy !== null}
                    onClick={() => setConfirming(row)}
                  >
                    {busy === row.snapshotId ? '回滚中…' : '回滚到这一版'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && (
        <div className="border-t border-[var(--panel-border)] bg-[#FFFBEB] px-3 py-2">
          <p className="text-[11px] leading-4 text-[#92400E]">
            回滚会把整张图替换成 v{confirming.version} 的内容（版本号 +1，历史保留）。确定吗？
          </p>
          <div className="mt-1.5 flex justify-end gap-2">
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
    </aside>
  );
}
