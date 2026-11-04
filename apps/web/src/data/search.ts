import { groupAbsoluteRect, nodeAbsoluteRect, type ArchitectureDiagram, type NodeType } from '@arch/schema';

export interface Hit {
  id: string;
  kind: 'node' | 'group' | 'edge';
  title: string;
  detail: string;
  center: { x: number; y: number };
}

export interface SearchFilters {
  /** 只看这种节点类型 */
  nodeType?: NodeType | 'all';
  /** 只看这个分组里的节点（'all' = 不限；'none' = 不在任何分组里） */
  groupId?: string | 'all' | 'none';
}

/**
 * Ctrl+F 搜索（规格 §12 第 4 条 + D2 的类型 / 分组筛选）。
 *
 * 匹配范围：`label` / `subLabel` / `extJson.ip` / 节点类型名，不区分大小写。
 * 类型或分组筛选生效时只返回节点 —— 分组和连线没有这两项属性，
 * 混在结果里只会让人以为筛选没生效。
 */
export function search(diagram: ArchitectureDiagram, query: string, filters: SearchFilters = {}): Hit[] {
  const q = query.trim().toLowerCase();
  const typeFilter = filters.nodeType && filters.nodeType !== 'all' ? filters.nodeType : null;
  const groupFilter = filters.groupId && filters.groupId !== 'all' ? filters.groupId : null;
  const nodeOnly = Boolean(typeFilter || groupFilter);
  if (!q && !nodeOnly) return [];
  const hits: Hit[] = [];

  for (const node of diagram.nodes) {
    if (node.isDeleted || !node.visible) continue;
    if (typeFilter && node.nodeType !== typeFilter) continue;
    if (groupFilter === 'none' && node.groupId) continue;
    if (groupFilter && groupFilter !== 'none' && node.groupId !== groupFilter) continue;

    const ip = typeof node.extJson?.ip === 'string' ? node.extJson.ip : '';
    const haystack = `${node.label}\n${node.subLabel}\n${ip}\n${node.nodeType}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    const rect = nodeAbsoluteRect(diagram.groups, node);
    hits.push({
      id: node.nodeId,
      kind: 'node',
      title: node.label || node.nodeType,
      detail: ip ? `IP ${ip}` : node.subLabel || node.nodeType,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    });
  }

  if (!nodeOnly) {
    for (const group of diagram.groups) {
      if (group.isDeleted) continue;
      if (!group.label.toLowerCase().includes(q)) continue;
      const rect = groupAbsoluteRect(diagram.groups, group);
      hits.push({
        id: group.groupId,
        kind: 'group',
        title: group.label || '未命名分组',
        detail: '分组',
        center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      });
    }

    for (const edge of diagram.edges) {
      if (edge.isDeleted || !edge.label || !edge.label.toLowerCase().includes(q)) continue;
      const source = diagram.nodes.find((n) => n.nodeId === edge.sourceNodeId);
      const target = diagram.nodes.find((n) => n.nodeId === edge.targetNodeId);
      if (!source || !target) continue;
      const a = nodeAbsoluteRect(diagram.groups, source);
      const b = nodeAbsoluteRect(diagram.groups, target);
      hits.push({
        id: edge.edgeId,
        kind: 'edge',
        title: edge.label,
        detail: `${source.label} → ${target.label}`,
        center: { x: (a.x + a.width / 2 + b.x + b.width / 2) / 2, y: (a.y + a.height / 2 + b.y + b.height / 2) / 2 },
      });
    }
  }

  return hits.slice(0, 30);
}
