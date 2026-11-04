import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDiagram, createGroup, createNode } from '@arch/schema';
import { useDiagramStore } from '../src/store/useDiagramStore.js';

const store = () => useDiagramStore.getState();

beforeEach(() => {
  store().setDiagram(createEmptyDiagram({ name: '测试' }));
});

describe('多选与删除', () => {
  it('updateSelection 增量更新，单选时才回填 selectedId', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 200, y: 0 });

    store().updateSelection([a.nodeId], []);
    expect(store().selectedIds).toEqual([a.nodeId]);
    expect(store().selectedId).toBe(a.nodeId);

    store().updateSelection([b.nodeId], []);
    expect(store().selectedIds).toHaveLength(2);
    // 多选时属性面板没有"唯一选中项"
    expect(store().selectedId).toBeNull();

    store().updateSelection([], [a.nodeId]);
    expect(store().selectedIds).toEqual([b.nodeId]);
    expect(store().selectedId).toBe(b.nodeId);
  });

  it('删除先挂起，确认后才真的删（含连带连线）', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    expect(store().diagram.edges).toHaveLength(1);

    store().requestDelete([a.nodeId]);
    expect(store().pendingDelete?.nodeIds).toEqual([a.nodeId]);
    // 还没删
    expect(store().diagram.nodes).toHaveLength(2);

    store().confirmDelete();
    expect(store().diagram.nodes.map((n) => n.nodeId)).toEqual([b.nodeId]);
    expect(store().diagram.edges).toHaveLength(0);
    expect(store().pendingDelete).toBeNull();
    expect(store().selectedIds).toEqual([]);
  });

  it('取消删除：数据原样保留', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    store().requestDelete([a.nodeId]);
    store().cancelDelete();
    expect(store().pendingDelete).toBeNull();
    expect(store().diagram.nodes).toHaveLength(1);
  });

  it('删分组时把子节点提上一层，不连坐', () => {
    const diagram = store().diagram;
    const group = createGroup(diagram.diagramId, { x: 0, y: 0, width: 300, height: 200 }, { label: 'DMZ' });
    store().setDiagram({ ...diagram, groups: [group] });
    const child = createNode(diagram.diagramId, 'waf', { x: 20, y: 40, groupId: group.groupId });
    store().setDiagram({ ...store().diagram, nodes: [child] });

    store().requestDelete([group.groupId]);
    store().confirmDelete();

    expect(store().diagram.groups).toHaveLength(0);
    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.nodes[0]?.groupId).toBeNull();
  });

  it('批量删除节点 + 连线一次确认', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    const created = store().diagram.edges[0]!;
    expect(created).toBeDefined();

    store().requestDelete([a.nodeId, created.edgeId]);
    expect(store().pendingDelete?.nodeIds).toHaveLength(1);
    expect(store().pendingDelete?.edgeIds).toHaveLength(1);
    store().confirmDelete();

    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.edges).toHaveLength(0);
  });
});

describe('连线全局配置', () => {
  it('默认：灰色 #6B7280 / 2px / 单向箭头', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    const edge = store().diagram.edges[0]!;
    expect(edge.strokeColor).toBe('#6B7280');
    expect(edge.strokeWidth).toBe(2);
    expect(edge.arrow).toBe('forward');
  });

  it('新建连线跟随全局配置，已有连线不动；"应用到全部"才批量改', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    const c = store().addNode('lb', { x: 600, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    store().setEdgeDefaults({ edgeType: 'bezier', strokeWidth: 4 });
    store().addEdge(b.nodeId, c.nodeId, 'right', 'left');

    const [first, second] = store().diagram.edges;
    expect(first?.edgeType).toBe('ortho');
    expect(first?.strokeWidth).toBe(2);
    expect(second?.edgeType).toBe('bezier');
    expect(second?.strokeWidth).toBe(4);

    store().applyEdgeDefaultsToAll();
    expect(store().diagram.edges.every((e) => e.edgeType === 'bezier' && e.strokeWidth === 4)).toBe(true);
    expect(store().saveState).toBe('dirty');
  });
});
