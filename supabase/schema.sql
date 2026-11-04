-- ============================================================================
-- 架构拓扑绘图工具 · 数据库结构（Supabase / PostgreSQL 14+）
--
-- 用法：Supabase Dashboard → SQL Editor → New query → 粘贴本文件全文 → Run。
--       可重复执行：表用 if not exists，列用 add column if not exists，
--       策略先 drop 再 create，触发器先 drop 再建。
--       阶段 2 起另有增量保存函数，装完本文件后再执行 supabase/patch-diagram.sql
--       （不装也能用，前端会自动回退到整图保存）。
--
-- 命名：本项目与 toolbox 共用同一个 Supabase 项目（public schema），
--       所有对象统一 arch_ 前缀，避免与其既有对象冲突。
--       Postgres 未加引号的标识符不能含连字符，故用下划线。
--
-- 依据：技术规格 v1.0 §7.3（列名、类型、默认值保持一致，仅对象名加前缀）
--   规格 architecture_diagram → arch_diagram
--   规格 diagram_group        → arch_group
--   规格 diagram_node         → arch_node
--   规格 diagram_edge         → arch_edge
--   规格 diagram_snapshot     → arch_snapshot
--
-- 安全模型：无自建后端，前端用 anon key 经 PostgREST 直连。
--       因此 5 张表启用 RLS 并对 anon 放行读写（详见 ADR-0004）。
--       注意：anon key 会随前端包公开，等同「拿到地址即可读写」，仅限内网使用。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 主表
-- ---------------------------------------------------------------------------
create table if not exists public.arch_diagram (
    diagram_id      uuid primary key,
    schema_version  varchar(16)  not null default '1.0',
    name            varchar(255) not null,
    description     text         not null default '',
    project_id      varchar(64),
    tags            text[]       not null default '{}',
    version         int          not null default 1,
    creator_id      varchar(64)  not null,
    created_at      timestamptz  not null default now(),
    updated_at      timestamptz  not null default now(),
    viewport_x      float        not null default 0,
    viewport_y      float        not null default 0,
    viewport_zoom   float        not null default 1,
    is_deleted      boolean      not null default false,
    constraint arch_ck_viewport_zoom check (viewport_zoom between 0.1 and 4)
);

create index if not exists arch_idx_diagram_project on public.arch_diagram(project_id) where is_deleted = false;
create index if not exists arch_idx_diagram_updated on public.arch_diagram(updated_at desc);

comment on table public.arch_diagram is '架构图主表（规格 architecture_diagram）';

-- ---------------------------------------------------------------------------
-- 2. 分组 / 泳道
-- ---------------------------------------------------------------------------
create table if not exists public.arch_group (
    group_id        uuid primary key,
    diagram_id      uuid not null references public.arch_diagram(diagram_id) on delete cascade,
    parent_group_id uuid references public.arch_group(group_id) on delete set null,
    label           varchar(255) not null default '',
    x               float not null,
    y               float not null,
    width           float not null,
    height          float not null,
    bg_color        varchar(32) not null default '#F1F3F5',
    border_color    varchar(32) not null default '#D1D5DB',
    title_color     varchar(32) not null default '#374151',
    collapsed       boolean not null default false,
    sort            int not null default 0,
    ext_json        jsonb,
    is_deleted      boolean not null default false,
    constraint arch_ck_group_size check (width >= 120 and height >= 80)
);

create index if not exists arch_idx_group_diagram on public.arch_group(diagram_id) where is_deleted = false;

comment on table public.arch_group is '分组 / 泳道（规格 diagram_group）';

-- ---------------------------------------------------------------------------
-- 3. 节点
-- ---------------------------------------------------------------------------
create table if not exists public.arch_node (
    node_id       uuid primary key,
    diagram_id    uuid not null references public.arch_diagram(diagram_id) on delete cascade,
    group_id      uuid references public.arch_group(group_id) on delete set null,
    label         varchar(255) not null default '',
    sub_label     text not null default '',
    node_type     varchar(64) not null default 'custom',
    x             float not null,
    y             float not null,
    width         float not null default 160,
    height        float not null default 80,
    bg_color      varchar(32) not null default '#FFFFFF',
    border_color  varchar(32) not null default '#D1D5DB',
    text_color    varchar(32) not null default '#111827',
    locked        boolean not null default false,
    visible       boolean not null default true,
    sort          int not null default 0,
    ext_json      jsonb,
    is_deleted    boolean not null default false,
    constraint arch_ck_node_size check (width >= 64 and height >= 40),
    constraint arch_ck_node_type check (node_type ~ '^[a-z0-9-]{1,32}$')
);

