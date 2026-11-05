import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import type { EdgeProps, InternalNode } from '@xyflow/react';
import { anchorPoint, isEditLocked, type Anchor, type Rect } from '@arch/schema';
import { anchorOf, type ArchFlowEdge } from './flowMapping.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useEdgeLabelEdit } from '../store/useEdgeLabelEdit.js';
import { useCanvasMode } from '../store/useCanvasMode.js';
import {
  buildPath,
  MAX_WAYPOINTS,
  midpointInsertIndex,
  pointAt,
  readWaypoints,
  snap,
  writeWaypoints,
  type Pt,
} from './edgeGeometry.js';

/** 箭头尺寸（userSpaceOnUse，固定 10px，不随线宽放大） */
const ARROW = 10;

/** 拖动中的端点：记录拖的是哪一头、当前落在哪条边上 */
interface AnchorDrag {
  end: 'source' | 'target';
  anchor: Anchor;
}

function rectOf(node: InternalNode | undefined): Rect | null {
  if (!node) return null;
  const width = node.measured?.width ?? 0;
  const height = node.measured?.height ?? 0;
  if (width <= 0 || height <= 0) return null;
  const abs = node.internals?.positionAbsolute;
  if (!abs) return null;
  return { x: abs.x, y: abs.y, width, height };
}

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

/** 把指针位置换算成"离节点哪条边最近"，用于拖端点换锚点 */
function nearestAnchor(rect: Rect, p: Pt): Anchor {
  const dl = Math.abs(p.x - rect.x);
  const dr = Math.abs(p.x - (rect.x + rect.width));
  const dt = Math.abs(p.y - rect.y);
  const db = Math.abs(p.y - (rect.y + rect.height));
  const min = Math.min(dl, dr, dt, db);
  if (min === dl) return 'left';
  if (min === dr) return 'right';
  if (min === dt) return 'top';
  return 'bottom';
}

