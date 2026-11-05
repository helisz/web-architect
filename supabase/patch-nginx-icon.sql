-- ====================================================================
-- 把 nginx 的旧图标 key 统一刷成自绘的「方框 N」
--
-- 背景（用户 2026-11-05）：
--   原来 nginx 用的是品牌库的整词 wordmark（devicon:nginx），字太小认不出。
--   现在统一换成项目里手绘的 `arch:nginx`（绿色六边形 + 白色 N）。
--   前端已经做了兜底：老的 key 在渲染时会被映射成 arch:nginx，
--   所以**不跑这个脚本也不会显示旧图标**；跑它是为了让库里的数据也干净，
--   这样以后导出 JSON、换客户端、或者按 key 搜图标都不会再碰到旧值。
--
-- 执行方式：Supabase Dashboard → SQL Editor → 整段粘贴执行。
-- 幂等：可以重复跑，第二次影响 0 行。
-- ====================================================================

-- 1) 节点：arch_node.ext_json.iconKey
update public.arch_node
   set ext_json = jsonb_set(coalesce(ext_json, '{}'::jsonb), '{iconKey}', '"arch:nginx"')
 where ext_json ->> 'iconKey' in (
         'devicon:nginx',
         'logos:nginx',
         'simple-icons:nginx',
         'cib:nginx',
         'fa6-brands:nginx'
       );

-- 2) 分组：arch_group.ext_json.iconKey（nginx 预设分组会带图标）
update public.arch_group
   set ext_json = jsonb_set(coalesce(ext_json, '{}'::jsonb), '{iconKey}', '"arch:nginx"')
 where ext_json ->> 'iconKey' in (
         'devicon:nginx',
         'logos:nginx',
         'simple-icons:nginx',
         'cib:nginx',
         'fa6-brands:nginx'
       );

-- 注意：这里不碰 arch_diagram.ext_json（那是画布设置，没有图标）。

-- --------------------------------------------------------------------
-- 自检：下面两条查询都应该返回 0
-- --------------------------------------------------------------------
select 'arch_node 里还有旧 nginx key' as check_name, count(*) as remaining
  from public.arch_node
 where ext_json ->> 'iconKey' in ('devicon:nginx', 'logos:nginx', 'simple-icons:nginx', 'cib:nginx', 'fa6-brands:nginx')
union all
select 'arch_group 里还有旧 nginx key', count(*)
  from public.arch_group
 where ext_json ->> 'iconKey' in ('devicon:nginx', 'logos:nginx', 'simple-icons:nginx', 'cib:nginx', 'fa6-brands:nginx');

-- 顺带看一眼现在用 arch:nginx 的元素有多少（应该 > 0，如果你有 nginx 节点/分组）
select 'arch_node 用 arch:nginx' as check_name, count(*) as total
  from public.arch_node
 where ext_json ->> 'iconKey' = 'arch:nginx'
union all
select 'arch_group 用 arch:nginx', count(*)
  from public.arch_group
 where ext_json ->> 'iconKey' = 'arch:nginx';
