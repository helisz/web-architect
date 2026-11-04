import { describe, expect, it } from 'vitest';
import {
  createEdge,
  createEmptyDiagram,
  createGroup,
  createNode,
  validateDiagram,
} from '@arch/schema';
import { exportFileName, parseImport, reissueIds, serializeDiagram } from '../src/data/transfer.js';

/** 造一张有小内容的图：1 组 + 2 节点（其中一个在组里）+ 1 连线 */
function sample() {
  const diagram = createEmptyDiagram({ name: '生产架构/2026' });
  const zone = createGroup(diagram.diagramId, { x: 100, y: 100 }, { label: 'DMZ' });
  const waf = createNode('waf', diagram.diagramId, { x: 20, y: 30 }, { label: 'WAF' });
  const db = createNode('db', diagram.diagramId, { x: 400, y: 30 }, { label: 'MySQL' });
  db.groupId = zone.groupId;
  return {
    ...diagram,
    groups: [zone],
    nodes: [waf, db],
    edges: [createEdge(diagram.diagramId, waf.nodeId, db.nodeId)],
    viewport: { x: 10, y: 20, zoom: 1.5 },
  };
}

describe('JSON 导出 / 导入', () => {
  it('导出的文件名去掉非法字符', () => {
    expect(exportFileName(sample(), 'json')).toBe('生产架构_2026.json');
  });

  it('导出体是自描述格式，且不含 version', () => {
    const parsed = JSON.parse(serializeDiagram(sample())) as Record<string, unknown>;
    expect(parsed.format).toBe('arch-diagram');
    expect(parsed.schemaVersion).toBe('1.0');
    expect((parsed.diagram as Record<string, unknown>).version).toBeUndefined();
    expect((parsed.diagram as { nodes: unknown[] }).nodes).toHaveLength(2);
  });

  it('导出 → 导入往返：内容一致，id 全部换新', () => {
    const original = sample();
    const result = parseImport(serializeDiagram(original));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const imported = result.diagram;
    // 结构一致
    expect(imported.name).toBe(original.name);
    expect(imported.nodes).toHaveLength(2);
    expect(imported.groups).toHaveLength(1);
    expect(imported.edges).toHaveLength(1);
    expect(imported.viewport.zoom).toBe(1.5);

    // id 全部换新，且引用被正确改写
    expect(imported.diagramId).not.toBe(original.diagramId);
    const oldIds = new Set([
      original.diagramId,
      ...original.nodes.map((n) => n.nodeId),
      ...original.groups.map((g) => g.groupId),
      ...original.edges.map((e) => e.edgeId),
    ]);
    for (const node of imported.nodes) expect(oldIds.has(node.nodeId)).toBe(false);
    for (const group of imported.groups) expect(oldIds.has(group.groupId)).toBe(false);

    const importedGroup = imported.groups[0]!;
    const inGroup = imported.nodes.find((n) => n.label === 'MySQL')!;
    expect(inGroup.groupId).toBe(importedGroup.groupId);
    // 连线端点指向新 id
    const edge = imported.edges[0]!;
    expect(imported.nodes.some((n) => n.nodeId === edge.sourceNodeId)).toBe(true);
    expect(imported.nodes.some((n) => n.nodeId === edge.targetNodeId)).toBe(true);

    // 导入结果本身必须是合法图（能存库、能渲染）
    expect(validateDiagram(imported, { repair: true }).ok).toBe(true);
  });

  it('接受裸 diagram 对象（外部工具手写的文件）', () => {
    const bare = JSON.stringify({
      name: '手写图',
      nodes: [{ nodeType: 'server', x: 0, y: 0, width: 160, height: 80 }],
      edges: [],
    });
    const result = parseImport(bare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagram.name).toBe('手写图');
    expect(result.diagram.nodes).toHaveLength(1);
    // 缺的字段被补齐
    expect(result.diagram.nodes[0]?.label).toBeTruthy();
    expect(result.diagram.nodes[0]?.extJson?.iconKey).toBeTruthy();
  });

  it('坏 JSON 给出可读错误', () => {
    const result = parseImport('{ 不是 json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('JSON');
  });

  it('悬空连线（端点不存在）在导入时被丢掉', () => {
    const original = sample();
    const broken = {
      ...original,
      edges: [
        ...original.edges,
        createEdge(original.diagramId, 'not-a-node', 'also-not', {}),
      ],
    };
    const result = parseImport(JSON.stringify({ diagram: broken }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagram.edges).toHaveLength(1);
  });

  it('分组父子关系在重编号后仍然有效', () => {
    const diagram = createEmptyDiagram();
    const outer = createGroup(diagram.diagramId, { x: 0, y: 0 }, { label: '外' });
    const inner = createGroup(diagram.diagramId, { x: 20, y: 20 }, { label: '内', parentGroupId: outer.groupId });
    const reissued = reissueIds({ ...diagram, groups: [outer, inner] });

    const newOuter = reissued.groups.find((g) => g.label === '外')!;
    const newInner = reissued.groups.find((g) => g.label === '内')!;
    expect(newInner.parentGroupId).toBe(newOuter.groupId);
    expect(newOuter.parentGroupId).toBeNull();
  });
});
