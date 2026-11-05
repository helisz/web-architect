import { textStyleOf } from '@arch/schema';
import { readLineData } from '../canvas/lineGeometry.js';
import type { DiagramEdge, DiagramGroup, DiagramNode } from '@arch/schema';

/**
 * 多选批量编辑的「交集」规则（用户 2026-11-04 指定）。
 *
 * 选中多个对象时，属性面板只显示**所有对象都有**的字段，改一次批量应用到全部；
 * 值不一致的字段标成「多个值」。没有的字段直接不出现 —— 所以节点 + 连线混选时，
 * 只剩「名称」这一项（连线没有背景色、节点没有线宽）。
 */

export type MultiKind = 'node' | 'group' | 'edge' | 'line';

export type MultiField =
  | 'label'
  | 'subLabel'
  | 'bgColor'
  | 'borderColor'
  | 'textColor'
  | 'iconKey'
  | 'iconHidden'
  | 'align'
  | 'valign'
  | 'strokeColor'
  /* 2026-11-05：连线的批量样式（选多条线时一次改完，省得一条条点） */
  | 'strokeWidth'
  | 'edgeType'
  | 'arrow'
  | 'strokeDasharray';

/** 每类对象支持哪些可批量编辑的字段 */
const SUPPORT: Record<MultiKind, readonly MultiField[]> = {
  node: ['label', 'subLabel', 'bgColor', 'borderColor', 'textColor', 'iconKey', 'iconHidden', 'align', 'valign'],
  // 线条（用户 2026-11-05）：颜色复用节点边框色，粗细/虚线在 extJson.line 里；
  // 与普通节点混选时交集正好剩下 borderColor，可以一起改色。
  line: ['borderColor', 'strokeWidth', 'strokeDasharray'],
  group: ['label', 'subLabel', 'bgColor', 'borderColor', 'textColor', 'iconKey', 'iconHidden'],
  edge: ['label', 'strokeColor', 'strokeWidth', 'edgeType', 'arrow', 'strokeDasharray'],
};

/** 字段的中文名，面板上按这个顺序铺开 */
export const FIELD_LABEL: Record<MultiField, string> = {
  label: '名称',
  subLabel: '副文本',
  bgColor: '背景色',
  borderColor: '边框色',
  textColor: '文字颜色',
  iconKey: '图标',
  iconHidden: '图标开关',
  align: '水平对齐',
  valign: '垂直对齐',
  strokeColor: '线条颜色',
  strokeWidth: '线宽',
  edgeType: '线型',
  arrow: '箭头',
  strokeDasharray: '虚线',
};

const ORDER: MultiField[] = [
  'label',
  'subLabel',
  'bgColor',
  'borderColor',
  'textColor',
  'strokeColor',
  'strokeWidth',
  'edgeType',
  'arrow',
  'strokeDasharray',
  'iconKey',
  'iconHidden',
  'align',
  'valign',
];

export interface MultiSelection {
  nodes: DiagramNode[];
  groups: DiagramGroup[];
  edges: DiagramEdge[];
}

/** 把选中的 id 拆成三类对象，顺序与 selectedIds 一致 */
export function pickSelection(ids: string[], selection: MultiSelection): { kind: MultiKind; item: DiagramNode | DiagramGroup | DiagramEdge }[] {
  const out: { kind: MultiKind; item: DiagramNode | DiagramGroup | DiagramEdge }[] = [];
  for (const id of ids) {
    const node = selection.nodes.find((n) => n.nodeId === id);
    if (node) {
      out.push({ kind: node.nodeType === 'line' ? 'line' : 'node', item: node });
      continue;
    }
    const group = selection.groups.find((g) => g.groupId === id);
    if (group) {
      out.push({ kind: 'group', item: group });
      continue;
    }
    const edge = selection.edges.find((e) => e.edgeId === id);
    if (edge) out.push({ kind: 'edge', item: edge });
  }
  return out;
}

/** 读某对象某字段的当前值；不支持该字段返回 undefined */
export function readField(
  kind: MultiKind,
  item: DiagramNode | DiagramGroup | DiagramEdge,
  field: MultiField,
): string | undefined {
  if (!SUPPORT[kind].includes(field)) return undefined;
  if (kind === 'edge') {
    const edge = item as DiagramEdge;
    if (field === 'label') return edge.label ?? '';
    if (field === 'strokeColor') return edge.strokeColor;
    // 数字/枚举统一转成字符串参与「多个值」比较，apply 时再解析回类型
    if (field === 'strokeWidth') return String(edge.strokeWidth);
    if (field === 'edgeType') return edge.edgeType;
    if (field === 'arrow') return edge.arrow;
    // 「实线」用 'solid' 表示：strokeDasharray 为 null
    if (field === 'strokeDasharray') return edge.strokeDasharray ?? 'solid';
    return undefined;
  }
  if (kind === 'group') {
    const group = item as DiagramGroup;
    if (field === 'label') return group.label;
    if (field === 'subLabel') return group.subLabel;
    if (field === 'bgColor') return group.bgColor;
    if (field === 'borderColor') return group.borderColor;
    // 分组没有独立的"文字色"，标题色就是它
    if (field === 'textColor') return group.titleColor;
    if (field === 'iconKey') return typeof group.extJson?.iconKey === 'string' ? group.extJson.iconKey : '';
    if (field === 'iconHidden') return group.extJson?.iconHidden === true ? 'hidden' : 'shown';
    return undefined;
  }
  if (kind === 'line') {
    const node = item as DiagramNode;
    // 线条只有三样可批量改：颜色（节点边框色）、粗细、虚线
    if (field === 'borderColor') return node.borderColor;
    const line = readLineData(node.extJson, node.width, node.height);
    if (field === 'strokeWidth') return String(line.width);
    if (field === 'strokeDasharray') return line.dash ?? 'solid';
    return undefined;
  }
  const node = item as DiagramNode;
  if (field === 'label') return node.label;
  if (field === 'subLabel') return node.subLabel;
  if (field === 'bgColor') return node.bgColor;
  if (field === 'borderColor') return node.borderColor;
  if (field === 'textColor') return node.textColor;
  if (field === 'iconKey') return typeof node.extJson?.iconKey === 'string' ? node.extJson.iconKey : '';
  if (field === 'iconHidden') return node.extJson?.iconHidden === true ? 'hidden' : 'shown';
  if (field === 'align') return textStyleOf(node.nodeType, node.extJson).align;
  if (field === 'valign') return textStyleOf(node.nodeType, node.extJson).valign;
  return undefined;
}

export interface CommonFieldState {
  field: MultiField;
  /** 所有对象的值都相同时为这个值，否则为 null */
  value: string | null;
  mixed: boolean;
}

/**
 * 求"交集字段"：只有**每一个**选中对象都支持的字段才会出现；
 * 出现时再算出统一值 / 混合状态。
 */
export function commonFields(
  ids: string[],
  selection: MultiSelection,
): CommonFieldState[] {
  const picked = pickSelection(ids, selection);
  if (picked.length < 2) return [];
  const usable = ORDER.filter((field) => picked.every(({ kind }) => SUPPORT[kind].includes(field)));
  return usable.map((field) => {
    const values = picked.map(({ kind, item }) => readField(kind, item, field) ?? '');
    const first = values[0] ?? '';
    const mixed = values.some((v) => v !== first);
    return { field, value: mixed ? null : first, mixed };
  });
}
