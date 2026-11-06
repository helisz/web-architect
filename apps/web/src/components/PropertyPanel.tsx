import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useStore } from '@xyflow/react';
import {
  ALLOWED_ICON_KEYS,
  COMPONENT_INDEX,
  EDGE_DASH_PRESETS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LIMITS,
  dashPresetOf,
  groupOffset,
  iconKeyFor,
  isGroupLocked,
  isEditLocked,
  isIconHidden,
  isSingleLineGroup,
  parseFontSize,
  textStyleOf,
  withTextStyle,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type TextStyle,
} from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { NodeIcon } from '../icons/index.js';
import { IconPicker } from './IconPicker.js';
import { ColorField } from './ColorField.js';
import { ToolIcon } from './ToolIcons.js';
import { FIELD_LABEL, commonFields, pickSelection, type MultiField, type MultiKind } from './multiEdit.js';
import {
  LINE_DASH_PRESETS,
  LINE_MAX_WIDTH,
  LINE_MIN_WIDTH,
  LINE_WIDTH_PRESETS,
  clampLineWidth,
  describeAngle,
  lineInfo,
  readLineData,
} from '../canvas/lineGeometry.js';

/** 浮动属性卡宽度（用户 2026-11-06 定稿 264px；停靠态仍用 300px 给色板留位置） */
const PANEL_W = 264;

/** 多选批量改写：按对象类型把字段落到正确的属性上（分组没有独立的文字色，用标题色） */
function applyMultiField(
  kind: MultiKind,
  field: MultiField,
  value: string,
  actions: {
    patchNode: (id: string, patch: Partial<DiagramNode>) => void;
    patchGroup: (id: string, patch: Partial<DiagramGroup>) => void;
    patchEdge: (id: string, patch: Partial<DiagramEdge>) => void;
  },
  id: string,
): void {
  if (kind === 'edge') {
    if (field === 'label') actions.patchEdge(id, { label: value });
    else if (field === 'strokeColor') actions.patchEdge(id, { strokeColor: value });
    // 2026-11-05：多选连线批量改样式
    else if (field === 'strokeWidth') {
      const width = Math.min(LIMITS.strokeWidthMax, Math.max(LIMITS.strokeWidthMin, Number(value) || 1));
      actions.patchEdge(id, { strokeWidth: width });
    } else if (field === 'edgeType') {
      actions.patchEdge(id, { edgeType: value as DiagramEdge['edgeType'] });
    } else if (field === 'arrow') {
      actions.patchEdge(id, { arrow: value as DiagramEdge['arrow'] });
    } else if (field === 'strokeDasharray') {
      // 'solid' 表示实线（null），其余值沿用预设里的 '6 4' / '12 8'
      const preset = EDGE_DASH_PRESETS.find((p) => p.key === value);
      actions.patchEdge(id, { strokeDasharray: preset ? preset.value : value });
    }
    return;
  }
  if (kind === 'group') {
    if (field === 'label') actions.patchGroup(id, { label: value });
    else if (field === 'subLabel') actions.patchGroup(id, { subLabel: value });
    else if (field === 'bgColor') actions.patchGroup(id, { bgColor: value });
    else if (field === 'borderColor') actions.patchGroup(id, { borderColor: value });
    else if (field === 'textColor') actions.patchGroup(id, { titleColor: value });
    else if (field === 'iconKey') {
      const group = useDiagramStore.getState().diagram.groups.find((g) => g.groupId === id);
      actions.patchGroup(id, { extJson: { ...(group?.extJson ?? {}), iconKey: value, iconHidden: false } });
    } else if (field === 'iconHidden') {
      const group = useDiagramStore.getState().diagram.groups.find((g) => g.groupId === id);
      actions.patchGroup(id, { extJson: { ...(group?.extJson ?? {}), iconHidden: value === 'hidden' } });
    }
    return;
  }
  if (kind === 'line') {
    const node = useDiagramStore.getState().diagram.nodes.find((n) => n.nodeId === id);
    if (!node) return;
    const current = readLineData(node.extJson, node.width, node.height);
    const line = { ...(node.extJson?.line as Record<string, unknown> | undefined), a: current.a, b: current.b, width: current.width, dash: current.dash };
    if (field === 'borderColor') actions.patchNode(id, { borderColor: value });
    else if (field === 'strokeWidth') {
      actions.patchNode(id, { extJson: { ...(node.extJson ?? {}), line: { ...line, width: clampLineWidth(Number(value)) } } });
    } else if (field === 'strokeDasharray') {
      const preset = LINE_DASH_PRESETS.find((p) => p.key === value);
      actions.patchNode(id, { extJson: { ...(node.extJson ?? {}), line: { ...line, dash: preset ? preset.value : value } } });
    }
    return;
  }
  if (field === 'label') actions.patchNode(id, { label: value });
  else if (field === 'subLabel') actions.patchNode(id, { subLabel: value });
  else if (field === 'bgColor') actions.patchNode(id, { bgColor: value });
  else if (field === 'borderColor') actions.patchNode(id, { borderColor: value });
  else if (field === 'textColor') actions.patchNode(id, { textColor: value });
  else if (field === 'iconKey') {
    const node = useDiagramStore.getState().diagram.nodes.find((n) => n.nodeId === id);
    actions.patchNode(id, { extJson: { ...(node?.extJson ?? {}), iconKey: value, iconHidden: false } });
  } else if (field === 'iconHidden') {
    const node = useDiagramStore.getState().diagram.nodes.find((n) => n.nodeId === id);
    actions.patchNode(id, { extJson: { ...(node?.extJson ?? {}), iconHidden: value === 'hidden' } });
  } else if (field === 'align' || field === 'valign') {
    // 文字对齐（用户 2026-11-04 第二批）：多选时一并生效
    const node = useDiagramStore.getState().diagram.nodes.find((n) => n.nodeId === id);
    actions.patchNode(id, {
      extJson: withTextStyle(node?.extJson, { [field]: value } as { align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom' }),
    });
  }
}

/**
 * 文字对齐按钮组（用户 2026-11-04 第二批）：水平 左/中/右 + 垂直 上/中/下。
 * 单选与多选共用一套，值不一致（多选）时全部不高亮。
 */
const ALIGN_OPTIONS = [
  ['left', '水平左对齐', '⇤'],
  ['center', '水平居中', '↔'],
  ['right', '水平右对齐', '⇥'],
] as const;

const VALIGN_OPTIONS = [
  ['top', '顶端对齐', '⤒'],
  ['middle', '垂直居中', '⬍'],
  ['bottom', '底端对齐', '⤓'],
] as const;

function AlignButtons({
  align,
  valign,
  onChange,
}: {
  align?: string;
  valign?: string;
  onChange: (field: 'align' | 'valign', value: string) => void;
}) {
  const cls = (active: boolean): string =>
    `grid h-6 w-7 shrink-0 place-items-center rounded border text-[11px] ${
      active
        ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
        : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
    }`;
  return (
    <div className="flex items-center gap-1">
      {ALIGN_OPTIONS.map(([value, title, glyph]) => (
        <button
          key={value}
          type="button"
          title={title}
          aria-label={title}
          aria-pressed={align === value}
          onClick={() => onChange('align', value)}
          className={cls(align === value)}
        >
          {glyph}
        </button>
      ))}
      <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--panel-border)]" />
      {VALIGN_OPTIONS.map(([value, title, glyph]) => (
        <button
          key={value}
          type="button"
          title={title}
          aria-label={title}
          aria-pressed={valign === value}
          onClick={() => onChange('valign', value)}
          className={cls(valign === value)}
        >
          {glyph}
        </button>
      ))}
    </div>
  );
}

