import {
  createEdge,
  createEmptyDiagram,
  createGroup,
  createNode,
  DEFAULT_CREATOR_ID,
  newId,
  SCHEMA_VERSION,
  validateDiagram,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
} from '@arch/schema';

/**
 * JSON 导入 / 导出（规格 §6.1）。
 *
 * 两条硬规则：
 * 1. 导入必须换一套 id（diagramId / groupId / nodeId / edgeId 全换），
 *    否则会把"别人的图"和自己的图搅成同一张，外键全乱；
 * 2. 导入必须过一遍 Zod（repair 模式），坏数据降级成可打开的图，而不是把画布搞崩。
 */

export const TRANSFER_FORMAT = 'arch-diagram';

/** 跨系统传文件时，只带"内容"，不带库里的乐观锁与审计字段 */
export interface PortableDiagram {
  format: typeof TRANSFER_FORMAT;
  schemaVersion: string;
  exportedAt: string;
  /** 只带内容字段：不含乐观锁 version 与审计时间以外的库内字段 */
  diagram: Omit<ArchitectureDiagram, 'version'>;
}

export type ParseResult =
  | { ok: true; diagram: ArchitectureDiagram; warnings: string[] }
  | { ok: false; error: string };

function toPortable(diagram: ArchitectureDiagram): PortableDiagram {
  return {
    format: TRANSFER_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    diagram: {
      diagramId: diagram.diagramId,
      schemaVersion: diagram.schemaVersion,
      name: diagram.name,
      description: diagram.description,
      creatorId: diagram.creatorId,
      viewport: diagram.viewport,
      groups: diagram.groups.filter((g) => !g.isDeleted),
      nodes: diagram.nodes.filter((n) => !n.isDeleted),
      edges: diagram.edges.filter((e) => !e.isDeleted),
      createdAt: diagram.createdAt,
      updatedAt: diagram.updatedAt,
    },
  };
}

export function serializeDiagram(diagram: ArchitectureDiagram): string {
  return `${JSON.stringify(toPortable(diagram), null, 2)}\n`;
}

/** 文件名里的非法字符替换掉，避免 Windows 上存不下来 */
export function exportFileName(diagram: ArchitectureDiagram, extension: string): string {
  const base = (diagram.name || '架构图').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60);
  return `${base || '架构图'}.${extension}`;
}

/**
 * 换一套 id：分组、节点、连线各自重新编号，并把引用一并改写。
 * 坐标不动——组内局部坐标的语义在导入后依然成立。
 */
export function reissueIds(diagram: ArchitectureDiagram): ArchitectureDiagram {
  const groupIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();

  for (const group of diagram.groups) groupIdMap.set(group.groupId, newId());
  for (const node of diagram.nodes) nodeIdMap.set(node.nodeId, newId());

  const diagramId = newId();
  const remap = (id: string | null | undefined, map: Map<string, string>): string | null =>
    id ? (map.get(id) ?? null) : null;

  return {
    ...diagram,
    diagramId,
    schemaVersion: SCHEMA_VERSION,
    creatorId: diagram.creatorId || DEFAULT_CREATOR_ID,
    version: 1,
    groups: diagram.groups.map((g) => ({
      ...g,
      groupId: groupIdMap.get(g.groupId)!,
      diagramId,
      parentGroupId: remap(g.parentGroupId, groupIdMap),
      isDeleted: false,
    })),
    nodes: diagram.nodes.map((n) => ({
      ...n,
      nodeId: nodeIdMap.get(n.nodeId)!,
      diagramId,
      groupId: remap(n.groupId, groupIdMap),
      isDeleted: false,
    })),
    edges: diagram.edges
      .map((e) => ({
        ...e,
        edgeId: newId(),
        diagramId,
        sourceNodeId: remap(e.sourceNodeId, nodeIdMap),
        targetNodeId: remap(e.targetNodeId, nodeIdMap),
        isDeleted: false,
      }))
      // 端点找不到（脏数据）就别导进来变成悬空边
      .filter((e): e is typeof e & { sourceNodeId: string; targetNodeId: string } =>
        Boolean(e.sourceNodeId && e.targetNodeId),
      ),
  };
}

/**
 * 把外部文件补成"结构完整"的图：缺 id 就发新 id，缺字段就取工厂默认值。
 *
 * 这一步必须做在校验之前——校验器只负责业务规则（坐标越界、颜色非法、类型不认识），
 * 不会替外部文件生成 nodeId 这种"必须存在"的字段。
 */
