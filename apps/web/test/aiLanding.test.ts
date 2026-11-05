/**
 * 草图 → 画布坐标（用户 2026-11-05）。
 *
 * 最关键的断言是"顺序不变"：原图里 A 在 B 上方，落图后 A 仍然在上方。
 * 这条一旦破了，"还原原图"就无从谈起，用户会直接不信任这个功能。
 */

import { describe, expect, it } from 'vitest';
import { buildLanding, contentHeight, landingBounds, rectsOverlap } from '../src/ai/landing.js';
import type { AiDraft } from '../src/ai/parseSchema.js';

const node = (key: string, label: string, x: number, y: number, extra: Partial<AiDraft['nodes'][number]> = {}): AiDraft['nodes'][number] => ({
  key,
  label,
  subLabel: '',
  type: 'server',
  x,
  y,
  ...extra,
});

const draft = (): AiDraft => ({
  name: '三层架构',
  nodes: [
    node('ext', '用户', 0.42, 0.05),
    node('lb', '负载均衡', 0.42, 0.25),
    node('web1', 'Web 01', 0.15, 0.5),
    node('web2', 'Web 02', 0.65, 0.5),
    node('db', 'MySQL', 0.42, 0.75),
  ],
  edges: [
    { from: 'ext', to: 'lb', label: 'HTTPS' },
    { from: 'lb', to: 'web1' },
    { from: 'lb', to: 'web2' },
    { from: 'web1', to: 'db' },
  ],
  groups: [
    { label: 'DMZ', members: ['lb'] },
    { label: 'INTRANET', members: ['web1', 'web2', 'db'] },
  ],
});

const pick = (spec: ReturnType<typeof buildLanding>, key: string) => spec.nodes.find((n) => n.key === key)!;

describe('buildLanding', () => {
  it('上下左右的相对顺序和原图一致', () => {
    const spec = buildLanding(draft());
    expect(pick(spec, 'ext').y).toBeLessThan(pick(spec, 'lb').y);
    expect(pick(spec, 'lb').y).toBeLessThan(pick(spec, 'web1').y);
    expect(pick(spec, 'web1').y).toBeLessThan(pick(spec, 'db').y);
    expect(pick(spec, 'web1').x).toBeLessThan(pick(spec, 'web2').x);
    // 归一化坐标乘上画布宽（默认 1280），误差不超过一个节点宽
    expect(Math.abs(pick(spec, 'web1').x - 0.15 * 1280)).toBeLessThan(80);
  });

  it('所有节点都落在内容区域内', () => {
    const spec = buildLanding(draft());
    for (const node of spec.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(spec.width);
      expect(node.y + node.height).toBeLessThanOrEqual(spec.height);
    }
  });

  it('分组框把成员包住，并且成员带上 groupIndex', () => {
    const spec = buildLanding(draft());
    const dmz = spec.groups[0]!;
    const lb = pick(spec, 'lb');
    expect(dmz.x).toBeLessThan(lb.x);
    expect(dmz.y).toBeLessThan(lb.y);
    expect(dmz.x + dmz.width).toBeGreaterThan(lb.x + lb.width);
    expect(dmz.y + dmz.height).toBeGreaterThan(lb.y + lb.height);
    expect(lb.groupIndex).toBe(0);
    expect(pick(spec, 'web1').groupIndex).toBe(1);
    expect(pick(spec, 'ext').groupIndex).toBe(-1);
  });

  it('同一节点出现在两个分组时只归第一个', () => {
    const base = draft();
    base.groups = [
      { label: 'A组', members: ['web1'] },
      { label: 'B组', members: ['web1', 'web2'] },
    ];
    const spec = buildLanding(base);
    expect(pick(spec, 'web1').groupIndex).toBe(0);
    expect(pick(spec, 'web2').groupIndex).toBe(1);
  });

  it('模型把节点叠在同一坐标时会错开（不重叠）', () => {
    const base = draft();
    base.nodes = [node('a', 'A', 0.3, 0.3), node('b', 'B', 0.3, 0.3), node('c', 'C', 0.3, 0.3)];
    base.groups = [];
    base.edges = [];
    const spec = buildLanding(base);
    const rects = spec.nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
    expect(rectsOverlap(rects[0]!, rects[1]!)).toBe(false);
    expect(rectsOverlap(rects[1]!, rects[2]!)).toBe(false);
  });

  it('模型给了 w/h 就用（并夹在合理区间）', () => {
    const base = draft();
    base.nodes = [node('a', 'A', 0.1, 0.1, { w: 0.2, h: 0.1 }), node('tiny', 'T', 0.6, 0.6, { w: 0.001, h: 0.001 })];
    base.groups = [];
    base.edges = [];
    const spec = buildLanding(base);
    expect(pick(spec, 'a').width).toBe(Math.round(0.2 * spec.width));
    expect(pick(spec, 'tiny').width).toBe(92);
    expect(pick(spec, 'tiny').height).toBe(40);
  });

  it('没给 w/h 时用组件默认尺寸', () => {
    const spec = buildLanding(draft());
    // server 默认 160×80（见 COMPONENT_INDEX）
    expect(pick(spec, 'web1')).toMatchObject({ width: 160, height: 80 });
  });

  it('连线原样带过来，标签和虚线都保留', () => {
    const base = draft();
    base.edges.push({ from: 'web2', to: 'db', label: 'SQL', dashed: true });
    const spec = buildLanding(base);
    const dashed = spec.edges.find((e) => e.dashed);
    expect(dashed).toMatchObject({ fromKey: 'web2', toKey: 'db', label: 'SQL', dashed: true });
  });

  it('图名：有就用，没有用兜底名', () => {
    expect(buildLanding(draft()).name).toBe('三层架构');
    const unnamed = { ...draft(), name: '   ' };
    expect(buildLanding(unnamed, { fallbackName: '架构图 1' }).name).toBe('架构图 1');
  });

  it('aspect 决定内容高度（竖图更高），并夹在合理区间', () => {
    expect(contentHeight(0.5)).toBe(640);
    expect(contentHeight(9)).toBe(Math.round(1280 * 1.8));
    expect(contentHeight(0)).toBeLessThan(1280);
    expect(buildLanding(draft(), { aspect: 0.6 }).height).toBe(768);
  });

  it('landingBounds 覆盖到分组边框', () => {
    const spec = buildLanding(draft());
    const bounds = landingBounds(spec);
    for (const group of spec.groups) {
      expect(bounds.width).toBeGreaterThanOrEqual(group.x + group.width);
      expect(bounds.height).toBeGreaterThanOrEqual(group.y + group.height);
    }
  });
});
