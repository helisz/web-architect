import { create } from 'zustand';

/**
 * 游客试用模式（用户 2026-11-05）。
 *
 * 只有一条状态：现在是不是"游客"。游客模式下所有数据走 `guestRepo`（localStorage），
 * **一个 Supabase 请求都不发**；退出游客模式后回到正常登录页，数据仍留在本机。
 *
 * 为什么用模块级 store 而不是 React state：
 * - `diagramRepo` / `usePersistence` 这些非组件模块也要判断模式；
 * - 登录页、顶栏、图库、画布四个入口都要读它，还可能在另一个标签页里切换（storage 事件）。
 */
export const GUEST_FLAG_KEY = 'arch:guest:on';

function readFlag(): boolean {
  try {
    return localStorage.getItem(GUEST_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 非组件代码用：当前是不是游客 */
export function isGuestMode(): boolean {
  return readFlag() || useGuestSession.getState().guest;
}

interface GuestSessionState {
  guest: boolean;
  enter: () => void;
  exit: () => void;
}

export const useGuestSession = create<GuestSessionState>()((set) => ({
  guest: readFlag(),
  enter: () => {
    try {
      localStorage.setItem(GUEST_FLAG_KEY, '1');
    } catch {
      // 隐私模式写不了 flag：这次会话仍然是游客，只是刷新后回到登录页
    }
    set({ guest: true });
  },
  exit: () => {
    try {
      localStorage.removeItem(GUEST_FLAG_KEY);
    } catch {
      // 同上
    }
    set({ guest: false });
  },
}));

// 另一个标签页进出游客模式时同步过来（否则一个标签页还在写本地、另一个已经在等登录）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== GUEST_FLAG_KEY) return;
    useGuestSession.setState({ guest: event.newValue === '1' });
  });
}
