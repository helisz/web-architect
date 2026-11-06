import { useGuestSession } from '../data/guestSession.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 顶栏右上角：游客身份（用户 2026-11-05）。
 *
 * 登录用户那里是头像菜单，游客没有账号可点，就换成一枚「游客」胶囊 + 登录按钮 ——
 * 位置和尺寸与 `AccountMenu` 对齐，切换时顶栏不跳。
 */
export function GuestAccount() {
  const exitGuest = useGuestSession((s) => s.exit);

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span
        className="flex items-center gap-1 rounded-[var(--radius-ctl)] border border-[var(--accent-200)] bg-[var(--accent-50)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-700)]"
        title="游客模式：数据只保存在这台电脑的浏览器里，不会写进任何账号或数据库"
      >
        <ToolIcon name="database" size={12} />
        本机
      </span>
      <button
        type="button"
        onClick={() => exitGuest()}
        className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)]"
        title="回到登录页；本机游客数据会保留，登录后可以导入账号"
      >
        登录
      </button>
    </div>
  );
}
