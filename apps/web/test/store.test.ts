import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDiagram, createGroup, createNode, isGroupLocked, isSingleLineGroup } from '@arch/schema';
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

/** 造"外层组 → 内层组 → 节点"的嵌套，用于复制/锁定用例 */
function nestedDiagram() {
  const outer = store().addGroup({ x: 100, y: 100 }, { label: '外层', width: 600, height: 400 });
  const inner = store().addGroup({ x: 40, y: 40 }, { label: '内层', width: 300, height: 200 });
  store().reparentGroup(inner.groupId, outer.groupId);
  const node = store().addNode('waf', { x: 20, y: 20 }, inner.groupId);
  return { outer, inner, node };
}

/** 从当前状态读（reparent 后局部坐标会变，不能用复制的旧对象断言） */
const groupOf = (id: string) => store().diagram.groups.find((g) => g.groupId === id)!;
const nodeOf = (id: string) => store().diagram.nodes.find((n) => n.nodeId === id)!;

describe('复制嵌套分组（用户 2026-11-04：Ctrl+D 丢内容）', () => {
  it('只选中外层组，也会把子组和组里的节点一起复制', () => {
    const { outer } = nestedDiagram();
    store().updateSelection([outer.groupId], []);
    store().copySelection();

    expect(store().clipboard?.groups).toHaveLength(2);
    expect(store().clipboard?.nodes).toHaveLength(1);
  });

  it('粘贴后父子关系仍然正确，组内元素相对位置不变', () => {
    const { outer, inner, node } = nestedDiagram();
    const before = { outer: { ...groupOf(outer.groupId) }, inner: { ...groupOf(inner.groupId) }, node: { ...nodeOf(node.nodeId) } };

    store().updateSelection([outer.groupId], []);
    store().copySelection();
    store().pasteClipboard();

    const newOuter = store().diagram.groups.find((g) => g.groupId !== outer.groupId && g.label === '外层')!;
    const newInner = store().diagram.groups.find((g) => g.groupId !== inner.groupId && g.label === '内层')!;
    const newNode = store().diagram.nodes.find((n) => n.nodeId !== node.nodeId)!;

    // 子组挂到**新的**外层，节点挂到新的内层
    expect(newInner.parentGroupId).toBe(newOuter.groupId);
    expect(newNode.groupId).toBe(newInner.groupId);
    // 局部坐标原样保留：整棵子树跟着外层一起 +24，内部结构不散
    expect({ x: newInner.x, y: newInner.y }).toEqual({ x: before.inner.x, y: before.inner.y });
    expect({ x: newNode.x, y: newNode.y }).toEqual({ x: before.node.x, y: before.node.y });
    // 只有顶层的外层组整体偏移
    expect({ x: newOuter.x, y: newOuter.y }).toEqual({ x: before.outer.x + 24, y: before.outer.y + 24 });
  });

  it('单独复制内层组：父组不在范围内，粘出来落到顶层且位置不漂', () => {
    const { inner } = nestedDiagram();
    const before = { ...groupOf(inner.groupId) };

    store().updateSelection([inner.groupId], []);
    store().copySelection();
    store().pasteClipboard();

    const copy = store().diagram.groups[store().diagram.groups.length - 1]!;
    expect(copy.groupId).not.toBe(inner.groupId);
    expect(copy.parentGroupId).toBeNull();
    // 绝对坐标 = 父组偏移(100,100) + 局部坐标 + 24
    expect({ x: copy.x, y: copy.y }).toEqual({ x: before.x + 100 + 24, y: before.y + 100 + 24 });
  });
});

