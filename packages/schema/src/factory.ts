import {
  COMPONENT_INDEX,
  EDGE_DEFAULTS,
  GROUP_DEFAULTS,
  NODE_DEFAULTS,
  ZONE_PALETTES,
} from './constants.js';
import { iconKeyFor } from './icons.js';
import type {
  ArchitectureDiagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  NodeType,
  Point,
} from './types.js';

export const SCHEMA_VERSION = '1.0';
export const DEFAULT_CREATOR_ID = 'local-user';

/** 统一 id 生成：浏览器与 Node 都有 globalThis.crypto */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 极端兜底（老 Node / 无 crypto 环境），仍满足 UUID v4 格式
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[(Math.random() * 4) | 0]! + 'a';
    else out += hex[(Math.random() * 16) | 0]!;
  }
  return out;
}

export const nowIso = (): string => new Date().toISOString();

export function createEmptyDiagram(overrides: Partial<ArchitectureDiagram> = {}): ArchitectureDiagram {
  const ts = nowIso();
  return {
    diagramId: newId(),
    schemaVersion: SCHEMA_VERSION,
    name: '未命名架构图',
    description: '',
    version: 1,
    creatorId: DEFAULT_CREATOR_ID,
    createdAt: ts,
    updatedAt: ts,
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
    nodes: [],
    edges: [],
    ...overrides,
  };
}

export function createNode(
  nodeType: NodeType,
  diagramId: string,
  position: Point,
  overrides: Partial<DiagramNode> = {},
): DiagramNode {
  const component = COMPONENT_INDEX[nodeType];
  return {
    nodeId: newId(),
    diagramId,
    groupId: null,
    label: component?.label ?? '节点',
    subLabel: component?.defaultSubLabel ?? '',
    nodeType,
    x: position.x,
    y: position.y,
    width: component?.width ?? NODE_DEFAULTS.width,
    height: component?.height ?? NODE_DEFAULTS.height,
    bgColor: NODE_DEFAULTS.bgColor,
    borderColor: NODE_DEFAULTS.borderColor,
    textColor: NODE_DEFAULTS.textColor,
    locked: false,
    visible: true,
    sort: 0,
    // 图标规则：只存 key，不存 base64/url（见 icons.ts）
    extJson: { iconKey: iconKeyFor(nodeType) },
    isDeleted: false,
    ...overrides,
  };
}

export function createGroup(
  diagramId: string,
  position: Point,
  overrides: Partial<DiagramGroup> = {},
): DiagramGroup {
  return {
    groupId: newId(),
    diagramId,
    parentGroupId: null,
    label: '新分组',
    x: position.x,
    y: position.y,
    width: GROUP_DEFAULTS.width,
    height: GROUP_DEFAULTS.height,
    bgColor: GROUP_DEFAULTS.bgColor,
    borderColor: GROUP_DEFAULTS.borderColor,
    titleColor: GROUP_DEFAULTS.titleColor,
    collapsed: false,
    sort: 0,
    isDeleted: false,
    ...overrides,
  };
}

/** 按语义色板创建分区泳道（DMZ / INTRANET / EXTERNAL） */
export function createZoneGroup(
  diagramId: string,
  paletteKey: string,
  position: Point,
  overrides: Partial<DiagramGroup> = {},
): DiagramGroup {
  const palette = ZONE_PALETTES.find((p) => p.key === paletteKey) ?? ZONE_PALETTES[0]!;
  return createGroup(diagramId, position, {
    label: palette.label,
    bgColor: palette.bgColor,
    borderColor: palette.borderColor,
    titleColor: palette.titleColor,
    ...overrides,
  });
}

export function createEdge(
  diagramId: string,
  sourceNodeId: string,
  targetNodeId: string,
  overrides: Partial<DiagramEdge> = {},
): DiagramEdge {
  return {
    edgeId: newId(),
    diagramId,
    sourceNodeId,
    targetNodeId,
    strokeColor: EDGE_DEFAULTS.strokeColor,
    strokeWidth: EDGE_DEFAULTS.strokeWidth,
    strokeDasharray: EDGE_DEFAULTS.strokeDasharray,
    edgeType: EDGE_DEFAULTS.edgeType,
    sourceAnchor: null,
    targetAnchor: null,
    arrow: EDGE_DEFAULTS.arrow,
    sort: 0,
    isDeleted: false,
    ...overrides,
  };
}

/** 深拷贝并换新 id（复制/粘贴、整图复制用） */
export function cloneNodeWithNewId(node: DiagramNode, offset: Point = { x: 24, y: 24 }): DiagramNode {
  return { ...structuredClone(node), nodeId: newId(), x: node.x + offset.x, y: node.y + offset.y };
}

export function cloneEdgeWithNewId(edge: DiagramEdge, nodeIdMap: Map<string, string>): DiagramEdge | null {
  const source = nodeIdMap.get(edge.sourceNodeId);
  const target = nodeIdMap.get(edge.targetNodeId);
  if (!source || !target) return null;
  return { ...structuredClone(edge), edgeId: newId(), sourceNodeId: source, targetNodeId: target };
}

/** 统计信息，供状态栏与列表页使用 */
export function diagramStats(diagram: ArchitectureDiagram): {
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
} {
  return {
    nodeCount: diagram.nodes.filter((n) => !n.isDeleted && n.visible).length,
    edgeCount: diagram.edges.filter((e) => !e.isDeleted).length,
    groupCount: diagram.groups.filter((g) => !g.isDeleted).length,
  };
}
