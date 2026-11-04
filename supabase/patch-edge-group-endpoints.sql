-- =====================================================================
-- 连线端点允许指向「分组」（用户 2026-11-04：分组之间、分组与节点之间都能连线）
--
-- 原 DDL 里 arch_edge.source_node_id / target_node_id 是外键，指向 arch_node，
-- 于是"分组"（arch_group 表）当端点时插入会被数据库拒绝。一个 uuid 列没法同时
-- 外键到两张表，所以这两个外键必须去掉，改为由应用层维护一致性：
--   * 删除节点 → 应用层同时删掉相关连线（applyDeletion）
--   * 删除分组 / 解组 → 应用层同时删掉相关连线（removeGroup / ungroup）
--   * 载入时 Schema 校验 V2 会丢弃悬空连线（端点既不是节点也不是分组）
--
-- 幂等：可重复执行。
-- 在 Supabase SQL Editor 里跑一次即可，跑之前存量的图不受影响。
-- =====================================================================

alter table public.arch_edge
  drop constraint if exists arch_edge_source_node_id_fkey;

alter table public.arch_edge
  drop constraint if exists arch_edge_target_node_id_fkey;

-- 自连检查仍然有效（同一张图里不能自己连自己）
-- 说明：约束 arch_ck_edge_no_self 保留不动。

comment on column public.arch_edge.source_node_id is
  '连线起点：arch_node.node_id 或 arch_group.group_id（两者共用一套 id 空间，外键已移除）';
comment on column public.arch_edge.target_node_id is
  '连线终点：arch_node.node_id 或 arch_group.group_id（两者共用一套 id 空间，外键已移除）';

-- 校验：外键是否真的没了（期望 0 行）
select conname
from pg_constraint
where conrelid = 'public.arch_edge'::regclass
  and contype = 'f'
  and conname like '%node_id_fkey';
