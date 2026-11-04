import { nodeAbsoluteRect, type ArchitectureDiagram, type DiagramNode } from '@arch/schema';

/**
 * CSV 导出（规格 §12 附加项）：节点清单 / 连线清单。
 *
 * 目的是"资产管理盘点"—— 所以导出的是**扁平表**，带分组、绝对坐标、IP 这些
 * 能直接拿去筛选排序的列；列顺序与运维表习惯一致。
 */

/** Excel 打开 UTF-8 需要 BOM，否则中文会乱码 */
export const CSV_BOM = '\uFEFF';

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  // 含逗号 / 引号 / 换行 → 整体加引号，内部引号翻倍
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(','));
  return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}

const ipOf = (node: DiagramNode): string =>
  typeof node.extJson?.ip === 'string' ? node.extJson.ip : '';

const groupLabelOf = (diagram: ArchitectureDiagram, groupId: string | null | undefined): string => {
  if (!groupId) return '';
  const group = diagram.groups.find((g) => g.groupId === groupId);
  return group?.label ?? '';
};

/** 节点清单：一行一个节点，坐标是**绝对**坐标（跨分组也能直接比） */
export function toNodesCsv(diagram: ArchitectureDiagram): string {
  const header = [
    '节点ID',
    '名称',
    '副文本',
    '类型',
    '所属分组',
    'IP',
    'X',
    'Y',
    '宽',
    '高',
    '背景色',
    '边框色',
    '文字色',
    '锁定',
    '可见',
    '层级',
  ];

  const rows = diagram.nodes
    .filter((n) => !n.isDeleted)
    .map((n) => {
      const rect = nodeAbsoluteRect(diagram.groups, n);
      return [
        n.nodeId,
        n.label,
        n.subLabel,
        n.nodeType,
        groupLabelOf(diagram, n.groupId),
        ipOf(n),
        Math.round(rect.x),
        Math.round(rect.y),
        Math.round(rect.width),
        Math.round(rect.height),
        n.bgColor,
        n.borderColor,
        n.textColor,
        n.locked ? '是' : '否',
        n.visible ? '是' : '否',
        n.sort,
      ];
    });

  return toCsv(header, rows);
}

/** 连线清单：一行一条连线，起止用节点名称（同时给 id，方便回表） */
export function toEdgesCsv(diagram: ArchitectureDiagram): string {
  const header = [
    '连线ID',
    '起点ID',
    '起点名称',
    '终点ID',
    '终点名称',
    '标注',
    '线型',
    '方向',
    '颜色',
    '线宽',
    '虚线',
    '起点锚点',
    '终点锚点',
  ];

  // 端点可能是节点，也可能是分组（用户 2026-11-04），分组名后面标一下来源
  const nameOf = (endpointId: string): string => {
    const node = diagram.nodes.find((n) => n.nodeId === endpointId);
    if (node) return node.label;
    const group = diagram.groups.find((g) => g.groupId === endpointId);
    if (group) return `${group.label}（分组）`;
    return '（已删除）';
  };

  const rows = diagram.edges
    .filter((e) => !e.isDeleted)
    .map((e) => [
      e.edgeId,
      e.sourceNodeId,
      nameOf(e.sourceNodeId),
      e.targetNodeId,
      nameOf(e.targetNodeId),
      e.label ?? '',
      e.edgeType,
      e.arrow,
      e.strokeColor,
      e.strokeWidth,
      e.strokeDasharray ?? '',
      e.sourceAnchor ?? '',
      e.targetAnchor ?? '',
    ]);

  return toCsv(header, rows);
}
