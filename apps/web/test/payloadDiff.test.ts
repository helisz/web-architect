import { describe, expect, it } from 'vitest';
import { diffPayload, isEmpty } from '../src/data/payloadDiff.js';
import type { SavePayload } from '../src/data/payloadDiff.js';

/** 造一份最小 payload：只带 diff 关心的字段 */
function payload(overrides: Partial<SavePayload> = {}): SavePayload {
  return {
    diagramId: 'd1',
    schemaVersion: '1.0',
    name: '图',
    description: '',
    projectId: null,
    creatorId: 'u1',
    viewport: { x: 0, y: 0, zoom: 1 },
    groups: [],
    nodes: [],
    edges: [],
    ...overrides,
  };
}

const node = (id: string, x = 0): SavePayload['nodes'][number] => ({
  nodeId: id,
  groupId: null,
  label: id,
  subLabel: '',
  nodeType: 'custom',
  x,
  y: 0,
  width: 160,
  height: 80,
  bgColor: '#FFFFFF',
  borderColor: '#D1D5DB',
  textColor: '#111827',
  locked: false,
  visible: true,
  sort: 0,
  extJson: null,
});

const edge = (id: string, source: string, target: string): SavePayload['edges'][number] => ({
  edgeId: id,
  sourceNodeId: source,
  targetNodeId: target,
  label: null,
  strokeColor: '#6B7280',
  strokeWidth: 2,
  strokeDasharray: null,
  edgeType: 'ortho',
  arrow: 'forward',
  sourceAnchor: 'right',
  targetAnchor: 'left',
  sort: 0,
  extJson: null,
});

describe('diffPayload 增量差异', () => {
  it('没有任何变化时返回空补丁', () => {
    const base = payload({ nodes: [node('a')] });
    const patch = diffPayload(base, structuredClone(base));
    expect(patch).toEqual({});
    expect(isEmpty(patch)).toBe(true);
  });

  it('没有基线（首次保存）时返回空补丁，交给整图保存', () => {
    expect(diffPayload(null, payload({ nodes: [node('a')] }))).toEqual({});
  });

  it('拖动一个节点：只 upsert 这一行', () => {
    const before = payload({ nodes: [node('a', 0), node('b', 100)] });
    const after = payload({ nodes: [node('a', 40), node('b', 100)] });
    const patch = diffPayload(before, after);
    expect(patch.nodes?.upsert).toHaveLength(1);
    expect(patch.nodes?.upsert[0]!.nodeId).toBe('a');
    expect(patch.nodes?.delete).toEqual([]);
    expect(patch.groups).toBeUndefined();
    expect(patch.edges).toBeUndefined();
  });

  it('新增与删除：分别进 upsert / delete', () => {
    const before = payload({ nodes: [node('a'), node('b')] });
    const after = payload({ nodes: [node('a'), node('c', 10)] });
    const patch = diffPayload(before, after);
    expect(patch.nodes?.upsert.map((n) => n.nodeId)).toEqual(['c']);
    expect(patch.nodes?.delete).toEqual(['b']);
  });

  it('改名 / 视口变化进 diagram 段', () => {
    const before = payload();
    const after = payload({ name: '新名字', viewport: { x: 10, y: 20, zoom: 1.5 } });
    const patch = diffPayload(before, after);
    expect(patch.diagram).toEqual({
      name: '新名字',
      viewport: { x: 10, y: 20, zoom: 1.5 },
    });
  });

  it('连线单独变化只带连线', () => {
    const before = payload({ nodes: [node('a'), node('b')], edges: [edge('e1', 'a', 'b')] });
    const after = payload({
      nodes: [node('a'), node('b')],
      edges: [{ ...edge('e1', 'a', 'b'), strokeColor: '#EF4444' }],
    });
    const patch = diffPayload(before, after);
    expect(patch.edges?.upsert).toHaveLength(1);
    expect(patch.nodes).toBeUndefined();
  });

  it('分组按父在前排序（外键要求先插父级）', () => {
    const group = (id: string, parent: string | null) => ({
      groupId: id,
      parentGroupId: parent,
      label: id,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      bgColor: '#F1F3F5',
      borderColor: '#D1D5DB',
      titleColor: '#374151',
      collapsed: false,
      sort: 0,
      extJson: null,
    });
    const before = payload();
    const after = payload({ groups: [group('child', 'parent'), group('parent', null)] });
    const patch = diffPayload(before, after);
    expect(patch.groups?.upsert.map((g) => g.groupId)).toEqual(['parent', 'child']);
  });
});
