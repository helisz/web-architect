import { memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  ANCHOR_ORDER,
  groupHeaderHeight,
  isGroupLocked,
  isEditLocked,
  isIconHidden,
  isSingleLineGroup,
  resolveIconKey,
  type Anchor,
} from '@arch/schema';
import { NodeIcon } from '../icons/index.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import type { SwimlaneFlowNode } from './flowMapping.js';

/** 锚点 → ReactFlow 位置（与 ArchNode 中的映射一致） */
const POSITION: Record<Anchor, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

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
  const editRequestId = useDiagramStore((s) => s.editRequestId);
  const highlighted = useDiagramStore((s) => s.highlightId === group.groupId);
  const requestEdit = useDiagramStore((s) => s.requestEdit);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.label);
  const inputRef = useRef<HTMLInputElement>(null);

  const showSubLabel = Boolean(group.subLabel) && !isSingleLineGroup(group);
  const locked = isGroupLocked(group);
  // 全局锁定编辑：改名也一起关掉
  const editLocked = useDiagramStore((s) => isEditLocked(s.diagram));

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
      className="h-full w-full rounded-[var(--radius-node)] border"
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

      {/* 标题栏：拖动组、改名都在这里。折叠三角已移除（用户 2026-11-04 第四批：
          标题栏只要名称 + 副文本，不再放按钮）；折叠仍可从属性面板和右键菜单操作。
          高度：带副文本 38px（上边距 2 + 标题 16 + 副文本两行 2×10），
          不带副文本的通用分组 24px。 */}
      <div
        className="flex items-start gap-1.5 rounded-t-[var(--radius-node)] px-2"
        style={{
          height: groupHeaderHeight(group),
          color: group.titleColor,
          borderBottom: `1px solid ${group.borderColor}`,
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag nopan mt-1 w-40 rounded border border-[var(--primary)] bg-white px-1 text-xs outline-none"
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
                className={`${showSubLabel ? 'mt-[6px]' : 'mt-[5px]'} shrink-0 opacity-70`}
              />
            )}
            <div className={`min-w-0 flex-1 ${showSubLabel ? 'pt-[5px]' : 'pt-[4px]'}`}>
              <div
                className="truncate text-xs font-medium leading-[16px]"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!locked && !editLocked) setEditing(true);
                }}
              >
                {group.label}
              </div>
              {/*
                副文本：10px 等宽，**只显示一行**、超出用省略号（用户 2026-11-05）。
                标题栏固定 38px（2 上边距 + 16 标题 + 3 间距 + 10 一行），
                换行内容仍完整存在数据里，属性面板能看到全文。
              */}
              {showSubLabel && (
                <div className="mono mt-[3px] truncate text-[10px] leading-[10px] opacity-60">
                  {group.subLabel}
                </div>
              )}
            </div>
          </>
        )}

        {/* 锁定的分组留一个小锁标记（三角按钮已移除，这个只是状态提示） */}
        {locked && (
          <span
            className="ml-auto mt-[3px] shrink-0 text-[10px] leading-4 opacity-50"
            title="分组已锁定"
            aria-label="分组已锁定"
          >
            🔒
          </span>
        )}
      </div>

      {/* 分组也能连线（用户 2026-11-04）：四边各一个 source Handle，配合 ConnectionMode.Loose
          任意边起线/接收。视觉与节点手柄同一套 .arch-handle（8px 本体 + 24px 命中区，
          平时透明，鼠标移到分组上才显形），锁定的分组不给手柄。 */}
      {!locked &&
        ANCHOR_ORDER.map((anchor) => (
          <Handle
            key={anchor}
            id={anchor}
            type="source"
            position={POSITION[anchor]}
            className={`arch-handle${selected ? ' is-visible' : ''}`}
          >
            <span className="arch-handle-dot" />
          </Handle>
        ))}
    </div>
  );
}

export const SwimlaneNode = memo(SwimlaneNodeImpl);


