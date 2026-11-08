import { describe, expect, it } from 'vitest';
import { createEmptyDiagram, createGroup, createNode, DYNAMIC_GAP, defaultDynamicCols, layoutDynamicItems, layoutDynamicGroup, layoutWithCols } from '../src/index.js';

const items = (widths: number[], height = 40) =>
  widths.map((width, i) => ({ id: `n${i}`, width, height }));

describe('动态容器排版（2026-11-07）', () => {
  it('列宽 = 该列最宽的节点，列与列互不影响', () => {
    // 3 列：第 1 列有个 300 宽的节点，第 2/3 列都是 200
    const layout = layoutWithCols(items([300, 200, 200, 200, 200, 200]), 3);
    expect(layout.cols).toBe(3);
    expect(layout.colWidths).toEqual([300, 200, 200]);
    // 第 2 列从 300 + gap 开始
    expect(layout.slots[1]!.x).toBe(300 + DYNAMIC_GAP);
    expect(layout.slots[2]!.x).toBe(300 + DYNAMIC_GAP + 200 + DYNAMIC_GAP);
  });

  it('行高 = 该行最高的节点，间距都是一个网格单位', () => {
    const layout = layoutWithCols(
      [
        { id: 'a', width: 200, height: 80 },
        { id: 'b', width: 200, height: 40 },
        { id: 'c', width: 200, height: 40 },
        { id: 'd', width: 200, height: 40 },
      ],
      2,
    );
    expect(layout.slots[2]!.y).toBe(80 + DYNAMIC_GAP);
    expect(layout.contentHeight).toBe(80 + DYNAMIC_GAP + 40);
  });

  it('按可用宽度挑"放得下的最大列数"', () => {
    const list = items([200, 200, 200, 200]);
    // 两列：200 + 10 + 200 = 410
    expect(layoutDynamicItems(list, { innerWidth: 420 }).cols).toBe(2);
    // 三列：200*3 + 20 = 620
    expect(layoutDynamicItems(list, { innerWidth: 620 }).cols).toBe(3);
    // 太窄：退回一列
    expect(layoutDynamicItems(list, { innerWidth: 150 }).cols).toBe(1);
  });

  it('默认列数：接近方形、最多 3 列', () => {
    expect(defaultDynamicCols(1)).toBe(1);
    expect(defaultDynamicCols(2)).toBe(2);
    expect(defaultDynamicCols(4)).toBe(2);
    expect(defaultDynamicCols(9)).toBe(3);
    expect(defaultDynamicCols(30)).toBe(3);
  });

  it('layoutDynamicGroup：写入局部坐标、容器高度自动包住内容', () => {
    const base = createEmptyDiagram({ name: '动态' });
    const group = createGroup(base.diagramId, { x: 100, y: 100 }, {
      width: 240,
      height: 120,
      // 动态分组默认单行标题（副文本可在属性面板打开）
      extJson: { dynamic: true, singleLine: true },
    });
    const nodes = [0, 1, 2, 3].map((i) =>
      createNode('element', base.diagramId, { x: 0, y: 0 }, { groupId: group.groupId, label: `节点${i}` }),
    );
    const diagram = { ...base, groups: [group], nodes };

    const next = layoutDynamicGroup(diagram, group.groupId, { cols: 2, fitWidth: true });
    const g = next.groups[0]!;
    const placed = next.nodes.filter((n) => n.groupId === group.groupId);

    // 内距 2 格（20）；标题栏 24 会向上取整到 30，子节点 y 才是整格
    expect(placed[0]!.x).toBe(20);
    expect(placed[0]!.y).toBe(30 + 20);
    // 第 2 个在右边一列：20 + 200 + 10（1 格间距）
    expect(placed[1]!.x).toBe(20 + 200 + DYNAMIC_GAP);
    // 容器宽 = 内距 20×2 + 200×2 + 10
    expect(g.width).toBe(20 * 2 + 200 * 2 + DYNAMIC_GAP);
    // 高 = 标题 30（取整后）+ 内距 20×2 + 两行 40×2 + 行距 10
    expect(g.height).toBe(30 + 20 * 2 + 40 * 2 + DYNAMIC_GAP);
  });
});
