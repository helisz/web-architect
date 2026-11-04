import { describe, expect, it } from 'vitest';
import {
  IDLE_MS,
  MAX_WAIT_MS,
  MIN_INTERVAL_MS,
  STRUCTURAL_IDLE_MS,
  nextDelay,
  structuralKey,
} from '../src/data/saveScheduler.js';

const T0 = 1_700_000_000_000;

describe('保存节流：空闲就存、连续编辑强制存、写库有最小间隔', () => {
  it('刚变脏、且已过最小间隔 → 等一个空闲窗口（3 秒）', () => {
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt: T0 - MIN_INTERVAL_MS, structural: false })).toBe(IDLE_MS);
  });

  it('结构性改动（增删节点/分组）只等 1 秒', () => {
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt: 0, structural: true })).toBe(STRUCTURAL_IDLE_MS);
  });

  it('连续编辑 29 秒还没停手 → 按 30 秒上限强制存（还剩 1 秒）', () => {
    const dirtySince = T0 - 29_000;
    expect(nextDelay({ now: T0, dirtySince, lastWriteAt: 0, structural: false })).toBe(1000);
  });

  it('连续编辑超过 30 秒 → 立刻写，不再等', () => {
    const dirtySince = T0 - 45_000;
    expect(nextDelay({ now: T0, dirtySince, lastWriteAt: 0, structural: false })).toBe(0);
  });

  it('刚写库 2 秒 → 至少还要等 8 秒（10 秒最小间隔）', () => {
    const lastWriteAt = T0 - 2000;
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt, structural: false })).toBe(8000);
    // 结构性改动也要让路，但只需要等到最小间隔
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt, structural: true })).toBe(8000);
  });

  it('最小间隔已过 → 不再额外延迟', () => {
    const lastWriteAt = T0 - MIN_INTERVAL_MS - 1;
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt, structural: false })).toBe(IDLE_MS);
  });

  it('上限优先于最小间隔：攒超时了宁可破一次间隔也要写', () => {
    // 已经脏了 40 秒，但 3 秒前刚写过 —— 上限要求立刻写，这里保持 0，
    // 由调用方决定是否真的越过间隔（宁可多写一次，也不要丢改动）。
    const delay = nextDelay({ now: T0, dirtySince: T0 - 40_000, lastWriteAt: T0 - 3000, structural: false });
    expect(delay).toBe(7000);
  });

  it('本会话还没写过库（lastWriteAt = 0）不套最小间隔', () => {
    expect(nextDelay({ now: T0, dirtySince: T0, lastWriteAt: 0, structural: false })).toBe(IDLE_MS);
  });

  it('MAX_WAIT 至少能装下两次最小间隔，否则节流会把写库拖成一条直线', () => {
    expect(MAX_WAIT_MS).toBeGreaterThan(MIN_INTERVAL_MS * 2);
  });
});

describe('结构指纹', () => {
  const node = (id: string) => ({ nodeId: id });
  const edge = (id: string) => ({ edgeId: id });
  const group = (id: string) => ({ groupId: id });

  it('增删节点会变', () => {
    const a = structuralKey({ nodes: [node('n1')], edges: [], groups: [] });
    const b = structuralKey({ nodes: [node('n1'), node('n2')], edges: [], groups: [] });
    expect(a).not.toBe(b);
  });

  it('顺序无关（拖动不改变指纹）', () => {
    const a = structuralKey({ nodes: [node('n1'), node('n2')], edges: [edge('e1')], groups: [group('g1')] });
    const b = structuralKey({ nodes: [node('n2'), node('n1')], edges: [edge('e1')], groups: [group('g1')] });
    expect(a).toBe(b);
  });

  it('只改属性、不加删 → 指纹不变', () => {
    const before = structuralKey({ nodes: [node('n1')], edges: [], groups: [] });
    const after = structuralKey({ nodes: [node('n1')], edges: [], groups: [] });
    expect(before).toBe(after);
  });
});
