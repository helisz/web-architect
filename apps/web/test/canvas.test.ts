import { beforeEach, describe, expect, it } from 'vitest';
import { COMPONENT_INDEX, createEmptyDiagram } from '@arch/schema';
import { useDiagramStore } from '../src/store/useDiagramStore.js';
import { anchorOf, toFlowEdges, toFlowNodes } from '../src/canvas/flowMapping.js';

const reset = (): void => {
  useDiagramStore.setState({
    diagram: createEmptyDiagram({ name: '测试图' }),
    selectedId: null,
    saveState: 'saved',
  });
};

describe('画布 store（M1 编辑动作）', () => {
  beforeEach(reset);

  it('拖入创建：默认尺寸与副文本取自分类型表，并自动选中', () => {
    const spec = COMPONENT_INDEX['k8s-cluster'];
    const node = useDiagramStore.getState().addNode('k8s-cluster', { x: 100, y: 50 });

    const state = useDiagramStore.getState();
    expect(state.diagram.nodes).toHaveLength(1);
    expect(node.width).toBe(spec.width);
    expect(node.height).toBe(spec.height);
    expect(node.label).toBe(spec.label);
    expect(state.selectedId).toBe(node.nodeId);
    expect(state.saveState).toBe('dirty');
  });

  it('建线：记录两端锚点，缺省不重复、不建自环', () => {
    const store = useDiagramStore.getState();
    const a = store.addNode('server', { x: 0, y: 0 });
    const b = store.addNode('database', { x: 300, y: 0 });

    useDiagramStore.getState().addEdge(a.nodeId, b.nodeId, 'right', 'left');
    useDiagramStore.getState().addEdge(a.nodeId, b.nodeId, 'right', 'left'); // 重复
    useDiagramStore.getState().addEdge(a.nodeId, a.nodeId, 'right', 'left'); // 自环

    const edges = useDiagramStore.getState().diagram.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]!.sourceAnchor).toBe('right');
    expect(edges[0]!.targetAnchor).toBe('left');
    expect(edges[0]!.edgeType).toBe('ortho');
  });

  it('移动与改尺寸写回 Schema（C1：坐标原样，不做绝对换算）', () => {
    const node = useDiagramStore.getState().addNode('server', { x: 0, y: 0 });
    useDiagramStore.getState().moveNode(node.nodeId, { x: 42, y: 84 });
    useDiagramStore.getState().resizeNode(node.nodeId, { width: 220, height: 120 });

    const after = useDiagramStore.getState().diagram.nodes[0]!;
    expect([after.x, after.y]).toEqual([42, 84]);
    expect([after.width, after.height]).toEqual([220, 120]);
  });

  it('删除节点时连带删掉挂在其上的连线', () => {
    const store = useDiagramStore.getState();
    const a = store.addNode('server', { x: 0, y: 0 });
    const b = store.addNode('database', { x: 300, y: 0 });
    useDiagramStore.getState().addEdge(a.nodeId, b.nodeId, 'right', 'left');

    useDiagramStore.getState().removeNode(b.nodeId);

    const diagram = useDiagramStore.getState().diagram;
    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.edges).toHaveLength(0);
  });
});

