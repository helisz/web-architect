import { describe, expect, it } from 'vitest';
import { newId } from '../src/factory.js';
import type { ArchitectureDiagram } from '../src/types.js';
import { validateDiagram } from '../src/validate.js';
import { loadSample } from './fixtures.js';

const clone = (): ArchitectureDiagram => loadSample();
const codes = (r: ReturnType<typeof validateDiagram>): string[] => r.errors.map((e) => e.code);
const warnCodes = (r: ReturnType<typeof validateDiagram>): string[] => r.warnings.map((e) => e.code);

describe('V1 diagramId 一致', () => {
  it('子元素 diagramId 不一致时报错并定位到字段', () => {
    const d = clone();
    d.nodes[0]!.diagramId = newId();
    const r = validateDiagram(d);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('DIAGRAM_ID_MISMATCH');
    expect(r.errors[0]!.path).toBe('nodes[0].diagramId');
  });
});

describe('V2 引用完整性', () => {
  it('节点 groupId 悬空 → 报错', () => {
    const d = clone();
    d.nodes[0]!.groupId = newId();
    const r = validateDiagram(d);
    expect(codes(r)).toContain('REF_NOT_FOUND');
    expect(r.errors.some((e) => e.path === 'nodes[0].groupId')).toBe(true);
  });

  it('节点 groupId 悬空 → repair 后置 null', () => {
    const d = clone();
    d.nodes[0]!.groupId = newId();
    const r = validateDiagram(d, { repair: true });
    expect(r.ok).toBe(true);
    expect(r.diagram!.nodes[0]!.groupId).toBeNull();
    expect(warnCodes(r)).toContain('REF_DROPPED');
  });

  it('连线指向不存在的节点 → 报错两条', () => {
    const d = clone();
    d.edges[0]!.targetNodeId = newId();
    const r = validateDiagram(d);
    expect(r.ok).toBe(false);
    expect(r.errors.filter((e) => e.code === 'REF_NOT_FOUND')).toHaveLength(2);
  });

  it('连线悬空 → repair 丢弃该边', () => {
    const d = clone();
    const before = d.edges.length;
    d.edges[0]!.targetNodeId = newId();
    const r = validateDiagram(d, { repair: true });
    expect(r.ok).toBe(true);
    expect(r.diagram!.edges).toHaveLength(before - 1);
    expect(warnCodes(r)).toContain('REF_DROPPED');
  });
});

describe('V3 分组嵌套', () => {
  it('成环时报错', () => {
    const d = clone();
    d.groups[0]!.parentGroupId = d.groups[1]!.groupId;
    d.groups[1]!.parentGroupId = d.groups[0]!.groupId;
    const r = validateDiagram(d);
    expect(codes(r)).toContain('GROUP_CYCLE');
  });

  it('成环 → repair 断开为顶级', () => {
    const d = clone();
    d.groups[0]!.parentGroupId = d.groups[1]!.groupId;
    d.groups[1]!.parentGroupId = d.groups[0]!.groupId;
    const r = validateDiagram(d, { repair: true });
    expect(r.ok).toBe(true);
    expect(warnCodes(r)).toContain('CYCLE_BROKEN');
  });

  it('深度超过 3 层时报错', () => {
    const d = clone();
    // a1 是顶级；a2→a1（深 1）、a3→a2（深 2）、a4→a3（深 3），再造一个 a5→a4 即深 4
    const extra = { ...d.groups[0]!, groupId: newId(), label: 'L4', x: 0, y: 0 };
    d.groups.push(extra);
    d.groups[1]!.parentGroupId = d.groups[0]!.groupId;
    d.groups[2]!.parentGroupId = d.groups[1]!.groupId;
    d.groups[3]!.parentGroupId = d.groups[2]!.groupId;
    d.groups[4]!.parentGroupId = d.groups[3]!.groupId;
    const r = validateDiagram(d);
    expect(codes(r)).toContain('GROUP_DEPTH_EXCEEDED');
  });
});