/**
 * 虚线的示意图（用户 2026-11-04 第二批）：直接画一段带真实 stroke-dasharray 的线，
 * 比「实线 / 短虚线 / 长虚线」三个词更快看懂。颜色跟随当前是否选中。
 */
function DashSample({ dasharray, color }: { dasharray: string | null; color: string }) {
  return (
    <svg width="44" height="10" viewBox="0 0 44 10" aria-hidden focusable="false">
      <line
        x1="2"
        y1="5"
        x2="42"
        y2="5"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="butt"
        strokeDasharray={dasharray ?? undefined}
      />
    </svg>
  );
}

/**
 * 多选批量编辑：只显示所有选中对象都有的字段（交集），改一次全改。
 * 值不一致的字段显示「多个值」，点选后统一。
 */
function MultiForm() {
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const diagram = useDiagramStore((s) => s.diagram);
  const requestDelete = useDiagramStore((s) => s.requestDelete);
  const patchNode = useDiagramStore((s) => s.patchNode);
  const patchGroup = useDiagramStore((s) => s.patchGroup);
  const patchEdge = useDiagramStore((s) => s.patchEdge);

  const picked = useMemo(
    () => pickSelection(selectedIds, diagram),
    [selectedIds, diagram],
  );
  const fields = useMemo(() => commonFields(selectedIds, diagram), [selectedIds, diagram]);

  const apply = (field: MultiField, value: string): void => {
    for (const { kind, item } of picked) {
      const id =
        kind === 'edge'
          ? (item as DiagramEdge).edgeId
          : kind === 'group'
            ? (item as DiagramGroup).groupId
            : (item as DiagramNode).nodeId;
      applyMultiField(kind, field, value, { patchNode, patchGroup, patchEdge }, id);
    }
  };

  const find = (field: MultiField) => fields.find((f) => f.field === field);
  // 纯线条选择时把字段名换成线条的说法（颜色 / 粗细 / 虚线）
  const allLines = picked.length > 0 && picked.every(({ kind }) => kind === 'line');
  const labelOf = (field: MultiField): string => {
    if (!allLines) return FIELD_LABEL[field];
    if (field === 'borderColor') return '颜色';
    if (field === 'strokeWidth') return '粗细';
    if (field === 'strokeDasharray') return '虚线';
    return FIELD_LABEL[field];
  };

  return (
    <div>
      <p className="text-sm font-semibold">
        {picked.every(({ kind }) => kind === 'edge')
          ? `已选中 ${picked.length} 条连线`
          : allLines
            ? `已选中 ${picked.length} 条线条`
            : `已选中 ${picked.length} 个元素`}
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        只显示所有对象都有的属性，改一次全部生效；值不一致时显示「多个值」。
      </p>

      <div className="mt-3">
        {find('label') && (
          <Field label={`${FIELD_LABEL.label}${find('label')!.mixed ? '（多个值）' : ''}`}>
            <input
              className={inputClass}
              value={find('label')!.value ?? ''}
              placeholder={find('label')!.mixed ? '多个值' : ''}
              onChange={(e) => apply('label', e.target.value)}
            />
          </Field>
        )}

        {find('subLabel') && (
          <Field label={`${FIELD_LABEL.subLabel}${find('subLabel')!.mixed ? '（多个值）' : ''}`}>
            <input
              className={inputClass}
              value={find('subLabel')!.value ?? ''}
              placeholder={find('subLabel')!.mixed ? '多个值' : ''}
              onChange={(e) => apply('subLabel', e.target.value)}
            />
          </Field>
        )}

        {/* 文字对齐（用户 2026-11-04 第二批）：多选时也能批量改 */}
        {(find('align') || find('valign')) && (
          <Field label={`文字对齐${find('align')?.mixed || find('valign')?.mixed ? '（多个值）' : ''}`}>
            <AlignButtons
              align={find('align')?.value ?? undefined}
              valign={find('valign')?.value ?? undefined}
              onChange={(field, value) => apply(field, value)}
            />
          </Field>
        )}

        {(find('textColor') || find('bgColor') || find('borderColor')) && (
          <ColorField
            kind={picked.every(({ kind }) => kind === 'group') ? 'group' : 'node'}
            targets={[
              ...(find('textColor')
                ? [
                    {
                      scope: 'font' as const,
                      value: find('textColor')!.value ?? '',
                      onChange: (color: string) => apply('textColor', color),
                    },
                  ]
                : []),
              ...(find('bgColor')
                ? [
                    {
                      scope: 'bg' as const,
                      value: find('bgColor')!.value ?? '',
                      onChange: (color: string) => apply('bgColor', color),
                    },
                  ]
                : []),
              ...(find('borderColor')
                ? [
                    {
                      scope: 'line' as const,
                      value: find('borderColor')!.value ?? '',
                      onChange: (color: string) => apply('borderColor', color),
                    },
                  ]
                : []),
            ]}
          />
        )}

        {find('strokeColor') && (
          <ColorField
            kind="edge"
            targets={[
              {
                scope: 'edge',
                value: find('strokeColor')!.value ?? '',
                onChange: (color: string) => apply('strokeColor', color),
              },
            ]}
          />
        )}

        {/* 连线样式（用户 2026-11-05：选多条线时也要能一次改完） */}
        {find('strokeWidth') && (
          <Field label={`${labelOf('strokeWidth')}${find('strokeWidth')!.mixed ? '（多个值）' : ''}`}>
            <input
              type="number"
              step={0.5}
              min={LIMITS.strokeWidthMin}
              max={LIMITS.strokeWidthMax}
              className={inputClass}
              value={find('strokeWidth')!.value ?? ''}
              placeholder={find('strokeWidth')!.mixed ? '多个值' : ''}
              onChange={(e) => apply('strokeWidth', e.target.value)}
            />
          </Field>
        )}

        {find('edgeType') && (
          <Field label={`${FIELD_LABEL.edgeType}${find('edgeType')!.mixed ? '（多个值）' : ''}`}>
            <select
              className={inputClass}
              value={find('edgeType')!.value ?? 'ortho'}
              onChange={(e) => apply('edgeType', e.target.value)}
            >
              {find('edgeType')!.mixed && <option value="">多个值</option>}
              {EDGE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {find('arrow') && (
          <Field label={`${FIELD_LABEL.arrow}${find('arrow')!.mixed ? '（多个值）' : ''}`}>
            <select
              className={inputClass}
              value={find('arrow')!.value ?? 'none'}
              onChange={(e) => apply('arrow', e.target.value)}
            >
              {find('arrow')!.mixed && <option value="">多个值</option>}
              {ARROWS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {find('strokeDasharray') && (
          <Field label={`${labelOf('strokeDasharray')}${find('strokeDasharray')!.mixed ? '（多个值）' : ''}`}>
            <div className="flex gap-1">
              {EDGE_DASH_PRESETS.map((preset) => {
                const active = find('strokeDasharray')!.value === preset.key;
                return (
                  <button
                    key={preset.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => apply('strokeDasharray', preset.key)}
                    className={`flex-1 rounded border px-1.5 py-1 text-[11px] ${
                      active
                        ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                        : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {find('iconKey') && (
          <Field label={`${FIELD_LABEL.iconKey}（点一个批量换）`}>
            <div className="arch-hscroll flex items-center gap-1">
              {find('iconHidden') && (
                <button
                  type="button"
                  title="不显示图标"
                  aria-pressed={find('iconHidden')!.value === 'hidden'}
                  onClick={() =>
                    apply('iconHidden', find('iconHidden')!.value === 'hidden' ? 'shown' : 'hidden')
                  }
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded border text-[11px] ${
                    find('iconHidden')!.value === 'hidden'
                      ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                      : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                  }`}
                >
                  无
                </button>
              )}
              {ALLOWED_ICON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  title={key}
                  onClick={() => apply('iconKey', key)}
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded border ${
                    find('iconKey')!.value === key
                      ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                      : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                  }`}
                >
                  <NodeIcon iconKey={key} size={16} />
                </button>
              ))}
            </div>
          </Field>
        )}

        {fields.length === 0 && (
          <p className="text-xs text-[var(--text-secondary)]">
            这批对象没有共同可批量编辑的属性，只能整体移动或删除。
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
        拖动即可整体移动（按 10px 吸附），也可以直接 Delete 删除。
      </p>
      <button
        type="button"
        onClick={() => requestDelete(selectedIds)}
        className="mt-2 w-full rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 hover:bg-red-100"
      >
        删除选中的 {selectedIds.length} 个元素
      </button>
    </div>
  );
}

/**
 * 右侧属性面板（规格 §3.4 / §5.4）。
 *
 * 单选：节点表单、连线表单、分组表单；多选：交集字段批量编辑。
 * 所有修改都直接改 Schema（单一事实来源），保存由自动保存链路负责。
 */
export function PropertyPanel() {
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const diagram = useDiagramStore((s) => s.diagram);
  const locked = useDiagramStore((s) => isEditLocked(s.diagram));

  const node = useMemo(
    () => diagram.nodes.find((n) => n.nodeId === selectedId) ?? null,
    [diagram.nodes, selectedId],
  );
  const edge = useMemo(
    () => diagram.edges.find((e) => e.edgeId === selectedId) ?? null,
    [diagram.edges, selectedId],
  );
  const group = useMemo(
    () => diagram.groups.find((g) => g.groupId === selectedId) ?? null,
    [diagram.groups, selectedId],
  );

  /*
   * 浮动属性卡（2026-11-06 第二批）：跟着选中的节点 / 分组走，不再钉在右侧。
   *
   * 规则和样张一致：优先贴在元素右侧 → 右侧放不下翻到左侧 → 两边都放不下就贴住画布边缘
   * 并夹在可视区内；上下居中于元素，靠近底边时上移。选中「连线」或「多选」时没有可贴的
   * 矩形，退回右侧停靠（那条路径和以前一样）。
   */
  const viewport = useStore((s) => s.transform);
  const panelRef = useRef<HTMLElement>(null);
  const [canvasBox, setCanvasBox] = useState<{ w: number; h: number } | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  useLayoutEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const measure = (): void => setCanvasBox({ w: parent.clientWidth, h: parent.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    // 卡片自己的高度也要量：夹取顶部时不能再用写死的 200px 假设（会溢出浏览器底部）
    const cardEl = panelRef.current;
    const measureCard = (): void => setPanelHeight(cardEl ? Math.round(cardEl.getBoundingClientRect().height) : 0);
    measureCard();
    const cardObserver = cardEl ? new ResizeObserver(measureCard) : null;
    if (cardEl && cardObserver) cardObserver.observe(cardEl);
    return () => {
      observer.disconnect();
      cardObserver?.disconnect();
    };
  }, [diagram.diagramId]);

  const anchorRect = useMemo(() => {
    // 连线（2026-11-06）：取两端元素中心的中点当锚点，属性卡贴在线的中间
    if (!node && !group && edge) {
      const centerOf = (id: string): { x: number; y: number } | null => {
        const endNode = diagram.nodes.find((n) => n.nodeId === id);
        if (endNode) {
          const offset = groupOffset(diagram.groups, endNode.groupId ?? null);
          return { x: offset.x + endNode.x + endNode.width / 2, y: offset.y + endNode.y + endNode.height / 2 };
        }
        const endGroup = diagram.groups.find((g) => g.groupId === id);
        if (endGroup) {
          const offset = groupOffset(diagram.groups, endGroup.parentGroupId ?? null);
          return { x: offset.x + endGroup.x + endGroup.width / 2, y: offset.y + endGroup.y + endGroup.height / 2 };
        }
        return null;
      };
      const from = centerOf(edge.sourceNodeId);
      const to = centerOf(edge.targetNodeId);
      if (!from || !to) return null;
      return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, w: 0, h: 0 };
    }
    if (!node && !group) return null;
    const target = node ?? group!;
    const offset = groupOffset(diagram.groups, node ? (node.groupId ?? null) : (group!.parentGroupId ?? null));
    return { x: target.x + offset.x, y: target.y + offset.y, w: target.width, h: target.height };
  }, [node, group, edge, diagram.groups, diagram.nodes]);

  const panelBox = useMemo(() => {
    if (!anchorRect || !canvasBox) return null;
    const [tx, ty, zoom] = viewport;
    const INSET = 10;
    const GAP = 14;
    const screenX = anchorRect.x * zoom + tx;
    const screenY = anchorRect.y * zoom + ty;
    const screenW = anchorRect.w * zoom;
    const screenH = anchorRect.h * zoom;
    const rightSide = screenX + screenW + GAP;
    const flipped = rightSide + PANEL_W > canvasBox.w - INSET;
    const left = Math.max(
      INSET,
      Math.min(flipped ? screenX - GAP - PANEL_W : rightSide, canvasBox.w - INSET - PANEL_W),
    );
    const centerY = screenY + screenH / 2;
    // 首帧还没量到高度时先用一个保守估计，量到之后立刻按真实高度夹取
    const cardH = panelHeight > 0 ? panelHeight : 320;
    const maxTop = canvasBox.h - INSET - cardH;
    const top = maxTop <= INSET ? INSET : Math.max(INSET, Math.min(centerY - cardH / 2, maxTop));
    return { left, top, flipped, centerY, maxHeight: canvasBox.h - INSET * 2 };
  }, [anchorRect, canvasBox, viewport, panelHeight]);

  const panelStyle: CSSProperties | undefined = panelBox
    ? { left: panelBox.left, top: panelBox.top, width: PANEL_W, maxHeight: panelBox.maxHeight }
    : undefined;

  return (
    <>
      {panelBox && (
        <span
          aria-hidden
          className={`panel-arrow ${panelBox.flipped ? 'left' : 'right'}`}
          style={{
            left: panelBox.flipped ? panelBox.left + PANEL_W : panelBox.left - 7,
            top: panelBox.centerY - 6,
          }}
        />
      )}
    <aside
      ref={panelRef}
      style={panelStyle}
      className={`floating-panel flex flex-col overflow-y-auto ${
        panelBox ? '' : 'right-[var(--panel-inset)] top-[var(--panel-inset)] bottom-[var(--panel-inset)] w-[300px]'
      }`}
    >
      <div className="border-b border-[var(--panel-border)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
        {node
          ? '节点属性'
          : edge
            ? '连线属性'
            : group
              ? '分组属性'
              : selectedIds.length > 1
                ? '多选'
                : '属性'}
      </div>
      <div className="flex-1 p-3">
        {/* 全局锁定（用户 2026-11-04 第二批）：面板照常能看，但所有控件都禁用 */}
        {locked && (
          <div className="mb-2 flex items-start gap-1.5 rounded border border-[var(--panel-border)] bg-[var(--bg-hover)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
            <span aria-hidden>🔒</span>
            <span>
              已锁定编辑，属性只能查看。点画布右上角「已锁定」解锁。
            </span>
          </div>
        )}
        <div className={locked ? 'pointer-events-none select-none opacity-60' : undefined} aria-disabled={locked}>
          {node && (node.nodeType === 'line' ? <LineForm node={node} /> : <NodeForm node={node} />)}
          {edge && <EdgeForm edge={edge} />}
          {group && <GroupForm group={group} />}
          {!node && !edge && !group && selectedIds.length > 1 && <MultiForm />}
          {!node && !edge && !group && selectedIds.length <= 1 && (
            <p className="text-xs text-[var(--text-secondary)]">选中一个节点、连线或分组</p>
          )}
        </div>
      </div>
    </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 分组表单                                                            */
/* ------------------------------------------------------------------ */

/** 宽高一对输入框（分组与节点共用口径：下限来自 DB 的 check 约束） */
function SizeFields({
  width,
  height,
  minWidth,
  minHeight,
  onChange,
}: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  onChange: (size: { width: number; height: number }) => void;
}) {
  return (
    <div className="mb-3 flex gap-2">
      <Field label="宽">
        <input
          type="number"
          min={minWidth}
          className={inputClass}
          value={Math.round(width)}
          onChange={(e) => onChange({ width: Math.max(minWidth, Number(e.target.value) || minWidth), height })}
        />
      </Field>
      <Field label="高">
        <input
          type="number"
          min={minHeight}
          className={inputClass}
          value={Math.round(height)}
          onChange={(e) => onChange({ width, height: Math.max(minHeight, Number(e.target.value) || minHeight) })}
        />
      </Field>
    </div>
  );
}

function GroupForm({ group }: { group: DiagramGroup }) {
  const patchGroup = useDiagramStore((s) => s.patchGroup);
  const toggleGroupCollapsed = useDiagramStore((s) => s.toggleGroupCollapsed);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const childCount = useDiagramStore(
    (s) => s.diagram.nodes.filter((n) => n.groupId === group.groupId).length,
  );
  const iconKey = (group.extJson?.iconKey as string | undefined) ?? iconKeyFor('group');
  const [pickerOpen, setPickerOpen] = useState(false);
  const setIcon = (key: string): void =>
    patchGroup(group.groupId, { extJson: { ...(group.extJson ?? {}), iconKey: key, iconHidden: false } });
  const patchGroupIcon = (patch: { iconHidden: boolean }): void =>
    patchGroup(group.groupId, { extJson: { ...(group.extJson ?? {}), ...patch } });
  const locked = isGroupLocked(group);
  const toggleLock = (): void =>
    patchGroup(group.groupId, {
      extJson: { ...(group.extJson ?? {}), locked: locked ? undefined : true },
    });

  // 锁定的分组只留「解锁」入口（用户 2026-11-04：隐藏分组属性配置入口，但锁定要能解锁）
  if (locked) {
    return (
      <div>
        <p className="mb-3 rounded border border-[var(--panel-border)] bg-[var(--bg-hover)] px-2 py-2 text-[12px] text-[var(--text-secondary)]">
          分组「{group.label}」已锁定：不能拖动、缩放、改名、折叠，也不能改颜色和图标。
          仍然可以选中、可以往里放节点。
        </p>
        <button
          type="button"
          onClick={toggleLock}
          aria-pressed
          className="flex w-full items-center justify-center gap-1.5 rounded border border-[var(--primary)] bg-[var(--accent-50)] px-2 py-1.5 text-xs text-[var(--primary)] hover:bg-[var(--accent-100)]"
        >
          <ToolIcon name="unlock" size={16} />
          <span>解锁分组</span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <Field label="名称">
        <input
          className={inputClass}
          value={group.label}
          onChange={(e) => patchGroup(group.groupId, { label: e.target.value })}
        />
      </Field>

      {/* 通用分组不支持副文本（用户 2026-11-04）：不给输入框，标题栏也只有一行 */}
      {!isSingleLineGroup(group) && (
        <Field label="副文本">
          {/* 允许回车换行（用户 2026-11-04 第二批）；标题栏高度固定，最多显示两行 */}
          <textarea
            className={`${inputClass} mono h-12 resize-none`}
            value={group.subLabel}
            placeholder="标题下面那行小字，例如 10.0.0.0/24"
            onChange={(e) => patchGroup(group.groupId, { subLabel: e.target.value })}
          />
        </Field>
      )}

      <Field label={`图标（${isIconHidden(group) ? '不显示' : iconKey}）`}>
        <div className="flex items-center gap-2">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded border border-[var(--panel-border)] ${isIconHidden(group) ? 'opacity-30' : ''}`}>
            <NodeIcon iconKey={iconKey} size={20} />
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex-1 rounded border border-[var(--panel-border)] px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            搜索图标库…
          </button>
        </div>
        <div className="arch-hscroll mt-1 flex items-center gap-1">
          <button
            type="button"
            title="不显示图标"
            aria-pressed={isIconHidden(group)}
            onClick={() => patchGroupIcon({ iconHidden: !isIconHidden(group) })}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded border text-[11px] ${
              isIconHidden(group)
                ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
            }`}
          >
            无
          </button>
          {ALLOWED_ICON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={key}
              onClick={() => setIcon(key)}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded border ${
                key === iconKey
                  ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
              }`}
            >
              <NodeIcon iconKey={key} size={16} />
            </button>
          ))}
        </div>
      </Field>

      {pickerOpen && (
        <IconPicker
          value={iconKey}
          onSelect={(key) => {
            setIcon(key);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <SizeFields
        width={group.width}
        height={group.height}
        minWidth={120}
        minHeight={80}
        onChange={(size) => patchGroup(group.groupId, size)}
      />

      <ColorField
        targets={[
          { scope: 'font', value: group.titleColor, onChange: (value) => patchGroup(group.groupId, { titleColor: value }) },
          { scope: 'bg', value: group.bgColor, onChange: (value) => patchGroup(group.groupId, { bgColor: value }) },
          { scope: 'line', value: group.borderColor, onChange: (value) => patchGroup(group.groupId, { borderColor: value }) },
        ]}
        kind="group"
      />

      <label className="mb-3 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={group.collapsed}
          onChange={() => toggleGroupCollapsed(group.groupId)}
        />
        折叠（子元素数据保留，展开即回来）
      </label>

      <p className="mb-3 text-[11px] text-[var(--text-secondary)]">
        组内直接包含 {childCount} 个节点；拖进/拖出会自动换算局部坐标，整体拖动不漂移。
      </p>

      <button
        type="button"
        onClick={toggleLock}
        aria-pressed={false}
        aria-label="锁定分组"
        title="锁定后不能拖动、改名、缩放、折叠（仍可选中）"
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded border border-[var(--panel-border)] px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
      >
        <ToolIcon name="lock" size={16} />
        <span>锁定分组</span>
      </button>

      <button
        type="button"
        className="w-full rounded border border-[#FCA5A5] px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
        onClick={() => {
          if (window.confirm(`删除分组「${group.label}」？组里的节点会保留并移到上一层。`)) {
            removeGroup(group.groupId);
          }
        }}
      >
        删除分组
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 通用控件                                                            */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-[var(--hair-strong)] bg-white px-2 py-1 text-[13px] outline-none focus:border-[var(--primary)]';

/* ------------------------------------------------------------------ */
/* 节点表单                                                            */
/* ------------------------------------------------------------------ */

/**
 * 线条的属性（用户 2026-11-05）。
 *
 * 只有三样可调：颜色（复用节点边框色）、粗细、虚线；外加一行几何读数帮忙对角度。
 * 名称/副文本/文字/图标对线条没有意义，所以整个 NodeForm 换掉而不是加开关。
 */
function LineForm({ node }: { node: DiagramNode }) {
  const patch = useDiagramStore((s) => s.patchNode);
  const line = readLineData(node.extJson, node.width, node.height);
  const info = lineInfo(line.a, line.b);
  const setLine = (next: Partial<{ width: number; dash: string | null }>): void =>
    patch(node.nodeId, {
      extJson: {
        ...(node.extJson ?? {}),
        line: { ...(node.extJson?.line as Record<string, unknown> | undefined), ...next },
      },
    });

  return (
    <div>
      <ColorField
        kind="edge"
        targets={[
          {
            scope: 'edge',
            value: node.borderColor,
            onChange: (borderColor: string) => patch(node.nodeId, { borderColor }),
          },
        ]}
      />

      <Field label="粗细">
        <div className="flex items-center gap-1">
          <input
            type="number"
            aria-label="线条粗细"
            min={LINE_MIN_WIDTH}
            max={LINE_MAX_WIDTH}
            step={0.5}
            className={`${inputClass} w-16`}
            value={line.width}
            onChange={(e) => {
              const width = Number(e.target.value);
              if (Number.isFinite(width)) setLine({ width: clampLineWidth(width) });
            }}
          />
          <span className="text-[11px] text-[var(--text-secondary)]">px</span>
          {/* 常用粗细快选（用户 2026-11-05）：手填之外给 0.5/1/1.5/2 四个档，点一下就用 */}
          <div className="ml-auto flex items-center gap-0.5">
            {LINE_WIDTH_PRESETS.map((preset) => {
              const active = clampLineWidth(line.width) === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  aria-label={`线条粗细 ${preset}px`}
                  title={`${preset}px`}
                  onClick={() => setLine({ width: preset })}
                  className={`h-6 min-w-7 rounded border px-1 text-[11px] leading-none ${
                    active
                      ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                      : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                  }`}
                >
                  {preset}
                </button>
              );
            })}
          </div>
        </div>
      </Field>

      <Field label="样式">
        <div className="flex items-center gap-1">
          {LINE_DASH_PRESETS.map((preset) => {
            const active = line.dash === preset.value;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                title={preset.label}
                onClick={() => setLine({ dash: preset.value })}
                className={`flex h-7 flex-1 items-center justify-center gap-1 rounded border text-[11px] ${
                  active
                    ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                    : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                }`}
              >
                <svg width={28} height={8} aria-hidden>
                  <line
                    x1={1}
                    y1={4}
                    x2={27}
                    y2={4}
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeDasharray={preset.value ?? undefined}
                    strokeLinecap="round"
                  />
                </svg>
                {preset.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="几何">
        <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
          长 {Math.round(info.length)} px · 角度 {describeAngle(info.angle)}
          <br />
          拖端点靠近水平 / 垂直 / 45° 会吸附，按住 Shift 强制 45° 步进。
        </p>
      </Field>
    </div>
  );
}

function NodeForm({ node }: { node: DiagramNode }) {
  const requestDelete = useDiagramStore((s) => s.requestDelete);
  const patch = useDiagramStore((s) => s.patchNode);
  const spec = COMPONENT_INDEX[node.nodeType];
  const iconKey = (node.extJson?.iconKey as string | undefined) ?? iconKeyFor(node.nodeType);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textStyle = textStyleOf(node.nodeType, node.extJson);
  const setTextStyle = (stylePatch: Partial<TextStyle>): void =>
    patch(node.nodeId, { extJson: withTextStyle(node.extJson, stylePatch) });

  return (
    <div>
      <Field label="名称">
        <input
          className={inputClass}
          value={node.label}
          onChange={(e) => patch(node.nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="副文本">
        <textarea
          className={`${inputClass} mono h-14 resize-none`}
          value={node.subLabel}
          placeholder={spec?.defaultSubLabel ?? ''}
          onChange={(e) => patch(node.nodeId, { subLabel: e.target.value })}
        />
      </Field>

      {/* 文字样式（用户 2026-11-04）：字号 + 加粗/斜体/下划线，存在 extJson 里 */}
      <Field label="文字">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            aria-label="字号"
            className={`${inputClass} w-16`}
            value={textStyle.fontSize}
            onChange={(e) => {
              const size = parseFontSize(e.target.value);
              if (size !== null) setTextStyle({ fontSize: size });
            }}
          />
          <span className="text-[11px] text-[var(--text-secondary)]">px</span>
          <div className="ml-1 flex items-center gap-1">
            {(
              [
                ['bold', 'B', '加粗', 'font-bold'],
                ['italic', 'I', '斜体', 'italic'],
                ['underline', 'U', '下划线', 'underline'],
              ] as const
            ).map(([key, label, title, cls]) => (
              <button
                key={key}
                type="button"
                title={title}
                aria-label={title}
                aria-pressed={textStyle[key]}
                onClick={() => setTextStyle({ [key]: !textStyle[key] })}
                className={`grid h-7 w-7 place-items-center rounded border text-[12px] ${cls} ${
                  textStyle[key]
                    ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                    : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1">
          <AlignButtons
            align={textStyle.align}
            valign={textStyle.valign}
            onChange={(field, value) => setTextStyle({ [field]: value })}
          />
        </div>
      </Field>

      {/* 宽高按用户要求隐藏：调尺寸走画布手柄，属性面板不再重复一套数字 */}
      <ColorField
        targets={[
          { scope: 'font', value: node.textColor, onChange: (textColor) => patch(node.nodeId, { textColor }) },
          { scope: 'bg', value: node.bgColor, onChange: (bgColor) => patch(node.nodeId, { bgColor }) },
          { scope: 'line', value: node.borderColor, onChange: (borderColor) => patch(node.nodeId, { borderColor }) },
        ]}
      />

      <Field label={`图标（${isIconHidden(node) ? '不显示' : iconKey}）`}>
        <div className="flex items-center gap-2">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded border border-[var(--panel-border)] ${isIconHidden(node) ? 'opacity-30' : ''}`}>
            <NodeIcon iconKey={iconKey} size={20} />
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex-1 rounded border border-[var(--panel-border)] px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            搜索图标库…
          </button>
        </div>
        <div className="arch-hscroll mt-1 flex items-center gap-1">
          <button
            type="button"
            title="不显示图标"
            aria-pressed={isIconHidden(node)}
            onClick={() =>
              patch(node.nodeId, {
                extJson: { ...(node.extJson ?? {}), iconHidden: !isIconHidden(node) },
              })
            }
            className={`grid h-7 w-7 shrink-0 place-items-center rounded border text-[11px] ${
              isIconHidden(node)
                ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
            }`}
          >
            无
          </button>
          {ALLOWED_ICON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={key}
              onClick={() =>
                patch(node.nodeId, { extJson: { ...(node.extJson ?? {}), iconKey: key, iconHidden: false } })
              }
              className={`grid h-7 w-7 shrink-0 place-items-center rounded border ${
                key === iconKey
                  ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
              }`}
            >
              <NodeIcon iconKey={key} size={16} />
            </button>
          ))}
        </div>
      </Field>

      {pickerOpen && (
        <IconPicker
          value={iconKey}
          onSelect={(key) => {
            patch(node.nodeId, { extJson: { ...(node.extJson ?? {}), iconKey: key } });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* 锁定 / 删除（2026-11-06）：锁定只留图标（状态看图标高亮即可），
          右侧放删除入口；锁定时禁止删除，避免"锁了还被删" */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => patch(node.nodeId, { locked: !node.locked })}
          title={node.locked ? '已锁定：点击解锁' : '锁定后不能拖动、改名、改尺寸'}
          aria-pressed={node.locked}
          aria-label={node.locked ? '解锁' : '锁定'}
          className={`grid h-8 w-8 place-items-center rounded border ${
            node.locked
              ? 'border-[var(--primary)] bg-[var(--accent-50)] text-[var(--primary)]'
              : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
          }`}
        >
          <ToolIcon name={node.locked ? 'lock' : 'unlock'} size={16} />
        </button>
        <button
          type="button"
          disabled={node.locked}
          onClick={() => requestDelete([node.nodeId])}
          title={node.locked ? '已锁定：先解锁才能删除' : '删除这个节点（需要确认）'}
          aria-label="删除节点"
          className="ml-auto grid h-8 w-8 place-items-center rounded border border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--err)] hover:text-[var(--err)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--panel-border)] disabled:hover:text-[var(--text-secondary)]"
        >
          <ToolIcon name="trash" size={16} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 连线表单                                                            */
/* ------------------------------------------------------------------ */

const EDGE_TYPES = [
  { value: 'ortho', label: '正交折线' },
  { value: 'bezier', label: '贝塞尔曲线' },
  { value: 'straight', label: '直线' },
] as const;

const ARROWS = [
  { value: 'none', label: '无箭头' },
  { value: 'forward', label: '单向（指向目标）' },
  { value: 'backward', label: '反向（指向来源）' },
  { value: 'both', label: '双向' },
] as const;

function EdgeForm({ edge }: { edge: DiagramEdge }) {
  const patch = useDiagramStore((s) => s.patchEdge);

  return (
    <div>
      <Field label="标注">
        <input
          className={inputClass}
          value={edge.label ?? ''}
          placeholder="例如 443/TLS"
          onChange={(e) => patch(edge.edgeId, { label: e.target.value })}
        />
      </Field>

      <ColorField
        targets={[
          { scope: 'edge', value: edge.strokeColor, onChange: (strokeColor) => patch(edge.edgeId, { strokeColor }) },
        ]}
        kind="edge"
      />

      {/* 标注配色（2026-11-06）：字色 + 底色，存在 extJson，默认白底保证压在线上也看得清 */}
      <ColorField
        kind="edgeLabel"
        targets={[
          {
            scope: 'font',
            value: (edge.extJson?.labelColor as string | undefined) ?? '#77766F',
            onChange: (labelColor) =>
              patch(edge.edgeId, { extJson: { ...(edge.extJson ?? {}), labelColor } }),
          },
          {
            scope: 'bg',
            value: (edge.extJson?.labelBgColor as string | undefined) ?? '#FFFFFF',
            onChange: (labelBgColor) =>
              patch(edge.edgeId, { extJson: { ...(edge.extJson ?? {}), labelBgColor } }),
          },
        ]}
      />

      <div className="mb-3 flex gap-2">
        <Field label="线宽">
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={8}
            className={inputClass}
            value={edge.strokeWidth}
            onChange={(e) =>
              patch(edge.edgeId, { strokeWidth: Math.min(8, Math.max(0.5, Number(e.target.value) || 1)) })
            }
          />
        </Field>
        <Field label="虚线">
          {/* 用户 2026-11-04 第二批：三档改成"示意图标"（画一段真实线型），文字只留 title/aria */}
          <div className="flex gap-1">
            {EDGE_DASH_PRESETS.map((preset) => {
              const active = dashPresetOf(edge.strokeDasharray) === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={active}
                  onClick={() => patch(edge.edgeId, { strokeDasharray: preset.value })}
                  className={`grid h-7 flex-1 place-items-center rounded border ${
                    active
                      ? 'border-[var(--primary)] bg-[var(--accent-50)]'
                      : 'border-[var(--panel-border)] hover:border-[var(--primary)]'
                  }`}
                >
                  <DashSample
                    dasharray={preset.value}
                    color={active ? 'var(--primary)' : 'var(--text-secondary)'}
                  />
                </button>
              );
            })}
          </div>
          {dashPresetOf(edge.strokeDasharray) === 'custom' && (
            <span className="mt-1 block text-[10px] text-[var(--text-secondary)]">
              当前是自定义虚线（{edge.strokeDasharray}），点上面任一档可覆盖
            </span>
          )}
        </Field>
      </div>

      <Field label="线型">
        <select
          className={inputClass}
          value={edge.edgeType}
          onChange={(e) => patch(edge.edgeId, { edgeType: e.target.value as DiagramEdge['edgeType'] })}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="箭头">
        <select
          className={inputClass}
          value={edge.arrow}
          onChange={(e) => patch(edge.edgeId, { arrow: e.target.value as DiagramEdge['arrow'] })}
        >
          {ARROWS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}




