import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.js';

/**
 * 右上角账号菜单（用户 2026-11-05：图库和画布都要有，并且固定在最右边）。
 *
 * 交互：**鼠标移入就展开**（mouseover），移出收起；同时保留点击展开 ——
 * 触屏和键盘用户没有 hover，只有点击可用，两种都留最省事。
 * tooltip 里给完整邮箱，圆点上只显示首字母。
 */
export function AccountMenu() {
  const auth = useAuth();
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
        className="grid h-7 w-7 place-items-center rounded-full bg-[#EEF1F4] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[#E5E9EE] hover:text-[var(--text-primary)]"
      >
        {(email[0] ?? '?').toUpperCase()}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-[var(--panel-border)] bg-white py-1 shadow-md"
        >
          <p className="truncate px-3 py-1 text-[11px] text-[var(--text-secondary)]" title={email}>
            {email || '未登录'}
          </p>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[#F3F4F6]"
            onClick={() => {
              setOpen(false);
              void auth.signOut();
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
