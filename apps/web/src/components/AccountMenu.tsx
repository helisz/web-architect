import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.js';
import { useDbStatus } from '../data/useDbStatus.js';

/**
 * 右上角账号菜单（用户 2026-11-05：图库和画布都要有，并且固定在最右边）。
 *
 * 交互：**鼠标移入就展开**（mouseover），移出收起；同时保留点击展开 ——
 * 触屏和键盘用户没有 hover，只有点击可用，两种都留最省事。
 * tooltip 里给完整邮箱，圆点上只显示首字母。
 */
export function AccountMenu() {
  const auth = useAuth();
  // 数据库状态（2026-11-06）：从顶栏绿点挪进下拉，这里给完整文字
  const db = useDbStatus();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const email = auth.user?.email ?? '';

  // 点空白处收起：hover 菜单一旦展开，用户还会点别处，不收敛会一直挂着
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={email ? `已登录 ${email}` : '账号'}
        aria-label="账号"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-7 w-7 place-items-center rounded-full bg-[var(--bg-sunken)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[#E5E9EE] hover:text-[var(--text-primary)]"
      >
        {(email[0] ?? '?').toUpperCase()}
      </button>
      {open && (
        /*
         * 关键：外层这个 `pt-1` 是**透明桥接**。
         * 菜单是绝对定位、不占父盒子的高度，原来按钮和菜单之间有 4px 空隙
         * 不属于任何元素，鼠标从圆点往下走会先离开 wrapper → 菜单立刻收起
         * （用户 2026-11-05 实测反馈）。把空隙做成菜单自己的 padding，
         * 这一段就落在子元素里，一路划过去菜单不会消失。
         */
        <div className="anim-pop absolute right-0 top-full z-40 pt-1">
          <div
            role="menu"
            className="glass w-56 rounded-md py-1"
          >
            <p className="truncate px-3 py-1 text-[11px] text-[var(--text-secondary)]" title={email}>
              {email || '未登录'}
            </p>
            <div className="my-1 border-t border-[var(--hair)]" />
            <p
              className="flex items-center gap-1.5 px-3 py-1 text-[11px]"
              title={db.kind === 'checking' ? '正在探测 Supabase' : db.kind === 'up' ? 'PostgREST 可达，arch_diagram 可读' : db.message}
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: db.kind === 'checking' ? 'var(--text-tertiary)' : db.kind === 'up' ? '#2F7D46' : 'var(--err)' }}
              />
              <span
                className={
                  db.kind === 'up'
                    ? 'text-[var(--text-secondary)]'
                    : db.kind === 'checking'
                      ? 'text-[var(--text-secondary)]'
                      : 'text-[var(--err)]'
                }
              >
                {db.kind === 'checking'
                  ? '正在检测数据库…'
                  : db.kind === 'up'
                    ? `数据库正常 · ${db.latencyMs}ms`
                    : `数据库不可用`}
              </span>
            </p>
            <div className="my-1 border-t border-[var(--hair)]" />
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
              onClick={() => {
                setOpen(false);
                void auth.signOut();
              }}
            >
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
