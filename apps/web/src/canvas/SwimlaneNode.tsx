import { memo, useEffect, useRef, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { groupHeaderHeight, isGroupLocked, isIconHidden, isSingleLineGroup, resolveIconKey } from '@arch/schema';
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
  const toggleGroupCollapsed = useDiagramStore((s) => s.toggleGroupCollapsed);
  const editRequestId = useDiagramStore((s) => s.editRequestId);
  const highlighted = useDiagramStore((s) => s.highlightId === group.groupId);
  const requestEdit = useDiagramStore((s) => s.requestEdit);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSubLabel = Boolean(group.subLabel) && !isSingleLineGroup(group);
  const locked = isGroupLocked(group);

  // 右键菜单「重命名」通过 store 请求进入行内编辑（锁定的组不给改名）
  useEffect(() => {
    if (editRequestId && editRequestId === group.groupId && !locked) {
      setEditing(true);
      requestEdit(null);
    }
  }, [editRequestId, group.groupId, locked, requestEdit]);

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
        borderWidth: selected || highlighted ? 2 : 1,
        outline: highlighted ? '3px solid rgba(36,91,219,0.35)' : undefined,
        outlineOffset: highlighted ? 2 : undefined,
        boxShadow: 'none',
      }}
    >
      <NodeResizer
        isVisible={selected && !locked}
        minWidth={120}
        minHeight={80}
        lineClassName="!border-[var(--primary)]"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--primary)] !bg-white"
      />

      {/* 标题栏：拖动组、改名、折叠都在这里；折叠三角固定在标题栏最右边。
          两行（名称 + 副文本），图标与**第一行**顶部对齐（items-start）；
          通用分组（singleLine）不给副文本，高度回到一行的 32px。 */}
      <div
        className="flex items-start gap-1.5 rounded-t-lg px-2"
        style={{
          height: groupHeaderHeight(group),
          color: group.titleColor,
          borderBottom: `1px solid ${group.borderColor}`,
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan mt-1.5 w-40 rounded border border-[var(--primary)] bg-white px-1 text-xs outline-none"
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
            {!isIconHidden(group) && (
              <NodeIcon
                iconKey={resolveIconKey({ nodeType: 'group', extJson: group.extJson })}
                size={14}
                className="mt-[5px] shrink-0 opacity-70"
              />
            )}
            <div className="min-w-0 flex-1 pt-[4px]">
              <div
                className="truncate text-xs font-medium leading-[16px]"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!locked) setEditing(true);
                }}
              >
                {group.label}
              </div>
              {showSubLabel && (
                <div className="truncate text-[10px] leading-[14px] opacity-60">{group.subLabel}</div>
              )}
            </div>
          </>
        )}

        {/* 锁定的分组不显示折叠三角（用户 2026-11-04），顺带给出一个小锁标记 */}
        {locked ? (
          <span
            className="ml-auto mt-[3px] shrink-0 text-[10px] leading-4 opacity-50"
            title="分组已锁定"
            aria-label="分组已锁定"
          >
            🔒
          </span>
        ) : (
          <button
            type="button"
            className="nodrag mt-[3px] ml-auto grid h-4 w-4 shrink-0 place-items-center rounded hover:bg-black/5"
            title={group.collapsed ? '展开分组' : '折叠分组'}
            onClick={(e) => {
              e.stopPropagation();
              toggleGroupCollapsed(group.groupId);
            }}
          >
            {group.collapsed ? '▸' : '▾'}
          </button>
        )}
      </div>
    </div>
  );
}

export const SwimlaneNode = memo(SwimlaneNodeImpl);



