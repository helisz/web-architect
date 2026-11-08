-- ============================================================================
-- 流程（Flow）功能 · 建表 + RLS（用户 2026-11-08）
--
-- 用法：Supabase Dashboard → SQL Editor → 粘贴全文 → Run。可重复执行。
--
-- 与「架构图」的关系：**完全独立的一套表**（用户选定），不碰 arch_diagram 那 5 张。
-- 表名沿用 arch_ 前缀，因为本项目和 toolbox 共用同一个 Supabase 项目（ADR-0003）。
--
-- 管理员：用 Supabase Auth 的 app_metadata.role = 'admin' 判定
--        （Dashboard → Authentication → Users → 选中用户 → app_metadata 里加 role）。
--        管理员可以建"公共模板"（visibility = 'public'），普通用户只能建私有模板。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 模板
-- ---------------------------------------------------------------------------
create table if not exists public.arch_flow_template (
    template_id uuid primary key,
    name        varchar(120) not null,
    description text         not null default '',
    -- public：所有人可读（只有管理员能建/改）；private：只有创建者
    visibility  varchar(16)  not null default 'private',
    creator_id  varchar(64)  not null,
    -- 模板节点配置（数据源 / 参数 / 展示字段 / 状态判定 / 系统跳转），结构见设计文档 §3
    config      jsonb        not null default '{}'::jsonb,
    created_at  timestamptz  not null default now(),
    updated_at  timestamptz  not null default now(),
    is_deleted  boolean      not null default false,
    constraint arch_flow_tpl_visibility check (visibility in ('public', 'private'))
);

create index if not exists arch_idx_flow_template_owner on public.arch_flow_template(creator_id) where is_deleted = false;
create index if not exists arch_idx_flow_template_public on public.arch_flow_template(visibility) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 2. 流程（一张流程 = 一个画布，字段与 arch_diagram 同构，便于复用那套乐观锁）
-- ---------------------------------------------------------------------------
create table if not exists public.arch_flow (
    flow_id       uuid primary key,
    name          varchar(255) not null,
    description   text         not null default '',
    creator_id    varchar(64)  not null,
    version       int          not null default 1,
    viewport_x    float        not null default 0,
    viewport_y    float        not null default 0,
    viewport_zoom float        not null default 1,
    created_at    timestamptz  not null default now(),
    updated_at    timestamptz  not null default now(),
    is_deleted    boolean      not null default false,
    constraint arch_flow_zoom check (viewport_zoom between 0.1 and 4)
);

create index if not exists arch_idx_flow_owner on public.arch_flow(creator_id) where is_deleted = false;
create index if not exists arch_idx_flow_updated on public.arch_flow(updated_at desc);

-- ---------------------------------------------------------------------------
-- 3. 节点（引用模板 + 自己的参数 + 模板快照）
-- ---------------------------------------------------------------------------
create table if not exists public.arch_flow_node (
    node_id           uuid primary key,
    flow_id           uuid not null references public.arch_flow(flow_id) on delete cascade,
    -- 模板可能被删：置空而不是级联删节点（节点上还有快照，仍可显示）
    template_id       uuid references public.arch_flow_template(template_id) on delete set null,
    label             varchar(255) not null default '',
    x                 float not null default 0,
    y                 float not null default 0,
    width             float not null default 260,
    height            float not null default 180,
    -- 该节点自己的参数值：{ "app": "xxx", "token": "yyy" }
    params            jsonb not null default '{}'::jsonb,
    -- 创建时的模板配置快照：模板改动不影响已有节点（用户选定），可手动「同步到最新」
    template_snapshot jsonb not null default '{}'::jsonb,
    ext_json          jsonb,
    sort              int   not null default 0,
    is_deleted        boolean not null default false,
    constraint arch_flow_node_size check (width >= 120 and height >= 80)
);

