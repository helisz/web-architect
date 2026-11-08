/**
 * 「记住邮箱」（用户 2026-11-08）。
 *
 * 只记邮箱，**不存密码**：共用电脑上明文存密码风险太大。
 * 勾选框默认勾上；取消勾选并登录成功后会把已存的邮箱删掉。
 */
const KEY = 'arch.login.email';

export function readRememberedEmail(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? '';
  } catch {
    // 隐私模式读不到：当没记过
    return '';
  }
}

export function writeRememberedEmail(email: string): void {
  try {
    const clean = email.trim();
    if (!clean) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, clean);
  } catch {
    // 存不了不影响登录本身
  }
}

export function forgetRememberedEmail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上
  }
}
