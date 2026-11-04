import { Position, getBezierPath } from '@xyflow/react';
import type { ConnectionLineComponentProps } from '@xyflow/react';

/** 拖线时那个小箭头的尺寸，与落库后 ArchEdge 的箭头一致 */
const ARROW = 10;

/**
 * 拖拽建线时的预览线（用户 2026-11-04：以前用的是 RF 默认连接线，
 * 1px 淡灰 + 无箭头，白底上基本看不见，经常"以为没拉出来"）。
 *
 * 这里换成主色 2px 虚线 + 箭头 + 起点圆点：从哪条边出发、现在指到哪，一眼能看到。
 */
export function ArchConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
}: ConnectionLineComponentProps) {
  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition ?? Position.Right,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition ?? Position.Left,
  });

  return (
    <g>
      <defs>
        <marker
          id="arch-connection-arrow"
          markerUnits="userSpaceOnUse"
          markerWidth={ARROW}
          markerHeight={ARROW}
          refX={ARROW - 0.5}
          refY={ARROW / 2}
          orient="auto-start-reverse"
          viewBox={`0 0 ${ARROW} ${ARROW}`}
        >
          <path d={`M 0 0.6 L ${ARROW} ${ARROW / 2} L 0 ${ARROW - 0.6} Z`} style={{ fill: 'var(--primary)' }} />
        </marker>
      </defs>
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        strokeDasharray="6 4"
        markerEnd="url(#arch-connection-arrow)"
        style={{ stroke: 'var(--primary)' }}
      />
      <circle cx={fromX} cy={fromY} r={3} style={{ fill: 'var(--primary)' }} />
    </g>
  );
}
