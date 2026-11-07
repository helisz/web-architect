-- ============================================================================
-- 节点最小尺寸放宽：64×40 → 24×24（用户 2026-11-07）
--
-- 只跑这一个文件就行（不用重跑整份 schema.sql）。它做两件事：
--   1) 改表上的 CHECK 约束 arch_ck_node_size；
--   2) 改两个保存函数里对宽高的服务端钳制：
--        greatest(coalesce((e->>'width')::float, 160), 64)   → ..., 24
--        greatest(coalesce((e->>'height')::float, 80), 40)   → ..., 24
--      不改进程函数的话，前端能存 24×24，但写库时会被悄悄顶回 64×40
--      （不报错，只是刷新后又变大了，更难排查）。
--
-- 幂等：约束先 drop 再 add；函数用 pg_get_functiondef 读出来做字面替换，
--       已经是 24 的会跳过（不重复 execute）。
-- 分组（arch_group 120×80）不动。
-- ============================================================================

-- 1) 约束 -------------------------------------------------------------------
alter table public.arch_node drop constraint if exists arch_ck_node_size;

alter table public.arch_node
  add constraint arch_ck_node_size check (width >= 24 and height >= 24);

-- 2) 两个保存函数里的钳制 ---------------------------------------------------
do $patch$
declare
  fn record;
  def text;
  changed boolean;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('arch_save_diagram', 'arch_patch_diagram')
  loop
    def := pg_get_functiondef(fn.oid);
    changed := false;

    if position($old$greatest(coalesce((e->>'width')::float, 160), 64)$old$ in def) > 0 then
      def := replace(
        def,
        $old$greatest(coalesce((e->>'width')::float, 160), 64)$old$,
        $new$greatest(coalesce((e->>'width')::float, 160), 24)$new$
      );
      changed := true;
    end if;

    if position($old$greatest(coalesce((e->>'height')::float, 80), 40)$old$ in def) > 0 then
      def := replace(
        def,
        $old$greatest(coalesce((e->>'height')::float, 80), 40)$old$,
        $new$greatest(coalesce((e->>'height')::float, 80), 24)$new$
      );
      changed := true;
    end if;

    if changed then
      execute def;
      raise notice '已更新 %：节点宽高钳制 64/40 → 24/24', fn.proname;
    else
      raise notice '跳过 %：没有找到旧的 64/40 钳制（可能已经改过）', fn.proname;
    end if;
  end loop;
end
$patch$;

-- 让 PostgREST 立刻感知约束变化
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 自检 1：应输出 CHECK (((width >= 24) AND (height >= 24)))
-- ---------------------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.arch_node'::regclass
  and conname = 'arch_ck_node_size';

-- ---------------------------------------------------------------------------
-- 自检 2：两个函数里应该已经是 24，不再出现 ", 64)" / ", 40)"
-- ---------------------------------------------------------------------------
select p.proname,
       position('(e->>''width'')::float, 160), 24)' in pg_get_functiondef(p.oid)) > 0 as width_24,
       position('(e->>''height'')::float, 80), 24)' in pg_get_functiondef(p.oid)) > 0 as height_24
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('arch_save_diagram', 'arch_patch_diagram');