describe('命令栈（撤销 / 重做）', () => {
  beforeEach(reset);

  it('撤销与重做按步回放，栈深不超过 50', () => {
    const store = useDiagramStore.getState();
    for (let i = 0; i < 3; i += 1) useDiagramStore.getState().addNode('server', { x: i * 100, y: 0 });
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(3);

    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(2);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(1);
    useDiagramStore.getState().redo();
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(2);

    void store;
    expect(useDiagramStore.getState().past.length).toBeLessThanOrEqual(50);
  });

  it('同一次拖拽只产生一步撤销（合并手势内的连续移动）', () => {
    const node = useDiagramStore.getState().addNode('server', { x: 0, y: 0 });
    const before = useDiagramStore.getState().past.length;

    for (let i = 1; i <= 10; i += 1) {
      useDiagramStore.getState().moveNode(node.nodeId, { x: i * 10, y: 0 });
    }
    // 拖拽整体只压一步：第一次移动入栈，其后 9 次被 800ms 合并窗口吸收
    expect(useDiagramStore.getState().past.length).toBe(before + 1);
    useDiagramStore.getState().undo();
    // 撤销后回到拖拽前的坐标，而不是第 9 步
    expect(useDiagramStore.getState().diagram.nodes[0]?.x).toBe(0);
  });

  it('撤销删除节点时，连线和节点一起回来', () => {
    const store = useDiagramStore.getState();
    const a = store.addNode('server', { x: 0, y: 0 });
    const b = store.addNode('db', { x: 200, y: 0 });
    useDiagramStore.getState().addEdge(a.nodeId, b.nodeId, 'right', 'left');

    useDiagramStore.getState().removeEdge(useDiagramStore.getState().diagram.edges[0]!.edgeId);
    useDiagramStore.getState().removeNode(b.nodeId);
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(1);

    useDiagramStore.getState().undo(); // 撤销删节点
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(2);
    useDiagramStore.getState().undo(); // 撤销删连线
    expect(useDiagramStore.getState().diagram.edges).toHaveLength(1);
  });

  it('新操作会清空重做栈', () => {
    useDiagramStore.getState().addNode('server', { x: 0, y: 0 });
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().future).toHaveLength(1);
    useDiagramStore.getState().addNode('db', { x: 100, y: 0 });
    expect(useDiagramStore.getState().future).toHaveLength(0);
  });
});

describe('Schema → ReactFlow 映射（ADR-0001）', () => {
  beforeEach(reset);

  it('C1：position 直接取 x/y，不做任何换算', () => {
    const node = useDiagramStore.getState().addNode('server', { x: 12, y: 34 });
    const flow = toFlowNodes(useDiagramStore.getState().diagram, null);
    expect(flow[0]!.position).toEqual({ x: 12, y: 34 });
    expect(flow[0]!.id).toBe(node.nodeId);
  });

  it('C2：节点类型名固定 archNode，真实类型在 data.node.nodeType', () => {
    useDiagramStore.getState().addNode('waf', { x: 0, y: 0 });
    const flow = toFlowNodes(useDiagramStore.getState().diagram, null);
    expect(flow[0]!.type).toBe('archNode');
    expect(flow[0]!.data.node.nodeType).toBe('waf');
  });

  it('C3：尺寸走 style，且是数字而非字符串', () => {
    useDiagramStore.getState().addNode('server', { x: 0, y: 0 });
    const flow = toFlowNodes(useDiagramStore.getState().diagram, null);
    expect(typeof flow[0]!.style!.width).toBe('number');
  });

  it('连线映射带上锚点，供路由函数使用', () => {
    const store = useDiagramStore.getState();
    const a = store.addNode('server', { x: 0, y: 0 });
    const b = store.addNode('database', { x: 300, y: 0 });
    useDiagramStore.getState().addEdge(a.nodeId, b.nodeId, 'bottom', 'top');

    const flow = toFlowEdges(useDiagramStore.getState().diagram);
    expect(flow[0]!.sourceHandle).toBe('bottom');
    expect(flow[0]!.targetHandle).toBe('top');
    expect(flow[0]!.type).toBe('archEdge');
    expect(anchorOf(flow[0]!.sourceHandle)).toBe('bottom');
  });

  it('隐藏节点不进画布，但数据保留', () => {
    const node = useDiagramStore.getState().addNode('server', { x: 0, y: 0 });
    useDiagramStore.setState((s) => ({
      diagram: {
        ...s.diagram,
        nodes: s.diagram.nodes.map((n) => (n.nodeId === node.nodeId ? { ...n, visible: false } : n)),
      },
    }));
    expect(toFlowNodes(useDiagramStore.getState().diagram, null)).toHaveLength(0);
    expect(useDiagramStore.getState().diagram.nodes).toHaveLength(1);
  });
});

