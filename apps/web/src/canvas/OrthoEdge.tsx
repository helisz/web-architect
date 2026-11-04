import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode } from '@xyflow/react';
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
  const { d, labelPoint } = buildOrthoPath(
    sourceRect,
    anchorOf(sourceHandleId),
    targetRect,
    anchorOf(targetHandleId),
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
      {edge?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-white/90 px-1 py-0.5 text-[11px]"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPoint.x}px, ${labelPoint.y}px)`,
              color: 'var(--text-secondary)',
            }}
          >
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const OrthoEdge = memo(OrthoEdgeImpl);
