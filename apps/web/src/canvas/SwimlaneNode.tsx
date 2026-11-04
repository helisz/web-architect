import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { GROUP_HEADER_HEIGHT, resolveIconKey } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import type { SwimlaneFlowNode } from './flowMapping.js';

/**
 * 分组泳道（规格 §5.3 / C9）。
 *
 * 两个容易踩的点：
 * 1. 折叠只影响**显示高度**，Schema 里的 height 仍是展开高度，展开时尺寸自动还原；
 * 2. 分组整体拖动由 ReactFlow 的 parentId 负责，子节点存的是局部坐标，
 *    因此不需要（也不允许）在拖动时手工给孩子加偏移——那正是历史上坐标漂移的来源。
 */
function SwimlaneNodeImpl({ data, selected }: NodeProps<SwimlaneFlowNode>) {
  const group = data.group;
  const patchGroup = useDiagramStore((s) => s.patchGroup);
  const requestDelete = useDiagramStore((s) => s.requestDelete);
  const toggleGroupCollapsed = useDiagramStore((s) => s.toggleGroupCollapsed);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(group.label);
  }, [group.label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== group.label) patchGroup(group.groupId, { label: next });
    else setDraft(group.label);
  };

  return (
    <div
      className="h-full w-full rounded-lg border"
      style={{
        background: group.bgColor,
        borderColor: selected ? 'var(--primary)' : group.borderColor,
        borderWidth: selected ? 2 : 1,
        boxShadow: 'none',
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={120}
        minHeight={80}
        lineClassName="!border-[var(--primary)]"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--primary)] !bg-white"
      />

      {/* 标题栏：拖动组、折叠、改名、删除都在这里 */}
      <div
        className="flex items-center gap-1 rounded-t-lg px-2 text-xs font-medium"
        style={{ height: GROUP_HEADER_HEIGHT, color: group.titleColor, borderBottom: `1px solid ${group.borderColor}` }}
      >
        <button
          type="button"
          className="nodrag grid h-4 w-4 place-items-center rounded hover:bg-black/5"
          title={group.collapsed ? '展开分组' : '折叠分组'}
          onClick={(e) => {
            e.stopPropagation();
            toggleGroupCollapsed(group.groupId);
          }}
        >
          {group.collapsed ? '▸' : '▾'}
        </button>

        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan w-40 rounded border border-[var(--primary)] bg-white px-1 text-xs outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(group.label);
                setEditing(false);
              }
              e.stopPropagation();
            }}
          />
        ) : (
          <>
          <NodeIcon iconKey={resolveIconKey({ nodeType: 'group', extJson: group.extJson })} size={13} className="shrink-0 opacity-60" />
          <span
            className="truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {group.label}
          </span>
          </>
        )}

        <span className="mono ml-auto text-[10px] opacity-50">
          {group.collapsed ? '已折叠' : `${group.width}×${group.height}`}
        </span>
        <button
          type="button"
          className="nodrag grid h-4 w-4 place-items-center rounded text-[10px] hover:bg-black/5"
          title="删除分组（里面的节点会保留并提升到上一层）"
          onClick={(e) => {
            e.stopPropagation();
            // 规格 §5.3：删除分组要二次确认（里面的节点不会被删，只提升到上一层）
            if (window.confirm(`删除分组「${group.label}」？组里的节点会保留并移到上一层。`)) {
              requestDelete([group.groupId]);
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export const SwimlaneNode = memo(SwimlaneNodeImpl);



