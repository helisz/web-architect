import { useState } from 'react';
import { guestDiagramCount, clearGuestData } from '../data/guestRepo.js';
import { useGuestSession } from '../data/guestSession.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 游客模式的常驻提示条（用户 2026-11-05）。
 *
 * 放在图库和画布最上面：说清楚"数据只在这台电脑的浏览器里"，
 * 给一条去登录的路，另给一个清空本机数据的出口（试用完想清干净的人不少）。
 * 不用 toast —— 这信息需要一直在，而不是闪一下就没了。
 */
export function GuestBanner() {
  const exitGuest = useGuestSession((s) => s.exit);
  const pushToast = useDiagramStore((s) => s.pushToast);
  const [count, setCount] = useState(() => guestDiagramCount());
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[#FDE68A] bg-[#FFFBEB] px-3 text-[11px] text-[#92400E]">
      <span className="rounded bg-[#FDE68A] px-1.5 py-0.5 font-medium text-[#78350F]">游客模式</span>
      <span>数据只保存在这台电脑的浏览器里 · 换设备 / 清缓存就没了 · 本机 {count} 张图</span>
      <div className="ml-auto flex items-center gap-1">
        {count > 0 && (
          <button
            type="button"
            onClick={() => {
              if (!confirming) {
                setConfirming(true);
                return;
              }
              clearGuestData();
              setCount(0);
              setConfirming(false);
              pushToast('已清空本机游客数据', 'info');
            }}
            onBlur={() => setConfirming(false)}
            className="rounded px-1.5 py-0.5 hover:bg-[#FDE68A]"
            title="只删本机浏览器里的游客数据，不影响任何账号里的图"
          >
            {confirming ? '再点一次确认清空' : '清空本机数据'}
          </button>
        )}
        <button
          type="button"
          onClick={() => exitGuest()}
          className="rounded bg-[#B45309] px-2 py-0.5 font-medium text-white hover:bg-[#92400E]"
          title="回到登录页；本机游客数据会保留，登录后可以导入账号"
        >
          登录以保存到云端
        </button>
      </div>
    </div>
  );
}
