import { memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import {
  ANCHOR_ORDER,
  dynamicHeaderHeight,
  isGroupLocked,
  isEditLocked,
  isIconHidden,
  isSingleLineGroup,
  isDynamicGroup,
  isDynamicZone,
  resolveIconKey,
  GROUP_ICON_KEY,
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
  // 动态容器（2026-11-07）：容器内一个「＋」打开批量添加
  const isDynamic = isDynamicGroup(group);
  const isZone = isDynamicZone(group);
  const openBatch = useDiagramStore((s) => s.openBatch);
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
      className={`relative h-full w-full rounded-[var(--radius-node)] border ${
        isZone ? 'border-dashed' : ''
      }`}
      style={{
        background: group.bgColor,
        borderColor: selected ? 'var(--primary)' : group.borderColor,
        borderWidth: selected || highlighted ? 2 : 1,
        borderStyle: isZone ? 'dashed' : 'solid',
        // 动态组的名称画在框外左上角，不能被自己裁掉
        overflow: isZone ? 'visible' : undefined,
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
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !border !border-[var(--primary)] !bg-white"
      />

      {/* 动态组（2026-11-07）：名称画在虚线框**外**的左上角，灰色等宽小字 + 图标。
          双击可改名；不参与节点包围盒（absolute + 负 top），不影响拖拽/缩放命中。 */}
      {isZone && (
        <div
          className="nodrag nopan absolute -top-5 left-0 flex max-w-full items-center gap-1 text-[11px] leading-4 text-[var(--text-tertiary)]"
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (!locked && !editLocked) setEditing(true);
          }}
          title="双击改名"
        >
          {!isIconHidden(group) && (
            <NodeIcon iconKey={resolveIconKey({ nodeType: GROUP_ICON_KEY, extJson: group.extJson })} size={12} className="shrink-0 opacity-70" />
          )}
          {editing ? (
            <input
              ref={inputRef}
              className="nodrag nopan w-40 rounded border border-[var(--primary)] bg-white px-1 text-[11px] text-[var(--text-primary)] outline-none"
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
            <span className="mono truncate">{group.label || '动态组'}</span>
          )}
        </div>
      )}

      {/* 动态容器的「＋」（用户 2026-11-08）：放到**框外下方居中**，不占内容区 */}
      {isDynamic && !locked && (
        <button
          type="button"
          title="批量添加节点"
          aria-label="批量添加节点"
          onClick={(e) => {
            e.stopPropagation();
            openBatch(group.groupId);
          }}
          className="nodrag nopan absolute left-1/2 z-10 grid h-6 w-6 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-dashed border-[var(--text-tertiary)] bg-white/85 text-[14px] leading-none text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]"
          style={{ bottom: -32 }}
        >
          ＋
        </button>
      )}

      {/* 标题栏：拖动组、改名都在这里。折叠三角已移除（用户 2026-11-04 第四批：
          标题栏只要名称 + 副文本，不再放按钮）；折叠仍可从属性面板和右键菜单操作。
          高度（2026-11-07 用户定）：勾了「副文本」至少 38px，副文本每多一行 +10px；
          没勾就是 24px（只有一行标题）。 */}
      {!isZone && (
      <div
        data-group-header
        className="flex items-start gap-1.5 rounded-t-[var(--radius-node)] px-2"
        style={{
          height: dynamicHeaderHeight(group),
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
                iconKey={resolveIconKey({ nodeType: GROUP_ICON_KEY, extJson: group.extJson })}
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
                副文本（2026-11-07 用户定）：
                - 不再单行省略 —— 太长就换行，标题栏高度按行数动态加高（见 groupHeaderHeight）；
                - 整体上移 2px（原来的 3px 间距改 1px）；
                - 输入框里敲的回车会原样换行（whitespace-pre-line）。
              */}
              {showSubLabel && (
                <div className="mono mt-[1px] whitespace-pre-line break-words text-[10px] leading-[10px] opacity-60">
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
      )}

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


