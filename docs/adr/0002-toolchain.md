# ADR-0002：工具链与环境约定

- 状态：已采纳（v2：改为无后端后更新）
- 日期：2026-11-04
- 关联：阶段计划 §8 技术选型、ADR-0004

## 决策

| 项 | 规格建议 | 实际采用 | 原因 |
|---|---|---|---|
| 包管理 | （未指定） | **npm workspaces** | 本机 pnpm 12 的全局存储锁目录固定在 `%LOCALAPPDATA%\pnpm-store-operation-locks`，该目录被系统权限拒绝写入（与代码无关）。 |
| 运行形态 | 前端 + API 两进程 | **单前端进程** | 改为直连 Supabase（ADR-0004），不再有 API 进程与 3000 端口。 |
| Web 端口 | （未指定） | **5273**（`strictPort: true`，绑 `127.0.0.1`） | 5173 在开发机上被其它项目占用，自动 +1 会让地址不可预测。 |
| 环境变量文件 | `.env` | **`.env.local`**（`.env.example` 入库） | 与 toolbox 一致；`.gitignore` 用 `*.local` + `.env.*` + `!.env.example`。 |
| 环境变量名 | `DATABASE_URL` | **`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`** | 浏览器需要直接访问；两个值本就会打进前端包，安全边界在 RLS。**service_role key 绝不进前端**。 |
| 本地数据库 | 未指定 | **不跑本地数据库/容器** | 直连真实 Supabase 项目；`supabase/schema.sql` 粘进 SQL Editor 建表。 |
| React | 18 | **18.3.1** | 与规格一致；`@vitejs/plugin-react` 6 要求 Vite 8，React 18 仍在其支持范围内。 |
| TypeScript | 5 | **5.9.x** | 不使用 7.x（原生移植版），避免与现有类型生态的未知差异。 |
| Vite | （未指定版本） | 8.x | 当前稳定版；Tailwind 4 的 `@tailwindcss/vite` 与其兼容。 |
| 校验 | Zod | Zod 4 | 只用手写的字符串/正则校验器（UUID、颜色、ISO 时间），不依赖 `z.uuid()` 这类版本相关 API，行为稳定。 |
| 数据库 | PostgreSQL 14+ | **Supabase Postgres** | 按你的决定。列名与规格 §7.3 一致，对象名加 `arch_` 前缀（ADR-0003）。 |
| 缓存目录 | — | `.cache/`、`.npm-cache/`、`.tmp/` 落在工作区内 | 沙箱环境不允许写用户目录；均已在 `.gitignore` 中。 |

## 关于 Supabase 连接

- 前端只持有 anon key；`supabase-js` 走 PostgREST（HTTP），不走 5432 直连，因此不受 Direct 连接只有 IPv6 的影响。
- 免费档项目闲置会自动暂停：恢复后页面刷新即可，无需改配置。
- 与 toolbox 共用同一个项目：**可以**复用它的 `VITE_SUPABASE_URL` 与 anon key，但**不要**在两个项目间共用同一张表——本项目对象全部 `arch_` 前缀。

## 影响

- 根 `package.json` 使用 `workspaces`；包间依赖写 `"@arch/schema": "*"`。
- 部署只需静态托管 `apps/web/dist`（配 SPA 回退）。
- 若后续需要服务端能力（PDF 生成、AI、定时任务），再单独加一个轻服务，不改变现有数据访问层。