/**
 * 连线绘制（用户 2026-11-04 第 3 批改定；2026-11-05 第 8 批加拖拽改路线）。
 *
 * 端点统一由"节点矩形 + 锚点"算出、**贴住节点边框**：RF 自己算端点时会用 handle
 * 元素的 DOM 矩形（`x + width`），handle 一大线头就离边框十来像素，看着"没连上"；
 * 这里绕开 handle 测量，直接落边框。
 *
 * 三种线型：
 * - 无折点时走 React Flow 官方生成器（和以前逐像素一致，老图不受影响）；
 * - 有折点时走 `edgeGeometry.buildPath`：直线=折线、正交=横纵段、曲线=Catmull-Rom。
 *
 * 拖拽（用户 2026-11-05 第 8 批）：
 * - 拖**两端的小圆点** → 换锚点（从节点的哪条边出/进）；
 * - 拖**线上中点的小＋** → 生成一个折点，之后可继续拖；
 * - 双击折点 → 删掉它；
 * - 全部 10px 吸附；拖动过程只改本地预览，松手才写进 store（一次撤销、一次自动保存）。
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
  const { screenToFlowPosition } = useReactFlow();
  const editLocked = useDiagramStore((s) => isEditLocked(s.diagram));
  const panMode = useCanvasMode((s) => s.panMode);

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);

  const edge = data?.edge;
  const sourceAnchor = anchorOf(sourceHandleId);
  const targetAnchor = anchorOf(targetHandleId);
  const edgeType = edge?.edgeType ?? 'ortho';

  /* —— 拖拽手柄的本地状态（松手才落库） —— */
  const [anchorDrag, setAnchorDrag] = useState<AnchorDrag | null>(null);
  const [draftWaypoints, setDraftWaypoints] = useState<Pt[] | null>(null);
  const draggingRef = useRef(false);

  const storedWaypoints = useMemo(() => readWaypoints(edge?.extJson), [edge?.extJson]);
  const waypoints = draftWaypoints ?? storedWaypoints;

  const liveSourceAnchor = anchorDrag?.end === 'source' ? anchorDrag.anchor : sourceAnchor;
  const liveTargetAnchor = anchorDrag?.end === 'target' ? anchorDrag.anchor : targetAnchor;

  const geometry = useMemo(() => {
    if (!sourceRect || !targetRect) return null;
    const start = anchorPoint(sourceRect, liveSourceAnchor);
    const end = anchorPoint(targetRect, liveTargetAnchor);

    // 有折点：自己拼路径（三种线型都支持穿过折点）
    if (waypoints.length > 0) {
      const built = buildPath(edgeType, [start, ...waypoints, end], liveSourceAnchor, liveTargetAnchor);
      return { d: built.d, labelPoint: built.labelPoint, points: built.points };
    }

    if (edgeType === 'bezier') {
      const [d, labelX, labelY] = getBezierPath({
        sourceX: start.x,
        sourceY: start.y,
        sourcePosition: positionOf(liveSourceAnchor),
        targetX: end.x,
        targetY: end.y,
        targetPosition: positionOf(liveTargetAnchor),
      });
      return { d, labelPoint: { x: labelX, y: labelY }, points: [start, end] };
    }
    if (edgeType === 'straight') {
      const [d, labelX, labelY] = getStraightPath({
        sourceX: start.x,
        sourceY: start.y,
        targetX: end.x,
        targetY: end.y,
      });
      return { d, labelPoint: { x: labelX, y: labelY }, points: [start, end] };
    }
    // 正交：React Flow 标准折线（与插件内建 "smoothstep" 线型完全一致）
    const [d, labelX, labelY] = getSmoothStepPath({
      sourceX: start.x,
      sourceY: start.y,
      sourcePosition: positionOf(liveSourceAnchor),
      targetX: end.x,
      targetY: end.y,
      targetPosition: positionOf(liveTargetAnchor),
    });
    return { d, labelPoint: { x: labelX, y: labelY }, points: [start, end] };
  }, [
    sourceRect?.x,
    sourceRect?.y,
    sourceRect?.width,
    sourceRect?.height,
    targetRect?.x,
    targetRect?.y,
    targetRect?.width,
    targetRect?.height,
    liveSourceAnchor,
    liveTargetAnchor,
    edgeType,
    waypoints,
  ]);

  /* —— 双击改标注（用户 2026-11-05） —— */
  const editingEdgeId = useEdgeLabelEdit((s) => s.editingEdgeId);
  const stopEditing = useEdgeLabelEdit((s) => s.stop);
  const editing = editingEdgeId === id;
  const patchEdgeNow = useDiagramStore((s) => s.patchEdge);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (editing) setDraft(edge?.label ?? '');
  }, [editing, edge?.label]);

  const commitDraft = (): void => {
    const next = draft.trim();
    if (next !== (edge?.label ?? '')) patchEdgeNow(id, { label: next === '' ? undefined : next });
    stopEditing();
  };

  const toFlow = useCallback(
    (event: PointerEvent): Pt => {
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      return { x: snap(p.x), y: snap(p.y) };
    },
    [screenToFlowPosition],
  );

  /** 拖端点：实时预览锚点，松手写一次 */
  const startAnchorDrag = (event: React.PointerEvent, end: 'source' | 'target'): void => {
    event.preventDefault();
    event.stopPropagation();
    const rect = end === 'source' ? sourceRect : targetRect;
    if (!rect) return;
    draggingRef.current = true;
    let current: AnchorDrag = {
      end,
      anchor: end === 'source' ? liveSourceAnchor : liveTargetAnchor,
    };
    setAnchorDrag(current);
    const onMove = (moveEvent: PointerEvent): void => {
      const p = toFlow(moveEvent);
      current = { end, anchor: nearestAnchor(rect, p) };
      setAnchorDrag(current);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = false;
      setAnchorDrag(null);
      const stored = end === 'source' ? sourceAnchor : targetAnchor;
      if (current.anchor !== stored) {
        patchEdgeNow(id, end === 'source' ? { sourceAnchor: current.anchor } : { targetAnchor: current.anchor });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    onMove(event.nativeEvent as PointerEvent);
  };

  /** 拖折点（含"从无到有"的第一个点）：索引 = 在 waypoints 里的位置 */
  const startWaypointDrag = (event: React.PointerEvent, index: number | 'new'): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!geometry) return;
    draggingRef.current = true;
    const base = [...storedWaypoints];
    let list: Pt[];
    let fixedIndex: number;
    if (index === 'new') {
      const insertAt = midpointInsertIndex(geometry.points, addHandleRatio);
      list = [...base.slice(0, insertAt), addHandlePoint, ...base.slice(insertAt)];
      fixedIndex = insertAt;
    } else {
      list = base;
      fixedIndex = index;
    }
    setDraftWaypoints(list);
    const onMove = (moveEvent: PointerEvent): void => {
      const p = toFlow(moveEvent);
      list = list.map((item, i) => (i === fixedIndex ? p : item));
      setDraftWaypoints([...list]);
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      draggingRef.current = false;
      setDraftWaypoints(null);
      patchEdgeNow(id, { extJson: writeWaypoints(edge?.extJson, list) });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    onMove(event.nativeEvent as PointerEvent);
  };

  /** 双击折点删掉它（双击线本身仍然是改标注，所以这里必须 stopPropagation） */
  const removeWaypoint = (event: React.MouseEvent, index: number): void => {
    event.preventDefault();
    event.stopPropagation();
    const next = storedWaypoints.filter((_, i) => i !== index);
    patchEdgeNow(id, { extJson: writeWaypoints(edge?.extJson, next) });
  };

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

  // 手柄只在"选中 + 可编辑 + 非拖动模式"时出现；缩放时反向缩放，视觉尺寸恒定为 12px
  const showHandles = selected && !editLocked && !panMode && !editing;
  // 线有标注时把"加折点"的小＋挪到 1/4 处，不然正好盖住文字
  const addHandleRatio = edge?.label ? 0.25 : 0.5;
  const addHandlePoint = pointAt(edgeType, geometry.points, addHandleRatio);
  const handleScale = 1 / (zoom || 1);
  const handleStyle = (p: Pt): React.CSSProperties => ({
    position: 'absolute',
    // 端点手柄正好压在节点的连接点上（`.react-flow__handle`），DOM 里节点在标签渲染器后面，
    // 不给 z-index 的话点击会被节点的小圆点抢走（实测：命中 react-flow__handle）。
    zIndex: 20,
    transform: `translate(-50%, -50%) translate(${p.x}px, ${p.y}px) scale(${handleScale})`,
    pointerEvents: 'all',
  });

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

      {showHandles && (
        <EdgeLabelRenderer>
          {/* 两端：拖动换锚点 */}
          <div
            className="nodrag nopan"
            role="button"
            tabIndex={-1}
            aria-label="拖动换出口"
            title="拖动换出口（从节点的哪条边连出）"
            onPointerDown={(e) => startAnchorDrag(e, 'source')}
            style={handleStyle(geometry.points[0]!)}
          >
            <div className="h-3 w-3 rounded-full border-2 border-[var(--primary)] bg-white" />
          </div>
          <div
            className="nodrag nopan"
            role="button"
            tabIndex={-1}
            aria-label="拖动换入口"
            title="拖动换入口（连进节点的哪条边）"
            onPointerDown={(e) => startAnchorDrag(e, 'target')}
            style={handleStyle(geometry.points[geometry.points.length - 1]!)}
          >
            <div className="h-3 w-3 rounded-full border-2 border-[var(--primary)] bg-white" />
          </div>

          {/* 折点：拖动移动，双击删除 */}
          {(draftWaypoints ?? storedWaypoints).map((point, index) => (
            <div
              key={`wp-${index}`}
              className="nodrag nopan"
              role="button"
              tabIndex={-1}
              aria-label={`折点 ${index + 1}`}
              title="拖动移动折点 · 双击删除"
              onPointerDown={(e) => startWaypointDrag(e, index)}
              onDoubleClick={(e) => removeWaypoint(e, index)}
              style={handleStyle(point)}
            >
              <div className="h-2.5 w-2.5 rounded-sm border-2 border-[var(--primary)] bg-white" />
            </div>
          ))}

          {/* 线上小＋：拖出来就是新折点（虚线小圆，提示"还能拐一下"） */}
          {!draftWaypoints && !anchorDrag && storedWaypoints.length < MAX_WAYPOINTS && (
            <div
              className="nodrag nopan"
              role="button"
              tabIndex={-1}
              aria-label="拖动添加折点"
              title="拖动这里可以给连线加一个折点"
              onPointerDown={(e) => startWaypointDrag(e, 'new')}
              style={handleStyle(addHandlePoint)}
            >
              <div className="grid h-3.5 w-3.5 place-items-center rounded-full border border-dashed border-[var(--primary)] bg-white/90 text-[9px] leading-none text-[var(--primary)]">
                ＋
              </div>
            </div>
          )}
        </EdgeLabelRenderer>
      )}

      {/* 双击连线就地输入（用户 2026-11-05）：输入框永远渲染在线的中点 */}
      {editing && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${geometry.labelPoint.x}px, ${geometry.labelPoint.y}px)`,
              pointerEvents: 'all',
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') {
                  setDraft(edge?.label ?? '');
                  stopEditing();
                }
              }}
              placeholder="标注，如 443/TLS"
              aria-label="连线标注"
              className="w-32 rounded border border-[var(--primary)] bg-white px-1 py-0.5 text-center text-[11px] outline-none shadow-sm"
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ArchEdge = memo(ArchEdgeImpl);
