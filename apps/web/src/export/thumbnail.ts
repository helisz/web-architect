/**
 * 快照缩略图（阶段 3 · B2）。
 *
 * 版本历史列表里每行一张小图，让"回滚到哪一版"看得见。
 *
 * 做法：直接用快照 payload 的几何数据拼一张极简 SVG（分组底色矩形 + 节点矩形
 * + 连线直线），不渲染真实 DOM —— 一次 50 条列表也不会卡，也不需要额外存储
 * 缩略图文件。样式只保"形状与位置"，不保字体与图标（缩略图不需要）。
 */

interface ThumbRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ThumbNode extends ThumbRect {
  nodeId?: string;
  label?: string;
  bgColor?: string;
  borderColor?: string;
  groupId?: string | null;
}

interface ThumbGroup extends ThumbRect {
  groupId: string;
  parentGroupId?: string | null;
  bgColor?: string;
  borderColor?: string;
}

interface ThumbEdge {
  sourceNodeId: string;
  targetNodeId: string;
  strokeColor?: string;
  strokeWidth?: number;
}

/** 只依赖 payload 里的这几个字段，导出用（避免把整个 schema 类型搬进来） */
export interface ThumbnailPayload {
  nodes?: ThumbNode[];
  groups?: ThumbGroup[];
  edges?: ThumbEdge[];
}

/** 分组偏移：payload 里的子节点坐标是相对父组的（C1） */
function groupOffsetOf(groups: ThumbGroup[], groupId: string | null | undefined, guard = 0): { x: number; y: number } {
  if (!groupId || guard > 8) return { x: 0, y: 0 };
  const group = groups.find((g) => g.groupId === groupId);
  if (!group) return { x: 0, y: 0 };
  const parent = groupOffsetOf(groups, group.parentGroupId, guard + 1);
  return { x: parent.x + group.x, y: parent.y + group.y };
}

const escapeXml = (value: string): string =>
  value.replace(/[<>&"']/g, (ch) =>
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&apos;',
  );

/**
 * 生成缩略图 SVG 字符串。
 *
 * @param payload 快照 payload
 * @param width   目标宽度（px），高度按内容比例算
 * @param padding 内容四周留白（px，按缩略图坐标）
 */
export function snapshotThumbnail(
  payload: ThumbnailPayload,
  width = 96,
  padding = 4,
  background: string | null = '#FFFFFF',
): string {
  const groups = (payload.groups ?? []).map((g) => ({ ...g, ...groupOffsetOf(payload.groups ?? [], g.parentGroupId) }));
  const nodes = (payload.nodes ?? []).map((n) => {
    const offset = groupOffsetOf(payload.groups ?? [], n.groupId);
    return { ...n, x: n.x + offset.x, y: n.y + offset.y };
  });

  const rects: (ThumbRect & { kind: 'group' | 'node'; fill: string; stroke: string })[] = [
    ...groups.map((g) => ({
      kind: 'group' as const,
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      fill: g.bgColor || '#F2F1EC',
      stroke: g.borderColor || '#D6D9DD',
    })),
    ...nodes.map((n) => ({
      kind: 'node' as const,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      fill: n.bgColor || '#FFFFFF',
      stroke: n.borderColor || '#D6D9DD',
    })),
  ];

  if (rects.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${Math.round(width * 0.6)}" viewBox="0 0 ${width} ${Math.round(
      width * 0.6,
    )}"><rect width="100%" height="100%" fill="#F9FAFB"/></svg>`;
  }

  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  const scale = (width - padding * 2) / contentWidth;
  const height = Math.max(24, Math.round(contentHeight * scale + padding * 2));

  const byId = new Map(nodes.map((n) => [n.nodeId ?? '', n]));
  // 缩略图里连线用"中心到中心"的直线，够看清拓扑走向
  const lines = (payload.edges ?? [])
    .map((edge) => {
      const source = byId.get(edge.sourceNodeId);
      const target = byId.get(edge.targetNodeId);
      if (!source || !target) return '';
      const x1 = (source.x + source.width / 2 - minX) * scale + padding;
      const y1 = (source.y + source.height / 2 - minY) * scale + padding;
      const x2 = (target.x + target.width / 2 - minX) * scale + padding;
      const y2 = (target.y + target.height / 2 - minY) * scale + padding;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(
        1,
      )}" stroke="${escapeXml(edge.strokeColor || '#AFACA2')}" stroke-width="1"/>`;
    })
    .join('');

  const shapes = rects
    .map((r) => {
      const x = ((r.x - minX) * scale + padding).toFixed(1);
      const y = ((r.y - minY) * scale + padding).toFixed(1);
      const w = Math.max(1, r.width * scale).toFixed(1);
      const h = Math.max(1, r.height * scale).toFixed(1);
      const strokeWidth = r.kind === 'group' ? 1 : 0.6;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r.kind === 'group' ? 2 : 1}" fill="${escapeXml(
        r.fill,
      )}" stroke="${escapeXml(r.stroke)}" stroke-width="${strokeWidth}"/>`;
    })
    .join('');

  const bg = background === null ? '' : `<rect width="100%" height="100%" fill="${escapeXml(background)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${shapes}${lines}</svg>`;
}

/** 缩略图 SVG → data URL（直接塞进 <img src>） */
export function thumbnailDataUrl(payload: ThumbnailPayload, width = 96, background: string | null = '#FFFFFF'): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(snapshotThumbnail(payload, width, 4, background))}`;
}

