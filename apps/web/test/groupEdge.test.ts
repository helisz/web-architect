import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDiagram } from '@arch/schema';
import { toFlowEdges } from '../src/canvas/flowMapping.js';
import { useDiagramStore } from '../src/store/useDiagramStore.js';

const store = () => useDiagramStore.getState();

beforeEach(() => {
  store().setDiagram(createEmptyDiagram({ name: '分组连线' }));
});

describe('分组也能连线（用户 2026-11-04）', () => {
  it('分组 → 分组：连线进入 schema，端点就是分组 id', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A 区' });
    const b = store().addGroup({ x: 600, y: 0 }, { label: 'B 区' });
    store().addEdge(a.groupId, b.groupId, 'right', 'left');

    const edge = store().diagram.edges[0]!;
    expect(edge.sourceNodeId).toBe(a.groupId);
    expect(edge.targetNodeId).toBe(b.groupId);
    expect(edge.sourceAnchor).toBe('right');
    expect(edge.targetAnchor).toBe('left');
  });

  it('节点 → 分组（混合端点）也可以', () => {
    const node = store().addNode('firewall', { x: 0, y: 0 });
    const group = store().addGroup({ x: 400, y: 0 }, { label: '内网' });
    store().addEdge(node.nodeId, group.groupId, 'right', 'left');
    expect(store().diagram.edges).toHaveLength(1);
  });

  it('自己连自己被拒绝', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A' });
    store().addEdge(a.groupId, a.groupId, 'right', 'left');
    expect(store().diagram.edges).toHaveLength(0);
  });

  it('分组连线能进 ReactFlow（不会被"端点不见"的过滤丢掉）', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A 区' });
    const b = store().addGroup({ x: 600, y: 0 }, { label: 'B 区' });
    store().addEdge(a.groupId, b.groupId, 'right', 'left');

    const flowEdges = toFlowEdges(store().diagram);
    expect(flowEdges).toHaveLength(1);
    expect(flowEdges[0]?.source).toBe(a.groupId);
  });

  it('父分组折叠后，子分组的连线一起隐藏', () => {
    const outer = store().addGroup({ x: 0, y: 0 }, { label: '外层' });
    const inner = store().addGroup({ x: 40, y: 40 }, { label: '内层' });
    store().reparentGroup(inner.groupId, outer.groupId);
    const other = store().addGroup({ x: 600, y: 0 }, { label: '另一个' });
    store().addEdge(inner.groupId, other.groupId, 'right', 'left');
    expect(toFlowEdges(store().diagram)).toHaveLength(1);

    store().toggleGroupCollapsed(outer.groupId);
    expect(toFlowEdges(store().diagram)).toHaveLength(0);
  });

  it('删除分组会带走挂在它身上的连线（否则就是悬空线）', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A 区' });
    const b = store().addGroup({ x: 600, y: 0 }, { label: 'B 区' });
    const node = store().addNode('firewall', { x: 0, y: 400 });
    store().addEdge(a.groupId, b.groupId, 'right', 'left');
    store().addEdge(a.groupId, node.nodeId, 'bottom', 'top');
    expect(store().diagram.edges).toHaveLength(2);

    store().removeGroup(a.groupId);
    expect(store().diagram.edges).toHaveLength(0);
  });

  it('解组同样清掉该分组的连线', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A 区' });
    const b = store().addGroup({ x: 600, y: 0 }, { label: 'B 区' });
    store().addEdge(a.groupId, b.groupId, 'right', 'left');

    store().ungroup(a.groupId);
    expect(store().diagram.edges).toHaveLength(0);
    expect(store().diagram.groups.map((g) => g.groupId)).toEqual([b.groupId]);
  });

  it('多选删除（删掉分组）也清线', () => {
    const a = store().addGroup({ x: 0, y: 0 }, { label: 'A 区' });
    const b = store().addGroup({ x: 600, y: 0 }, { label: 'B 区' });
    store().addEdge(a.groupId, b.groupId, 'right', 'left');

    store().requestDelete([a.groupId]);
    store().confirmDelete();
    expect(store().diagram.edges).toHaveLength(0);
  });
});
