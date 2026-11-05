/**
 * 解析草图的整理规则（用户 2026-11-05）。
 *
 * 这些断言都在钉"模型不听话时会怎样"：多了废话、类型瞎写、坐标越界、端点不存在……
 * 每一种都必须变成"少一个元素"而不是"整张图失败"。
 */

import { describe, expect, it } from 'vitest';
import {
  AI_NODE_TYPES,
  AiDraftError,
  coerceNodeType,
  draftFromText,
  extractJsonObject,
  inferNodeType,
  isAiNodeType,
  normalizeDraft,
} from '../src/ai/parseSchema.js';

describe('extractJsonObject', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('剥掉 ```json 围栏', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('容忍前后废话：截取第一个 { 到最后一个 }', () => {
    expect(extractJsonObject('好的，结果如下：\n{"a":1}\n以上。')).toEqual({ a: 1 });
  });

  it('容忍尾逗号', () => {
    expect(extractJsonObject('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it('真的不是 JSON 就抛 AiDraftError', () => {
    expect(() => extractJsonObject('这张图里有防火墙和负载均衡')).toThrow(AiDraftError);
  });
});

describe('类型推断', () => {
  it('中文关键词能猜对', () => {
    expect(inferNodeType('防火墙')).toBe('firewall');
    expect(inferNodeType('WAF 防护')).toBe('waf');
    expect(inferNodeType('负载均衡')).toBe('lb');
    expect(inferNodeType('MySQL 主库')).toBe('db');
    expect(inferNodeType('Kubernetes 集群')).toBe('k8s-cluster');
    expect(inferNodeType('交换机')).toBe('switch');
    expect(inferNodeType('用户的手机')).toBe('external');
    expect(inferNodeType('订单服务')).toBe('custom');
  });

  it('专有词优先于通用词（WAF 不是普通防火墙、Redis 是 db）', () => {
    expect(inferNodeType('Web 应用防火墙 WAF')).toBe('waf');
    expect(inferNodeType('Redis 缓存')).toBe('db');
  });

  it('模型写的英文别名归一到我们的类型', () => {
    expect(coerceNodeType('load balancer')).toBe('lb');
    expect(coerceNodeType('K8S')).toBe('k8s-cluster');
    expect(coerceNodeType('virtual machine')).toBe('vm');
  });

  it('不认识的类型回落到关键词，再回落到 custom', () => {
    expect(coerceNodeType('weird-thing', '数据库')).toBe('db');
    expect(coerceNodeType('weird-thing', '订单中心')).toBe('custom');
  });

  it('清单里的类型都是 schema 认识的节点类型', () => {
    for (const type of AI_NODE_TYPES) expect(isAiNodeType(type)).toBe(true);
    expect(isAiNodeType('line')).toBe(false);
  });
});

const wrap = (payload: unknown): string => JSON.stringify(payload);

describe('normalizeDraft', () => {
  it('正常输入原样保留，坐标与尺寸照抄', () => {
    const { draft, issues } = normalizeDraft({
      name: '测试图',
      nodes: [{ key: 'a', label: '防火墙', type: 'firewall', x: 0.2, y: 0.3, w: 0.1, h: 0.06 }],
      edges: [],
      groups: [],
    });
    expect(draft.name).toBe('测试图');
    expect(draft.nodes[0]).toMatchObject({ key: 'a', label: '防火墙', type: 'firewall', x: 0.2, y: 0.3, w: 0.1, h: 0.06 });
    expect(issues.droppedNodes).toBe(0);
  });

  it('包了一层 {"diagram": {...}} 也能拆出来', () => {
    const { draft } = normalizeDraft({ diagram: { nodes: [{ key: 'a', label: 'A', x: 0, y: 0 }] } });
    expect(draft.nodes).toHaveLength(1);
  });

  it('没有 label 的节点被丢弃并计数', () => {
    const { draft, issues } = normalizeDraft({
      nodes: [{ key: 'a', label: '好的', x: 0.1, y: 0.1 }, { key: 'b' }, null],
    });
    expect(draft.nodes).toHaveLength(1);
    expect(issues.droppedNodes).toBe(2);
  });

  it('坐标越界被夹回 0–1 并计数', () => {
    const { draft, issues } = normalizeDraft({
      nodes: [
        { key: 'a', label: 'A', x: 1.4, y: -0.2 },
        { key: 'b', label: 'B' },
      ],
    });
    expect(draft.nodes[0]).toMatchObject({ x: 1, y: 0 });
    expect(draft.nodes[1]).toMatchObject({ x: 0.5, y: 0.5 });
    expect(issues.repairedCoordinates).toBe(2);
  });

  it('重复 key 自动加后缀，不覆盖已有节点', () => {
    const { draft } = normalizeDraft({
      nodes: [
        { key: 'a', label: '第一个', x: 0.1, y: 0.1 },
        { key: 'a', label: '第二个', x: 0.2, y: 0.2 },
      ],
    });
    expect(draft.nodes.map((n) => n.key)).toEqual(['a', 'a#2']);
  });

  it('连线端点不存在 / 自环 / 重复都被丢掉', () => {
    const { draft, issues } = normalizeDraft({
      nodes: [
        { key: 'a', label: 'A', x: 0.1, y: 0.1 },
        { key: 'b', label: 'B', x: 0.5, y: 0.5 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b', label: '重复' },
        { from: 'a', to: 'ghost' },
        { from: 'a', to: 'a' },
      ],
    });
    expect(draft.edges).toHaveLength(1);
    expect(issues.droppedEdges).toBe(3);
  });

  it('连线的文字与虚线标记保留', () => {
    const { draft } = normalizeDraft({
      nodes: [
        { key: 'a', label: 'A', x: 0.1, y: 0.1 },
        { key: 'b', label: 'B', x: 0.5, y: 0.5 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'HTTPS 443', dashed: true }],
    });
    expect(draft.edges[0]).toEqual({ from: 'a', to: 'b', label: 'HTTPS 443', dashed: true });
  });

  it('分组只保留真实存在的成员；成员全无效的分组被丢掉', () => {
    const { draft } = normalizeDraft({
      nodes: [{ key: 'a', label: 'A', x: 0.1, y: 0.1 }],
      groups: [
        { label: 'DMZ', members: ['a', 'ghost'] },
        { label: '空组', members: ['ghost'] },
      ],
    });
    expect(draft.groups).toHaveLength(1);
    expect(draft.groups[0]).toMatchObject({ label: 'DMZ', members: ['a'] });
  });

  it('一个节点都没有就失败（并说明原因）', () => {
    expect(() => normalizeDraft({ nodes: [] })).toThrow(AiDraftError);
    expect(() => normalizeDraft('nope')).toThrow(AiDraftError);
  });

  it('节点数量上限保护', () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ key: `n${i}`, label: `节点${i}`, x: 0.1, y: 0.1 }));
    const { draft } = normalizeDraft({ nodes });
    expect(draft.nodes).toHaveLength(150);
  });

  it('draftFromText 一步到位，空内容有专门提示', () => {
    const { draft } = draftFromText(wrap({ nodes: [{ key: 'a', label: 'A', x: 0, y: 0 }] }));
    expect(draft.nodes).toHaveLength(1);
    expect(() => draftFromText('   ')).toThrow('模型返回了空内容');
  });
});
