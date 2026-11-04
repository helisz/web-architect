import { describe, expect, it } from 'vitest';
import { AUTH_ERRORS, explainAuthError } from '../src/lib/auth.js';

describe('登录报错翻译（用户 2026-11-04 第三批）', () => {
  it('密码错 / 用户不存在都归到"邮箱或密码不对"', () => {
    expect(explainAuthError('Invalid login credentials')).toBe(AUTH_ERRORS.badCredentials);
    expect(explainAuthError('invalid login credentials')).toBe(AUTH_ERRORS.badCredentials);
  });

  it('邮箱没确认给出可操作的指引', () => {
    expect(explainAuthError('Email not confirmed')).toBe(AUTH_ERRORS.notConfirmed);
    expect(explainAuthError('EMAIL NOT CONFIRMED')).toContain('Dashboard');
  });

  it('网络问题不冒充密码错误', () => {
    expect(explainAuthError('Failed to fetch')).toBe(AUTH_ERRORS.network);
    expect(explainAuthError('NetworkError when attempting to fetch resource')).toBe(AUTH_ERRORS.network);
  });

  it('限流单独提示', () => {
    expect(explainAuthError('Email rate limit exceeded')).toContain('太频繁');
  });

  it('没见过的报错原样透出（排障要看原文），空串给兜底文案', () => {
    expect(explainAuthError('some new supabase wording')).toBe('some new supabase wording');
    expect(explainAuthError('')).toBe(AUTH_ERRORS.unknown);
  });
});
