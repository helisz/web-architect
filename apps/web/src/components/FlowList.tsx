import { useCallback, useEffect, useState } from 'react';
import { createEmptyFlow, deleteFlow, listFlows, saveFlow, type FlowSummary } from '../data/flowRepo.js';
import { navigateToFlow, navigateToTemplates, type Route } from '../lib/route.js';
import { PageHeader } from './PageHeader.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 流程列表（用户 2026-11-08）。
 *
 * 和架构图的图库是两套数据，所以没有缩略图 —— 流程的价值在"实时数据"，
 * 静态缩略图意义不大，这里改成列出节点数 / 最近更新。
 */
export function FlowList({ route }: { route: Route }) {
  const [rows, setRows] = useState<FlowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await listFlows());
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (): Promise<void> => {
    setBusy('new');
    try {
      const flow = createEmptyFlow();
      const saved = await saveFlow(flow, null);
      if (!saved.ok) throw new Error(saved.message ?? '保存失败');
      navigateToFlow(flow.flowId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (flowId: string): Promise<void> => {
    if (!window.confirm('删除这张流程？里面的节点和连线会一起删掉。')) return;
    setBusy(flowId);
    try {
      await deleteFlow(flowId);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <PageHeader
        route={route}
        title="流程"
        meta={rows === null ? '读取中…' : `共 ${rows.length} 张`}
        actions={
          <>
            <button
              type="button"
              onClick={navigateToTemplates}
              className="rounded-[var(--radius-ctl)] border border-[var(--panel-border)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary-text)]"
            >
              模板库
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy !== null}
              className="flex items-center gap-1 rounded-[var(--radius-ctl)] bg-[var(--primary-solid)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-solid-hover)] disabled:opacity-60"
            >
              <ToolIcon name="plus" size={14} />
              新建流程
            </button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p className="mb-3 border border-[#E8B4A6] bg-[#FDF1EE] px-3 py-2 text-[12px] leading-5 text-[var(--err)]">
            {error}
          </p>
        )}

        {rows !== null && rows.length === 0 && (
          <div className="grid place-items-center py-20 text-center">
            <p className="text-[13px] text-[var(--text-secondary)]">还没有流程</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              流程里的节点来自「模板」，先去模板库建一个模板，再回来建流程。
            </p>
          </div>
        )}

        {rows !== null && rows.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((row) => (
              <li
                key={row.flowId}
                className="group relative flex flex-col border border-[var(--hair-strong)] bg-white p-3 transition-colors hover:border-[var(--primary)]"
              >
                <button
                  type="button"
                  aria-label={`打开「${row.name}」`}
                  className="absolute inset-0 z-0"
                  onClick={() => navigateToFlow(row.flowId)}
                />
                <div className="mb-1 truncate text-left text-[13px] font-medium text-[var(--text-primary)]">
                  {row.name || '未命名流程'}
                </div>
                <div className="mono text-[10px] leading-4 text-[var(--text-tertiary)]">
                  v{row.version} · {new Date(row.updatedAt).toLocaleString('zh-CN')}
                </div>
                {row.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                    {row.description}
                  </p>
                )}
                <div className="relative z-10 mt-2 flex justify-end">
                  <button
                    type="button"
                    aria-label="删除流程"
                    disabled={busy === row.flowId}
                    onClick={() => void remove(row.flowId)}
                    className="grid h-6 w-6 place-items-center text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--err)] group-hover:opacity-100"
                  >
                    <ToolIcon name="trash" size={13} />
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
