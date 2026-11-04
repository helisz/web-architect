import { describe, expect, it } from 'vitest';
import { UNLOAD_GRACE_MS, shouldWarnOnUnload, type UnloadGuardInput } from '../src/data/unloadGuard.js';

/**
 * 关窗口提示（用户 2026-11-04 方案 b）：
 * 只有"已落库 + 脏 + 距上次成功写库超过 3 秒 + 自己是写者"时才拦。
 */
const base: UnloadGuardInput = {
  persisted: true,
  saveState: 'dirty',
  conflict: null,
  saveDisabled: false,
  writerRole: 'owner',
};

const now = 1_000_000;

describe('关窗口提示判定', () => {
  it('正常脏状态且早就没存过 → 拦', () => {
    expect(shouldWarnOnUnload(base, now, now - UNLOAD_GRACE_MS - 1)).toBe(true);
  });

  it('刚存过 3 秒内 → 不拦（避免每次都弹）', () => {
    expect(shouldWarnOnUnload(base, now, now - 1000)).toBe(false);
  });

  it('从没成功存过也不拦（lastWriteAt = 0 视为无基线）', () => {
    expect(shouldWarnOnUnload(base, now, 0)).toBe(true);
  });

  it('没有落过库的临时图不拦', () => {
    expect(shouldWarnOnUnload({ ...base, persisted: false }, now, 0)).toBe(false);
  });

  it('保存中/已保存不拦，只有 dirty 拦', () => {
    expect(shouldWarnOnUnload({ ...base, saveState: 'saving' }, now, 0)).toBe(false);
    expect(shouldWarnOnUnload({ ...base, saveState: 'saved' }, now, 0)).toBe(false);
  });

  it('冲突或保存被禁用时不拦（拦了也解决不了）', () => {
    expect(shouldWarnOnUnload({ ...base, conflict: { code: 'VERSION_CONFLICT' } }, now, 0)).toBe(false);
    expect(shouldWarnOnUnload({ ...base, saveDisabled: true }, now, 0)).toBe(false);
  });

  it('跟随者不拦：它本来就不写库', () => {
    expect(shouldWarnOnUnload({ ...base, writerRole: 'follower' }, now, 0)).toBe(false);
  });
});
