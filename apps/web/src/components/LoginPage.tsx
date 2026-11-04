import { useState } from 'react';
import type { AuthState } from '../lib/auth.js';
import { AUTH_ERRORS } from '../lib/auth.js';

/**
 * 登录页（用户 2026-11-04 第三批）。
 *
 * 发布到 GitHub Pages 之后，站点是公开的；数据权限靠 Supabase RLS 收到 authenticated，
 * 所以进站第一件事是登录。账号由管理员在 Supabase Dashboard 建，这里不提供注册。
 */
export function LoginPage({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await auth.signIn(email, password);
  };

  return (
    <div className="grid h-full place-items-center bg-[var(--canvas-bg)] px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[var(--primary)] text-lg font-bold text-white">
            架
          </div>
          <h1 className="text-base font-semibold">架构拓扑绘图工具</h1>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">登录后才能查看和编辑架构图</p>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-[var(--panel-border)] bg-white p-4 shadow-sm">
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-[var(--text-secondary)]">邮箱</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              aria-label="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-[var(--panel-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--primary)]"
              placeholder="you@example.com"
            />
          </label>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-[var(--text-secondary)]">密码</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              aria-label="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-[var(--panel-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--primary)]"
              placeholder="••••••••"
            />
          </label>

          {auth.error && (
            <p role="alert" className="mb-3 rounded border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1.5 text-xs text-[#B91C1C]">
              {auth.error}
            </p>
          )}

          <button
            type="submit"
            disabled={auth.pending}
            className="w-full rounded bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-60"
          >
            {auth.pending ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="mt-3 text-center text-[11px] leading-5 text-[var(--text-secondary)]">
          没有账号？联系管理员在 Supabase Dashboard 里给你建一个
          <br />
          （Authentication → Users → Add user）
        </p>
      </div>
    </div>
  );
}

/** 启动时先问一次会话，避免"闪一下登录页" */
export function AuthSplash() {
  return (
    <div className="grid h-full place-items-center bg-[var(--canvas-bg)]">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
        <p className="text-sm text-[var(--text-secondary)]">正在确认登录状态…</p>
      </div>
    </div>
  );
}

/** 供自检脚本引用，避免文案散落 */
export const LOGIN_LABELS = {
  email: '邮箱',
  password: '密码',
  submit: '登录',
  missingEmail: AUTH_ERRORS.missingEmail,
} as const;
