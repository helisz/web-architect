import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDiagram, createNode, parseDiagram } from '@arch/schema';

/**
 * localStorage 桩：项目测试跑在 node 环境，没有 localStorage。
 * 这三个模块（draft / viewport / tabLock）都靠 try/catch 兜底，
 * 所以桩只要能存取就行。
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

const { saveDraft, readDraft, clearDraft } = await import('../src/data/draft.js');
const { saveLocalViewport, readLocalViewport, clearLocalViewport } = await import('../src/data/viewportPrefs.js');
const { createEmptyDiagram, createNode } = await import('@arch/schema');

const draftDiagram = () => {
  const diagram = createEmptyDiagram({ name: '草稿测试' });
  const node = createNode('firewall', diagram.diagramId, { x: 10, y: 20 }, { label: 'WAF' });
  return { ...diagram, version: 7, nodes: [node] };
};

describe('本地草稿（崩溃兜底）', () => {
  beforeEach(() => {
    storage.clear();
    vi.useRealTimers();
  });

  it('存进去再读出来是同一张图', () => {
    const diagram = draftDiagram();
    saveDraft(diagram);
    const draft = readDraft(diagram.diagramId);
    expect(draft?.version).toBe(7);
    expect(draft?.diagram.nodes[0]?.label).toBe('WAF');
  });

  it('存成功后清掉草稿', () => {
    const diagram = draftDiagram();
    saveDraft(diagram);
    clearDraft(diagram.diagramId);
    expect(readDraft(diagram.diagramId)).toBeNull();
  });

  it('超过 24 小时的草稿不再恢复，并顺手删掉', () => {
    const diagram = draftDiagram();
    saveDraft(diagram);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(readDraft(diagram.diagramId)).toBeNull();
    expect(storage.getItem(`arch:draft:${diagram.diagramId}`)).toBeNull();
    vi.useRealTimers();
  });

  it('坏数据（手改 localStorage）不会抛，返回 null', () => {
    storage.setItem('arch:draft:broken', '{not json');
    expect(readDraft('broken')).toBeNull();
  });
});

describe('视口本地记忆', () => {
  beforeEach(() => storage.clear());

  it('记下并恢复平移/缩放', () => {
    saveLocalViewport('dg-1', { x: -120, y: 60, zoom: 1.5 });
    expect(readLocalViewport('dg-1')).toEqual({ x: -120, y: 60, zoom: 1.5 });
  });

  it('缩放值离谱就当没有（防手改）', () => {
    storage.setItem('arch:viewport:dg-2', JSON.stringify({ x: 0, y: 0, zoom: 99 }));
    expect(readLocalViewport('dg-2')).toBeNull();
  });

  it('没有记录时返回 null，调用方回落到库里的视口', () => {
    expect(readLocalViewport('dg-3')).toBeNull();
    clearLocalViewport('dg-3');
  });
});
describe('脏草稿不能污染当前图（用户 2026-11-05：节点莫名消失）', () => {
  it('历史 bug 的草稿（节点 id 是 undefined）会被 schema 拦下', () => {
    const diagram = createEmptyDiagram({ name: '脏草稿' });
    const poisoned = {
      ...diagram,
      nodes: [
        // 故意造一个 id 丢失的节点 —— 就是粘贴 bug 当年写进草稿的样子
        { ...createNode('firewall', diagram.diagramId, { x: 0, y: 0 }), nodeId: undefined as unknown as string },
      ],
    };
    const result = parseDiagram(poisoned);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => /nodeId/.test(e.path))).toBe(true);
    }
  });

  it('干净草稿仍然能通过（别把正常草稿一起丢掉）', () => {
    const diagram = createEmptyDiagram({ name: '干净草稿' });
    diagram.nodes.push(createNode('firewall', diagram.diagramId, { x: 0, y: 0 }));
    expect(parseDiagram(diagram).success).toBe(true);
  });
});
