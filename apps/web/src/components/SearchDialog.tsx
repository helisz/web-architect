import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { COMPONENT_INDEX, type NodeType } from '@arch/schema';
import { search, type Hit } from '../data/search.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * Ctrl+F 搜索定位（阶段 2 第 4 项）。
 *
 * 匹配范围按规格：`label` / `subLabel` / `extJson.ip`，不区分大小写。
 * 选中结果后把视口飞过去，并给元素打 2 秒高亮。
 */

export function SearchDialog() {
  const open = useDiagramStore((s) => s.searchOpen);
  const setSearchOpen = useDiagramStore((s) => s.setSearchOpen);
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const setHighlight = useDiagramStore((s) => s.setHighlight);
  const { setViewport, getViewport } = useReactFlow();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NodeType | 'all'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () => search(diagram, query, { nodeType: typeFilter, groupId: groupFilter }),
    [diagram, query, typeFilter, groupFilter],
  );
  const filtered = typeFilter !== 'all' || groupFilter !== 'all';

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setTypeFilter('all');
    setGroupFilter('all');
    setActive(0);
    // 等面板挂上再聚焦
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  const goto = (hit: Hit): void => {
    select(hit.id);
    const { zoom } = getViewport();
    const nextZoom = Math.max(zoom, 1);
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
    const width = pane?.width ?? window.innerWidth;
    const height = pane?.height ?? window.innerHeight;
    setViewport(
      {
        x: width / 2 - hit.center.x * nextZoom,
        y: height / 2 - hit.center.y * nextZoom,
        zoom: nextZoom,
      },
      { duration: 320 },
    );
    setHighlight(hit.id);
    window.setTimeout(() => {
      // 2 秒后自动褪掉高亮；期间又搜了别的就交给它
      if (useDiagramStore.getState().highlightId === hit.id) setHighlight(null);
    }, 2000);
    setSearchOpen(false);
  };

  return (
    <div
      className="glass anim-pop absolute left-1/2 top-3 z-30 w-[420px] -translate-x-1/2 overflow-hidden rounded-[var(--radius-card)]"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <span className="text-[var(--text-secondary)]">🔍</span>
        <input
          ref={inputRef}
          aria-label="搜索节点"
          placeholder="搜索名称 / 副文本 / IP…"
          className="w-full bg-transparent text-[13px] outline-none"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setSearchOpen(false);
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, hits.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter' && hits[active]) goto(hits[active]!);
          }}
        />
        <span className="mono shrink-0 text-[11px] text-[var(--text-secondary)]">Esc 关闭</span>
      </div>

      {/* D2：类型 / 分组筛选（选了任一项就只搜节点） */}
      <div className="flex items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--bg-hover)] px-3 py-1.5 text-[11px]">
        <select
          aria-label="按节点类型筛选"
          className="rounded border border-[var(--panel-border)] bg-white px-1 py-0.5"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value as NodeType | 'all');
            setActive(0);
          }}
        >
          <option value="all">全部类型</option>
          {(Object.keys(COMPONENT_INDEX) as NodeType[]).map((type) => (
            <option key={type} value={type}>
              {COMPONENT_INDEX[type].label}
            </option>
          ))}
        </select>
        <select
          aria-label="按分组筛选"
          className="rounded border border-[var(--panel-border)] bg-white px-1 py-0.5"
          value={groupFilter}
          onChange={(event) => {
            setGroupFilter(event.target.value);
            setActive(0);
          }}
        >
          <option value="all">全部分组</option>
          <option value="none">不在分组里</option>
          {diagram.groups
            .filter((group) => !group.isDeleted)
            .map((group) => (
              <option key={group.groupId} value={group.groupId}>
                {group.label || '未命名分组'}
              </option>
            ))}
        </select>
        {filtered && <span className="text-[var(--text-secondary)]">筛选中，仅列出节点</span>}
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {query.trim() === '' && !filtered ? (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-secondary)]">
            输入关键字，按名称、副文本或 IP 定位；也可以只用上面的类型 / 分组筛选
          </p>
        ) : hits.length === 0 ? (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-secondary)]">没有匹配的元素</p>
        ) : (
          <ul>
            {hits.map((hit, index) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => goto(hit)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                    index === active ? 'bg-[var(--accent-50)]' : 'hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <span className="rounded border border-[var(--panel-border)] px-1 text-[10px] text-[var(--text-secondary)]">
                    {hit.kind === 'node' ? '节点' : hit.kind === 'group' ? '分组' : '连线'}
                  </span>
                  <span className="flex-1 truncate">{hit.title}</span>
                  <span className="truncate text-[11px] text-[var(--text-secondary)]">{hit.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}




