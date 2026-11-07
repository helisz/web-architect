import { useMemo, useState } from 'react';
import { MAX_GROUP_DEPTH } from '@arch/schema';
import { buildLayerRows, groupDepth, isSelfOrDescendant, subtreeHeight } from './layerTree.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 图层面板（阶段 2 第 5 项；2026-11-05 用户要求改成"树 + 拖拽改归属"）。
 *
 * 两件事分开：
 * 1. **层级关系**：按分组嵌套画成树（分组 > 子分组 > 节点），带缩进和展开箭头；
 * 2. **遮挡顺序**：仍然用每行的 ↑ / ↓ 按钮调 z 序（拖拽已经改作"改归属"，
 *    不再兼任排序，避免同一个手势有两个含义）。
 *
 * 拖拽语义（用户 2026-11-05 选定）：
 * - 拖到某个**分组行**上 → 放进这个分组（节点 / 子分组都可以）；
 * - 拖到列表底部的「顶层」投放区 → 移出分组，回到最外层；
 * - 成环、超过 3 层、原地放 → 不动，并给一句 toast 说明原因。
 */


export function LayerPanel() {
  const open = useDiagramStore((s) => s.layerPanelOpen);
  const setOpen = useDiagramStore((s) => s.setLayerPanelOpen);
  const nodes = useDiagramStore((s) => s.diagram.nodes);
  const groups = useDiagramStore((s) => s.diagram.groups);
  const select = useDiagramStore((s) => s.select);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const bringToFront = useDiagramStore((s) => s.bringToFront);
  const sendToBack = useDiagramStore((s) => s.sendToBack);
  const toggleLock = useDiagramStore((s) => s.toggleLock);
  const reparentNode = useDiagramStore((s) => s.reparentNode);
  const reparentGroup = useDiagramStore((s) => s.reparentGroup);
  const pushToast = useDiagramStore((s) => s.pushToast);

  const [dragging, setDragging] = useState<{ id: string; kind: 'node' | 'group' } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const rows = useMemo(() => buildLayerRows(groups, nodes, collapsed), [groups, nodes, collapsed]);

  if (!open) return null;

  /** 把拖拽行放到 targetParent（null = 顶层） */
  const drop = (targetParent: string | null): void => {
    if (!dragging) return;
    const item = dragging;
    setDragging(null);
    setDropTarget(null);

    const currentParent =
      item.kind === 'node'
        ? (nodes.find((n) => n.nodeId === item.id)?.groupId ?? null)
        : (groups.find((g) => g.groupId === item.id)?.parentGroupId ?? null);
    if (currentParent === targetParent) return;

    if (targetParent && item.kind === 'group') {
      if (isSelfOrDescendant(groups, item.id, targetParent)) {
        pushToast('不能把分组拖进它自己里面');
        return;
      }
      if (groupDepth(groups, targetParent) + subtreeHeight(groups, item.id) > MAX_GROUP_DEPTH) {
        pushToast(`分组最多嵌套 ${MAX_GROUP_DEPTH} 层`);
        return;
      }
    }
    if (targetParent && item.kind === 'node' && groupDepth(groups, targetParent) >= MAX_GROUP_DEPTH) {
      pushToast(`分组最多嵌套 ${MAX_GROUP_DEPTH} 层`);
      return;
    }

    if (item.kind === 'node') reparentNode(item.id, targetParent);
    else reparentGroup(item.id, targetParent);
  };

  return (
    <div className="glass anim-pop absolute right-3 top-12 z-20 w-[252px] overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-2.5 py-1.5">
        <span className="text-[12px] font-medium">图层（{rows.length}）</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          title="关闭"
        >
          ✕
        </button>
      </div>

      <ul className="max-h-[340px] overflow-y-auto py-1">
        {rows.map((row) => {
          const isDropTarget = dropTarget === row.id && row.kind === 'group' && dragging?.id !== row.id;
          return (
            <li
              key={row.id}
              draggable
              onDragStart={() => setDragging({ id: row.id, kind: row.kind })}
              onDragEnd={() => {
                setDragging(null);
                setDropTarget(null);
              }}
              onDragOver={(event) => {
                if (row.kind !== 'group' || !dragging) return;
                event.preventDefault();
                setDropTarget(row.id);
              }}
              onDragLeave={() => setDropTarget((current) => (current === row.id ? null : current))}
              onDrop={(event) => {
                if (row.kind !== 'group') return;
                event.preventDefault();
                drop(row.id);
              }}
              className={`flex items-center gap-1 pr-1.5 text-[12px] ${
                selectedIds.includes(row.id) ? 'bg-[var(--accent-50)]' : 'hover:bg-[var(--bg-hover)]'
              } ${dragging?.id === row.id ? 'opacity-50' : ''} ${
                isDropTarget ? 'outline outline-1 -outline-offset-1 outline-[var(--primary)]' : ''
              }`}
              style={{ paddingLeft: 6 + row.depth * 12 }}
            >
              {/* 展开箭头：只有分组才有；节点占同宽空位保持对齐 */}
              {row.kind === 'group' ? (
                <button
                  type="button"
                  title={row.collapsed ? '展开' : '收起'}
                  aria-label={row.collapsed ? '展开分组' : '收起分组'}
                  aria-expanded={!row.collapsed}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  className={`w-3 shrink-0 text-center text-[10px] ${
                    row.hasChildren ? 'text-[var(--text-secondary)]' : 'text-transparent'
                  }`}
                  disabled={!row.hasChildren}
                >
                  {row.collapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span className="w-3 shrink-0" />
              )}

              <span className="w-3 shrink-0 text-center text-[10px] text-[var(--text-secondary)]">
                {row.kind === 'group' ? '▤' : '▢'}
              </span>

              <button
                type="button"
                className="min-w-0 flex-1 truncate py-1 text-left"
                onClick={() => select(row.id)}
                title={row.kind === 'group' && row.childCount > 0 ? `${row.label}（${row.childCount}）` : row.label}
              >
                {row.label}
                {row.kind === 'group' && row.childCount > 0 && (
                  <span className="ml-1 text-[10px] text-[var(--text-secondary)]">{row.childCount}</span>
                )}
              </button>

              {/* 锁标记本身就是解锁按钮（用户 2026-11-04：属性面板 / 右键菜单 / 图层面板都要能解锁） */}
              <button
                type="button"
                title={row.locked ? '已锁定，点击解锁' : '点击锁定'}
                aria-label={row.locked ? '解锁' : '锁定'}
                aria-pressed={row.locked}
                onClick={() => toggleLock([row.id])}
                className={`shrink-0 rounded px-0.5 text-[10px] hover:bg-[var(--bg-hover)] ${
                  row.locked ? 'text-[var(--text-secondary)]' : 'text-transparent hover:text-[var(--text-secondary)]'
                }`}
              >
                🔒
              </button>
              <span className="flex shrink-0 gap-0.5">
                <button
                  type="button"
                  title="置顶"
                  className="rounded px-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  onClick={() => bringToFront([row.id])}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="置底"
                  className="rounded px-0.5 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  onClick={() => sendToBack([row.id])}
                >
                  ↓
                </button>
              </span>
            </li>
          );
        })}

        {/* 顶层投放区：把元素拖出分组 */}
        <li
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            setDropTarget('__root__');
          }}
          onDragLeave={() => setDropTarget((current) => (current === '__root__' ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            drop(null);
          }}
          className={`mx-1.5 my-1 rounded border border-dashed px-2 py-1 text-center text-[11px] ${
            dropTarget === '__root__'
              ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
              : 'border-[var(--panel-border)] text-[var(--text-secondary)]'
          }`}
        >
          拖到这里 → 移出分组（顶层）
        </li>
      </ul>

      <p className="border-t border-[var(--panel-border)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]">
        拖到分组行 = 放进该组 · ↑↓ 调遮挡顺序
      </p>
    </div>
  );
}
