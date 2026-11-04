import type { ArchitectureDiagram, DiagramEdge, DiagramGroup, DiagramNode } from './types.js';

/**
 * DB 行 ⇄ 对象字段映射（规格 §8.4）。
 *
 * 唯一允许的转换：snake_case ⇄ camelCase 一一对应，不做任何业务改写。
 * 这一层的存在正是为了守住"Schema 前后端同一份"这条红线。
 */

export interface DiagramMasterRow {
  diagram_id: string;
  schema_version: string;
  name: string;
  description: string;
  project_id: string | null;
  tags: string[] | null;
  version: number;
  creator_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  viewport_x: number;
  viewport_y: number;
  viewport_zoom: number;
  is_deleted: boolean;
}

export interface DiagramGroupRow {
  group_id: string;
  diagram_id: string;
  parent_group_id: string | null;
  label: string;
  /** 老库（patch 没跑）里没有这一列，读出来是 undefined —— 用 `?? ''` 兜住 */
  sub_label?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  bg_color: string;
  border_color: string;
  title_color: string;
  collapsed: boolean;
  sort: number;
  ext_json: Record<string, unknown> | null;
  is_deleted: boolean;
}

export interface DiagramNodeRow {
  node_id: string;
  diagram_id: string;
  group_id: string | null;
  label: string;
  sub_label: string;
  node_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bg_color: string;
  border_color: string;
  text_color: string;
  locked: boolean;
  visible: boolean;
  sort: number;
  ext_json: Record<string, unknown> | null;
  is_deleted: boolean;
}

export interface DiagramEdgeRow {
  edge_id: string;
  diagram_id: string;
  source_node_id: string;
  target_node_id: string;
  label: string | null;
  stroke_color: string;
  stroke_width: number;
  stroke_dasharray: string | null;
  edge_type: string;
  arrow: string;
  source_anchor: string | null;
  target_anchor: string | null;
  sort: number;
  ext_json: Record<string, unknown> | null;
  is_deleted: boolean;
}

const toIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/* ------------------------------------------------------------------ */
/* row → 对象（读取方向）                                              */
/* ------------------------------------------------------------------ */

export function rowToGroup(row: DiagramGroupRow): DiagramGroup {
  return {
    groupId: row.group_id,
    diagramId: row.diagram_id,
    parentGroupId: row.parent_group_id ?? null,
    label: row.label,
    subLabel: row.sub_label ?? '',
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    bgColor: row.bg_color,
    borderColor: row.border_color,
    titleColor: row.title_color,
    collapsed: row.collapsed,
    sort: row.sort,
    ...(row.ext_json ? { extJson: row.ext_json } : {}),
    isDeleted: false,
  };
}

export function rowToNode(row: DiagramNodeRow): DiagramNode {
  return {
    nodeId: row.node_id,
    diagramId: row.diagram_id,
    groupId: row.group_id ?? null,
    label: row.label,
    subLabel: row.sub_label,
    nodeType: row.node_type as DiagramNode['nodeType'],
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    bgColor: row.bg_color,
    borderColor: row.border_color,
    textColor: row.text_color,
    locked: row.locked,
    visible: row.visible,
    sort: row.sort,
    ...(row.ext_json ? { extJson: row.ext_json } : {}),
    isDeleted: false,
  };
}

export function rowToEdge(row: DiagramEdgeRow): DiagramEdge {
  return {
    edgeId: row.edge_id,
    diagramId: row.diagram_id,
    sourceNodeId: row.source_node_id,
    targetNodeId: row.target_node_id,
    ...(row.label ? { label: row.label } : {}),
    strokeColor: row.stroke_color,
    strokeWidth: Number(row.stroke_width),
    strokeDasharray: row.stroke_dasharray,
    edgeType: row.edge_type as DiagramEdge['edgeType'],
    sourceAnchor: (row.source_anchor as DiagramEdge['sourceAnchor']) ?? null,
    targetAnchor: (row.target_anchor as DiagramEdge['targetAnchor']) ?? null,
    arrow: row.arrow as DiagramEdge['arrow'],
    sort: row.sort,
    ...(row.ext_json ? { extJson: row.ext_json } : {}),
    isDeleted: false,
  };
}

export function assembleDiagram(
  master: DiagramMasterRow,
  groups: DiagramGroupRow[],
  nodes: DiagramNodeRow[],
  edges: DiagramEdgeRow[],
): ArchitectureDiagram {
  return {
    diagramId: master.diagram_id,
    schemaVersion: master.schema_version,
    name: master.name,
    description: master.description,
    ...(master.project_id ? { projectId: master.project_id } : {}),
    tags: master.tags ?? [],
    version: master.version,
    creatorId: master.creator_id,
    createdAt: toIso(master.created_at),
    updatedAt: toIso(master.updated_at),
    viewport: {
      x: Number(master.viewport_x),
      y: Number(master.viewport_y),
      zoom: Number(master.viewport_zoom),
    },
    groups: groups.map(rowToGroup),
    nodes: nodes.map(rowToNode),
    edges: edges.map(rowToEdge),
  };
}

/* ------------------------------------------------------------------ */
/* 对象 → row（写入方向）                                              */
/* ------------------------------------------------------------------ */

export function groupToRow(g: DiagramGroup, diagramId: string): DiagramGroupRow {
  return {
    group_id: g.groupId,
    diagram_id: diagramId,
    parent_group_id: g.parentGroupId ?? null,
    label: g.label,
    sub_label: g.subLabel,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    bg_color: g.bgColor,
    border_color: g.borderColor,
    title_color: g.titleColor,
    collapsed: g.collapsed,
    sort: g.sort,
    ext_json: g.extJson ?? null,
    is_deleted: false,
  };
}

export function nodeToRow(n: DiagramNode, diagramId: string): DiagramNodeRow {
  return {
    node_id: n.nodeId,
    diagram_id: diagramId,
    group_id: n.groupId ?? null,
    label: n.label,
    sub_label: n.subLabel,
    node_type: n.nodeType,
    x: n.x,
    y: n.y,
    width: n.width,
    height: n.height,
    bg_color: n.bgColor,
    border_color: n.borderColor,
    text_color: n.textColor,
    locked: n.locked,
    visible: n.visible,
    sort: n.sort,
    ext_json: n.extJson ?? null,
    is_deleted: false,
  };
}

export function edgeToRow(e: DiagramEdge, diagramId: string): DiagramEdgeRow {
  return {
    edge_id: e.edgeId,
    diagram_id: diagramId,
    source_node_id: e.sourceNodeId,
    target_node_id: e.targetNodeId,
    label: e.label ?? null,
    stroke_color: e.strokeColor,
    stroke_width: e.strokeWidth,
    stroke_dasharray: e.strokeDasharray ?? null,
    edge_type: e.edgeType,
    arrow: e.arrow,
    source_anchor: e.sourceAnchor ?? null,
    target_anchor: e.targetAnchor ?? null,
    sort: e.sort,
    ext_json: e.extJson ?? null,
    is_deleted: false,
  };
}

