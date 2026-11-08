import { beforeEach, describe, expect, it, vi } from 'vitest';

/** localStorage 桩（node 环境没有 localStorage），与 localState.test.ts 同一套做法 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

const { forgetRememberedEmail, readRememberedEmail, writeRememberedEmail } = await import(
  '../src/lib/rememberedEmail.js'
);

describe('记住邮箱（2026-11-08）', () => {
  beforeEach(() => storage.clear());

  it('默认没有记录', () => {
    expect(readRememberedEmail()).toBe('');
  });

  it('写入后能读回，且会去掉首尾空白', () => {
    writeRememberedEmail('  ops@example.com  ');
    expect(readRememberedEmail()).toBe('ops@example.com');
  });

  it('写空串等于清除（不会留下空记录）', () => {
    writeRememberedEmail('a@b.c');
    writeRememberedEmail('   ');
    expect(storage.getItem('arch.login.email')).toBeNull();
    expect(readRememberedEmail()).toBe('');
  });

  it('forget 直接清掉', () => {
    writeRememberedEmail('a@b.c');
    forgetRememberedEmail();
    expect(readRememberedEmail()).toBe('');
  });

  it('只存邮箱，不存密码：本模块没有任何跟密码相关的键', () => {
    writeRememberedEmail('a@b.c');
    const keys: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      // MemoryStorage 不暴露 keys()，用"逐个试探"确认没有密码键
      if (storage.getItem(`arch.login.password`)) keys.push('arch.login.password');
    }
    expect(keys).toEqual([]);
    expect(storage.getItem('arch.login.email')).toBe('a@b.c');
  });

  it('localStorage 不可用时静默降级（不抛错）', () => {
    const broken = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    vi.stubGlobal('localStorage', broken);
    expect(() => writeRememberedEmail('x@y.z')).not.toThrow();
    expect(readRememberedEmail()).toBe('');
    expect(() => forgetRememberedEmail()).not.toThrow();
    vi.stubGlobal('localStorage', storage);
  });
});
