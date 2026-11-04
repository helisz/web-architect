import { useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 图层面板（阶段 2 第 5 项）。
 *
 * 列表 = 节点 + 分组，按 `sort` 从上层到下层排。
 * 拖动某一行即可改层级；层级值统一由 store 归一化成 0..N-1。
 */

interface Row {
  id: string;
  kind: 'node' | 'group';
  label: string;
  sort: number;
  locked?: boolean;
}

export function LayerPanel() {
  const open = useDiagramStore((s) => s.layerPanelOpen);
  const setOpen = useDiagramStore((s) => s.setLayerPanelOpen);
  const nodes = useDiagramStore((s) => s.diagram.nodes);
  const groups = useDiagramStore((s) => s.diagram.groups);
  const select = useDiagramStore((s) => s.select);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const setLayerOrder = useDiagramStore((s) => s.setLayerOrder);
  const bringToFront = useDiagramStore((s) => s.bringToFront);
  const sendToBack = useDiagramStore((s) => s.sendToBack);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (!open) return null;

  const rows: Row[] = [
    ...nodes.map((n) => ({ id: n.nodeId, kind: 'node' as const, label: n.label || n.nodeType, sort: n.sort, locked: n.locked })),
    ...groups.map((g) => ({ id: g.groupId, kind: 'group' as const, label: g.label || '未命名分组', sort: g.sort })),
  ].sort((a, b) => b.sort - a.sort);

  const move = (fromId: string, toId: string): void => {
    if (fromId === toId) return;
    const ids = rows.map((row) => row.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    setLayerOrder(ids);
  };

  return (
    <div className="absolute right-3 top-12 z-20 w-[236px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <span className="text-[12px] font-medium">图层（{rows.length}）</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1 text-[var(--text-secondary)] hover:bg-[#F3F4F6]"
          title="关闭"
        >
          ✕
        </button>
      </div>
      <ul className="max-h-[340px] overflow-y-auto py-1">
        {rows.map((row) => (
          <li
            key={row.id}
            draggable
            onDragStart={() => setDraggingId(row.id)}
            onDragEnd={() => setDraggingId(null)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggingId) move(draggingId, row.id);
              setDraggingId(null);
            }}
            className={`flex cursor-grab items-center gap-1.5 px-2 py-1 text-[12px] ${
              selectedIds.includes(row.id) ? 'bg-[#EFF6FF]' : 'hover:bg-[#F9FAFB]'
            } ${draggingId === row.id ? 'opacity-50' : ''}`}
          >
            <span className="w-3 shrink-0 text-center text-[10px] text-[var(--text-secondary)]">
              {row.kind === 'group' ? '▤' : '▢'}
            </span>
            <button
              type="button"
              className="flex-1 truncate text-left"
              onClick={() => select(row.id)}
              title={row.label}
            >
              {row.label}
            </button>
            {row.locked && <span className="text-[10px] text-[var(--text-secondary)]" title="已锁定">🔒</span>}
            <span className="flex shrink-0 gap-0.5">
              <button
                type="button"
                title="置顶"
                className="rounded px-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[#F3F4F6]"
                onClick={() => bringToFront([row.id])}
              >
                ↑
              </button>
              <button
                type="button"
                title="置底"
                className="rounded px-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[#F3F4F6]"
                onClick={() => sendToBack([row.id])}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-[var(--panel-border)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
        拖动行调整上下层级 · 组永远在节点下面
      </p>
    </div>
  );
}
