# ADR-0004：不建自建后端，前端直连 Supabase

- 状态：已采纳
- 日期：2026-11-04
- 关联：技术规格 §2、§7、§9；阶段计划 D5、D6

## 背景

规格 v1.0 画的是「浏览器 → API Service（Fastify）→ Postgres」三段式，§7 定义了 13 个 HTTP 接口。你的决定是：**与同目录的 toolbox 项目保持同一套配置与架构**——浏览器用 anon key 直连 Supabase，本地直接连真实库、不起本地数据库镜像。

## 决策

1. **删除自建后端**（`apps/api` 整个移除，含 Fastify、`pg`、`/api/health`、迁移执行器）。
2. **数据访问**：`@supabase/supabase-js`，用 `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`（后者会打进前端包，不是机密）。唯一入口是 `apps/web/src/data/diagramRepo.ts`。
3. **多表写入必须是一个事务**：因此写库不走"前端连发四条 PostgREST 请求"，而是调用 Postgres 函数 `arch_save_diagram(p_payload jsonb, p_base_version int)`——一次 RPC 内完成版本校验、三表 upsert、差集软删、`version+1`、条件快照。函数定义在 `supabase/schema.sql`（M2 落地）。
4. **权限**：5 张 `arch_*` 表启用 RLS，对 `anon` / `authenticated` 放行读写；授权语句只覆盖本项目的 5 张表，不影响库里 toolbox 的对象。
5. **建库**：`supabase/schema.sql` 全文粘进 Supabase SQL Editor 执行，可重复执行（toolbox 同款）；不再有编号迁移与迁移记录表。
6. **健康检查**：`npm run check:db`（REST 层自检）+ 前端顶部栏探针，取代 `/api/health`。

## 代价与应对

| 代价 | 说明 | 应对 |
|---|---|---|
| **anon key 公开** | 它本来就在前端包里；toolbox 的 key 已公开在 GitHub Pages 上，而两者共用同一个 Supabase 项目。任何拿到地址的人都能读写 `arch_*` | 明确接受：本工具内网使用，图内数据按"内部可见"处理。要收紧时加 Supabase Auth（邮箱密码）+ 把 RLS 从 `using (true)` 改为按 `creator_id`，前端改两处即可，**不需要改回三段式架构** |
| 规格 §7 / §9 的接口清单作废 | HTTP 契约、状态码、`{code,message,data}` 响应包不再存在 | 契约改由「TypeScript 类型 + zod schema + Postgres 约束」三层共同保证；错误从 `error.message` / SQLSTATE 拿 |
| 复杂逻辑要用 plpgsql 写 | 保存/回滚/快照的编排从 TS 挪到 SQL | 只把**事务性**部分放进函数；校验、diff、几何仍留在 TS（`@arch/schema` 已被单测覆盖） |
| 没有服务端，PDF 导出受限 | 浏览器打印中文需字体支持 | 阶段 3 先做 PNG/SVG/CSV；PDF 放到阶段 4 验证，不达标就改用本地脚本，不影响主流程 |
| 需要在 SQL Editor 手工执行建库 | 不能 `npm run db:migrate` | 已用一次性容器验证过 SQL 可执行；`schema.sql` 幂等 + 撞名自检，重复粘贴安全 |

## 仍然保留的规格约束

- 列名、类型、默认值、CHECK、索引与 §7.3 一致（只有对象名加了 `arch_` 前缀，见 ADR-0003）。
- Schema 仍是唯一事实来源：`@arch/schema` 的 `types.ts` / `zod.ts` / `validate.ts` 同时被 UI、导入导出、持久化前校验使用。
- V9/V10（引用完整性）在保存前于前端执行；数据库侧用外键 + CHECK 兜底。

## 影响

- 部署形态变为**纯静态产物**：`npm run build` → `dist/`，任意静态托管 + SPA 回退即可。
- 不再需要 `DATABASE_URL`、连接池、服务端 CORS 与端口 3000。
- 本地开发只需 `npm run dev`（单个 Vite 进程，端口 5273）。