create index if not exists arch_idx_node_diagram on public.arch_node(diagram_id) where is_deleted = false;
create index if not exists arch_idx_node_group   on public.arch_node(group_id);
create index if not exists arch_idx_node_ip      on public.arch_node((ext_json->>'ip')) where is_deleted = false;

comment on table public.arch_node is '节点 / 组件卡片（规格 diagram_node）';

-- ---------------------------------------------------------------------------
-- 4. 连线
-- ---------------------------------------------------------------------------
create table if not exists public.arch_edge (
    edge_id          uuid primary key,
    diagram_id       uuid not null references public.arch_diagram(diagram_id) on delete cascade,
    source_node_id   uuid not null references public.arch_node(node_id) on delete cascade,
    target_node_id   uuid not null references public.arch_node(node_id) on delete cascade,
    label            varchar(255),
    stroke_color     varchar(32) not null default '#8B5CF6',
    stroke_width     float not null default 1.5,
    stroke_dasharray varchar(32),
    edge_type        varchar(16) not null default 'ortho',
    arrow            varchar(16) not null default 'none',
    source_anchor    varchar(16),
    target_anchor    varchar(16),
    sort             int not null default 0,
    ext_json         jsonb,
    is_deleted       boolean not null default false,
    constraint arch_ck_edge_type check (edge_type in ('ortho','bezier','straight')),
    constraint arch_ck_edge_no_self check (source_node_id <> target_node_id)
);

create index if not exists arch_idx_edge_diagram on public.arch_edge(diagram_id) where is_deleted = false;
create index if not exists arch_idx_edge_source  on public.arch_edge(source_node_id);
create index if not exists arch_idx_edge_target  on public.arch_edge(target_node_id);

comment on table public.arch_edge is '连线（规格 diagram_edge）';

-- ---------------------------------------------------------------------------
-- 5. 快照
-- ---------------------------------------------------------------------------
create table if not exists public.arch_snapshot (
    snapshot_id  uuid primary key,
    diagram_id   uuid not null references public.arch_diagram(diagram_id) on delete cascade,
    version      int not null,
    name         varchar(255),
    payload      jsonb not null,
    created_by   varchar(64),
    created_at   timestamptz not null default now(),
    constraint arch_uq_snapshot_version unique (diagram_id, version)
);

comment on table public.arch_snapshot is '版本快照（规格 diagram_snapshot）';

-- ---------------------------------------------------------------------------
-- 6. updated_at 自动维护
-- ---------------------------------------------------------------------------
create or replace function public.arch_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists arch_tg_diagram_touch on public.arch_diagram;
create trigger arch_tg_diagram_touch
before update on public.arch_diagram
for each row execute function public.arch_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. 撞名自检
--    本库与 toolbox 共用，若 arch_* 已被别的项目的同名表占用，
--    create table if not exists 会静默跳过 → 这里显式报错，避免"用错表"。
-- ---------------------------------------------------------------------------
do $$
declare
  missing text;
begin
  select string_agg(t.table_name || '.' || t.column_name, ', ')
    into missing
    from (values
      ('arch_diagram',  'diagram_id'),
      ('arch_diagram',  'schema_version'),
      ('arch_diagram',  'viewport_zoom'),
      ('arch_diagram',  'is_deleted'),
      ('arch_group',    'parent_group_id'),
      ('arch_group',    'collapsed'),
      ('arch_node',     'node_type'),
      ('arch_node',     'ext_json'),
      ('arch_edge',     'source_anchor'),
      ('arch_edge',     'stroke_dasharray'),
      ('arch_snapshot', 'payload')
    ) as t(table_name, column_name)
   where not exists (
     select 1
       from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name  = t.table_name
        and c.column_name = t.column_name
   );

  if missing is not null then
    raise exception 'arch_* 对象已存在但结构不符（疑似撞上其它项目的表）：缺列 %', missing
      using hint = '确认这些表不属于别的项目后，改名或删除重建，再重跑本文件。';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. 权限与 RLS
