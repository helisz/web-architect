/**
 * AI 配置的本地保险箱单测（用户 2026-11-05）。
 *
 * 重点是三件事：口令对了能原样读回、口令错了必须失败（不能"解开一半"）、
 * 信封字段被手改过要能被识别出来，而不是带着坏数据继续跑。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VAULT_ITERATIONS,
  VaultError,
  clearVault,
  isVaultEnvelope,
  openConfig,
  readVault,
  sealConfig,
  writeVault,
} from '../src/ai/vault.js';
import {
  AI_LIMITS,
  createAiProfile,
  emptyAiConfig,
  maskApiKey,
  normalizeAiConfig,
  normalizeProfile,
  profileProblem,
  removeAiProfile,
  setActiveAiProfile,
  upsertAiProfile,
  type AiConfig,
} from '../src/ai/types.js';

/** node 环境没有 localStorage，打个内存桩（和 guestRepo.test 同款） */
function stubStorage(): void {
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
}

const sample = (): AiConfig => {
  const profile = {
    ...createAiProfile('openai-compatible'),
    name: '测试档案',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-4o',
    apiKey: 'sk-abcdef123456',
    temperature: 0.2,
  };
  return { version: 1, profiles: [profile], activeProfileId: profile.profileId };
};

describe('vault（本地口令加密）', () => {
  beforeEach(() => {
    stubStorage();
    clearVault();
  });

  it('口令正确时能原样读回配置', async () => {
    const config = sample();
    const envelope = await sealConfig(config, 'hunter2hunter2');
    const restored = await openConfig(envelope, 'hunter2hunter2');
    expect(restored).toEqual(config);
  });

  it('口令错误时报统一的「口令不对或配置已损坏」，并且不返回任何数据', async () => {
    const envelope = await sealConfig(sample(), 'correct-passphrase');
    await expect(openConfig(envelope, 'wrong-passphrase')).rejects.toBeInstanceOf(VaultError);
    await expect(openConfig(envelope, 'wrong-passphrase')).rejects.toThrow('口令不对');
  });

  it('密文被改一个字节就解不开（GCM 校验）', async () => {
    const envelope = await sealConfig(sample(), 'correct-passphrase');
    const bytes = Buffer.from(envelope.ct, 'base64');
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const tampered = { ...envelope, ct: bytes.toString('base64') };
    await expect(openConfig(tampered, 'correct-passphrase')).rejects.toBeInstanceOf(VaultError);
  });

  it('每次加密用新的 salt/iv，同一份配置两次密文不同', async () => {
    const config = sample();
    const a = await sealConfig(config, 'same-passphrase');
    const b = await sealConfig(config, 'same-passphrase');
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it('信封带迭代次数，且是 21 万次', async () => {
    const envelope = await sealConfig(sample(), 'same-passphrase');
    expect(envelope.iter).toBe(VAULT_ITERATIONS);
    expect(VAULT_ITERATIONS).toBeGreaterThanOrEqual(200_000);
  });

  it('localStorage 里读不出坏信封时返回 null', () => {
    localStorage.setItem('arch.ai.vault', '{"v":1}');
    expect(readVault()).toBeNull();
    writeVault({ ...({} as never), v: 2 } as never);
    expect(readVault()).toBeNull();
  });

  it('isVaultEnvelope 拒绝缺字段的对象', () => {
    expect(isVaultEnvelope(null)).toBe(false);
    expect(isVaultEnvelope({ v: 1, kdf: 'PBKDF2-SHA256' })).toBe(false);
  });

  it('空口令直接拒绝', async () => {
    await expect(sealConfig(sample(), '')).rejects.toBeInstanceOf(VaultError);
  });
});

describe('配置结构的兜底', () => {
  it('坏档案被丢弃，好的保留，active 指向存在的档案', () => {
    const config = normalizeAiConfig({
      version: 1,
      profiles: [null, 42, { name: '好的', model: 'gpt-4o', apiKey: 'k', provider: 'gemini' }],
      activeProfileId: 'not-exist',
    });
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles[0]!.name).toBe('好的');
    expect(config.profiles[0]!.provider).toBe('gemini');
    expect(config.activeProfileId).toBe(config.profiles[0]!.profileId);
  });

  it('未知 provider 回落到 openai-compatible，并补上默认 baseUrl', () => {
    const profile = normalizeProfile({ name: 'x', provider: 'ollama', model: 'llava' });
    expect(profile).not.toBeNull();
    expect(profile!.provider).toBe('openai-compatible');
    expect(profile!.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('温度被夹到 0..1，名称/模型/Key 被裁到上限', () => {
    const profile = normalizeProfile({
      name: 'x'.repeat(200),
      model: 'm'.repeat(400),
      apiKey: 'k'.repeat(999),
      temperature: 9,
    })!;
    expect(profile.name).toHaveLength(AI_LIMITS.nameMax);
    expect(profile.model).toHaveLength(AI_LIMITS.modelMax);
    expect(profile.apiKey).toHaveLength(AI_LIMITS.apiKeyMax);
    expect(profile.temperature).toBe(AI_LIMITS.temperatureMax);
  });

  it('增删改档案与切换默认', () => {
    const a = createAiProfile();
    const b = createAiProfile();
    let config = upsertAiProfile(emptyAiConfig(), a);
    config = upsertAiProfile(config, b);
    expect(config.profiles).toHaveLength(2);
    expect(config.activeProfileId).toBe(a.profileId);
    config = setActiveAiProfile(config, b.profileId);
    expect(config.activeProfileId).toBe(b.profileId);
    config = removeAiProfile(config, b.profileId);
    expect(config.profiles).toHaveLength(1);
    expect(config.activeProfileId).toBe(a.profileId);
  });

  it('Key 掩码只露前后几位', () => {
    expect(maskApiKey('')).toBe('未填写');
    expect(maskApiKey('short')).toBe('••••');
    expect(maskApiKey('sk-abcdefghijklmn')).toBe('sk-••••klmn');
  });

  it('profileProblem 指出具体缺什么', () => {
    expect(profileProblem(null)).toBe('还没有配置模型');
    const profile = { ...createAiProfile(), model: '', apiKey: '', baseUrl: '' };
    expect(profileProblem(profile)).toBe('没有填模型名');
    expect(profileProblem({ ...profile, model: 'gpt-4o' })).toBe('没有填 API Key');
    expect(profileProblem({ ...profile, model: 'gpt-4o', apiKey: 'k' })).toBe('Base URL 要以 http(s):// 开头');
    expect(
      profileProblem({ ...profile, model: 'gpt-4o', apiKey: 'k', baseUrl: 'https://x.test/v1' }),
    ).toBeNull();
  });
});