create index if not exists arch_idx_flow_node_flow on public.arch_flow_node(flow_id) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 4. 连线
-- ---------------------------------------------------------------------------
create table if not exists public.arch_flow_edge (
    edge_id          uuid primary key,
    flow_id          uuid not null references public.arch_flow(flow_id) on delete cascade,
    source_node_id   uuid not null,
    target_node_id   uuid not null,
    label            varchar(255) not null default '',
    source_anchor    varchar(8),
    target_anchor    varchar(8),
    stroke_color     varchar(32) not null default '#AFACA2',
    stroke_width     float not null default 2,
    stroke_dasharray varchar(32),
    ext_json         jsonb,
    sort             int not null default 0,
    is_deleted       boolean not null default false
);

create index if not exists arch_idx_flow_edge_flow on public.arch_flow_edge(flow_id) where is_deleted = false;

-- ---------------------------------------------------------------------------
-- 5. updated_at 触发器（复用架构图那套函数；schema.sql 已建过就直接用）
-- ---------------------------------------------------------------------------
drop trigger if exists arch_flow_touch on public.arch_flow;
create trigger arch_flow_touch before update on public.arch_flow
  for each row execute function public.arch_touch_updated_at();

drop trigger if exists arch_flow_template_touch on public.arch_flow_template;
create trigger arch_flow_template_touch before update on public.arch_flow_template
  for each row execute function public.arch_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS
--    - 流程 / 节点 / 连线：只对创建者可见可写（和 arch_diagram 同一套）
--    - 模板：自己的 或 公共的 可读；写只限自己的；只有管理员能写 public
-- ---------------------------------------------------------------------------
alter table public.arch_flow_template enable row level security;
alter table public.arch_flow            enable row level security;
alter table public.arch_flow_node       enable row level security;
alter table public.arch_flow_edge       enable row level security;

drop policy if exists arch_flow_template_read on public.arch_flow_template;
create policy arch_flow_template_read on public.arch_flow_template
  for select to authenticated
  using (is_deleted = false and (visibility = 'public' or creator_id = auth.uid()::text));

drop policy if exists arch_flow_template_write on public.arch_flow_template;
create policy arch_flow_template_write on public.arch_flow_template
  for all to authenticated
  using (creator_id = auth.uid()::text)
  with check (
    creator_id = auth.uid()::text
    -- 只有管理员能把模板设成公共
    and (
      visibility <> 'public'
      or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    )
  );

drop policy if exists arch_flow_own on public.arch_flow;
create policy arch_flow_own on public.arch_flow
  for all to authenticated
  using (creator_id = auth.uid()::text)
  with check (creator_id = auth.uid()::text);

drop policy if exists arch_flow_node_own on public.arch_flow_node;
create policy arch_flow_node_own on public.arch_flow_node
  for all to authenticated
  using (exists (
    select 1 from public.arch_flow f
    where f.flow_id = arch_flow_node.flow_id and f.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_flow f
    where f.flow_id = arch_flow_node.flow_id and f.creator_id = auth.uid()::text
  ));

drop policy if exists arch_flow_edge_own on public.arch_flow_edge;
create policy arch_flow_edge_own on public.arch_flow_edge
  for all to authenticated
  using (exists (
    select 1 from public.arch_flow f
    where f.flow_id = arch_flow_edge.flow_id and f.creator_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from public.arch_flow f
    where f.flow_id = arch_flow_edge.flow_id and f.creator_id = auth.uid()::text
  ));

-- ---------------------------------------------------------------------------
-- 7. 整张流程一次性保存（事务 + 乐观锁）
--    节点/连线数量不大，直接"删了重插"最简单也最不容易错。
--    p_base_version = null 表示新建。
-- ---------------------------------------------------------------------------
create or replace function public.arch_flow_save(p_flow jsonb, p_base_version int)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_flow_id  uuid;
  v_current  int;
  v_name     varchar(255);
  v_owner    text;
