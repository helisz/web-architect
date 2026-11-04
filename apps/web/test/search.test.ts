import { describe, expect, it } from 'vitest';
import { createEdge, createEmptyDiagram, createGroup, createNode } from '@arch/schema';
import { search } from '../src/data/search.js';

/**
 * 搜索筛选（D2）。
 *
 * 匹配规则与筛选语义都在纯函数里，组件只负责渲染，测试直接打函数。
 */
const diagram = (() => {
  let d = createEmptyDiagram({ name: '搜索' });
  const group = createGroup(d.diagramId, { x: 0, y: 0 }, { label: '生产集群', width: 800, height: 600 });
  const web = createNode('server', d.diagramId, { x: 40, y: 40 }, { label: 'Web 服务器', groupId: group.groupId });
  const db = createNode('db', d.diagramId, { x: 300, y: 40 }, { label: 'MySQL 主库', groupId: group.groupId });
  const outside = createNode('server', d.diagramId, { x: 900, y: 40 }, { label: '独立服务器' });
  const edge = createEdge(d.diagramId, web.nodeId, db.nodeId, { label: '读写' });
  d = { ...d, groups: [group], nodes: [web, db, outside], edges: [edge] };
  return d;
})();

describe('搜索筛选', () => {
  it('纯关键字：节点、分组、连线都参与匹配', () => {
    expect(search(diagram, '服务器').filter((h) => h.kind === 'node')).toHaveLength(2);
    expect(search(diagram, '生产').some((h) => h.kind === 'group')).toBe(true);
    expect(search(diagram, '读写').some((h) => h.kind === 'edge')).toBe(true);
  });

  it('按类型筛选后只剩该类型节点，且不返回分组/连线', () => {
    const hits = search(diagram, '', { nodeType: 'db' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('node');
    expect(hits[0]!.title).toBe('MySQL 主库');
  });

  it('按分组筛选与"不在分组里"互不重叠', () => {
    const groupId = diagram.groups[0]!.groupId;
    expect(search(diagram, '', { groupId })).toHaveLength(2);
    const loose = search(diagram, '', { groupId: 'none' });
    expect(loose).toHaveLength(1);
    expect(loose[0]!.title).toBe('独立服务器');
  });

  it('类型 + 关键字叠加时取交集', () => {
    expect(search(diagram, 'MySQL', { nodeType: 'server' })).toHaveLength(0);
    expect(search(diagram, 'MySQL', { nodeType: 'db' })).toHaveLength(1);
  });

  it('空关键字 + 无筛选 → 空结果（不把整张图倒出来）', () => {
    expect(search(diagram, '   ')).toHaveLength(0);
  });

  it('结果上限 30 条', () => {
    let d = createEmptyDiagram({ name: 'many' });
    const nodes = Array.from({ length: 40 }, (_, i) =>
      createNode('server', d.diagramId, { x: i * 10, y: 0 }, { label: `批量节点${i}` }),
    );
    d = { ...d, nodes };
    expect(search(d, '批量节点')).toHaveLength(30);
  });
});
