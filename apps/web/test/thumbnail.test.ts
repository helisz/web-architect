import { describe, expect, it } from 'vitest';
import { snapshotThumbnail, thumbnailDataUrl } from '../src/export/thumbnail.js';

/**
 * 快照缩略图（阶段 3 · B2）。
 *
 * 缩略图是纯函数产物，重点验三件事：空图不炸、分组偏移被算进去、SVG 合法可渲染。
 */
describe('快照缩略图', () => {
  it('空 payload 返回占位图，不抛错', () => {
    const svg = snapshotThumbnail({});
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#F9FAFB"');
  });

  it('单个节点：产出 viewBox 与一个 rect，尺寸按传入宽度', () => {
    const svg = snapshotThumbnail(
      { nodes: [{ x: 0, y: 0, width: 160, height: 80, bgColor: '#FFFFFF', borderColor: '#D6D9DD' }] },
      96,
    );
    expect(svg).toContain('width="96"');
    expect((svg.match(/<rect /g) ?? []).length).toBe(2); // 背景 + 节点
  });

  it('分组子节点的绝对位置 = 组偏移 + 局部坐标', () => {
    const svg = snapshotThumbnail({
      groups: [{ groupId: 'g1', x: 100, y: 100, width: 400, height: 300, bgColor: '#EFF6FF', borderColor: '#BFDBFE' }],
      nodes: [{ x: 20, y: 20, width: 160, height: 80, groupId: 'g1', bgColor: '#FFFFFF' }],
    });
    // 内容包围盒 = 组 (100,100)-(500,400)，节点落在 (120,120) → 缩放后节点必须落在组内
    const nodeRect = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="1"/.exec(svg);
    expect(nodeRect).not.toBeNull();
    const [, x, y] = nodeRect!;
    expect(Number(x)).toBeGreaterThan(0);
    expect(Number(y)).toBeGreaterThan(0);
    expect(svg).toContain('fill="#EFF6FF"');
  });

  it('连线按端点中心画直线，颜色跟随 edge', () => {
    const svg = snapshotThumbnail({
      nodes: [
        { nodeId: 'a', x: 0, y: 0, width: 160, height: 80 },
        { nodeId: 'b', x: 400, y: 0, width: 160, height: 80 },
      ],
      edges: [{ sourceNodeId: 'a', targetNodeId: 'b', strokeColor: '#F59E0B' }],
    });
    expect(svg).toContain('<line');
    expect(svg).toContain('stroke="#F59E0B"');
  });

  it('端点缺失的连线被静默丢弃，不影响其他元素', () => {
    const svg = snapshotThumbnail({
      nodes: [{ nodeId: 'a', x: 0, y: 0, width: 160, height: 80 }],
      edges: [{ sourceNodeId: 'a', targetNodeId: '不存在' }],
    });
    expect(svg).not.toContain('<line');
    expect(svg).toContain('<rect');
  });

  it('标签里的特殊字符被转义（不会破坏 SVG）', () => {
    const svg = snapshotThumbnail({ nodes: [{ label: 'a<b&c"', x: 0, y: 0, width: 100, height: 50, bgColor: '#FFF' }] });
    expect(svg).not.toContain('a<b');
  });

  it('data URL 可直接给 img.src', () => {
    const url = thumbnailDataUrl({ nodes: [{ x: 0, y: 0, width: 160, height: 80 }] }, 120);
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1]!)).toContain('<svg');
  });
});
