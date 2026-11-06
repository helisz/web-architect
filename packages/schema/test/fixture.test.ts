import { describe, expect, it } from 'vitest';
import { diagramSchema } from '../src/zod.js';
import { absoluteGroupPosition, absoluteNodePosition, validateDiagram } from '../src/validate.js';
import { sample } from './fixtures.js';

describe('标准样图 fixture', () => {
  it('通过结构校验', () => {
    const parsed = diagramSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it('通过语义校验且无错误', () => {
    const result = validateDiagram(sample);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('规模符合预期（10 节点 / 8 连线 / 4 分组）', () => {
    expect(sample.nodes).toHaveLength(10);
    expect(sample.edges).toHaveLength(8);
    expect(sample.groups).toHaveLength(4);
  });

  it('组内节点使用局部坐标：WAF 绝对坐标 = 分组偏移 + 局部偏移', () => {
    const byId = new Map(sample.groups.map((g) => [g.groupId, g]));
    const waf = sample.nodes.find((n) => n.label === '防火墙')!;
    const dmz = byId.get(waf.groupId!)!;
    expect(dmz.x).toBe(280);
    expect(dmz.y).toBe(120);
    expect(waf.x).toBe(130);
    expect(waf.y).toBe(60);
    expect(absoluteNodePosition(waf, byId)).toEqual({ x: 410, y: 180 });
  });

  it('嵌套分组绝对坐标逐级累加', () => {
    const byId = new Map(sample.groups.map((g) => [g.groupId, g]));
    const intranet = byId.get(sample.groups[1]!.groupId)!;
    const child = { ...intranet, groupId: 'x', parentGroupId: intranet.groupId, x: 10, y: 20 };
    expect(absoluteGroupPosition(child, byId)).toEqual({
      x: intranet.x + 10,
      y: intranet.y + 20,
    });
  });
});


