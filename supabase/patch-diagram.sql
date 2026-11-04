-- ===========================================================================
-- 阶段 2 · PATCH 增量保存
--
-- 用法：在 Supabase SQL Editor 里整段执行一次即可（幂等，可重复执行）。
-- 执行完前端会在下一次自动保存时改走 arch_patch_diagram；
-- 若没执行，前端会收到 PGRST202 并自动回退到整图保存，不会坏。
--
-- 与 arch_save_diagram 的差别：
--   整图保存 = 三表全量 upsert + 差集软删（每次都要把整张图重写一遍）
--   增量保存 = 只 upsert 前端算出来的差异行 + 按 id 软删（行数 ≈ 本次改动量）
-- 版本号语义一致（每次都 +1），冲突检查一致（VERSION_CONFLICT）。
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. 把库里的图导出成与前端 toSavePayload 同构的 payload
--
--    增量保存时前端不再上传整图，所以快照需要由数据库自己重建。
-- ---------------------------------------------------------------------------
create or replace function public.arch_diagram_payload(p_diagram_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $fn$
  select jsonb_build_object(
    'diagramId',     d.diagram_id,
    'schemaVersion', d.schema_version,
    'name',          d.name,
    'description',   d.description,
    'projectId',     d.project_id,
    'creatorId',     d.creator_id,
    'viewport', jsonb_build_object('x', d.viewport_x, 'y', d.viewport_y, 'zoom', d.viewport_zoom),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'groupId',       g.group_id,
               'parentGroupId', g.parent_group_id,
               'label',         g.label,
               'x', g.x, 'y', g.y, 'width', g.width, 'height', g.height,
               'bgColor',       g.bg_color,
               'borderColor',   g.border_color,
               'titleColor',    g.title_color,
               'collapsed',     g.collapsed,
               'sort',          g.sort,
               'extJson',       g.ext_json
             ) order by g.sort, g.group_id)
        from public.arch_group g
       where g.diagram_id = d.diagram_id and not g.is_deleted), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nodeId',    n.node_id,
               'groupId',   n.group_id,
               'label',     n.label,
               'subLabel',  n.sub_label,
               'nodeType',  n.node_type,
               'x', n.x, 'y', n.y, 'width', n.width, 'height', n.height,
               'bgColor',     n.bg_color,
               'borderColor', n.border_color,
               'textColor',   n.text_color,
               'locked',      n.locked,
               'visible',     n.visible,
               'sort',        n.sort,
               'extJson',     n.ext_json
             ) order by n.sort, n.node_id)
        from public.arch_node n
       where n.diagram_id = d.diagram_id and not n.is_deleted), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'edgeId',      e.edge_id,
               'sourceNodeId', e.source_node_id,
               'targetNodeId', e.target_node_id,
               'label',       e.label,
               'strokeColor', e.stroke_color,
               'strokeWidth', e.stroke_width,
               'strokeDasharray', e.stroke_dasharray,
               'edgeType',    e.edge_type,
               'arrow',       e.arrow,
               'sourceAnchor', e.source_anchor,
               'targetAnchor', e.target_anchor,
               'sort',        e.sort,
               'extJson',     e.ext_json
             ) order by e.sort, e.edge_id)
        from public.arch_edge e
       where e.diagram_id = d.diagram_id and not e.is_deleted), '[]'::jsonb)
  )
  from public.arch_diagram d
  where d.diagram_id = p_diagram_id;
$fn$;

comment on function public.arch_diagram_payload(uuid)
  is '把库里的图导出成与前端 toSavePayload 同构的 JSON（快照 / 导出用）';

-- ---------------------------------------------------------------------------
-- 2. 增量保存
--
--    p_patch 结构（三段都可省略）：
--    {
--      "diagram": { "name", "description", "schemaVersion", "projectId", "viewport": {x,y,zoom} },
--      "groups":  { "upsert": [ ...同整图 payload... ], "delete": ["uuid", ...] },
--      "nodes":   { "upsert": [ ... ], "delete": [ ... ] },
--      "edges":   { "upsert": [ ... ], "delete": [ ... ] }
--    }
--
--    写入顺序：主表 → 分组 → 节点 → 连线；
--    软删顺序反过来：连线 → 节点 → 分组（避免先删父级被外键挡住）。
-- ---------------------------------------------------------------------------
create or replace function public.arch_patch_diagram(
  p_diagram_id   uuid,
  p_base_version integer,
  p_patch        jsonb
) returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_current  integer;
  v_new      integer;
  v_snapshot boolean := false;
  v_ids      uuid[];
