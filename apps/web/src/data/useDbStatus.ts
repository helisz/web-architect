import { useEffect, useState } from 'react';
import { TABLES } from '@arch/schema';
import { supabase } from '../lib/supabase.js';

export type DbState =
  | { kind: 'checking' }
  | { kind: 'up'; latencyMs: number }
  | { kind: 'down'; message: string };

/**
 * 数据库连通性探针（替代原来的后端 /api/health）。
 *
 * 打一次 `head` 请求只数行数，既验证「网络可达 + 表存在 + RLS 放行」，
 * 又不搬运数据。建表前会明确报「表不存在 → 先跑 supabase/schema.sql」。
 */
export function useDbStatus(pollMs = 30_000): DbState {
  const [state, setState] = useState<DbState>(
    supabase ? { kind: 'checking' } : { kind: 'down', message: '未配置 Supabase 环境变量' },
  );

  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let cancelled = false;

    const probe = async (): Promise<void> => {
      const startedAt = performance.now();
      try {
        // 注意：不能用 head:true —— HEAD 响应没有 body，表不存在时 supabase-js 拿不到
        // 错误对象（只回 404 状态码），会被误判为"正常"。改用 GET 取 1 行。
        const { error, status } = await db.from(TABLES.diagram).select('diagram_id').limit(1);
        if (cancelled) return;
        if (error) {
          const hint = /does not exist|schema cache|PGRST205/i.test(error.message)
            ? '表不存在 → 先跑 supabase/schema.sql'
            : error.message;
          setState({ kind: 'down', message: hint });
          return;
        }
        if (status !== 200 && status !== 206) {
          setState({ kind: 'down', message: `PostgREST 返回 ${status}` });
          return;
        }
        setState({ kind: 'up', latencyMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        if (cancelled) return;
        setState({ kind: 'down', message: (error as Error).message });
      }
    };

    void probe();
    const timer = window.setInterval(() => void probe(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pollMs]);

  return state;
}