function normalize(input: Record<string, unknown>): ArchitectureDiagram {
  const template = createEmptyDiagram({ name: '导入的架构图' });
  const diagramId = template.diagramId;
  const now = new Date().toISOString();

  const rawGroups = Array.isArray(input.groups) ? (input.groups as Partial<DiagramGroup>[]) : [];
  const rawNodes = Array.isArray(input.nodes) ? (input.nodes as Partial<DiagramNode>[]) : [];
  const rawEdges = Array.isArray(input.edges) ? (input.edges as Partial<DiagramEdge>[]) : [];

  // 外部文件的 id 可能是 "n1"、"g1" 这种随手写的字符串——一律换成新 UUID，
  // 同时保留"旧 id → 新 id"的映射，否则组归属和连线端点会全部指空。
  const groupIdMap = new Map<string, string>();
  const nodeIdMap = new Map<string, string>();

  const groups: DiagramGroup[] = rawGroups.map((g) => {
    const groupId = newId();
    if (typeof g.groupId === 'string' && g.groupId) groupIdMap.set(g.groupId, groupId);
    return {
      ...createGroup(diagramId, { x: Number(g.x) || 0, y: Number(g.y) || 0 }),
      ...g,
      groupId,
      diagramId,
      parentGroupId: null,
    };
  });

  // 第二遍补父组关系（此时 groupIdMap 已经完整）
  groups.forEach((group, index) => {
    const parent = rawGroups[index]?.parentGroupId;
    group.parentGroupId = typeof parent === 'string' ? (groupIdMap.get(parent) ?? null) : null;
  });

  const nodes: DiagramNode[] = rawNodes.map((n) => {
    // 保留原始类型名，让校验器给出 NODE_TYPE_FALLBACK 警告（而不是悄悄改成 custom）
    const nodeType = (typeof n.nodeType === 'string' && n.nodeType ? n.nodeType : 'custom') as DiagramNode['nodeType'];
    const nodeId = newId();
    if (typeof n.nodeId === 'string' && n.nodeId) nodeIdMap.set(n.nodeId, nodeId);
    return {
      ...createNode(nodeType, diagramId, { x: Number(n.x) || 0, y: Number(n.y) || 0 }),
      ...n,
      nodeId,
      diagramId,
      groupId: null,
    };
  });

  nodes.forEach((node, index) => {
    const groupId = rawNodes[index]?.groupId;
    node.groupId = typeof groupId === 'string' ? (groupIdMap.get(groupId) ?? null) : null;
  });

  const edges: DiagramEdge[] = rawEdges
    .map((e) => ({
      ...createEdge(diagramId, '', ''),
      ...e,
      edgeId: newId(),
      diagramId,
      sourceNodeId: typeof e.sourceNodeId === 'string' ? (nodeIdMap.get(e.sourceNodeId) ?? '') : '',
      targetNodeId: typeof e.targetNodeId === 'string' ? (nodeIdMap.get(e.targetNodeId) ?? '') : '',
    }))
    // 端点不存在的边直接丢掉，别指望校验器去修悬空引用
    .filter((e) => e.sourceNodeId !== '' && e.targetNodeId !== '');

  return {
    ...template,
    diagramId,
    name: typeof input.name === 'string' && input.name.trim() ? input.name : '导入的架构图',
    description: typeof input.description === 'string' ? input.description : '',
    creatorId: typeof input.creatorId === 'string' && input.creatorId ? input.creatorId : DEFAULT_CREATOR_ID,
    viewport:
      input.viewport && typeof input.viewport === 'object'
        ? (input.viewport as ArchitectureDiagram['viewport'])
        : { x: 0, y: 0, zoom: 1 },
    groups,
    nodes,
    edges,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: now,
  };
}

export function parseImport(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' };
  }

  if (!raw || typeof raw !== 'object') return { ok: false, error: '文件内容不是对象' };

  const container = raw as Record<string, unknown>;
  const candidate = (container.diagram ?? container) as Record<string, unknown>;
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, error: '文件里没有 diagram 字段' };
  }

  const validated = validateDiagram(normalize(candidate), { repair: true });
  if (!validated.ok || !validated.diagram) {
    return { ok: false, error: validated.errors[0]?.message ?? '图数据不合法' };
  }

  return {
    ok: true,
    diagram: reissueIds(validated.diagram),
    warnings: validated.warnings.map((w) => `${w.path}: ${w.message}`),
  };
}


