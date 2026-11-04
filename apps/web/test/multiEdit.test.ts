import { describe, expect, it } from 'vitest';
import { createEmptyDiagram, createGroup, createNode, newId } from '@arch/schema';
import { commonFields, pickSelection, readField } from '../src/components/multiEdit.js';

/**
 * 多选批量编辑的「交集」规则（用户 2026-11-04 要求 5）。
 *
 * 断言只关心"哪些字段该出现、值是否被判定为混合"，不关心 DOM。
 */
function makeDiagram() {
  const base = createEmptyDiagram({ name: '多选测试' });

  const a = createNode('server', base.diagramId, { x: 0, y: 0 }, { label: 'A', bgColor: '#FFFFFF' });
  const b = createNode('server', base.diagramId, { x: 200, y: 0 }, { label: 'B', bgColor: '#DBE8FF' });
  const group = createGroup(base.diagramId, { x: 0, y: 0 }, { label: 'G', subLabel: '子标题' });

  const edge = {
    edgeId: newId(),
    diagramId: base.diagramId,
    sourceNodeId: a.nodeId,
    targetNodeId: b.nodeId,
    label: '调用',
    strokeColor: '#55575C',
    strokeWidth: 2,
    strokeDasharray: null,
    edgeType: 'ortho' as const,
    sourceAnchor: null,
    targetAnchor: null,
    arrow: 'forward' as const,
    sort: 0,
    isDeleted: false,
  };

  return {
    diagram: { ...base, nodes: [a, b], groups: [group], edges: [edge] },
    a,
    b,
    group,
    edge,
  };
}

describe('多选字段交集', () => {
  it('两个节点：名称/副文本/背景/边框/文字/图标/对齐 全都在', () => {
    const { diagram, a, b } = makeDiagram();
    const fields = commonFields([a.nodeId, b.nodeId], diagram);
    expect(fields.map((f) => f.field)).toEqual([
      'label',
      'subLabel',
      'bgColor',
      'borderColor',
      'textColor',
      'iconKey',
      'iconHidden',
      'align',
      'valign',
    ]);
  });

  it('值不同的字段标成 mixed，值为 null', () => {
    const { diagram, a, b } = makeDiagram();
    const fields = commonFields([a.nodeId, b.nodeId], diagram);
    const bg = fields.find((f) => f.field === 'bgColor')!;
    expect(bg.mixed).toBe(true);
    expect(bg.value).toBeNull();
    const sub = fields.find((f) => f.field === 'subLabel')!;
    expect(sub.mixed).toBe(false);
    expect(sub.value).toBe('');
  });

  it('节点 + 连线：只剩名称（连线没有背景色/图标）', () => {
    const { diagram, a, edge } = makeDiagram();
    const fields = commonFields([a.nodeId, edge.edgeId], diagram).map((f) => f.field);
    expect(fields).toEqual(['label']);
  });

  it('节点 + 分组：两边都有背景色/边框色/文字色/图标/副文本', () => {
    const { diagram, a, group } = makeDiagram();
    const fields = commonFields([a.nodeId, group.groupId], diagram).map((f) => f.field);
    expect(fields).toEqual([
      'label',
      'subLabel',
      'bgColor',
      'borderColor',
      'textColor',
      'iconKey',
      'iconHidden',
    ]);
  });

  it('两个连线：名称 + 线条颜色', () => {
    const { diagram, edge, a, b } = makeDiagram();
    const second = { ...edge, edgeId: newId(), strokeColor: '#2563EB' };
    const withTwo = { ...diagram, edges: [edge, second] };
    const fields = commonFields([edge.edgeId, second.edgeId], withTwo);
    expect(fields.map((f) => f.field)).toEqual(['label', 'strokeColor']);
    expect(fields.find((f) => f.field === 'strokeColor')!.mixed).toBe(true);
  });

  it('只选中一个对象时不出交集表单', () => {
    const { diagram, a } = makeDiagram();
    expect(commonFields([a.nodeId], diagram)).toEqual([]);
  });

  it('分组的文字颜色映射到标题色', () => {
    const { group } = makeDiagram();
    expect(readField('group', group, 'textColor')).toBe(group.titleColor);
  });

  it('pickSelection 按 id 分派到正确类型，未知 id 直接忽略', () => {
    const { diagram, a, group, edge } = makeDiagram();
    const picked = pickSelection([a.nodeId, group.groupId, edge.edgeId, 'unknown'], diagram);
    expect(picked.map((p) => p.kind)).toEqual(['node', 'group', 'edge']);
  });
});
