-- =====================================================================
-- 图级扩展字段 arch_diagram.ext_json（用户 2026-11-04 第二批）
--
-- 用途：全局「锁定编辑」开关（ext_json = '{"editLocked": true}'），随图保存，
-- 换电脑/换浏览器打开同一张图也是锁定的。
--
-- 为什么不用保存函数：锁定是**视图/权限**类元数据，不占版本号；
-- 前端走一次 REST update 直接写这一列（和「图库改标签」同一条路径），
-- 不需要改 arch_save_diagram / arch_patch_diagram。
--
-- 不跑这个补丁也不会坏：读不到 ext_json 就当作未锁定，锁定按钮退回本地状态。
-- 幂等：可重复执行。
-- =====================================================================

alter table public.arch_diagram
  add column if not exists ext_json jsonb not null default '{}'::jsonb;

comment on column public.arch_diagram.ext_json is
  '图级扩展字段，目前只放 {"editLocked": bool}（全局锁定编辑），不参与版本号';

notify pgrst, 'reload schema';

-- 校验：列是否存在（期望 1 行）
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'arch_diagram'
  and column_name = 'ext_json';
