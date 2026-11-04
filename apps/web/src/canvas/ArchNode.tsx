import { memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { ANCHOR_ORDER, resolveIconKey, type Anchor } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import type { ArchFlowNode } from './flowMapping.js';

const POSITION: Record<Anchor, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * 业务节点（规格 §3.3 / §5.2）：白底、1px 描边、8px 圆角、**无阴影**、无渐变。
 *
 * C2：这是唯一的业务节点组件，图标/默认尺寸靠 `data.node.nodeType` 分派，
 * 不把 32 个 nodeType 注册成 32 个 ReactFlow 类型。
 */
function ArchNodeImpl({ data, selected }: NodeProps<ArchFlowNode>) {
  const node = data.node;
  // 小节点里图标要让位给文字，按高度自适应；太矮就干脆不画，免得挤压标签
  const showIcon = node.height >= 52;
  const iconSize = Math.max(14, Math.min(22, Math.round(node.height * 0.28)));
  const patchNode = useDiagramStore((s) => s.patchNode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(node.label);
  }, [node.label, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== node.label) patchNode(node.nodeId, { label: next });
    else setDraft(node.label);
  };

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-2 text-center"
      style={{
        background: node.bgColor,
        borderColor: selected ? 'var(--primary)' : node.borderColor,
        borderWidth: selected ? 2 : 1,
        color: node.textColor,
        // 规格 §5.2：禁止阴影，选中只用描边宽度与颜色区分
        boxShadow: 'none',
        opacity: node.visible ? 1 : 0.4,
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!node.locked) setEditing(true);
      }}
    >
      {/* 拖拽改尺寸（规格 §5.3）：锁定的节点不给手柄 */}
      <NodeResizer
        isVisible={selected && !node.locked}
        minWidth={64}
        minHeight={40}
        lineClassName="!border-[var(--primary)]"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--primary)] !bg-white"
      />

      {editing ? (
        <input
          ref={inputRef}
          className="nodrag nopan w-full rounded border border-[var(--primary)] bg-white px-1 text-center text-[13px] outline-none"
          style={{ color: node.textColor }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(node.label);
              setEditing(false);
            }
            e.stopPropagation();
          }}
        />
      ) : (
        <>
          {/* 图标（C15）：schema 只存 iconKey，图案由本地图标包渲染 */}
          {showIcon && (
            <NodeIcon iconKey={resolveIconKey(node)} size={iconSize} className="shrink-0 opacity-90" />
          )}
          <span className="w-full truncate text-[13px] font-medium leading-tight">{node.label}</span>
        </>
      )}

      {node.subLabel && (
        <span className="mono w-full truncate text-[11px] leading-tight opacity-70">
          {node.subLabel}
        </span>
      )}

      {/* 四边各一个 Handle；配合 ConnectionMode.Loose，任意边都能起线/接收。
          命中区 24px（透明），视觉圆点仍是 8px —— 拖出/接收都更好点中 */}
      {ANCHOR_ORDER.map((anchor) => (
        <Handle
          key={anchor}
          id={anchor}
          type="source"
          position={POSITION[anchor]}
          className="arch-handle"
          style={{ opacity: selected ? 1 : 0 }}
        >
          <span className="arch-handle-dot" />
        </Handle>
      ))}
    </div>
  );
}

export const ArchNode = memo(ArchNodeImpl);


