/**
 * AI 配置的会话状态（用户 2026-11-05）。
 *
 * 这里盯的是"配置到底写没写下去、口令到底还在不在内存里"：
 * 每一步之后都回读 localStorage，而不是只看 store 里的字段。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiStore, __getSessionPassphraseForTest } from '../src/store/useAiStore.js';
import { VAULT_STORAGE_KEY, readVault } from '../src/ai/vault.js';
import { createAiProfile } from '../src/ai/types.js';

function stubStorage(): Map<string, string> {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as unknown as Storage;
  vi.stubGlobal('localStorage', storage);
  return map;
}

const reset = (): void => {
  useAiStore.setState({ dialogOpen: false, locked: false, config: null, busy: false, error: null });
};

describe('useAiStore', () => {
  beforeEach(() => {
    stubStorage();
    reset();
    // 清掉模块内存里的口令（通过锁定动作）
    useAiStore.getState().lock();
  });

  it('第一次设口令：写出密文、配置为空、已解锁', async () => {
    const ok = await useAiStore.getState().createVault('pass-123456');
    expect(ok).toBe(true);
    const state = useAiStore.getState();
    expect(state.locked).toBe(false);
    expect(state.config?.profiles).toEqual([]);
    expect(readVault()).not.toBeNull();
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toContain('"ct"');
  });

  it('保存档案后 localStorage 里没有 Key 明文', async () => {
    await useAiStore.getState().createVault('pass-123456');
    const profile = {
      ...createAiProfile('openai-compatible'),
      name: '测试',
      model: 'gpt-4o',
      apiKey: 'sk-super-secret-value',
    };
    expect(await useAiStore.getState().saveProfile(profile)).toBe(true);
    const raw = localStorage.getItem(VAULT_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('sk-super-secret-value');
    expect(raw).not.toContain('gpt-4o');
    expect(useAiStore.getState().config?.profiles).toHaveLength(1);
  });

  it('锁定后内存里的配置和口令都清空，但密文还在', async () => {
    await useAiStore.getState().createVault('pass-123456');
    await useAiStore.getState().saveProfile({ ...createAiProfile(), apiKey: 'k', model: 'm' });
    useAiStore.getState().lock();
    expect(useAiStore.getState().config).toBeNull();
    expect(useAiStore.getState().locked).toBe(true);
    expect(__getSessionPassphraseForTest()).toBeNull();
    expect(readVault()).not.toBeNull();
  });

  it('错口令解不开：报错且不进入已解锁状态', async () => {
    await useAiStore.getState().createVault('pass-123456');
    useAiStore.getState().lock();
    const ok = await useAiStore.getState().unlock('wrong-pass');
    expect(ok).toBe(false);
    expect(useAiStore.getState().locked).toBe(true);
    expect(useAiStore.getState().error).toContain('口令不对');
  });

  it('对口令能读回档案，且会话口令只存在模块内存', async () => {
    await useAiStore.getState().createVault('pass-123456');
    await useAiStore.getState().saveProfile({ ...createAiProfile(), name: '线上', apiKey: 'k', model: 'm' });
    useAiStore.getState().lock();
    expect(await useAiStore.getState().unlock('pass-123456')).toBe(true);
    expect(useAiStore.getState().config?.profiles[0]?.name).toBe('线上');
    expect(__getSessionPassphraseForTest()).toBe('pass-123456');
    // 口令不进 zustand state（避免 devtools 快照泄漏）
    expect(JSON.stringify(useAiStore.getState())).not.toContain('pass-123456');
  });

  it('未解锁时保存会被拒绝', async () => {
    const ok = await useAiStore.getState().saveProfile({ ...createAiProfile(), apiKey: 'k', model: 'm' });
    expect(ok).toBe(false);
    expect(useAiStore.getState().error).toContain('还没解锁');
  });

  it('改口令后旧口令失效、新口令可用', async () => {
    await useAiStore.getState().createVault('old-pass-123');
    await useAiStore.getState().saveProfile({ ...createAiProfile(), name: 'A', apiKey: 'k', model: 'm' });
    expect(await useAiStore.getState().changePassphrase('new-pass-456')).toBe(true);
    useAiStore.getState().lock();
    expect(await useAiStore.getState().unlock('old-pass-123')).toBe(false);
    expect(await useAiStore.getState().unlock('new-pass-456')).toBe(true);
    expect(useAiStore.getState().config?.profiles[0]?.name).toBe('A');
  });

  it('清除所有配置：密文删除、状态归零', async () => {
    await useAiStore.getState().createVault('pass-123456');
    await useAiStore.getState().saveProfile({ ...createAiProfile(), apiKey: 'k', model: 'm' });
    useAiStore.getState().clearAll();
    expect(readVault()).toBeNull();
    expect(useAiStore.getState().config).toBeNull();
    expect(useAiStore.getState().locked).toBe(false);
    expect(__getSessionPassphraseForTest()).toBeNull();
  });

  it('删除档案会刷新默认档案', async () => {
    await useAiStore.getState().createVault('pass-123456');
    const first = { ...createAiProfile(), name: 'A', apiKey: 'k', model: 'm' };
    const second = { ...createAiProfile(), name: 'B', apiKey: 'k', model: 'm' };
    await useAiStore.getState().saveProfile(first);
    await useAiStore.getState().saveProfile(second);
    expect(useAiStore.getState().config?.activeProfileId).toBe(first.profileId);
    await useAiStore.getState().removeProfile(first.profileId);
    expect(useAiStore.getState().config?.profiles.map((p) => p.name)).toEqual(['B']);
    expect(useAiStore.getState().config?.activeProfileId).toBe(second.profileId);
  });
});
