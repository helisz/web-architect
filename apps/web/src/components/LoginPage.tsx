import { useState } from 'react';
import type { AuthState } from '../lib/auth.js';
import { useGuestSession } from '../data/guestSession.js';
import { navigateToGallery } from '../lib/route.js';
import { AUTH_ERRORS } from '../lib/auth.js';

/**
 * 登录页（用户 2026-11-04 第三批；2026-11-06 按工业外壳风格重做）。
 *
 * 发布到 GitHub Pages 之后，站点是公开的；数据权限靠 Supabase RLS 收到 authenticated，
 * 所以进站第一件事是登录。账号由管理员在 Supabase Dashboard 建，这里不提供注册。
 *
 * 版式（用户 2026-11-06 定稿）：左边品牌区（橙块 + 点阵 + 等宽微标签），右边直角登录卡。
 * 窄屏（< lg）隐藏品牌区，只留卡片，保证手机上不挤。
 */

/** 品牌区的一行等宽元信息 */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hair)] py-2 last:border-b-0">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="mono text-[12px] tabular-nums text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export function LoginPage({ auth }: { auth: AuthState }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const enterGuest = useGuestSession((s) => s.enter);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await auth.signIn(email, password);
  };

  const fieldClass =
    'mono w-full border border-[var(--hair-strong)] bg-white px-2.5 py-2.5 text-[13px] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--accent-200)] disabled:bg-[var(--bg-hover)]';

  return (
    <div className="grid h-full grid-cols-1 bg-[var(--canvas-bg)] lg:grid-cols-[1.05fr_0.95fr]">
      {/* ── 品牌区（窄屏隐藏） ── */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-[var(--hair)] bg-white px-14 py-12 lg:flex">
        {/* 点阵底：和画布同一套网格语言 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(var(--dot) 1px, transparent 1px)',
            backgroundSize: '10px 10px',
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.05))',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.05))',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center bg-[var(--primary-solid)] text-[15px] font-bold text-white">
              架
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-700)]">
                Architecture
              </span>
              <span className="text-[11px] text-[var(--text-tertiary)]">拓扑绘图工具</span>
            </div>
          </div>

          <h1 className="mt-12 max-w-[9em] text-[28px] font-semibold leading-[1.3] tracking-[-0.01em]">
            把架构画清楚，
            <br />
            比讲清楚更快
          </h1>
          <ul className="mt-6 flex flex-col gap-2 text-[13px] leading-6 text-[var(--text-secondary)]">
            <li>节点 · 连线 · 分组泳道 · 版本快照</li>
            <li>导出 PNG / SVG / PDF / CSV</li>
            <li className="whitespace-nowrap">
              也能把现成的架构图
              <b className="font-semibold text-[var(--text-primary)]">解析成可编辑节点</b>
            </li>
          </ul>
        </div>

        <div className="relative mt-10 max-w-[24em]">
          <MetaRow label="Schema" value="v1.0" />
          <MetaRow label="Storage" value="Supabase / 本机" />
          <MetaRow label="Export" value="JSON · PNG · SVG · PDF · CSV" />
          <p className="mono mt-4 text-[10.5px] tracking-[0.08em] text-[var(--text-secondary)]">
            NO BACKEND · 浏览器直连数据库
          </p>
        </div>
      </aside>

      {/* ── 登录区 ── */}
      <main className="flex flex-col justify-center overflow-y-auto px-6 py-10">
        <div className="mx-auto my-auto w-full max-w-[380px]">
          {/* 窄屏下的品牌标识（品牌区被隐藏时补上） */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-8 w-8 place-items-center bg-[var(--primary-solid)] text-[15px] font-bold text-white">
              架
            </span>
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-semibold">架构拓扑绘图工具</span>
              <span className="text-[11px] text-[var(--text-tertiary)]">登录后查看和编辑架构图</span>
            </div>
          </div>

          <div className="mb-4 hidden items-baseline gap-2 lg:flex">
            <h2 className="text-[15px] font-semibold tracking-[0.01em]">登录</h2>
            <span className="mono text-[10px] tracking-[0.1em] text-[var(--text-tertiary)]">
              SIGN IN
            </span>
          </div>

          <form
            onSubmit={submit}
            className="border border-[var(--hair-strong)] bg-white p-6"
          >
            <label className="mb-4 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                邮箱
              </span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                aria-label="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={fieldClass}
                placeholder="you@example.com"
                disabled={auth.pending}
              />
            </label>

            <label className="mb-5 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                密码
              </span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                aria-label="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={fieldClass}
                placeholder="••••••••"
                disabled={auth.pending}
              />
            </label>

            {auth.error && (
              <p
                role="alert"
                className="mb-4 border border-[#E8B4A6] bg-[#FDF1EE] px-2.5 py-2 text-[12px] leading-5 text-[var(--err)]"
              >
                {auth.error}
              </p>
            )}

            <button
              type="submit"
              disabled={auth.pending}
              className="h-9 w-full bg-[var(--primary-solid)] text-[13px] font-bold text-white transition-colors hover:bg-[var(--primary-solid-hover)] disabled:opacity-60"
            >
              {auth.pending ? '登录中…' : '登录'}
            </button>

            <div className="mt-4 flex items-center gap-2">
              <span className="h-px flex-1 bg-[var(--hair)]" />
              <span className="mono text-[10px] tracking-[0.1em] text-[var(--text-tertiary)]">OR</span>
              <span className="h-px flex-1 bg-[var(--hair)]" />
            </div>

            <button
              type="button"
              onClick={() => {
                enterGuest();
                navigateToGallery();
              }}
              className="mt-4 h-9 w-full border border-[var(--hair-strong)] bg-white text-[13px] text-[var(--text-primary)] transition-colors hover:border-[var(--primary)] hover:text-[var(--accent-700)]"
            >
              不登录，先试用
            </button>
            <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">
              数据只保存在这台电脑的浏览器里（最多 20 张），换设备或清缓存就没了；登录后可一键导入账号。
            </p>
          </form>

          <p className="mt-4 text-[11px] leading-5 text-[var(--text-tertiary)]">
            没有账号？联系管理员在 Supabase Dashboard 里建一个
            <span className="mono text-[var(--text-tertiary)]">（Authentication → Users → Add user）</span>
          </p>
          <p className="mono mt-6 text-[10px] tracking-[0.08em] text-[var(--text-tertiary)]">
            架构拓扑绘图工具 · v1.0
          </p>
        </div>
      </main>
    </div>
  );
}

/** 启动时先问一次会话，避免"闪一下登录页" */
export function AuthSplash() {
  return (
    <div className="grid h-full place-items-center bg-[var(--canvas-bg)]">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-8 w-8 place-items-center bg-[var(--primary-solid)] text-[15px] font-bold text-white">
          架
        </span>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse bg-[var(--accent-500)]" />
          <p className="text-[12px] text-[var(--text-secondary)]">正在确认登录状态…</p>
        </div>
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