begin
  if p_diagram_id is null then
    raise exception 'patch 缺少 diagramId' using errcode = '22023';
  end if;

  -- 版本校验：增量写入更怕并发，这里同样加行锁
  select version into v_current
    from public.arch_diagram where diagram_id = p_diagram_id for update;
  if v_current is null then
    raise exception '图不存在：%', p_diagram_id using errcode = 'P0002';
  end if;
  if p_base_version is not null and v_current <> p_base_version then
    raise exception 'VERSION_CONFLICT 库内版本 % ，提交基线 %', v_current, p_base_version
      using errcode = 'P0001';
  end if;

  -- a) 主表标量字段（只改出现过的键）
  update public.arch_diagram d set
    name           = coalesce(p_patch->'diagram'->>'name', d.name),
    description    = coalesce(p_patch->'diagram'->>'description', d.description),
    schema_version = coalesce(p_patch->'diagram'->>'schemaVersion', d.schema_version),
    project_id     = (case
                        when p_patch->'diagram' ? 'projectId'
                          then nullif(p_patch->'diagram'->>'projectId', '')
                        else d.project_id::text
                      end)::uuid,
    viewport_x     = coalesce((p_patch->'diagram'->'viewport'->>'x')::float, d.viewport_x),
    viewport_y     = coalesce((p_patch->'diagram'->'viewport'->>'y')::float, d.viewport_y),
    viewport_zoom  = least(greatest(
                       coalesce((p_patch->'diagram'->'viewport'->>'zoom')::float, d.viewport_zoom), 0.1), 4),
    version        = d.version + 1
  where d.diagram_id = p_diagram_id
  returning d.version into v_new;

  -- b) 软删（连线 → 节点 → 分组）
  update public.arch_edge set is_deleted = true
   where diagram_id = p_diagram_id
     and edge_id = any (coalesce((select array_agg(value::uuid)
                                    from jsonb_array_elements_text(coalesce(p_patch->'edges'->'delete', '[]'::jsonb))), '{}'));

  update public.arch_node set is_deleted = true
   where diagram_id = p_diagram_id
     and node_id = any (coalesce((select array_agg(value::uuid)
                                    from jsonb_array_elements_text(coalesce(p_patch->'nodes'->'delete', '[]'::jsonb))), '{}'));

  update public.arch_group set is_deleted = true
   where diagram_id = p_diagram_id
     and group_id = any (coalesce((select array_agg(value::uuid)
                                     from jsonb_array_elements_text(coalesce(p_patch->'groups'->'delete', '[]'::jsonb))), '{}'));

  -- c) 分组 upsert
  insert into public.arch_group
    (group_id, diagram_id, parent_group_id, label, x, y, width, height,
     bg_color, border_color, title_color, collapsed, sort, ext_json, is_deleted)
  select
    (e->>'groupId')::uuid,
    p_diagram_id,
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
  from jsonb_array_elements(coalesce(p_patch->'groups'->'upsert', '[]'::jsonb)) e
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

  -- d) 节点 upsert（分组已就位，外键不会炸）
  insert into public.arch_node
    (node_id, diagram_id, group_id, label, sub_label, node_type, x, y, width, height,
     bg_color, border_color, text_color, locked, visible, sort, ext_json, is_deleted)
  select
    (e->>'nodeId')::uuid,
    p_diagram_id,
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
  from jsonb_array_elements(coalesce(p_patch->'nodes'->'upsert', '[]'::jsonb)) e
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

  -- e) 连线 upsert（悬空端 / 自环直接跳过，别让外键炸掉整个事务）
  select coalesce(array_agg(node_id), '{}') into v_ids
    from public.arch_node where diagram_id = p_diagram_id and not is_deleted;

  insert into public.arch_edge
    (edge_id, diagram_id, source_node_id, target_node_id, label, stroke_color, stroke_width,
     stroke_dasharray, edge_type, arrow, source_anchor, target_anchor, sort, ext_json, is_deleted)
  select
    (e->>'edgeId')::uuid,
    p_diagram_id,
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
  from jsonb_array_elements(coalesce(p_patch->'edges'->'upsert', '[]'::jsonb)) e
  where (e->>'sourceNodeId')::uuid = any (v_ids)
    and (e->>'targetNodeId')::uuid = any (v_ids)
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

  -- f) 快照（与整图保存同一套策略：首次 / 每 5 版 / 距上次 ≥30 分钟）
  if v_new % 5 = 0
     or not exists (
          select 1 from public.arch_snapshot
           where diagram_id = p_diagram_id and created_at > now() - interval '30 minutes'
        )
  then
    insert into public.arch_snapshot (snapshot_id, diagram_id, version, name, payload, created_by)
    select gen_random_uuid(), p_diagram_id, v_new,
           left(coalesce(d.name, '未命名架构图'), 255),
           coalesce(public.arch_diagram_payload(p_diagram_id), '{}'::jsonb),
           coalesce(d.creator_id, 'local-user')
      from public.arch_diagram d where d.diagram_id = p_diagram_id
    on conflict (diagram_id, version) do nothing;
    v_snapshot := true;
  end if;

  return jsonb_build_object(
    'diagramId', p_diagram_id,
    'version',   v_new,
    'savedAt',   now(),
    'snapshot',  v_snapshot
  );
end
$fn$;

comment on function public.arch_patch_diagram(uuid, integer, jsonb)
  is '增量保存：版本校验 + 按差异 upsert/软删 + 条件快照（行数 ≈ 本次改动量）';

grant execute on function public.arch_diagram_payload(uuid) to anon, authenticated;
grant execute on function public.arch_patch_diagram(uuid, integer, jsonb) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

begin;

-- ---------------------------------------------------------------------------
-- arch_restore_snapshot：把某个快照回滚成一次新的整图保存
-- 语义（D7）：回滚不是"倒带"，而是"把旧内容当成一次新提交" —— 版本号 max+1，
-- 历史不丢；实现上直接复用 arch_save_diagram，避免两套写库逻辑走偏。
-- ---------------------------------------------------------------------------
create or replace function public.arch_restore_snapshot(p_snapshot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_diagram_id uuid;
  v_payload    jsonb;
begin
  select s.diagram_id, s.payload
    into v_diagram_id, v_payload
    from public.arch_snapshot s
   where s.snapshot_id = p_snapshot_id;

  if v_diagram_id is null then
    raise exception 'SNAPSHOT_NOT_FOUND: %', p_snapshot_id using errcode = 'P0002';
  end if;

  -- baseVersion 传 null：强制覆盖，避免"读的时候恰好有人保存过"导致冲突
  return public.arch_save_diagram(v_payload, null);
end
$fn$;

comment on function public.arch_restore_snapshot(uuid)
  is '快照回滚：以快照 payload 发起一次新保存，version = max + 1（D7）';

grant execute on function public.arch_restore_snapshot(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
