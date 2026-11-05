import { describe, expect, it } from 'vitest';
import { createEmptyDiagram, createNode } from '@arch/schema';
import type { DiagramGroup } from '@arch/schema';
import { buildLayerRows, groupDepth, isSelfOrDescendant, subtreeHeight } from '../src/components/layerTree.js';

/**
 * 图层面板树形展示（用户 2026-11-05：要能看到分组层级，并能拖拽改归属）。
 */

const DIAGRAM_ID = '11111111-1111-4111-8111-111111111111';

function makeGroup(groupId: string, label: string, parentGroupId: string | null, sort = 0): DiagramGroup {
  return {
    groupId,
    diagramId: DIAGRAM_ID,
    parentGroupId,
    label,
    subLabel: null,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    collapsed: false,
    sort,
    fillColor: '#EFF6FF',
    borderColor: '#93C5FD',
    titleColor: '#1E3A8A',
    isDeleted: false,
    extJson: {},
  } as DiagramGroup;
}

describe('图层面板的树形层级', () => {
  const outer = makeGroup('g-outer', '外层', null, 1);
  const inner = makeGroup('g-inner', '内层', 'g-outer', 0);
  const diagram = createEmptyDiagram({ name: '层级' });
  const nodeInInner = createNode('server', diagram.diagramId, { x: 10, y: 10 }, { groupId: 'g-inner' });
  nodeInInner.label = '里层节点';
  const nodeAtRoot = createNode('db', diagram.diagramId, { x: 10, y: 10 });
  nodeAtRoot.label = '顶层节点';
  const groups = [outer, inner];
  const nodes = [nodeInInner, nodeAtRoot];

  it('嵌套顺序：外层 → 内层 → 内层里的节点 → 顶层节点', () => {
    const rows = buildLayerRows(groups, nodes, new Set());
    expect(rows.map((r) => r.label)).toEqual(['外层', '内层', '里层节点', '顶层节点']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0]);
  });

  it('分组行带内部元素数量，节点没有子项', () => {
    const rows = buildLayerRows(groups, nodes, new Set());
    const outerRow = rows.find((r) => r.label === '外层')!;
    const innerRow = rows.find((r) => r.label === '内层')!;
    expect(outerRow.childCount).toBe(1); // 内层
    expect(outerRow.hasChildren).toBe(true);
    expect(innerRow.childCount).toBe(1); // 里层节点
    expect(rows.find((r) => r.label === '里层节点')!.hasChildren).toBe(false);
  });

  it('收起分组后子项不再出现，但行还在', () => {
    const rows = buildLayerRows(groups, nodes, new Set(['g-outer']));
    expect(rows.map((r) => r.label)).toEqual(['外层', '顶层节点']);
    expect(rows[0]!.collapsed).toBe(true);
  });

  it('成环判断：自己 / 后代 / 无关组', () => {
    expect(isSelfOrDescendant(groups, 'g-outer', 'g-outer')).toBe(true);
    expect(isSelfOrDescendant(groups, 'g-outer', 'g-inner')).toBe(true);
    expect(isSelfOrDescendant(groups, 'g-inner', 'g-outer')).toBe(false);
  });

  it('层数与子树高度用来挡"超过 3 层"', () => {
    expect(groupDepth(groups, null)).toBe(0);
    expect(groupDepth(groups, 'g-outer')).toBe(1);
    expect(groupDepth(groups, 'g-inner')).toBe(2);
    expect(subtreeHeight(groups, 'g-outer')).toBe(2);
    expect(subtreeHeight(groups, 'g-inner')).toBe(1);
  });
});
