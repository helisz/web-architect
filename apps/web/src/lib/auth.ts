import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';

/**
 * 登录（用户 2026-11-04 第三批）。
 *
 * 为什么要登录：这份图要发布到 GitHub Pages（公开站点），而 Supabase 的 anon key
 * 必然随前端包公开。原来 RLS 对 anon 全开 = 谁都能读改删所有图；收紧到
 * `authenticated`（见 `supabase/patch-auth-rls.sql`）之后，浏览器必须先在
 * Supabase Auth 拿到 JWT，PostgREST 才认。
 *
 * 不做注册页：账号由管理员在 Supabase Dashboard 里建（Authentication → Users → Add user），
 * 免得公开站点变成"谁都能注册然后改图"。
 */

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthUser {
  id: string;
  email: string;
}

export const AUTH_ERRORS = {
  missingEmail: '请填邮箱',
  missingPassword: '请填密码',
  badCredentials: '邮箱或密码不对',
  notConfirmed: '这个账号还没激活邮箱，去 Dashboard → Authentication → Users 点一下确认',
  network: '连不上 Supabase，检查网络或项目是否休眠',
  unknown: '登录失败',
} as const;

/** Supabase 的英文报错 → 人话（没命中的原样透出，方便排障） */
export function explainAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('invalid login credentials')) return AUTH_ERRORS.badCredentials;
  if (text.includes('email not confirmed')) return AUTH_ERRORS.notConfirmed;
  if (text.includes('failed to fetch') || text.includes('networkerror')) return AUTH_ERRORS.network;
  if (text.includes('rate limit') || text.includes('too many')) return '试太频繁了，等一会儿再登';
  return message || AUTH_ERRORS.unknown;
}

/** 邮箱 + 密码登录；失败抛中文错误（调用方直接显示 message） */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const clean = email.trim();
  if (!clean) throw new Error(AUTH_ERRORS.missingEmail);
  if (!password) throw new Error(AUTH_ERRORS.missingPassword);
  if (!supabase) throw new Error('Supabase 没有配置，没法登录');

  const { error } = await supabase.auth.signInWithPassword({ email: clean, password });
  if (error) throw new Error(explainAuthError(error.message));
}

export async function signOutCurrentSession(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** 登录动作是否在进行（按钮转圈用） */
  pending: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

/**
 * 会话状态。
 *
 * 两个来源：启动时 `getSession()`（supabase-js 从 localStorage 恢复，并自动续期），
 * 以及 `onAuthStateChange`（登录 / 登出 / token 过期 / 别的标签页登出）。
 */
export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setStatus('signed-out');
      return;
    }
    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const session = data.session;
      setUser(session?.user?.email ? { id: session.user.id, email: session.user.email } : null);
      setStatus(session ? 'signed-in' : 'signed-out');
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(session?.user?.email ? { id: session.user.id, email: session.user.email } : null);
      setStatus(session ? 'signed-in' : 'signed-out');
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setPending(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      return true;
    } catch (cause) {
      setError((cause as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setError(null);
    await signOutCurrentSession();
  };

  return { status, user, pending, error, signIn, signOut };
}