--    无自建后端 → 前端 anon key 直连，故对 anon 放行 arch_* 的读写。
--    只对本项目的 5 张表授权，不影响库里其它项目的表。
-- ---------------------------------------------------------------------------
alter table public.arch_diagram  enable row level security;
alter table public.arch_group    enable row level security;
alter table public.arch_node     enable row level security;
alter table public.arch_edge     enable row level security;
alter table public.arch_snapshot enable row level security;

grant select, insert, update, delete on public.arch_diagram  to anon, authenticated;
grant select, insert, update, delete on public.arch_group    to anon, authenticated;
grant select, insert, update, delete on public.arch_node     to anon, authenticated;
grant select, insert, update, delete on public.arch_edge     to anon, authenticated;
grant select, insert, update, delete on public.arch_snapshot to anon, authenticated;
grant execute on function public.arch_touch_updated_at() to anon, authenticated;

drop policy if exists arch_diagram_all on public.arch_diagram;
create policy arch_diagram_all on public.arch_diagram
  for all to anon, authenticated using (true) with check (true);

drop policy if exists arch_group_all on public.arch_group;
create policy arch_group_all on public.arch_group
  for all to anon, authenticated using (true) with check (true);

drop policy if exists arch_node_all on public.arch_node;
create policy arch_node_all on public.arch_node
  for all to anon, authenticated using (true) with check (true);

drop policy if exists arch_edge_all on public.arch_edge;
create policy arch_edge_all on public.arch_edge
  for all to anon, authenticated using (true) with check (true);

drop policy if exists arch_snapshot_all on public.arch_snapshot;
create policy arch_snapshot_all on public.arch_snapshot
  for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 9. 保存函数（一次 RPC = 一个事务，前端禁止逐表发请求）
--
--    做四件事：
--      a) 版本校验：库内 version ≠ p_base_version → 抛 VERSION_CONFLICT
--      b) 主表 upsert 并 version + 1
--      c) 分组 / 节点 / 连线 三表 upsert + 差集软删（is_deleted = true）
--      d) 按 C8 策略写快照（首次 / 每 5 版 / 距上次 ≥30 分钟）
--
--    顺序必须 分组 → 节点 → 连线，因为后者的外键指向前者。
--    返回 { diagramId, version, savedAt, snapshot }，前端拿 version 作为下次基线。
-- ---------------------------------------------------------------------------
create or replace function public.arch_save_diagram(
  p_payload      jsonb,
  p_base_version integer default null
) returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_diagram_id uuid;
  v_current    integer;
  v_new        integer;
  v_node_ids   uuid[];
  v_edge_ids   uuid[];
  v_group_ids  uuid[];
  v_snapshot   boolean := false;
  v_zoom       float;
