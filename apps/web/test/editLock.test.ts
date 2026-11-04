import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDiagram, isEditLocked, withEditLock } from '@arch/schema';
import { useDiagramStore } from '../src/store/useDiagramStore.js';

const store = () => useDiagramStore.getState();

beforeEach(() => {
  // 上一个用例可能把状态锁住了 —— 先解锁，否则连 setDiagram 都会被守卫挡掉（这正是它的作用）
  store().setEditLocked(false);
  store().setDiagram(createEmptyDiagram({ name: '锁定测试' }));
});

describe('全局锁定编辑（用户 2026-11-04 第二批）', () => {
  it('默认不锁', () => {
    expect(isEditLocked(store().diagram)).toBe(false);
  });

  it('setEditLocked 写进 diagram.extJson', () => {
    store().setEditLocked(true);
    expect(store().diagram.extJson).toMatchObject({ editLocked: true });
    expect(isEditLocked(store().diagram)).toBe(true);
    store().setEditLocked(false);
    expect(isEditLocked(store().diagram)).toBe(false);
  });

  it('锁定后：加节点 / 改属性 / 连线 / 删除 全部被挡住', () => {
    const node = store().addNode('server', { x: 0, y: 0 });
    store().setEditLocked(true);
    const before = store().diagram;

    store().addNode('db', { x: 200, y: 0 });
    store().patchNode(node.nodeId, { label: '不该生效' });
    store().addEdge(node.nodeId, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'right', 'left');
    store().requestDelete([node.nodeId]);
    store().confirmDelete();
    store().moveNode(node.nodeId, { x: 500, y: 500 });

    expect(store().diagram).toBe(before);
    expect(store().diagram.nodes).toHaveLength(1);
    expect(store().diagram.nodes[0]!.label).not.toBe('不该生效');
    expect(store().diagram.edges).toHaveLength(0);
  });

  it('锁定后：选中 / 平移缩放 / 折叠分组 仍然可用', () => {
    const group = store().addGroup({ x: 0, y: 0 }, { label: 'G' });
    store().setEditLocked(true);

    store().select(group.groupId);
    expect(store().selectedIds).toEqual([group.groupId]);

    store().setViewport({ x: 10, y: 20, zoom: 1.2 });
    expect(store().diagram.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 });

    store().toggleGroupCollapsed(group.groupId);
    expect(store().diagram.groups[0]!.collapsed).toBe(true);
  });

  it('解锁之后又能改（守卫不是一次性的）', () => {
    const node = store().addNode('server', { x: 0, y: 0 });
    store().setEditLocked(true);
    store().setEditLocked(false);
    store().patchNode(node.nodeId, { label: '可以改' });
    expect(store().diagram.nodes[0]!.label).toBe('可以改');
  });

  it('withEditLock 保留 extJson 其它键', () => {
    expect(withEditLock({ foo: 1 }, true)).toEqual({ foo: 1, editLocked: true });
    expect(withEditLock(undefined, false)).toEqual({ editLocked: false });
  });
});
