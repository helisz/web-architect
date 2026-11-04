import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './env.js';

/**
 * Supabase 客户端（浏览器端，anon key）。
 *
 * 没有自建后端：读写全走 PostgREST，权限边界在 supabase/schema.sql 的 RLS 策略。
 * 这里只用 anon key —— 绝不要把 service_role key 放进前端环境变量。
 */
export const supabase: SupabaseClient | null = supabaseConfig
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: { persistSession: false },
      global: { headers: { 'x-application-name': 'web-architect' } },
    })
  : null;
