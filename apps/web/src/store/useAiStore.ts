/**
 * AI 配置的会话状态（用户 2026-11-05）。
 *
 * 关键约束：口令只留在模块内存里，**不进 zustand state**，这样它不会出现在
 * devtools 的 state 快照里；刷新页面即清空，下次打开要重新解锁。
 */

import { create } from 'zustand';
import {
  emptyAiConfig,
  normalizeAiConfig,
  type AiConfig,
  type AiProfile,
} from '../ai/types.js';
import {
  VaultError,
  clearVault,
  openConfig,
  readVault,
  sealConfig,
  writeVault,
} from '../ai/vault.js';

let sessionPassphrase: string | null = null;

interface AiState {
  dialogOpen: boolean;
  /** true = 有密文但还没解锁 */
  locked: boolean;
  /** 未解锁时是 null */
  config: AiConfig | null;
  busy: boolean;
  error: string | null;
  setDialogOpen: (open: boolean) => void;
  /** 检查有没有保险箱，决定弹「解锁」还是「新建口令」 */
  refreshLock: () => void;
  /** 第一次设置口令：建一个空配置的保险箱 */
  createVault: (passphrase: string) => Promise<boolean>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  /** 保存整份配置（内部重新加密） */
  saveConfig: (next: AiConfig) => Promise<boolean>;
  saveProfile: (profile: AiProfile) => Promise<boolean>;
  removeProfile: (profileId: string) => Promise<boolean>;
  setActive: (profileId: string) => Promise<boolean>;
  changePassphrase: (next: string) => Promise<boolean>;
  clearAll: () => void;
}

export const useAiStore = create<AiState>((set, get) => ({
  dialogOpen: false,
  locked: readVault() !== null,
  config: null,
  busy: false,
  error: null,

  setDialogOpen: (dialogOpen) => set({ dialogOpen, error: null }),

  refreshLock: () => set({ locked: readVault() !== null }),

  createVault: async (passphrase) => {
    set({ busy: true, error: null });
    try {
      const config = emptyAiConfig();
      writeVault(await sealConfig(config, passphrase));
      sessionPassphrase = passphrase;
      set({ config, locked: false, busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: (err as Error).message });
      return false;
    }
  },

  unlock: async (passphrase) => {
    const envelope = readVault();
    if (!envelope) {
      sessionPassphrase = null;
      set({ locked: false, config: emptyAiConfig() });
      return true;
    }
    set({ busy: true, error: null });
    try {
      const config = await openConfig(envelope, passphrase);
      sessionPassphrase = passphrase;
      set({ config, locked: false, busy: false });
      return true;
    } catch (err) {
      set({
        busy: false,
        error: err instanceof VaultError ? err.message : (err as Error).message,
      });
      return false;
    }
  },

  lock: () => {
    sessionPassphrase = null;
    set({ config: null, locked: readVault() !== null, error: null });
  },

  saveConfig: async (next) => {
    const cleaned = normalizeAiConfig(next);
    if (!sessionPassphrase) {
      set({ error: '还没解锁，口令已失效，请重新解锁' });
      return false;
    }
    set({ busy: true, error: null });
    try {
      writeVault(await sealConfig(cleaned, sessionPassphrase));
      set({ config: cleaned, locked: false, busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: (err as Error).message });
      return false;
    }
  },

  saveProfile: async (profile) => {
    const current = get().config ?? emptyAiConfig();
    const exists = current.profiles.some((p) => p.profileId === profile.profileId);
    const profiles = exists
      ? current.profiles.map((p) => (p.profileId === profile.profileId ? profile : p))
      : [...current.profiles, profile];
    return get().saveConfig({
      ...current,
      profiles,
      activeProfileId: current.activeProfileId ?? profile.profileId,
    });
  },

  removeProfile: async (profileId) => {
    const current = get().config ?? emptyAiConfig();
    const profiles = current.profiles.filter((p) => p.profileId !== profileId);
    const activeProfileId =
      current.activeProfileId === profileId ? (profiles[0]?.profileId ?? null) : current.activeProfileId;
    return get().saveConfig({ ...current, profiles, activeProfileId });
  },

  setActive: async (profileId) => {
    const current = get().config ?? emptyAiConfig();
    if (!current.profiles.some((p) => p.profileId === profileId)) return false;
    return get().saveConfig({ ...current, activeProfileId: profileId });
  },

  changePassphrase: async (next) => {
    const current = get().config;
    if (!current) return false;
    set({ busy: true, error: null });
    try {
      writeVault(await sealConfig(current, next));
      sessionPassphrase = next;
      set({ busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: (err as Error).message });
      return false;
    }
  },

  clearAll: () => {
    sessionPassphrase = null;
    clearVault();
    set({ config: null, locked: false, error: null });
  },
}));

/** 测试用：拿到当前会话口令（仅内存），确认不会意外泄漏到 state */
export function __getSessionPassphraseForTest(): string | null {
  return sessionPassphrase;
}
