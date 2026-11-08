import { REQUIRED_ENV, missingEnv } from '../lib/env.js';
import { navigateToGallery } from '../lib/route.js';

interface StartupErrorProps {
  title?: string;
  detail?: string;
  hint?: string;
  /** 打开图失败时给一个"回图库"的出口（用户 2026-11-04 加了 hash 路由） */
  backToGallery?: boolean;
}

/**
 * 启动失败页（toolbox 同款做法）。
 *
 * 两种用法：
 * 1. 无 props —— 缺 Supabase 环境变量时告诉人缺了什么、去哪补；
 * 2. 带 title/detail —— 打开图失败（网络、表结构、函数缺失等）。
 */
export function StartupError({ title, detail, hint, backToGallery }: StartupErrorProps = {}) {
  const isEnvProblem = !title;

  return (
    <div className="grid h-full place-items-center bg-[var(--canvas-bg)] p-6">
      <div className="w-full max-w-xl rounded-[var(--radius-card)] border border-[#F5C2C7] bg-white p-6">
        <h1 className="text-base font-semibold text-[#B42318]">
          {title ?? '启动失败：缺少 Supabase 配置'}
        </h1>

        {isEnvProblem ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            缺少 {missingEnv.length} 个环境变量：
            <code className="mono ml-1 rounded bg-[#FEF3F2] px-1.5 py-0.5 text-[#B42318]">
              {missingEnv.join('、')}
            </code>
          </p>
        ) : (
          <p className="mono mt-2 max-h-40 overflow-auto rounded bg-[#FEF3F2] px-2 py-1.5 text-xs text-[#B42318]">
            {detail}
          </p>
        )}

        {isEnvProblem && (
          <ol className="mt-4 space-y-2 text-sm text-[var(--text-primary)]">
            <li>
              <span className="font-medium">1.</span> 在项目根目录执行{' '}
              <code className="mono rounded bg-[var(--bg-hover)] px-1.5 py-0.5">copy .env.example .env.local</code>
            </li>
            <li>
              <span className="font-medium">2.</span> 填入 Supabase Dashboard →{' '}
              <span className="mono">Settings → API</span> 里的{' '}
              <span className="mono">Project URL</span> 与 <span className="mono">anon public</span> key
              （与 toolbox 共用同一个项目，可直接复制它的两项）
            </li>
            <li>
              <span className="font-medium">3.</span> 重启开发服务器（Vite 只在启动时读取{' '}
              <span className="mono">import.meta.env</span>）
            </li>
          </ol>
        )}

        <p className="mt-4 rounded bg-[#FFFAEB] p-3 text-xs text-[#B54708]">
          {hint ?? (
            <>
              数据库还没建表？把 <code className="mono">supabase/schema.sql</code> 全文粘进 Supabase 的 SQL
              Editor 执行一遍即可（可重复执行，含保存函数 arch_save_diagram）。
            </>
          )}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-[var(--hair-strong)] px-3 py-1.5 text-sm hover:bg-[var(--bg-hover)]"
          >
            重新加载
          </button>
          {backToGallery && (
            <button
              type="button"
              onClick={() => navigateToGallery()}
              className="rounded bg-[var(--primary-solid)] px-3 py-1.5 text-sm text-white hover:bg-[var(--primary-solid-hover)]"
            >
              回到图库
            </button>
          )}
        </div>

        {isEnvProblem && (
          <details className="mt-4 text-xs text-[var(--text-secondary)]">
            <summary className="cursor-pointer">需要哪些变量</summary>
            <ul className="mt-2 space-y-1">
              {REQUIRED_ENV.map((key) => (
                <li key={key}>
                  <code className="mono">{key}</code>
                  {missingEnv.includes(key) ? ' ← 缺失' : ' ✓'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
