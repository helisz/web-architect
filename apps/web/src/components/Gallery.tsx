import { useCallback, useEffect, useMemo, useState } from 'react';
import { createEmptyDiagram } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import {
  deleteDiagram,
  duplicateDiagram,
  listAllTags,
  listDiagrams,
  loadDiagram,
  renameDiagram,
  saveDiagram,
  updateDiagramTags,
  type DiagramSummary,
} from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';

type SortKey = 'updated' | 'name' | 'version';

const PAGE_SIZE = 12;

const SORT_LABEL: Record<SortKey, string> = {
  updated: '按更新时间',
  name: '按名称',
  version: '按版本号',
};

/**
 * 图库（阶段 3 · A2/B4）：列出所有未删除的架构图，支持搜索 / 标签筛选 / 排序 / 分页，
 * 以及打开 / 改名 / 改标签 / 复制 / 删除 / 新建。
 *
 * 筛选和分页都下推给 PostgREST（`.ilike` / `.contains` / `.range`），
 * 前端只保存"当前条件"，不缓存全量列表。
 */
export function Gallery() {
  const setView = useDiagramStore((s) => s.setView);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const setNotice = useDiagramStore((s) => s.setNotice);
  const currentId = useDiagramStore((s) => s.diagram.diagramId);

  const [rows, setRows] = useState<DiagramSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 筛选条件
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('updated');
  const [page, setPage] = useState(0);
  const [tags, setTags] = useState<string[]>([]);

  // 行内编辑
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [tagging, setTagging] = useState<{ id: string; value: string } | null>(null);

  // 输入防抖：300ms 内连打不重复请求
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const refresh = useCallback(async () => {
    try {
      const result = await listDiagrams({ search, tag: tag ?? undefined, sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      setRows(result.rows);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setRows([]);
      setTotal(0);
    }
  }, [page, search, sort, tag]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void listAllTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  const commitTags = async (): Promise<void> => {
    if (!tagging) return;
    const target = tagging;
    setTagging(null);
    try {
      await updateDiagramTags(
        target.id,
        target.value
          .split(/[,，\s]+/)
          .map((t) => t.trim())
          .filter(Boolean),
      );
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
      if (rows && rows.length === 1 && page > 0) setPage(page - 1);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const activeFilter = useMemo(() => Boolean(search || tag), [search, tag]);

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--panel-border)] bg-white px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium">图库</h1>
          <span className="text-[11px] text-[var(--text-secondary)]">
            {rows === null ? '读取中…' : activeFilter ? `筛出 ${total} 张` : `共 ${total} 张`}
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

      {/* 筛选条：名称搜索 / 标签 / 排序 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--panel-border)] bg-white px-4 py-2">
        <input
          className="w-56 rounded border border-[var(--panel-border)] px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
          placeholder="按名称搜索…"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <select
          className="rounded border border-[var(--panel-border)] bg-white px-2 py-1 text-[12px]"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortKey);
            setPage(0);
          }}
        >
          {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-1">
          {tags.length > 0 && (
            <span className="mr-1 text-[11px] text-[var(--text-secondary)]">标签：</span>
          )}
          {tags.map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                tag === item
                  ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[#F9FAFB]'
              }`}
              onClick={() => {
                setTag(tag === item ? null : item);
                setPage(0);
              }}
            >
              {item}
            </button>
          ))}
          {activeFilter && (
            <button
              type="button"
              className="ml-1 text-[11px] text-[var(--text-secondary)] underline"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setTag(null);
                setPage(0);
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="border-b border-[#FECACA] bg-[#FEF2F2] px-4 py-2 text-[12px] text-[#B91C1C]">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
            知道了
          </button>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rows === null ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">正在读取图列表…</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">
            {activeFilter ? '没有符合条件的架构图，换个关键词或清掉标签筛选。' : '还没有架构图，点右上角「新建架构图」开始。'}
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

                <p className="mb-1.5 text-[11px] text-[var(--text-secondary)]">
                  v{row.version} · {new Date(row.updatedAt).toLocaleString('zh-CN')}
                </p>

                {tagging?.id === row.diagramId ? (
                  <input
                    autoFocus
                    className="mb-2 w-full rounded border border-[var(--primary)] px-1 py-0.5 text-[11px] outline-none"
                    placeholder="用逗号分隔，例如 生产,网络"
                    value={tagging.value}
                    onChange={(event) => setTagging({ id: row.diagramId, value: event.target.value })}
                    onBlur={() => void commitTags()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitTags();
                      if (event.key === 'Escape') setTagging(null);
                    }}
                  />
                ) : (
                  <div className="mb-2 flex min-h-[18px] flex-wrap items-center gap-1">
                    {row.tags.length > 0 ? (
                      row.tags.map((item) => (
                        <span key={item} className="rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] text-[#4B5563]">
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-[var(--text-secondary)]">无标签</span>
                    )}
                    <button
                      type="button"
                      className="text-[10px] text-[var(--text-secondary)] underline hover:text-[var(--primary)]"
                      onClick={() => setTagging({ id: row.diagramId, value: row.tags.join(', ') })}
                    >
                      改标签
                    </button>
                  </div>
                )}

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

      {pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[var(--panel-border)] bg-white py-2 text-[12px]">
          <button
            type="button"
            className="rounded border border-[var(--panel-border)] px-2 py-0.5 disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
          >
            上一页
          </button>
          <span className="text-[var(--text-secondary)]">
            第 {page + 1} / {pageCount} 页
          </span>
          <button
            type="button"
            className="rounded border border-[var(--panel-border)] px-2 py-0.5 disabled:opacity-40"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
