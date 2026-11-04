import { memo, useMemo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  useStore,
} from '@xyflow/react';
import type { EdgeProps, InternalNode } from '@xyflow/react';
import { anchorPoint, type Anchor, type Rect } from '@arch/schema';
import { anchorOf, type ArchFlowEdge } from './flowMapping.js';

/** 箭头尺寸（userSpaceOnUse，固定 10px，不随线宽放大） */
const ARROW = 10;

/** InternalNode → Rect；尺寸未测量时返回 null，避免闪一下错位的线 */
function rectOf(node: InternalNode | undefined): Rect | null {
  if (!node) return null;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  const abs = node.internals?.positionAbsolute;
  if (!abs) return null;
  return { x: abs.x, y: abs.y, width, height };
}

/** 锚点 → ReactFlow 的 Position（只给标准曲线算进出方向用） */
function positionOf(anchor: Anchor): Position {
  switch (anchor) {
    case 'top':
      return Position.Top;
    case 'bottom':
      return Position.Bottom;
    case 'left':
      return Position.Left;
    case 'right':
      return Position.Right;
  }
}

/**
 * 连线绘制（用户 2026-11-04 第 3 批改定）。
 *
 * 端点统一由"节点矩形 + 锚点"算出、**贴住节点边框**：RF 自己算端点时会用 handle
 * 元素的 DOM 矩形（`x + width`），handle 一大线头就离边框十来像素，看着"没连上"；
 * 这里绕开 handle 测量，直接落边框。
 *
 * 三种线型全部用 **React Flow 官方策略**（用户要求"照插件默认来"）：
 * - 正交：`getSmoothStepPath`（默认 offset 20 / borderRadius 5 / stepPosition 0.5）
 * - 曲线：`getBezierPath`
 * - 直线：`getStraightPath`
 *
 * 之前自研的 `buildOrthoPath`（绕障碍 + 同侧绕联合包围盒）会为了躲节点把线掰出
 * 多余的折角，视觉上"绕圈 / 偏斜"，已删除（代码留在 git 历史里）。
 *
 * 箭头用自绘 marker：`markerUnits="userSpaceOnUse"` 固定 10px，
 * 线宽 1→4 时箭头不再跟着放大；`refX` 落在箭头尖上，箭尖正好戳在节点边框。
 */
function ArchEdgeImpl({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  data,
  selected,
}: EdgeProps<ArchFlowEdge>) {
  // 所有 hook 必须在最外层：节点还没测量时直接 return null 会让 hook 数量变化，
  // React 会报 "change in the order of Hooks"（之前就踩过）。
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const zoom = useStore((s) => s.transform[2]);

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);

  const edge = data?.edge;
  const sourceAnchor = anchorOf(sourceHandleId);
  const targetAnchor = anchorOf(targetHandleId);
  const edgeType = edge?.edgeType ?? 'ortho';

  const geometry = useMemo(() => {
    if (!sourceRect || !targetRect) return null;
    const start = anchorPoint(sourceRect, sourceAnchor);
    const end = anchorPoint(targetRect, targetAnchor);

    if (edgeType === 'bezier') {
      const [d, labelX, labelY] = getBezierPath({
        sourceX: start.x,
        sourceY: start.y,
        sourcePosition: positionOf(sourceAnchor),
        targetX: end.x,
        targetY: end.y,
        targetPosition: positionOf(targetAnchor),
      });
      return { d, labelPoint: { x: labelX, y: labelY } };
    }
    if (edgeType === 'straight') {
      const [d, labelX, labelY] = getStraightPath({
        sourceX: start.x,
        sourceY: start.y,
        targetX: end.x,
        targetY: end.y,
      });
      return { d, labelPoint: { x: labelX, y: labelY } };
    }
    // 正交：React Flow 标准折线（与插件内建 "smoothstep" 线型完全一致）
    const [d, labelX, labelY] = getSmoothStepPath({
      sourceX: start.x,
      sourceY: start.y,
      sourcePosition: positionOf(sourceAnchor),
      targetX: end.x,
      targetY: end.y,
      targetPosition: positionOf(targetAnchor),
    });
    return { d, labelPoint: { x: labelX, y: labelY } };
  }, [
    sourceRect?.x,
    sourceRect?.y,
    sourceRect?.width,
    sourceRect?.height,
    targetRect?.x,
    targetRect?.y,
    targetRect?.width,
    targetRect?.height,
    sourceAnchor,
    targetAnchor,
    edgeType,
  ]);

  if (!geometry) return null;

  const stroke = edge?.strokeColor ?? '#8B5CF6';
  const width = edge?.strokeWidth ?? 1.5;
  const arrow = edge?.arrow ?? 'none';
  const arrowColor = selected ? 'var(--primary)' : stroke;

  // 箭头颜色跟着线走，所以 marker 只能一条线一个；用暖一点的 tip 对齐：refX = 尺寸
  const markerId = `arch-arrow-${id}`;
  const hasArrow = Boolean(edge) && (arrow === 'forward' || arrow === 'backward' || arrow === 'both');

  // 缩得很小时不渲染标签：字看不清还占一整个 DOM 节点（规格 §11.4 边标签延迟渲染）
  const showLabel = Boolean(edge?.label) && zoom >= 0.5;

  return (
    <>
      {hasArrow && (
        <defs>
          <marker
            id={markerId}
            markerUnits="userSpaceOnUse"
            markerWidth={ARROW}
            markerHeight={ARROW}
            refX={ARROW - 0.5}
            refY={ARROW / 2}
            orient="auto-start-reverse"
            viewBox={`0 0 ${ARROW} ${ARROW}`}
          >
            {/* fill 走 style：选中色是 css 变量，写在 SVG 属性里不生效 */}
            <path d={`M 0 0.6 L ${ARROW} ${ARROW / 2} L 0 ${ARROW - 0.6} Z`} style={{ fill: arrowColor }} />
          </marker>
        </defs>
      )}
      <BaseEdge
        id={id}
        path={geometry.d}
        markerEnd={arrow === 'forward' || arrow === 'both' ? `url(#${markerId})` : undefined}
        markerStart={arrow === 'backward' || arrow === 'both' ? `url(#${markerId})` : undefined}
        style={{
          stroke: selected ? 'var(--primary)' : stroke,
          strokeWidth: selected ? width + 0.5 : width,
          strokeDasharray: edge?.strokeDasharray ?? undefined,
        }}
        interactionWidth={12}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-white/90 px-1 py-0.5 text-[11px]"
            style={{
              transform: `translate(-50%, -50%) translate(${geometry.labelPoint.x}px, ${geometry.labelPoint.y}px)`,
              color: 'var(--text-secondary)',
            }}
          >
            {edge?.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ArchEdge = memo(ArchEdgeImpl);
