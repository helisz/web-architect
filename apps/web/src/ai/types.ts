/**
 * AI 解析用的模型配置（用户 2026-11-05）。
 *
 * 三条硬规则：
 * 1. 配置**只存在这台机器上**（localStorage 里的加密密文），任何时候都不进 Supabase；
 * 2. 默认提供方是 `openai-compatible`——市面上绝大多数服务（DeepSeek、月之暗面、通义、
 *    硅基流动、Ollama…）都兼容这套请求体，用户只要填 baseURL/model/key；
 * 3. 解析图需要**多模态**模型，纯文本模型在配置里会被提示没用，但不阻止保存（用户可能先配好）。
 */

export const AI_PROVIDERS = ['openai-compatible', 'anthropic', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface AiProfile {
  profileId: string;
  name: string;
  provider: AiProvider;
  /** 不带结尾斜杠，例如 https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 0–1，解析任务用低温更稳 */
  temperature: number;
}

export interface AiConfig {
  version: 1;
  profiles: AiProfile[];
  activeProfileId: string | null;
}

export const AI_LIMITS = {
  nameMax: 40,
  modelMax: 120,
  baseUrlMax: 300,
  apiKeyMax: 400,
  temperatureMin: 0,
  temperatureMax: 1,
  /** 口令太短等于没加密 */
  passphraseMin: 6,
} as const;

interface ProviderMeta {
  label: string;
  defaultBaseUrl: string;
  keyPlaceholder: string;
  /** 配置页里要写清楚的东西：CORS、图片字段、注意事项 */
  note: string;
}

export const PROVIDER_META: Record<AiProvider, ProviderMeta> = {
  'openai-compatible': {
    label: 'OpenAI 兼容（推荐）',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyPlaceholder: 'sk-…',
    note: '只要服务商兼容 /chat/completions 且支持图片输入即可：OpenAI、DeepSeek、月之暗面、通义、硅基流动、Ollama（http://localhost:11434/v1）都行。Ollama 需要设 OLLAMA_ORIGINS=* 才允许网页直连。',
  },
  anthropic: {
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyPlaceholder: 'sk-ant-…',
    note: 'Claude 的浏览器直连要带 anthropic-dangerous-direct-browser-access 头（我们已自动加）。模型名例如 claude-sonnet-4-5。',
  },
  gemini: {
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    keyPlaceholder: 'AIza…',
    note: 'Gemini 原生支持 JSON 输出，模型名例如 gemini-2.5-flash。Key 会拼在 URL 的 ?key= 上（官方用法）。',
  },
};

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

function trimTo(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function newProfileId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `ai-${c.randomUUID()}`;
  return `ai-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAiProfile(provider: AiProvider = 'openai-compatible'): AiProfile {
  return {
    profileId: newProfileId(),
    name: provider === 'openai-compatible' ? '我的模型' : PROVIDER_META[provider].label,
    provider,
    baseUrl: PROVIDER_META[provider].defaultBaseUrl,
    model: '',
    apiKey: '',
    temperature: 0,
  };
}

export function emptyAiConfig(): AiConfig {
  return { version: 1, profiles: [], activeProfileId: null };
}

/** 逐字段兜底：手改 localStorage / 旧版本配置都不能让界面崩 */
export function normalizeProfile(raw: unknown): AiProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const provider = isAiProvider(src.provider) ? src.provider : 'openai-compatible';
  const temperatureRaw = Number(src.temperature);
  const profile: AiProfile = {
    profileId: trimTo(src.profileId, 60) || newProfileId(),
    name: trimTo(src.name, AI_LIMITS.nameMax) || PROVIDER_META[provider].label,
    provider,
    baseUrl: trimTo(src.baseUrl, AI_LIMITS.baseUrlMax) || PROVIDER_META[provider].defaultBaseUrl,
    model: trimTo(src.model, AI_LIMITS.modelMax),
    apiKey: trimTo(src.apiKey, AI_LIMITS.apiKeyMax),
    temperature: Number.isFinite(temperatureRaw)
      ? Math.min(AI_LIMITS.temperatureMax, Math.max(AI_LIMITS.temperatureMin, temperatureRaw))
      : 0,
  };
  return profile;
}

export function normalizeAiConfig(raw: unknown): AiConfig {
  if (!raw || typeof raw !== 'object') return emptyAiConfig();
  const src = raw as Record<string, unknown>;
  const list = Array.isArray(src.profiles) ? src.profiles : [];
  const profiles = list
    .map((item) => normalizeProfile(item))
    .filter((item): item is AiProfile => item !== null);
  const activeRaw = typeof src.activeProfileId === 'string' ? src.activeProfileId : null;
  const activeProfileId =
    activeRaw && profiles.some((p) => p.profileId === activeRaw)
      ? activeRaw
      : (profiles[0]?.profileId ?? null);
  return { version: 1, profiles, activeProfileId };
}

export function activeAiProfile(config: AiConfig | null): AiProfile | null {
  if (!config) return null;
  return config.profiles.find((p) => p.profileId === config.activeProfileId) ?? config.profiles[0] ?? null;
}

export function upsertAiProfile(config: AiConfig, profile: AiProfile): AiConfig {
  const exists = config.profiles.some((p) => p.profileId === profile.profileId);
  const profiles = exists
    ? config.profiles.map((p) => (p.profileId === profile.profileId ? profile : p))
    : [...config.profiles, profile];
  return { ...config, profiles, activeProfileId: config.activeProfileId ?? profile.profileId };
}

export function removeAiProfile(config: AiConfig, profileId: string): AiConfig {
  const profiles = config.profiles.filter((p) => p.profileId !== profileId);
  const activeProfileId =
    config.activeProfileId === profileId ? (profiles[0]?.profileId ?? null) : config.activeProfileId;
  return { ...config, profiles, activeProfileId };
}

export function setActiveAiProfile(config: AiConfig, profileId: string): AiConfig {
  if (!config.profiles.some((p) => p.profileId === profileId)) return config;
  return { ...config, activeProfileId: profileId };
}

/** 列表里只显示后四位，避免整串 key 长时间暴露在屏幕上 */
export function maskApiKey(key: string): string {
  if (!key) return '未填写';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

/** 配置是否「看起来能用」：解析前做一次快检，给出具体缺什么 */
export function profileProblem(profile: AiProfile | null): string | null {
  if (!profile) return '还没有配置模型';
  if (!profile.model.trim()) return '没有填模型名';
  if (!profile.apiKey.trim()) return '没有填 API Key';
  if (!/^https?:\/\//.test(profile.baseUrl)) return 'Base URL 要以 http(s):// 开头';
  return null;
}
