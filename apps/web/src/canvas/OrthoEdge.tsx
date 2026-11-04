import { memo, useMemo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useStore } from '@xyflow/react';
import type { EdgeProps, InternalNode } from '@xyflow/react';
import { buildOrthoPath, type Rect } from '@arch/schema';
import { anchorOf, type OrthoFlowEdge } from './flowMapping.js';

/** InternalNode → Rect；尺寸未测量时先不画，避免闪一下错位的线 */
function rectOf(node: InternalNode | undefined): Rect | null {
  if (!node) return null;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  const abs = node.internals?.positionAbsolute;
  if (!abs) return null;
  return { x: abs.x, y: abs.y, width, height };
}

/**
 * 正交连线（规格 §11.3）。
 *
 * 路由是 `@arch/schema` 里的纯函数 `buildOrthoPath`：
 * 出入口外扩 8px、同轴反向 2 拐点、同侧出线绕行、拐点 4px 圆角。
 * 这样同一套算法既能被单测覆盖，也能被导出复用（不依赖 ReactFlow）。
 */
function OrthoEdgeImpl({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  data,
  selected,
  markerEnd,
  markerStart,
}: EdgeProps<OrthoFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);

  if (!sourceRect || !targetRect) return null;

  const edge = data?.edge;
  // 缩得很小时不渲染标签：字看不清还占一整个 DOM 节点（规格 §11.4 边标签延迟渲染）
  const zoom = useStore((s) => s.transform[2]);
  const showLabel = Boolean(edge?.label) && zoom >= 0.5;
  const obstacles = data?.obstacles;
  const sourceAnchor = anchorOf(sourceHandleId);
  const targetAnchor = anchorOf(targetHandleId);

  // 路径按"端点矩形 + 锚点 + 障碍数组"缓存：拖动时只有被拖节点的相邻边重算，
  // 其余边的入参都没变（obstacles 在拖动期间被冻结，见 Canvas），直接复用 path
  const { d, labelPoint } = useMemo(
    () => buildOrthoPath(sourceRect, sourceAnchor, targetRect, targetAnchor, obstacles),
    [sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, targetRect.x, targetRect.y, targetRect.width, targetRect.height, sourceAnchor, targetAnchor, obstacles],
  );

  const stroke = edge?.strokeColor ?? '#8B5CF6';
  const width = edge?.strokeWidth ?? 1.5;

  return (
    <>
      <BaseEdge
        id={id}
        path={d}
        markerEnd={markerEnd}
        markerStart={markerStart}
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
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
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

export const OrthoEdge = memo(OrthoEdgeImpl);

