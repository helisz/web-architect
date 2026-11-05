import { memo, useCallback, useState } from 'react';
import { useStore } from '@xyflow/react';
import { isEditLocked } from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useCanvasMode } from '../store/useCanvasMode.js';
import { absoluteEndpoints, lineGeometry, readLineData, snapEndpoint } from './lineGeometry.js';
import type { DiagramNode } from '@arch/schema';

/**
 * 自由线条（用户 2026-11-05）。
 *
 * 和连线（edge）不是一回事：连线必须挂在两个节点上，线条是独立元素，
 * 用来画分割线、装饰线、示意箭头杆。数据上它是 `nodeType: 'line'` 的节点，
 * 端点存在 `extJson.line`，节点盒子就是端点包围盒（见 lineGeometry.ts）。
 *
 * 交互：
 * - 拖两个端点圆点改方向/长度；靠近水平、垂直、45° 时**自动吸附**；
 * - 按住 `Shift` 强制按 45° 步进（偏多少都拉回来）；
 * - 整体拖动就是拖节点本身（React Flow 原生），端点跟着走，不需要额外代码。
 */
function ArchLineImpl({ node, selected }: { node: DiagramNode; selected: boolean }) {
  const editLocked = useDiagramStore((s) => isEditLocked(s.diagram));
  const panMode = useCanvasMode((s) => s.panMode);
  const setLineGeometry = useDiagramStore((s) => s.setLineGeometry);
  // 缩放补偿：手柄要保持屏幕尺寸恒定，和连线折点手柄同一套做法
  const zoom = useStore((s) => s.transform[2]);

  const line = readLineData(node.extJson, node.width, node.height);
  const showHandles = selected && !editLocked && !panMode;
  const [dragging, setDragging] = useState<'a' | 'b' | null>(null);

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent, which: 'a' | 'b') => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const abs = absoluteEndpoints(node, line);
      const startClient = { x: event.clientX, y: event.clientY };
      const handleStart = which === 'a' ? abs.a : abs.b;
      // 固定另一端当锚点：吸附只改拖的这一端
      const anchorAbs = which === 'a' ? abs.b : abs.a;
      setDragging(which);

      const move = (e: PointerEvent) => {
        const delta = { x: (e.clientX - startClient.x) / zoom, y: (e.clientY - startClient.y) / zoom };
        const flowPointer = { x: handleStart.x + delta.x, y: handleStart.y + delta.y };
        const snapped = snapEndpoint(anchorAbs, flowPointer, { force: e.shiftKey });
        setLineGeometry(node.nodeId, lineGeometry(anchorAbs, snapped));
      };
      const up = () => {
        setDragging(null);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [line, node, setLineGeometry, zoom],
  );

  const stroke = node.borderColor;
  const dash = line.dash ?? undefined;

  return (
    <div
      className="relative h-full w-full"
      style={{ background: 'transparent', opacity: node.visible ? 1 : 0.4 }}
    >
      {/* 线本体：svg 撑满盒子，`overflow-visible` 让圆点手柄不被裁掉 */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <line
          x1={line.a.x}
          y1={line.a.y}
          x2={line.b.x}
          y2={line.b.y}
          stroke={stroke}
          strokeWidth={line.width}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
        {/* 选中态：只在线上加一层淡色加粗底，不画包围盒（盒子是 64×40 的隐形框，画出来很难看） */}
        {selected && (
          <line
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke="var(--primary)"
            strokeWidth={line.width + 4}
            strokeLinecap="round"
            opacity={0.18}
          />
        )}
      </svg>

      {showHandles &&
        (['a', 'b'] as const).map((which) => {
          const point = line[which];
          return (
            <div
              key={which}
              role="button"
              tabIndex={-1}
              aria-label={which === 'a' ? '拖动起点' : '拖动终点'}
              title={which === 'a' ? '拖动起点（Shift 强制 45°）' : '拖动终点（Shift 强制 45°）'}
              onPointerDown={(event) => onHandlePointerDown(event, which)}
              className="nodrag nopan absolute rounded-full border-2 bg-white"
              style={{
                left: point.x,
                top: point.y,
                width: 10,
                height: 10,
                marginLeft: -5,
                marginTop: -5,
                borderColor: 'var(--primary)',
                transform: `scale(${1 / zoom})`,
                cursor: dragging === which ? 'grabbing' : 'grab',
                // 手柄必须压过节点本身，否则点不到
                zIndex: 20,
              }}
            />
          );
        })}
    </div>
  );
}

export const ArchLine = memo(ArchLineImpl);
