import { useEffect } from 'react';
import { useDiagramStore, type WriterRole } from '../store/useDiagramStore.js';

/**
 * 同一张图只允许一个标签页在写 —— 这是"版本冲突"最主要的来源。
 *
 * 做法：localStorage 里放一张"谁在写"的租约（`arch:writer:<diagramId>`），
 * 持有者每 4 秒续租一次；别的标签页看到**新鲜的**租约就把自己降为只读，
 * 不再发保存请求；租约 12 秒没续上（标签页崩了 / 被关了）就自然接管。
 *
 * 不用 BroadcastChannel：它要求两个标签页同时活着才能通信，而这个租约
 * 在"另一个标签页已经死掉"的情况下也能正确恢复。
 */
const LOCK_PREFIX = 'arch:writer:';
const HEARTBEAT_MS = 4000;
/** 超过这么久没续租，就认为原主已经不在了 */
const STALE_MS = 12_000;

interface LockRecord {
  tabId: string;
  at: number;
}

const tabId = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}`;
  }
})();

function lockKey(diagramId: string): string {
  return `${LOCK_PREFIX}${diagramId}`;
}

function readLock(key: string): LockRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LockRecord;
    if (typeof parsed?.tabId !== 'string' || typeof parsed?.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLock(key: string, record: LockRecord): void {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    /* 隐私模式下写不了 localStorage：退化成"没有租约"，行为等同单标签页 */
  }
}

function removeLock(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

/** 本页主动抢占写权（"在此页继续编辑"按钮 / 在本页开始编辑时自动调用） */
export function takeOverWriter(diagramId: string | null | undefined): void {
  if (!diagramId) return;
  writeLock(lockKey(diagramId), { tabId, at: Date.now() });
  useDiagramStore.getState().setWriterRole('owner');
}

/** 本页正在写吗（给保存链路的守卫用，不进 React 渲染） */
export function isWriterTab(): boolean {
  return useDiagramStore.getState().writerRole === 'owner';
}

/**
 * 挂一次：维护租约、把角色写进 store。
 *
 * 角色只有两种：
 * - `owner`：正常编辑 + 自动保存；
 * - `follower`：另一个标签页在写，本页不自动保存（一旦在本页真的动手改，
 *   `useAutosave` 会自动抢占，见那里的说明）。
 */
export function useWriterLock(diagramId: string | null | undefined, enabled: boolean): void {
  const setWriterRole = useDiagramStore((s) => s.setWriterRole);

  useEffect(() => {
    if (!enabled || !diagramId) return;
    const key = lockKey(diagramId);
    // 本页是否真的持有租约：只有持有者才续租，避免"只读的标签页"把租约刷成自己的
    let owned = false;

    const claim = (): void => {
      owned = true;
      writeLock(key, { tabId, at: Date.now() });
      setWriterRole('owner');
    };

    const tick = (): void => {
      const record = readLock(key);
      const now = Date.now();
      const foreign = record !== null && record.tabId !== tabId;
      const fresh = record !== null && now - record.at < STALE_MS;

      if (owned) {
        if (foreign && fresh) {
          // 别人抢走了（"在此页继续编辑"），本页立刻降级，别继续写
          owned = false;
          setWriterRole('follower');
          return;
        }
        writeLock(key, { tabId, at: now });
        return;
      }

      if (!record || record.tabId === tabId || !fresh) claim();
      else setWriterRole('follower');
    };

    tick();
    const timer = setInterval(tick, HEARTBEAT_MS);

    const release = (): void => {
      if (!owned) return;
      const record = readLock(key);
      if (record?.tabId === tabId) removeLock(key);
    };
    window.addEventListener('pagehide', release);

    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [diagramId, enabled, setWriterRole]);
}

/** 当前角色（组件里用） */
export function useWriterRole(): WriterRole {
  return useDiagramStore((s) => s.writerRole);
}