describe('分组锁定（extJson.locked，用户 2026-11-04）', () => {
  it('toggleLock 会同时处理分组，锁定值存在 extJson 里（不占数据库列）', () => {
    const { outer } = nestedDiagram();
    expect(isGroupLocked(store().diagram.groups.find((g) => g.groupId === outer.groupId)!)).toBe(false);

    store().toggleLock([outer.groupId]);
    const locked = store().diagram.groups.find((g) => g.groupId === outer.groupId)!;
    expect(locked.extJson?.locked).toBe(true);
    expect(isGroupLocked(locked)).toBe(true);

    store().toggleLock([outer.groupId]);
    expect(isGroupLocked(store().diagram.groups.find((g) => g.groupId === outer.groupId)!)).toBe(false);
  });

  it('混合选择（有锁有没锁）时统一锁上', () => {
    const { outer, inner } = nestedDiagram();
    store().toggleLock([outer.groupId]);
    store().toggleLock([outer.groupId, inner.groupId]);
    const groups = store().diagram.groups;
    expect(groups.every((g) => isGroupLocked(g))).toBe(true);
  });

  it('锁定的分组仍然可以选中（用户要求）', () => {
    const { outer } = nestedDiagram();
    store().toggleLock([outer.groupId]);
    store().updateSelection([outer.groupId], []);
    expect(store().selectedIds).toContain(outer.groupId);
  });

  it('单行分组与锁定互不影响（两个 extJson 标记并存）', () => {
    const g = store().addGroup({ x: 0, y: 0 }, { label: '通用分组', extJson: { singleLine: true } });
    store().toggleLock([g.groupId]);
    const next = store().diagram.groups.find((x) => x.groupId === g.groupId)!;
    expect(isSingleLineGroup(next)).toBe(true);
    expect(isGroupLocked(next)).toBe(true);
  });
});
describe('粘贴出来的 id 必须全是新字符串（用户 2026-11-05：nodes[n].nodeId undefined）', () => {
  it('复制普通节点（没有任何分组）后，新节点拿到全新的 nodeId', () => {
    useDiagramStore.getState().setEditLocked(false);
    const fresh = createEmptyDiagram({ name: '粘贴测试' });
    useDiagramStore.setState({ diagram: fresh, booted: true, bootError: null, persisted: true });
    store().addNode('waf', { x: 10, y: 10 });

    const original = store().diagram.nodes[0]!;
    store().updateSelection([original.nodeId], []);
    store().copySelection();
    store().pasteClipboard();

    const nodes = store().diagram.nodes;
    expect(nodes).toHaveLength(2);
    for (const node of nodes) {
      expect(typeof node.nodeId).toBe('string');
      expect(node.nodeId.length).toBeGreaterThan(0);
    }
    expect(nodes[1]!.nodeId).not.toBe(original.nodeId);
  });

  it('连续粘贴 5 次：id 不重复、连线两端都指向存在的节点', () => {
    useDiagramStore.getState().setEditLocked(false);
    const fresh = createEmptyDiagram({ name: '连续粘贴' });
    useDiagramStore.setState({ diagram: fresh, booted: true, bootError: null, persisted: true });

    const a = store().addNode('waf', { x: 10, y: 10 });
    const b = store().addNode('server', { x: 200, y: 10 });
    store().addEdge(a.nodeId, b.nodeId, 'right', 'left');

    store().updateSelection([a.nodeId, b.nodeId], [store().diagram.edges[0]!.edgeId]);
    store().copySelection();
    for (let i = 0; i < 5; i += 1) store().pasteClipboard();

    const nodes = store().diagram.nodes;
    const ids = nodes.map((n) => n.nodeId);
    expect(nodes).toHaveLength(12); // 2 + 5×2
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);

    // 连线只连存在的端点（粘出来的边不能指向 undefined / 原节点以外的东西）
    const known = new Set([...ids, ...store().diagram.groups.map((g) => g.groupId)]);
    for (const edge of store().diagram.edges) {
      expect(known.has(edge.sourceNodeId)).toBe(true);
      expect(known.has(edge.targetNodeId)).toBe(true);
    }
    expect(store().diagram.edges).toHaveLength(6); // 1 + 5
  });
});
