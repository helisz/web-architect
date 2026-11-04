import { useCallback, useEffect, useState } from 'react';
import { createEmptyDiagram } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import {
  deleteDiagram,
  duplicateDiagram,
  listDiagrams,
  loadDiagram,
  renameDiagram,
  saveDiagram,
  type DiagramSummary,
} from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';

/**
 * 图库（阶段 3）：列出所有未删除的架构图，支持打开 / 改名 / 复制 / 删除 / 新建。
 *
 * 单页应用没有路由，用 store 里的 `view` 在画布和图库之间切换 ——
 * 来回切换不会丢画布状态，也不会重新 bootstrap。
 */
export function Gallery() {
  const setView = useDiagramStore((s) => s.setView);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const setNotice = useDiagramStore((s) => s.setNotice);
  const setSaveError = useDiagramStore((s) => s.setSaveError);
  const currentId = useDiagramStore((s) => s.diagram.diagramId);

  const [rows, setRows] = useState<DiagramSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await listDiagrams());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (id: string): Promise<void> => {
    if (id === currentId) {
      setView('canvas');
      return;
    }
    setBusy(id);
    try {
      const loaded = await loadDiagram(id);
      setDiagram(loaded.diagram, { persisted: true });
      rememberSavedPayload(loaded.diagram);
      setView('canvas');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createNew = async (): Promise<void> => {
    const fresh = createEmptyDiagram({ name: '未命名架构图' });
    setDiagram(fresh);
    const saved = await saveDiagram(fresh, null);
    if (saved.ok) {
      rememberSavedPayload(fresh);
      setNotice('已新建一张空图');
      setView('canvas');
    } else {
      setError(saved.message);
    }
  };

  const commitRename = async (): Promise<void> => {
    if (!renaming) return;
    const target = renaming;
    setRenaming(null);
    try {
      await renameDiagram(target.id, target.value);
      if (target.id === currentId) {
        useDiagramStore.setState((s) => ({ diagram: { ...s.diagram, name: target.value.trim() || '未命名架构图' } }));
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const duplicate = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const copy = await duplicateDiagram(id);
      setNotice(`已复制为「${copy.name}」`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      await deleteDiagram(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--panel-border)] bg-white px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">图库</h1>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {rows === null ? '读取中…' : `共 ${rows.length} 张`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-[var(--primary)] px-3 py-1 text-xs text-white hover:bg-[var(--primary-hover,#1D4ED8)]"
            onClick={() => void createNew()}
          >
            新建架构图
          </button>
          <button
            type="button"
            className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F9FAFB]"
            onClick={() => setView('canvas')}
          >
            返回画布
          </button>
        </div>
      </header>

      {error && (
        <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-4 py-2 text-[12px] text-[#B91C1C]">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setSaveError(null)}
          >
            知道了
          </button>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rows === null ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">正在读取图列表…</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">
            还没有架构图，点右上角「新建架构图」开始。
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <li
                key={row.diagramId}
                className={`rounded-lg border bg-white p-3 ${
                  row.diagramId === currentId ? 'border-[var(--primary)]' : 'border-[var(--panel-border)]'
                }`}
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  {renaming?.id === row.diagramId ? (
                    <input
                      autoFocus
                      className="w-full rounded border border-[var(--primary)] px-1 py-0.5 text-[13px] outline-none"
                      value={renaming.value}
                      onChange={(event) => setRenaming({ id: row.diagramId, value: event.target.value })}
                      onBlur={() => void commitRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename();
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="truncate text-left text-[13px] font-medium hover:text-[var(--primary)]"
                      onClick={() => void open(row.diagramId)}
                      title="打开这张图"
                    >
                      {row.name || '未命名架构图'}
                    </button>
                  )}
                  {row.diagramId === currentId && (
                    <span className="shrink-0 rounded bg-[#EFF6FF] px-1 text-[10px] text-[var(--primary)]">当前</span>
                  )}
                </div>
                <p className="mb-2 text-[11px] text-[var(--text-secondary)]">
                  v{row.version} · {new Date(row.updatedAt).toLocaleString('zh-CN')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[#F9FAFB]"
                    onClick={() => void open(row.diagramId)}
                    disabled={busy !== null}
                  >
                    {busy === row.diagramId ? '处理中…' : '打开'}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[#F9FAFB]"
                    onClick={() => setRenaming({ id: row.diagramId, value: row.name })}
                  >
                    改名
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[#F9FAFB]"
                    onClick={() => void duplicate(row.diagramId)}
                    disabled={busy !== null}
                  >
                    复制
                  </button>
                  <button
                    type="button"
                    className="rounded border border-[#FECACA] px-2 py-0.5 text-[11px] text-[#B91C1C] hover:bg-[#FEF2F2]"
                    onClick={() => {
                      if (window.confirm(`删除「${row.name || '未命名架构图'}」？（可在版本快照里找回）`)) {
                        void remove(row.diagramId);
                      }
                    }}
                    disabled={busy !== null}
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
