/**
 * 启动期环境检查。
 *
 * 与 toolbox 同一套路：缺变量时不让页面白屏，而是渲染一个「启动失败」页，
 * 明确告诉你缺了哪几个、怎么补 —— 因为这两个值不进仓库，新机器上必然要自己填。
 */

export const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;
export type RequiredEnvKey = (typeof REQUIRED_ENV)[number];

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

function read(key: RequiredEnvKey): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export const missingEnv: RequiredEnvKey[] = REQUIRED_ENV.filter((key) => read(key) === '');

export const supabaseConfig: SupabaseConfig | null =
  missingEnv.length === 0
    ? { url: read('VITE_SUPABASE_URL'), anonKey: read('VITE_SUPABASE_ANON_KEY') }
    : null;

/** 脱敏显示，用于自检输出 */
export function maskedUrl(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '(URL 格式不合法)';
  }
}
