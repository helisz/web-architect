import { useCallback, useEffect, useMemo, useState } from 'react';
import { createEmptyDiagram } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import {
  deleteDiagram,
  duplicateDiagram,
  listAllTags,
  listDiagramPreviews,
  listDiagrams,
  renameDiagram,
  saveDiagram,
  updateDiagramTags,
  type DiagramSummary,
} from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';
import { navigateToDiagram } from '../lib/route.js';
import { ToolIcon } from './ToolIcons.js';
import { DiagramBadge } from './DiagramBadge.js';
import { AccountMenu } from './AccountMenu.js';
import { GuestAccount } from './GuestAccount.js';
import { useGuestSession } from '../data/guestSession.js';
import { thumbnailDataUrl, type ThumbnailPayload } from '../export/thumbnail.js';

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
  // 游客模式（用户 2026-11-05）：列表/新建/删除全部走本地仓储，账号区换成本机胶囊
  const guest = useGuestSession((s) => s.guest);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const pushToast = useDiagramStore((s) => s.pushToast);
  const currentId = useDiagramStore((s) => s.diagram.diagramId);

  const [rows, setRows] = useState<DiagramSummary[] | null>(null);
  const [total, setTotal] = useState(0);
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
  /** 鼠标停在哪张卡上：用它控制右下角操作区的显隐（2026-11-08） */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** 缩略图加载完的卡片：用来做"生成后渐入"（2026-11-08） */
  const [thumbReady, setThumbReady] = useState<Record<string, boolean>>({});
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
      // 错误统一走 toast（用户 2026-11-04）
    } catch (err) {
      pushToast((err as Error).message, 'error');
      setRows([]);
      setTotal(0);
    }
  }, [page, search, sort, tag]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 卡片预览：按当前页的 id 批量取几何，失败就留空预览框（不打断图库）
  const [previews, setPreviews] = useState<Record<string, ThumbnailPayload>>({});
  const previewKey = rows === null ? '' : rows.map((row) => row.diagramId).join(',');
  useEffect(() => {
    let cancelled = false;
    if (!previewKey) {
      setPreviews({});
      return;
    }
    void listDiagramPreviews(previewKey.split(','))
      .then((map) => {
        if (!cancelled) setPreviews(map as Record<string, ThumbnailPayload>);
      })
      .catch(() => {
        if (!cancelled) setPreviews({});
      });
    return () => {
      cancelled = true;
    };
  }, [previewKey]);

  useEffect(() => {
    void listAllTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const open = async (id: string): Promise<void> => {
    // 路由即状态：改 hash 由 useRouteDiagram 去载入（切图逻辑只写一份）
    setBusy(id);
    try {
      navigateToDiagram(id);
    } finally {
      setBusy(null);
    }
  };

  const createNew = async (): Promise<void> => {
    const fresh = createEmptyDiagram({ name: '未命名架构图' });
    const saved = await saveDiagram(fresh, null);
    if (saved.ok) {
      setDiagram({ ...fresh, version: saved.version }, { persisted: true });
      rememberSavedPayload(fresh);
      pushToast('已新建一张空图', 'success');
      navigateToDiagram(fresh.diagramId);
    } else {
      pushToast(saved.message, 'error');
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
      pushToast((err as Error).message, 'error');
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
      pushToast((err as Error).message, 'error');
    }
  };

  const duplicate = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const copy = await duplicateDiagram(id);
      pushToast(`已复制为「${copy.name}」`);
      await refresh();
    } catch (err) {
      pushToast((err as Error).message, 'error');
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
      pushToast((err as Error).message, 'error');
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
            className="flex items-center gap-1 rounded bg-[var(--primary-solid)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-solid-hover)]"
            onClick={() => void createNew()}
            title="新建空白架构图"
          >
            <ToolIcon name="plus" size={14} />
            新建架构图
          </button>
          {/* 账号固定在最右边（用户 2026-11-05：图库也要有，hover 展开登出）；游客换成"本机"胶囊 */}
          {guest ? <GuestAccount /> : <AccountMenu />}
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
                  ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary-text)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {rows === null ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">正在读取图列表…</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-[12px] text-[var(--text-secondary)]">
            {activeFilter ? '没有符合条件的架构图，换个关键词或清掉标签筛选。' : '还没有架构图。图库只显示你自己创建的图，点右上角「新建架构图」开始。'}
          </p>
        ) : (
          // 2026-11-06：1080p 六列，窄屏自动回落（2 → 3 → 4 → 5 → 6）
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {rows.map((row) => (
              <li
                key={row.diagramId}
                onMouseEnter={() => setHoverId(row.diagramId)}
                onMouseLeave={() => setHoverId((id) => (id === row.diagramId ? null : id))}
                className={`group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-white p-3 transition-colors ${
                  row.diagramId === currentId
                    ? 'border-[var(--primary)]'
                    : 'border-[var(--panel-border)] hover:border-[var(--primary)]'
                }`}
              >
                {/* 整卡片就是打开按钮（用户 2026-11-05：去掉「打开」按钮，点卡片即进图） */}
                <button
                  type="button"
                  aria-label={`打开「${row.name || '未命名架构图'}」`}
                  className="absolute inset-0 z-0 rounded-[var(--radius-card)]"
                  onClick={() => void open(row.diagramId)}
                  disabled={busy !== null}
                />
                {/*
                  缩略图（2026-11-08 视觉加强）：
                  - 底子是画布同款点阵 + 一层很淡的暖色渐变，缩略图本身透明底，叠在上面像"蓝图"；
                  - 图片 decode 完成后从「淡 + 轻微缩小 + 2px 模糊」过渡到正常，500ms；
                  - 卡片悬停时整张图再放大一点，配合边框高亮。
                */}
                {/* 缩略图整块 pointer-events-none：点击穿透到卡片底层那个"打开"按钮，
                    所以单击 / 双击缩略图都能进图（2026-11-08） */}
                <div className="pointer-events-none relative -mx-3 -mt-3 mb-2 aspect-[3/2] overflow-hidden border-b border-[var(--hair)] bg-[var(--canvas-bg)]">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)',
                      backgroundSize: '10px 10px',
                      maskImage: 'radial-gradient(ellipse at center, #000 55%, transparent 100%)',
                      WebkitMaskImage: 'radial-gradient(ellipse at center, #000 55%, transparent 100%)',
                    }}
                  />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[var(--accent-50)]/60 via-transparent to-[var(--bg-sunken)]/70"
                  />
                  {previews[row.diagramId] ? (
                    // 悬停放大放在外层：图片自己要用 scale 做渐入，两层拆开互不打架
                    <div
                      className={`relative h-full w-full transition-[scale] duration-500 ease-out ${
                        hoverId === row.diagramId ? 'scale-[1.03]' : 'scale-100'
                      }`}
                    >
                      <img
                        src={thumbnailDataUrl(previews[row.diagramId]!, 340, null)}
                        alt=""
                        draggable={false}
                        onLoad={() => setThumbReady((prev) => ({ ...prev, [row.diagramId]: true }))}
                        className={`h-full w-full object-contain transition-[opacity,filter,scale] duration-500 ease-out ${
                          thumbReady[row.diagramId]
                            ? 'scale-100 opacity-100 blur-0'
                            : 'scale-[0.97] opacity-0 blur-[2px]'
                        }`}
                      />
                    </div>
                  ) : (
                    <div className="relative grid h-full w-full place-items-center">
                      <span className="mono animate-pulse text-[10px] text-[var(--text-tertiary)]">生成中…</span>
                    </div>
                  )}
                </div>

                {/* 标题区（2026-11-08 用户定稿）：左侧图标撑满两行的高度、文字居中；
                    右边第一行标题、第二行版本/日期 */}
                <div className="pointer-events-none relative z-10 mb-1 flex items-stretch gap-2">
                  <DiagramBadge name={row.name} size="stretch" />
                  <div className="min-w-0 flex-1">
                    {renaming?.id === row.diagramId ? (
                      <input
                        autoFocus
                        className="pointer-events-auto w-full rounded border border-[var(--primary)] px-1 py-0.5 text-[13px] outline-none"
                        value={renaming.value}
                        onChange={(event) => setRenaming({ id: row.diagramId, value: event.target.value })}
                        onBlur={() => void commitRename()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void commitRename();
                          if (event.key === 'Escape') setRenaming(null);
                        }}
                      />
                    ) : (
                      <div className="truncate text-left text-[13px] font-medium leading-[18px]">
                        {row.name || '未命名架构图'}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="mono truncate text-[10px] leading-4 text-[var(--text-tertiary)]"
                        title={new Date(row.updatedAt).toLocaleString('zh-CN')}
                      >
                        v{row.version} · {new Date(row.updatedAt).toLocaleDateString('zh-CN')}
                      </span>
                      {row.diagramId === currentId && (
                        <span className="shrink-0 rounded bg-[var(--accent-50)] px-1 text-[10px] text-[var(--primary-text)]">当前</span>
                      )}
                    </div>
                  </div>
                </div>

                {tagging?.id === row.diagramId ? (
                  <input
                    autoFocus
                    className="relative z-10 mb-2 w-full rounded border border-[var(--primary)] px-1 py-0.5 text-[11px] outline-none"
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
                  <div className="relative z-10 mb-2 mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1">
                    {row.tags.length > 0 ? (
                      row.tags.map((item) => (
                        <span key={item} className="rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                          {item}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-[var(--text-secondary)]">无标签</span>
                    )}
                  </div>
                )}

                {/* 动作图标（2026-11-08）：绝对定位在卡片右下角，**不占布局高度**；
                    默认隐藏，悬停整张卡时浮出，底下一层高斯模糊避免压在文字上。 */}
                <div
                  className={`absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-[var(--radius-card)] border border-[var(--glass-line)] bg-white/60 p-1 backdrop-blur-[20px] backdrop-saturate-150 transition-opacity ${
                    hoverId === row.diagramId ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                >
                  <CardAction
                    icon="pencil"
                    label="改名"
                    onClick={() => setRenaming({ id: row.diagramId, value: row.name })}
                  />
                  <CardAction
                    icon="tag"
                    label="改标签"
                    onClick={() => setTagging({ id: row.diagramId, value: row.tags.join(', ') })}
                  />
                  <CardAction
                    icon="copy"
                    label={busy === row.diagramId ? '复制中…' : '复制'}
                    disabled={busy !== null}
                    onClick={() => void duplicate(row.diagramId)}
                  />
                  <CardAction
                    icon="trash"
                    label="删除"
                    danger
                    disabled={busy !== null}
                    onClick={() => {
                      if (window.confirm(`删除「${row.name || '未命名架构图'}」？（可在版本快照里找回）`)) {
                        void remove(row.diagramId);
                      }
                    }}
                  />
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

/**
 * 卡片上的图标按钮
（改名 / 复制 / 删除）。
 * 只有图标 + tooltip；`danger` 用红色 hover 表达破坏性，别靠 icon 形状去猜。
 */
function CardAction({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: 'pencil' | 'tag' | 'copy' | 'trash';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        // 卡片本身是打开按钮：动作按钮必须拦住冒泡，否则一点就跳走了
        event.stopPropagation();
        onClick();
      }}
      className={`grid h-7 w-7 place-items-center rounded border border-transparent text-[var(--text-secondary)] transition-colors hover:border-[var(--panel-border)] hover:bg-[var(--bg-hover)] disabled:opacity-40 ${
        danger ? 'text-[var(--err)] hover:border-[var(--err)] hover:bg-[var(--err-soft)]' : 'hover:text-[var(--primary-text)]'
      }`}
    >
      <ToolIcon name={icon} size={15} />
    </button>
  );
}