describe('V4 局部坐标启发式', () => {
  it('组内节点坐标完全落在父组外 → 告警（不阻断保存）', () => {
    const d = clone();
    const node = d.nodes.find((n) => n.groupId)!;
    node.x = 9999;
    node.y = 9999;
    const r = validateDiagram(d);
    expect(r.ok).toBe(true);
    expect(warnCodes(r)).toContain('COORD_SUSPECT');
  });

  it('repair 时收敛回父组内', () => {
    const d = clone();
    const node = d.nodes.find((n) => n.groupId)!;
    const group = d.groups.find((g) => g.groupId === node.groupId)!;
    node.x = 9999;
    node.y = 9999;
    const r = validateDiagram(d, { repair: true });
    const fixed = r.diagram!.nodes.find((n) => n.nodeId === node.nodeId)!;
    expect(fixed.x).toBeLessThanOrEqual(group.width);
    expect(fixed.y).toBeLessThanOrEqual(group.height);
    expect(fixed.x).toBeGreaterThanOrEqual(0);
  });
});

describe('V5 颜色', () => {
  it('非法颜色 → 结构校验失败', () => {
    const d = clone();
    d.nodes[0]!.bgColor = 'red';
    const r = validateDiagram(d);
    expect(codes(r)).toContain('SCHEMA_INVALID');
    expect(r.errors.some((e) => e.path === 'nodes[0].bgColor')).toBe(true);
  });

  it('repair 时回填默认色', () => {
    const d = clone();
    d.nodes[0]!.bgColor = 'red';
    const r = validateDiagram(d, { repair: true });
    expect(r.ok).toBe(true);
    expect(r.diagram!.nodes[0]!.bgColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(warnCodes(r)).toContain('COLOR_REPAIRED');
  });
});

describe('V6 数值有限性', () => {
  it('NaN 坐标被拒绝', () => {
    const d = clone();
    d.nodes[0]!.x = Number.NaN;
    const r = validateDiagram(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'nodes[0].x')).toBe(true);
  });

  it('Infinity 坐标被拒绝', () => {
    const d = clone();
    d.groups[0]!.width = Number.POSITIVE_INFINITY;
    const r = validateDiagram(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'groups[0].width')).toBe(true);
  });
});

describe('V7 文本长度', () => {
  it('超长 label 被拒绝', () => {
    const d = clone();
    d.nodes[0]!.label = 'x'.repeat(300);
    const r = validateDiagram(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.path === 'nodes[0].label')).toBe(true);
  });

  it('repair 截断到 255', () => {
    const d = clone();
    d.nodes[0]!.label = 'x'.repeat(300);
    const r = validateDiagram(d, { repair: true });
    expect(r.ok).toBe(true);
    expect(r.diagram!.nodes[0]!.label).toHaveLength(255);
    expect(warnCodes(r)).toContain('LABEL_TRUNCATED');
  });
});

describe('V8 规模上限', () => {
  it('节点超过 2000 → 报错', () => {
    const d = clone();
    const template = d.nodes[0]!;
    while (d.nodes.length <= 2000) {
      d.nodes.push({ ...template, nodeId: newId(), label: `n${d.nodes.length}` });
    }
    const r = validateDiagram(d);
    expect(codes(r)).toContain('LIMIT_EXCEEDED');
    expect(r.errors.some((e) => e.path === 'nodes')).toBe(true);
  });
});

describe('V9 version 只增不减', () => {
  it('客户端版本不大于库内版本 → 告警（服务端以库内为准）', () => {
    const d = clone();
    const r = validateDiagram(d, { existingVersion: 7 });
    expect(r.ok).toBe(true);
    expect(warnCodes(r)).toContain('VERSION_IGNORED');
  });

  it('客户端版本更大时不告警', () => {
    const d = clone();
    const r = validateDiagram(d, { existingVersion: 0 });
    expect(warnCodes(r)).not.toContain('VERSION_IGNORED');
  });
});

describe('V10 重复连线', () => {
  it('同源同目标同锚点 → strict 告警、repair 合并', () => {
    // 基线：原图本身无重复
    expect(warnCodes(validateDiagram(clone()))).not.toContain('EDGE_DUPLICATE');

    const d = clone();
    const originalCount = d.edges.length;
    d.edges.push({ ...d.edges[0]!, edgeId: newId() });

    expect(warnCodes(validateDiagram(d))).toContain('EDGE_DUPLICATE');

    const repaired = validateDiagram(d, { repair: true });
    expect(repaired.diagram!.edges).toHaveLength(originalCount);
    expect(warnCodes(repaired)).toContain('EDGE_MERGED');
  });
});