begin
  v_diagram_id := nullif(p_payload->>'diagramId', '')::uuid;
  if v_diagram_id is null then
    raise exception 'payload 缺少 diagramId' using errcode = '22023';
  end if;

  -- a) 版本校验（行锁：同一时刻只有一个写者，配合前端串行队列）
  select version into v_current from public.arch_diagram where diagram_id = v_diagram_id for update;
  if v_current is not null and p_base_version is not null and v_current <> p_base_version then
    raise exception 'VERSION_CONFLICT 库内版本 % ，提交基线 %', v_current, p_base_version
      using errcode = 'P0001';
  end if;

  -- b) 主表
  v_zoom := least(greatest(coalesce((p_payload->'viewport'->>'zoom')::float, 1), 0.1), 4);

  insert into public.arch_diagram
    (diagram_id, schema_version, name, description, project_id, version, creator_id,
     viewport_x, viewport_y, viewport_zoom, is_deleted)
  values (
    v_diagram_id,
    coalesce(p_payload->>'schemaVersion', '1.0'),
    coalesce(nullif(p_payload->>'name', ''), '未命名架构图'),
    coalesce(p_payload->>'description', ''),
    nullif(p_payload->>'projectId', ''),
    1,
    coalesce(nullif(p_payload->>'creatorId', ''), 'local-user'),
    coalesce((p_payload->'viewport'->>'x')::float, 0),
    coalesce((p_payload->'viewport'->>'y')::float, 0),
    v_zoom,
    false
  )
  on conflict (diagram_id) do update set
    name           = excluded.name,
    description    = excluded.description,
    schema_version = excluded.schema_version,
    project_id     = excluded.project_id,
    viewport_x     = excluded.viewport_x,
    viewport_y     = excluded.viewport_y,
    viewport_zoom  = excluded.viewport_zoom,
    is_deleted     = false,
    version        = public.arch_diagram.version + 1
  returning version into v_new;

  -- c1) 分组（先于节点：节点的 group_id 指向它）
  select coalesce(array_agg((e->>'groupId')::uuid), '{}')
    into v_group_ids
    from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) e;

  insert into public.arch_group
    (group_id, diagram_id, parent_group_id, label, x, y, width, height,
     bg_color, border_color, title_color, collapsed, sort, ext_json, is_deleted)
  select
    (e->>'groupId')::uuid,
    v_diagram_id,
    nullif(e->>'parentGroupId', '')::uuid,
    coalesce(e->>'label', ''),
    coalesce((e->>'x')::float, 0),
    coalesce((e->>'y')::float, 0),
    greatest(coalesce((e->>'width')::float, 420), 120),
    greatest(coalesce((e->>'height')::float, 300), 80),
    coalesce(e->>'bgColor', '#F1F3F5'),
    coalesce(e->>'borderColor', '#D1D5DB'),
    coalesce(e->>'titleColor', '#374151'),
    coalesce((e->>'collapsed')::boolean, false),
    coalesce((e->>'sort')::int, 0),
    e->'extJson',
    false
  from jsonb_array_elements(coalesce(p_payload->'groups', '[]'::jsonb)) e
  on conflict (group_id) do update set
    parent_group_id = excluded.parent_group_id,
    label           = excluded.label,
    x               = excluded.x,
    y               = excluded.y,
    width           = excluded.width,
    height          = excluded.height,
    bg_color        = excluded.bg_color,
    border_color    = excluded.border_color,
    title_color     = excluded.title_color,
    collapsed       = excluded.collapsed,
    sort            = excluded.sort,
    ext_json        = excluded.ext_json,
    is_deleted      = false;

  update public.arch_group set is_deleted = true
   where diagram_id = v_diagram_id and is_deleted = false and not (group_id = any (v_group_ids));

  -- c2) 节点
  select coalesce(array_agg((e->>'nodeId')::uuid), '{}')
    into v_node_ids
    from jsonb_array_elements(coalesce(p_payload->'nodes', '[]'::jsonb)) e;

  insert into public.arch_node
    (node_id, diagram_id, group_id, label, sub_label, node_type, x, y, width, height,
     bg_color, border_color, text_color, locked, visible, sort, ext_json, is_deleted)
  select
    (e->>'nodeId')::uuid,
    v_diagram_id,
    nullif(e->>'groupId', '')::uuid,
    coalesce(e->>'label', ''),
    coalesce(e->>'subLabel', ''),
    coalesce(e->>'nodeType', 'custom'),
    coalesce((e->>'x')::float, 0),
    coalesce((e->>'y')::float, 0),
    greatest(coalesce((e->>'width')::float, 160), 64),
    greatest(coalesce((e->>'height')::float, 80), 40),
    coalesce(e->>'bgColor', '#FFFFFF'),
    coalesce(e->>'borderColor', '#D1D5DB'),
    coalesce(e->>'textColor', '#111827'),
    coalesce((e->>'locked')::boolean, false),
    coalesce((e->>'visible')::boolean, true),
    coalesce((e->>'sort')::int, 0),
    e->'extJson',
    false
  from jsonb_array_elements(coalesce(p_payload->'nodes', '[]'::jsonb)) e
  on conflict (node_id) do update set
    group_id     = excluded.group_id,
    label        = excluded.label,
    sub_label    = excluded.sub_label,
    node_type    = excluded.node_type,
    x            = excluded.x,
    y            = excluded.y,
    width        = excluded.width,
    height       = excluded.height,
    bg_color     = excluded.bg_color,
    border_color = excluded.border_color,
    text_color   = excluded.text_color,
    locked       = excluded.locked,
    visible      = excluded.visible,
    sort         = excluded.sort,
    ext_json     = excluded.ext_json,
    is_deleted   = false;

  update public.arch_node set is_deleted = true
   where diagram_id = v_diagram_id and is_deleted = false and not (node_id = any (v_node_ids));

  -- c3) 连线（悬空连线直接丢弃，别让外键把整个事务炸掉）
  select coalesce(array_agg((e->>'edgeId')::uuid), '{}')
    into v_edge_ids
    from jsonb_array_elements(coalesce(p_payload->'edges', '[]'::jsonb)) e;

  insert into public.arch_edge
    (edge_id, diagram_id, source_node_id, target_node_id, label, stroke_color, stroke_width,
     stroke_dasharray, edge_type, arrow, source_anchor, target_anchor, sort, ext_json, is_deleted)
  select
    (e->>'edgeId')::uuid,
    v_diagram_id,
    (e->>'sourceNodeId')::uuid,
    (e->>'targetNodeId')::uuid,
    nullif(e->>'label', ''),
    coalesce(e->>'strokeColor', '#8B5CF6'),
    coalesce((e->>'strokeWidth')::float, 1.5),
    nullif(e->>'strokeDasharray', ''),
    coalesce(e->>'edgeType', 'ortho'),
    coalesce(e->>'arrow', 'none'),
    nullif(e->>'sourceAnchor', ''),
    nullif(e->>'targetAnchor', ''),
    coalesce((e->>'sort')::int, 0),
    e->'extJson',
    false
  from jsonb_array_elements(coalesce(p_payload->'edges', '[]'::jsonb)) e
  where (e->>'sourceNodeId')::uuid = any (v_node_ids)
    and (e->>'targetNodeId')::uuid = any (v_node_ids)
    and (e->>'sourceNodeId') <> (e->>'targetNodeId')
  on conflict (edge_id) do update set
    source_node_id   = excluded.source_node_id,
    target_node_id   = excluded.target_node_id,
    label            = excluded.label,
    stroke_color     = excluded.stroke_color,
    stroke_width     = excluded.stroke_width,
    stroke_dasharray = excluded.stroke_dasharray,
    edge_type        = excluded.edge_type,
    arrow            = excluded.arrow,
    source_anchor    = excluded.source_anchor,
    target_anchor    = excluded.target_anchor,
    sort             = excluded.sort,
    ext_json         = excluded.ext_json,
    is_deleted       = false;

  update public.arch_edge set is_deleted = true
   where diagram_id = v_diagram_id and is_deleted = false and not (edge_id = any (v_edge_ids));

  -- d) 快照（C8：首次 + 每 5 版 + 距上次 ≥30 分钟）
  if v_current is null
     or v_new % 5 = 0
     or not exists (
          select 1 from public.arch_snapshot
           where diagram_id = v_diagram_id and created_at > now() - interval '30 minutes'
        )
  then
    insert into public.arch_snapshot (snapshot_id, diagram_id, version, name, payload, created_by)
    values (
      gen_random_uuid(), v_diagram_id, v_new,
      left(coalesce(p_payload->>'name', '未命名架构图'), 255),
      p_payload,
      coalesce(nullif(p_payload->>'creatorId', ''), 'local-user')
    )
    on conflict (diagram_id, version) do nothing;
    v_snapshot := true;
  end if;

  return jsonb_build_object(
    'diagramId', v_diagram_id,
    'version',   v_new,
    'savedAt',   now(),
    'snapshot',  v_snapshot
  );
end
$fn$;

comment on function public.arch_save_diagram(jsonb, integer)
  is '整图保存：版本校验 + 三表 upsert + 差集软删 + 条件快照，一次调用一个事务';

grant execute on function public.arch_save_diagram(jsonb, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. PostgREST 立刻感知新表（Supabase 通常自动重载，这里显式喊一声）
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
