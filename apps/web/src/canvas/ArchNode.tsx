import { memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { ANCHOR_ORDER, resolveIconKey, type Anchor } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import type { ArchFlowNode } from './flowMapping.js';
import { angleFromOffset, tailAngleOf, tailGeometry } from './tail.js';

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
 *
 * 2026-11-04 起，文本类（标题 / 文本 / 便利贴 / 注释）也走这个组件，
 * 只是渲染分支不同：仍然是可以连线、可以进分组、可以多选对齐的**真节点**。
 */
function ArchNodeImpl({ data, selected }: NodeProps<ArchFlowNode>) {
  const node = data.node;
  const kind = node.nodeType;
  const isTitle = kind === 'title';
  const isSticky = kind === 'sticky';
  const isAnnotation = kind === 'annotation';
  const isPlainText = kind === 'text';
  const isTextLike = isTitle || isSticky || isAnnotation || isPlainText;

  // 小节点里图标要让位给文字，按高度自适应；太矮就干脆不画，免得挤压标签
  const showIcon = node.height >= 52 && !isTextLike;
  const iconSize = Math.max(14, Math.min(22, Math.round(node.height * 0.28)));
  const patchNode = useDiagramStore((s) => s.patchNode);
  // 右键菜单「编辑名称」通过 store 请求进入行内编辑
  const editRequestId = useDiagramStore((s) => s.editRequestId);
  const highlighted = useDiagramStore((s) => s.highlightId === node.nodeId);
  const requestEdit = useDiagramStore((s) => s.requestEdit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  /** 拖尖角时临时覆盖角度，松手才写进 store（避免一次拖动刷几百次状态） */
  const [dragAngle, setDragAngle] = useState<number | null>(null);

  useEffect(() => {
    if (editRequestId && editRequestId === node.nodeId && !node.locked) {
      setEditing(true);
      requestEdit(null);
    }
  }, [editRequestId, node.nodeId, node.locked, requestEdit]);

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

  const tailAngle = dragAngle ?? tailAngleOf(node.extJson);
  const tail = isAnnotation ? tailGeometry(node.width, node.height, tailAngle) : null;

  /** 拖尖角手柄：按指针相对节点中心的偏移算角度，松手写回 extJson */
  const startTailDrag = (e: React.PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let latest = tailAngle;
    const move = (ev: PointerEvent): void => {
      latest = angleFromOffset(ev.clientX - centerX, ev.clientY - centerY);
      setDragAngle(latest);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragAngle(null);
      if (latest !== tailAngleOf(node.extJson)) {
        patchNode(node.nodeId, { extJson: { ...node.extJson, tailAngle: latest } });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={boxRef}
      className={`relative flex h-full w-full flex-col ${
        isTitle
          ? 'items-start justify-center px-1 text-left'
          : isSticky
            ? 'items-start justify-start overflow-hidden rounded-sm px-2.5 py-2 text-left'
            : isAnnotation
              ? 'items-start justify-start rounded-lg px-2.5 py-2 text-left'
              : isPlainText
                ? 'items-start justify-center px-2 text-left'
                : 'items-center justify-center gap-0.5 rounded-lg border px-2 text-center'
      }`}
      style={{
        background: node.bgColor,
        borderColor: selected ? 'var(--primary)' : node.borderColor,
        borderWidth: isTitle || isPlainText ? 0 : selected || highlighted ? 2 : 1,
        borderStyle: 'solid',
        outline: highlighted ? '3px solid rgba(36,91,219,0.35)' : undefined,
        outlineOffset: 2,
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
        minWidth={isTitle ? 80 : 64}
        minHeight={isTitle ? 32 : 40}
        lineClassName="!border-[var(--primary)]"
        handleClassName="!h-2 !w-2 !rounded-sm !border !border-[var(--primary)] !bg-white"
      />

      {editing ? (
        <input
          ref={inputRef}
          className="nodrag nopan w-full rounded border border-[var(--primary)] bg-white px-1 text-[13px] outline-none"
          style={{ color: node.textColor, textAlign: isTextLike ? 'left' : 'center' }}
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
          <span
            className={
              isTitle
                ? 'w-full truncate text-[17px] font-semibold leading-snug'
                : isSticky
                  ? 'w-full whitespace-pre-wrap break-words text-[13px] leading-snug'
                  : isAnnotation
                    ? 'w-full whitespace-pre-wrap break-words text-[12px] leading-snug'
                    : isPlainText
                      ? 'w-full whitespace-pre-wrap break-words text-[13px] leading-snug'
                      : 'w-full truncate text-[13px] font-medium leading-tight'
            }
          >
            {node.label}
          </span>
        </>
      )}

      {node.subLabel && !isAnnotation && (
        <span
          className={`mono w-full truncate text-[11px] leading-tight opacity-70 ${
            isTitle || isPlainText || isSticky ? 'text-left' : ''
          }`}
        >
          {node.subLabel}
        </span>
      )}

      {/* 气泡尖角：贴着矩形边界画一个三角形，根部永远在边上，方向自由 */}
      {tail && (
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width="100%"
          height="100%"
          aria-hidden
        >
          <polygon
            points={`${tail.baseA.x},${tail.baseA.y} ${tail.tip.x},${tail.tip.y} ${tail.baseB.x},${tail.baseB.y}`}
            fill={node.bgColor}
            stroke={selected ? 'var(--primary)' : node.borderColor}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* 尖角方向手柄：只在选中时出现，拖动改方向（自由角度，吸附 1°） */}
      {tail && selected && !node.locked && (
        <div
          className="nodrag nopan absolute z-10 grid h-3.5 w-3.5 place-items-center rounded-full border border-white bg-[var(--primary)] shadow-none"
          style={{ left: tail.tip.x - 7, top: tail.tip.y - 7, cursor: 'grab' }}
          title="拖动改变气泡尖角方向"
          onPointerDown={startTailDrag}
        />
      )}

      {/* 四边各一个 Handle；配合 ConnectionMode.Loose，任意边都能起线/接收。
          手柄本体 8px（RF 会读它的 DOM 矩形来算连线端点，做大了端点会离边框十来像素），
          24px 的命中区由 .arch-handle::after 提供，不参与测量。
          未选中时也淡显，鼠标移到节点上就全亮 —— 以前只在选中时可见，
          根本看不出能从哪儿拉线。 */}
      {ANCHOR_ORDER.map((anchor) => (
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

export const ArchNode = memo(ArchNodeImpl);
