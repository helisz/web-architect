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

    // 新建节点会自动选中（拖进来就该是选中态），先清空再验选择逻辑
    store().updateSelection([], store().selectedIds);

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

  it('单个节点 / 单条连线直接删，不弹确认框', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    expect(store().diagram.edges).toHaveLength(1);

    // 单条连线：直接消失
    store().requestDelete([store().diagram.edges[0]!.edgeId]);
    expect(store().pendingDelete).toBeNull();
    expect(store().diagram.edges).toHaveLength(0);

    // 单个节点：直接消失（含连带连线，此时已无线）
    store().requestDelete([a.nodeId]);
    expect(store().pendingDelete).toBeNull();
    expect(store().diagram.nodes.map((n) => n.nodeId)).toEqual([b.nodeId]);
    expect(store().selectedIds).toEqual([]);
  });

  it('取消删除：数据原样保留（分组删除会弹框）', () => {
    const diagram = store().diagram;
    const group = createGroup(diagram.diagramId, { x: 0, y: 0, width: 300, height: 200 }, { label: 'DMZ' });
    store().setDiagram({ ...diagram, groups: [group] });

    store().requestDelete([group.groupId]);
    expect(store().pendingDelete?.groupIds).toEqual([group.groupId]);
    store().cancelDelete();
    expect(store().pendingDelete).toBeNull();
    expect(store().diagram.groups).toHaveLength(1);
  });

  it('删分组要先确认，确认后把子节点提上一层，不连坐', () => {
    const diagram = store().diagram;
    const group = createGroup(diagram.diagramId, { x: 0, y: 0, width: 300, height: 200 }, { label: 'DMZ' });
    store().setDiagram({ ...diagram, groups: [group] });
    const child = createNode(diagram.diagramId, 'waf', { x: 20, y: 40, groupId: group.groupId });
    store().setDiagram({ ...store().diagram, nodes: [child] });

    store().requestDelete([group.groupId]);
    expect(store().pendingDelete?.groupIds).toEqual([group.groupId]);
    expect(store().diagram.groups).toHaveLength(1);

    store().confirmDelete();

    expect(store().diagram.groups).toHaveLength(0);
    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.nodes[0]?.groupId).toBeNull();
  });

  it('多选（≥2 个元素）删除要确认，确认后一次删干净', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    const b = store().addNode('db', { x: 300, y: 0 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    const created = store().diagram.edges[0]!;

    store().requestDelete([a.nodeId, created.edgeId]);
    expect(store().pendingDelete?.nodeIds).toHaveLength(1);
    expect(store().pendingDelete?.edgeIds).toHaveLength(1);
    // 还没删
    expect(store().diagram.nodes).toHaveLength(2);

    store().confirmDelete();

    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.edges).toHaveLength(0);
  });

  it('直接删除也进撤销栈，Ctrl+Z 能恢复', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    store().updateSelection([a.nodeId], []);
    store().requestDelete([a.nodeId]);
    expect(store().diagram.nodes).toHaveLength(0);

    store().undo();
    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.nodes[0]?.nodeId).toBe(a.nodeId);
  });
});

describe('撤销栈与服务端版本', () => {
  it('保存成功后再撤销，版本号不倒退（否则下次保存会被判成假冲突）', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    // 模拟服务端回到 v42
    store().applySaved(42, new Date().toISOString());
    expect(store().diagram.version).toBe(42);

    store().patchNode(a.nodeId, { label: '改个名' });
    store().applySaved(43, new Date().toISOString());
    store().undo();

    expect(store().diagram.nodes[0]?.label).toBe('WAF');
    // 内容回放了，但版本号必须还是服务端最新的 43
    expect(store().diagram.version).toBe(43);
  });

  it('重做同样不带历史版本号', () => {
    const a = store().addNode('waf', { x: 0, y: 0 });
    store().applySaved(7, new Date().toISOString());
    store().patchNode(a.nodeId, { label: '甲' });
    store().applySaved(8, new Date().toISOString());
    store().undo();
    store().redo();
    expect(store().diagram.nodes[0]?.label).toBe('甲');
    expect(store().diagram.version).toBe(8);
  });
});

describe('连线全局配置', () => {
  it('默认：灰色 #6B7280 / 2px / 无箭头（规格 §5.2 规则 3）', () => {
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