begin
  v_flow_id := (p_flow ->> 'flowId')::uuid;
  if v_flow_id is null then
    raise exception 'payload 缺少 flowId' using errcode = '22023';
  end if;

  v_owner := auth.uid()::text;
  if v_owner is null then
    raise exception '未登录，不能保存流程' using errcode = '28000';
  end if;

  v_name := coalesce(nullif(p_flow ->> 'name', ''), '未命名流程');

  select version into v_current from public.arch_flow where flow_id = v_flow_id;

  if found then
    if p_base_version is not null and p_base_version <> v_current then
      return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'currentVersion', v_current);
    end if;

    update public.arch_flow set
      name = v_name,
      description = coalesce(p_flow ->> 'description', ''),
      version = v_current + 1,
      viewport_x = coalesce((p_flow -> 'viewport' ->> 'x')::float, 0),
      viewport_y = coalesce((p_flow -> 'viewport' ->> 'y')::float, 0),
      viewport_zoom = greatest(0.1, least(4, coalesce((p_flow -> 'viewport' ->> 'zoom')::float, 1))),
      is_deleted = false,
      updated_at = now()
    where flow_id = v_flow_id;
  else
    insert into public.arch_flow (flow_id, name, description, creator_id, version, viewport_x, viewport_y, viewport_zoom)
    values (
      v_flow_id, v_name, coalesce(p_flow ->> 'description', ''), v_owner, 1,
      coalesce((p_flow -> 'viewport' ->> 'x')::float, 0),
      coalesce((p_flow -> 'viewport' ->> 'y')::float, 0),
      greatest(0.1, least(4, coalesce((p_flow -> 'viewport' ->> 'zoom')::float, 1)))
    );
    v_current := 0;
  end if;

  -- 先删边再删点（外键方向）
  delete from public.arch_flow_edge where flow_id = v_flow_id;
  delete from public.arch_flow_node where flow_id = v_flow_id;

  insert into public.arch_flow_node
    (node_id, flow_id, template_id, label, x, y, width, height, params, template_snapshot, ext_json, sort)
  select
    (e ->> 'nodeId')::uuid,
    v_flow_id,
    nullif(e ->> 'templateId', '')::uuid,
    coalesce(e ->> 'label', ''),
    coalesce((e ->> 'x')::float, 0),
    coalesce((e ->> 'y')::float, 0),
    greatest(coalesce((e ->> 'width')::float, 260), 120),
    greatest(coalesce((e ->> 'height')::float, 180), 80),
    coalesce(e -> 'params', '{}'::jsonb),
    coalesce(e -> 'templateSnapshot', '{}'::jsonb),
    e -> 'extJson',
    coalesce((e ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p_flow -> 'nodes', '[]'::jsonb)) e;

  insert into public.arch_flow_edge
    (edge_id, flow_id, source_node_id, target_node_id, label, source_anchor, target_anchor,
     stroke_color, stroke_width, stroke_dasharray, ext_json, sort)
  select
    (e ->> 'edgeId')::uuid,
    v_flow_id,
    (e ->> 'sourceNodeId')::uuid,
    (e ->> 'targetNodeId')::uuid,
    coalesce(e ->> 'label', ''),
    nullif(e ->> 'sourceAnchor', ''),
    nullif(e ->> 'targetAnchor', ''),
    coalesce(e ->> 'strokeColor', '#AFACA2'),
    coalesce((e ->> 'strokeWidth')::float, 2),
    nullif(e ->> 'strokeDasharray', ''),
    e -> 'extJson',
    coalesce((e ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p_flow -> 'edges', '[]'::jsonb)) e;

  return jsonb_build_object('ok', true, 'version', v_current + 1);
end;
$$;

grant execute on function public.arch_flow_save(jsonb, int) to authenticated;

-- 让 PostgREST 立刻感知新表 / 新函数
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 自检：应为 4 张表、2 个触发器、5 条策略、1 个函数
-- ---------------------------------------------------------------------------
select 'tables' as kind, count(*)::text as n
from pg_tables where schemaname = 'public' and tablename like 'arch\_flow%'
union all
select 'policies', count(*)::text
from pg_policies where schemaname = 'public' and tablename like 'arch\_flow%'
union all
select 'function', count(*)::text
from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public' and p.proname = 'arch_flow_save';
