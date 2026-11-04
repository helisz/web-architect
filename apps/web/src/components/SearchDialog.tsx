import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { groupAbsoluteRect, nodeAbsoluteRect, type ArchitectureDiagram } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * Ctrl+F 搜索定位（阶段 2 第 4 项）。
 *
 * 匹配范围按规格：`label` / `subLabel` / `extJson.ip`，不区分大小写。
 * 选中结果后把视口飞过去，并给元素打 2 秒高亮。
 */

interface Hit {
  id: string;
  kind: 'node' | 'group' | 'edge';
  title: string;
  detail: string;
  center: { x: number; y: number };
}

function search(diagram: ArchitectureDiagram, query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];

  for (const node of diagram.nodes) {
    const ip = typeof node.extJson?.ip === 'string' ? node.extJson.ip : '';
    const haystack = `${node.label}\n${node.subLabel}\n${ip}\n${node.nodeType}`.toLowerCase();
    if (!haystack.includes(q)) continue;
    const rect = nodeAbsoluteRect(diagram.groups, node);
    hits.push({
      id: node.nodeId,
      kind: 'node',
      title: node.label || node.nodeType,
      detail: ip ? `IP ${ip}` : node.subLabel || node.nodeType,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    });
  }

  for (const group of diagram.groups) {
    if (!group.label.toLowerCase().includes(q)) continue;
    const rect = groupAbsoluteRect(diagram.groups, group);
    hits.push({
      id: group.groupId,
      kind: 'group',
      title: group.label || '未命名分组',
      detail: '分组',
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    });
  }

  for (const edge of diagram.edges) {
    if (!edge.label || !edge.label.toLowerCase().includes(q)) continue;
    const source = diagram.nodes.find((n) => n.nodeId === edge.sourceNodeId);
    const target = diagram.nodes.find((n) => n.nodeId === edge.targetNodeId);
    if (!source || !target) continue;
    const a = nodeAbsoluteRect(diagram.groups, source);
    const b = nodeAbsoluteRect(diagram.groups, target);
    hits.push({
      id: edge.edgeId,
      kind: 'edge',
      title: edge.label,
      detail: `${source.label} → ${target.label}`,
      center: { x: (a.x + a.width / 2 + b.x + b.width / 2) / 2, y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 },
    });
  }

  return hits.slice(0, 30);
}

export function SearchDialog() {
  const open = useDiagramStore((s) => s.searchOpen);
  const setSearchOpen = useDiagramStore((s) => s.setSearchOpen);
  const diagram = useDiagramStore((s) => s.diagram);
  const select = useDiagramStore((s) => s.select);
  const setHighlight = useDiagramStore((s) => s.setHighlight);
  const { setViewport, getViewport } = useReactFlow();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => search(diagram, query), [diagram, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
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
      className="absolute left-1/2 top-3 z-30 w-[420px] -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-white shadow-xl"
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
      <div className="max-h-[320px] overflow-y-auto">
        {query.trim() === '' ? (
          <p className="px-3 py-4 text-center text-[12px] text-[var(--text-secondary)]">
            输入关键字，按名称、副文本或 IP 定位
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
                    index === active ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'
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
