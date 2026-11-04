/**
 * 关窗口前是否要拦一下（用户 2026-11-04 选择方案 b：脏 + 距上次落库超过 3 秒才拦）。
 *
 * 单独抽成纯函数的原因：`beforeunload` 只能弹原生框，没法在浏览器里稳定回归；
 * 把判定条件钉在单测里，比在浏览器里点"离开"可靠得多。
 */
export const UNLOAD_GRACE_MS = 3000;

export interface UnloadGuardInput {
  /** 这张图是否已经落过库（临时图不拦，免得关窗口时被当成新图插入） */
  persisted: boolean;
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  conflict: unknown;
  saveDisabled: boolean;
  writerRole: 'owner' | 'follower';
}

/**
 * @param now          当前时间戳
 * @param lastWriteAt  上次**成功落库**的时间戳（0 表示这张图还没成功存过）
 */
export function shouldWarnOnUnload(input: UnloadGuardInput, now: number, lastWriteAt: number): boolean {
  if (!input.persisted) return false;
  if (input.saveState !== 'dirty') return false;
  if (input.conflict) return false;
  if (input.saveDisabled) return false;
  // 跟随者不写库，拦下来也存不了，反而每次关标签页都弹
  if (input.writerRole === 'follower') return false;
  // 刚存过就关：宽限期内的"脏"通常是还没来得及重排的那一次更新
  if (lastWriteAt > 0 && now - lastWriteAt < UNLOAD_GRACE_MS) return false;
  return true;
}
