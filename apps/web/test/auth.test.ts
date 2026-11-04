import { describe, expect, it } from 'vitest';
import { AUTH_ERRORS, canLoadData, explainAuthError } from '../src/lib/auth.js';

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

describe('什么时候可以拉数据（用户 2026-11-04 第四批）', () => {
  it('只有登录后才能拉：未登录/加载中一律不发请求', () => {
    expect(canLoadData('signed-in')).toBe(true);
    expect(canLoadData('signed-out')).toBe(false);
    expect(canLoadData('loading')).toBe(false);
  });

  it('未登录就不该拉数据的理由：请求会 401，而路由没变、登录后不会重试', () => {
    // 这条用例是"规则文档"，防止以后有人为了"少写一个参数"把 enabled 去掉
    const statuses = ['loading', 'signed-out', 'signed-in'] as const;
    expect(statuses.filter((status) => canLoadData(status))).toEqual(['signed-in']);
  });
});