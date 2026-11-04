-- ============================================================================
-- 每人只看自己的图（用户 2026-11-04 第四批，选 A）
--
-- 前置：先跑过 patch-auth-rls.sql（anon 已全撤、权限只给 authenticated）。
--       本文件在此基础上再收一层：authenticated 也不再"看到全部"，
--       只看 creator_id = auth.uid() 的那些图。
--
-- 设计要点
--   1. 归属由服务端决定：BEFORE INSERT/UPDATE 触发器把 creator_id 强制写成
--      auth.uid()，客户端（payload 里的 creatorId）说了不算，也没法"认领"别人的图。
--      这样不用改 arch_save_diagram 那一大坨函数体。
--   2. 主表按 creator_id 判；4 张子表（group/node/edge/snapshot）用 EXISTS 看父表，
--      免得子表成为侧门（否则隐藏了图名，仍能直接 REST 读到它的节点）。
--   3. 现有图的 creator_id 都是 'local-user'（老前端写死的），迁移段把它们改到你名下。
--
-- 执行顺序：① 跑本文件 ② 改末尾迁移段的邮箱再跑一次（或直接改好一起跑）。
--   注意：迁移段没跑之前，老图对所有人不可见（包括你）——别慌，是策略生效了。
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) 归属由服务端决定
-- ---------------------------------------------------------------------------
create or replace function public.arch_force_owner()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- 有 JWT 就用 JWT 的用户；本地/无会话（比如 SQL Editor 里的 service_role）保持原值
    if auth.uid() is not null then
      new.creator_id := auth.uid()::text;
    end if;
  else
    -- 归属不可改：既防"转移"，也防"覆盖成别人"。
    -- 只在**有 JWT 的请求**里锁死 —— SQL Editor（无 auth.uid()）要能跑下面的迁移。
    if auth.uid() is not null then
      new.creator_id := old.creator_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists arch_diagram_force_owner on public.arch_diagram;
create trigger arch_diagram_force_owner
  before insert or update on public.arch_diagram
  for each row execute function public.arch_force_owner();

-- ---------------------------------------------------------------------------
-- 2) 清掉旧策略，重建"只看自己的"
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public' and tablename like 'arch\_%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy arch_diagram_own on public.arch_diagram
  for all to authenticated
  using (creator_id = auth.uid()::text)
  with check (creator_id = auth.uid()::text);

create policy arch_group_own on public.arch_group
  for all to authenticated
  using (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_group.diagram_id and d.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_group.diagram_id and d.creator_id = auth.uid()::text
  ));

create policy arch_node_own on public.arch_node
  for all to authenticated
  using (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_node.diagram_id and d.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_node.diagram_id and d.creator_id = auth.uid()::text
  ));

create policy arch_edge_own on public.arch_edge
  for all to authenticated
  using (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_edge.diagram_id and d.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_edge.diagram_id and d.creator_id = auth.uid()::text
  ));

create policy arch_snapshot_own on public.arch_snapshot
  for all to authenticated
  using (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_snapshot.diagram_id and d.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_diagram d
    where d.diagram_id = arch_snapshot.diagram_id and d.creator_id = auth.uid()::text
  ));

-- 权限维持"只给 authenticated"（幂等，重复跑无害）
grant select, insert, update, delete on public.arch_diagram  to authenticated;
grant select, insert, update, delete on public.arch_group    to authenticated;
grant select, insert, update, delete on public.arch_node     to authenticated;
grant select, insert, update, delete on public.arch_edge     to authenticated;
grant select, insert, update, delete on public.arch_snapshot to authenticated;

-- ---------------------------------------------------------------------------
-- 2b) 补一个 definer 函数的洞：arch_restore_snapshot
--
--     它是 security definer（跑在函数属主名下 = 绕过 RLS），原来只校验"快照存在"，
--     于是任何 authenticated 用户只要拿到别人的 snapshot_id，就能把别人的图回滚成
--     旧内容（等于越权写）。收紧后：先查快照归属，不是自己的就当"不存在"——
--     返回和真不存在完全一样的错误，不泄漏"存在但无权"。
-- ---------------------------------------------------------------------------
create or replace function public.arch_restore_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_diagram_id uuid;
  v_payload    jsonb;
  v_owner      varchar(64);
begin
  select s.diagram_id, s.payload
    into v_diagram_id, v_payload
    from public.arch_snapshot s
   where s.snapshot_id = p_snapshot_id;

  if v_diagram_id is null then
    raise exception 'SNAPSHOT_NOT_FOUND: %', p_snapshot_id using errcode = 'P0002';
  end if;

  select d.creator_id into v_owner
    from public.arch_diagram d
   where d.diagram_id = v_diagram_id;

  if auth.uid() is null or v_owner is distinct from auth.uid()::text then
    raise exception 'SNAPSHOT_NOT_FOUND: %', p_snapshot_id using errcode = 'P0002';
  end if;

  -- baseVersion 传 null：强制覆盖，避免"读的时候恰好有人保存过"导致冲突
  return public.arch_save_diagram(v_payload, null);
end
$fn$;

grant execute on function public.arch_restore_snapshot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) 迁移：把老图从 'local-user' 改到你名下
--
--    ↓↓↓ 把这一行的邮箱改成你的登录邮箱，**再跑一次本文件**（或整段改好一次跑完）。
--        不跑这步：老图谁都看不见（策略已经生效，先别以为是数据丢了）。
-- ---------------------------------------------------------------------------
update public.arch_diagram d
set creator_id = u.id::text
from auth.users u
where u.email = 'YOUR_EMAIL@example.com'
  and d.creator_id = 'local-user';

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- 4) 自检（跑完看这几行）
-- ---------------------------------------------------------------------------
-- 4.1 策略是不是只剩 "own" 这一套（期望 5 行，全部 permissive/authenticated）
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename like 'arch\_%'
order by tablename;

-- 4.2 anon 应该没有任何权限（期望 5 行 false）
select table_name,
       has_table_privilege('anon', 'public.' || table_name, 'SELECT') as anon_select
from unnest(array['arch_diagram','arch_group','arch_node','arch_edge','arch_snapshot']) as table_name;

-- 4.3 归属分布：迁移成功的话 'local-user' 计数应为 0
select creator_id, count(*) as diagrams
from public.arch_diagram
group by creator_id
order by diagrams desc;

-- 4.4 触发器在不在
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.arch_diagram'::regclass and not tgisinternal;
