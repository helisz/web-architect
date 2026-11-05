/**
 * 一键整理（用户 2026-11-05）：分层结果必须"看得懂"，不能只是"动了一下"。
 *
 * 钉住四件事：连线层级决定上下、同层不重叠、分组的框要包住成员、有环不能崩。
 */

import { describe, expect, it } from 'vitest';
import { createEdge, createEmptyDiagram, createGroup, createNode } from '@arch/schema';
import { canAutoLayout, computeAutoLayout, rankUnits } from '../src/ai/autoLayout.js';

function diagramWith(chain: Array<[string, string]>, extra: Partial<ReturnType<typeof createEmptyDiagram>> = {}) {
  const diagram = createEmptyDiagram();
  const ids = new Map<string, string>();
  const nodes = [...new Set(chain.flat())].map((key) => {
    const node = createNode('server', diagram.diagramId, { x: 0, y: 0 }, { label: key });
    ids.set(key, node.nodeId);
    return node;
  });
  const edges = chain.map(([from, to]) => createEdge(diagram.diagramId, ids.get(from)!, ids.get(to)!));
  return {
    diagram: { ...diagram, nodes, edges, ...extra },
    ids,
    at: (key: string) => ids.get(key)!,
  };
}

describe('rankUnits', () => {
  it('链式连线得到递增层级', () => {
    const rank = rankUnits(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    expect(rank.get('a')).toBe(0);
    expect(rank.get('b')).toBe(1);
    expect(rank.get('c')).toBe(2);
  });

  it('多前驱取最长路径（不会被短路径提前拉上来）', () => {
    const rank = rankUnits(['a', 'b', 'c', 'd'], [['a', 'd'], ['a', 'b'], ['b', 'c'], ['c', 'd']]);
    expect(rank.get('d')).toBe(3);
  });

  it('有环也能给出确定层级（不死循环、不 NaN）', () => {
    const rank = rankUnits(['a', 'b'], [['a', 'b'], ['b', 'a']]);
    expect(Number.isFinite(rank.get('a')!)).toBe(true);
    expect(Number.isFinite(rank.get('b')!)).toBe(true);
  });
});

describe('computeAutoLayout', () => {
  it('沿连线方向从上到下排开', () => {
    const { diagram } = diagramWith([['a', 'b'], ['b', 'c']]);
    const result = computeAutoLayout(diagram);
    const [a, b, c] = diagram.nodes.map((node) => result.nodes.get(node.nodeId)!);
    expect(a!.y).toBeLessThan(b!.y);
    expect(b!.y).toBeLessThan(c!.y);
  });

  it('同一层横向排开、互不重叠', () => {
    const { diagram } = diagramWith([['a', 'x'], ['a', 'y'], ['x', 'z'], ['y', 'z']]);
    const result = computeAutoLayout(diagram);
    const [a, x, y] = diagram.nodes.map((node) => result.nodes.get(node.nodeId)!);
    expect(x!.y).toBe(y!.y);
    expect(Math.abs(x!.x - y!.x)).toBeGreaterThanOrEqual(160);
    expect(a!.y).toBeLessThan(x!.y);
  });

  it('分组被保留：框包住成员，组尺寸不小于内容', () => {
    const base = diagramWith([['a', 'b']]);
    const group = createGroup(base.diagram.diagramId, { x: 0, y: 0 }, { label: 'INTRANET' });
    const nodes = base.diagram.nodes.map((node, index) =>
      index === 0 ? { ...node, groupId: group.groupId } : node,
    );
    const diagram = { ...base.diagram, nodes, groups: [group] };
    const result = computeAutoLayout(diagram);
    const box = result.groups.get(group.groupId)!;
    const member = result.nodes.get(nodes[0]!.nodeId)!;
    expect(member.x).toBeGreaterThanOrEqual(box.x);
    expect(member.y).toBeGreaterThanOrEqual(box.y);
    expect(member.x + nodes[0]!.width).toBeLessThanOrEqual(box.x + box.width);
    expect(member.y + nodes[0]!.height).toBeLessThanOrEqual(box.y + box.height);
    // 组框至少要留出标题条
    expect(box.height).toBeGreaterThan(nodes[0]!.height + 40);
  });

  it('孤立节点不参与连线但也会被摆到画布上（不留在 0,0 重叠）', () => {
    const { diagram } = diagramWith([['a', 'b']]);
    const lonely = createNode('server', diagram.diagramId, { x: 0, y: 0 }, { label: '孤单节点' });
    const result = computeAutoLayout({ ...diagram, nodes: [...diagram.nodes, lonely] });
    const placed = result.nodes.get(lonely.nodeId)!;
    const others = diagram.nodes.map((node) => result.nodes.get(node.nodeId)!);
    expect(others.every((other) => other.x !== placed.x || other.y !== placed.y)).toBe(true);
  });

  it('空图不产生任何位置', () => {
    const diagram = createEmptyDiagram();
    expect(canAutoLayout(diagram)).toBe(false);
    expect(computeAutoLayout(diagram).nodes.size).toBe(0);
  });

  it('只动位置：分组归属、连线端点都不变', () => {
    const base = diagramWith([['a', 'b']]);
    const group = createGroup(base.diagram.diagramId, { x: 0, y: 0 }, { label: 'G' });
    const diagram = {
      ...base.diagram,
      groups: [group],
      nodes: base.diagram.nodes.map((node) => ({ ...node, groupId: group.groupId })),
    };
    const result = computeAutoLayout(diagram);
    expect(result.nodes.size).toBe(2);
    // 结果只含位置，不含 groupId（归属由 store 原样保留）
    expect(Object.keys([...result.nodes.values()][0]!).sort()).toEqual(['x', 'y']);
    expect(diagram.edges).toHaveLength(base.diagram.edges.length);
  });
});
