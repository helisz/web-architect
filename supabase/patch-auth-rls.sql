-- =====================================================================
-- 收紧权限：arch_* 只对「已登录用户」开放（用户 2026-11-04 第三批）
--
-- 背景：这份图要发布到 GitHub Pages（公开站点）。原来的 RLS 是
--   `for all to anon, authenticated using (true)`
-- 也就是说任何人只要拿到 anon key（它必然随前端包公开）就能读/改/删全部图。
-- 发布前把权限收到 authenticated：浏览器必须先用邮箱+密码登录拿到 JWT，
-- 之后的请求带的是 authenticated 角色，anon 一律拿不到行。
--
-- 幂等：可重复执行。
-- 执行顺序：先跑本文件，再在 Dashboard 建账号，然后才发布 Pages。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 表权限：anon 全撤，authenticated 只给 CRUD（不含 truncate / 改表结构）
-- ---------------------------------------------------------------------
revoke all on table public.arch_diagram, public.arch_group, public.arch_node,
                    public.arch_edge, public.arch_snapshot
  from anon;
revoke all on table public.arch_diagram, public.arch_group, public.arch_node,
                    public.arch_edge, public.arch_snapshot
  from public;

grant select, insert, update, delete on table public.arch_diagram,
      public.arch_group, public.arch_node, public.arch_edge, public.arch_snapshot
  to authenticated;

-- ---------------------------------------------------------------------
-- 2) 函数权限：这一套 arch_* 函数都只给 authenticated
--    （用 DO 块遍历，将来再加函数也不会漏；触发函数不参与权限检查，无副作用）
-- ---------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'arch\_%'
  loop
    execute format('revoke all on function %s from anon, public', fn.sig);
    execute format('grant execute on function %s to authenticated', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) 策略重建：只给 authenticated（每张表一条 for all，语义不变：登录后不区分用户）
--
--    注意：这里**没有**按 user_id 隔离 —— 建一个账号、团队里共用，谁都能改所有图
--    （与工具箱一致的做法）。要按人隔离的话，得给 5 张表都加 owner 列，改动较大，
--    不在本轮范围。
-- ---------------------------------------------------------------------
drop policy if exists arch_diagram_all  on public.arch_diagram;
drop policy if exists arch_group_all    on public.arch_group;
drop policy if exists arch_node_all     on public.arch_node;
drop policy if exists arch_edge_all     on public.arch_edge;
drop policy if exists arch_snapshot_all on public.arch_snapshot;

create policy arch_diagram_all  on public.arch_diagram  for all to authenticated using (true) with check (true);
create policy arch_group_all    on public.arch_group    for all to authenticated using (true) with check (true);
create policy arch_node_all     on public.arch_node     for all to authenticated using (true) with check (true);
create policy arch_edge_all     on public.arch_edge     for all to authenticated using (true) with check (true);
create policy arch_snapshot_all on public.arch_snapshot for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------
-- 4) 公开注册必须关掉（**必须做**，不是可选）
--
--    当前项目实测：email provider 已开，但 `disable_signup = false` —— 也就是
--    任何人拿 anon key 调 /auth/v1/signup 就能自己注册一个账号，注册完就是
--    authenticated 角色，本文件的策略对他全开。SQL 改不了 Auth 配置，所以：
--
--      Dashboard → Authentication → Providers → Email → 关掉 "Allow new users to sign up"
--
--    关掉之后，能登录的只剩**已经存在的账号** —— 也就是 toolbox 在同一项目里
--    建过的那些 Auth 用户（Supabase Auth 用户是项目级的，不是应用级的，
--    同一个邮箱 + 密码在两个应用都能登）。不需要再为这张图单独建账号。
--
--    如果要给某个人单独开权限：Authentication → Users → Add user，
--    勾 "Auto Confirm User"（项目没配 SMTP，auto_confirm 为 false，不勾会卡在待验证）。
-- ---------------------------------------------------------------------

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5) 自检
--    want_anon_grant = false（anon 已经没有表权限）
--    want_policies   = 5 条且 roles = {authenticated}
-- ---------------------------------------------------------------------
select
  has_table_privilege('anon', 'public.arch_diagram', 'select') as anon_can_select,
  has_table_privilege('authenticated', 'public.arch_diagram', 'select') as authenticated_can_select;

select tablename, policyname, roles
from pg_policies
where schemaname = 'public' and tablename like 'arch\_%'
order by tablename;
