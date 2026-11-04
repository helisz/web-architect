# 架构拓扑绘图工具（web-architect）

面向运维 / 架构 / 售前场景的**结构化架构拓扑编辑器**：像 n8n 一样拖拽连线，产物是可入库、可检索、可版本化的 JSON 资产。

- 技术规格：`docs/架构拓扑绘图工具-技术规格-v1.0.md`
- 阶段计划与 MVP 边界：`docs/阶段实施计划.md`
- 关键决策记录：`docs/adr/`

**架构**：React 18 + Vite + TypeScript + Tailwind v4 + ReactFlow 12 + Zustand，**没有自建后端** —— 浏览器用 anon key 直连 Supabase（PostgREST + RLS），写库走 Postgres 函数保证事务。配置方式与同目录的 toolbox 项目一致（见 [ADR-0004](docs/adr/0004-no-backend.md)）。

## 当前进度

| 阶段 | 状态 |
|---|---|
| 阶段 0 · 工程地基 | ✅ 完成（建库 SQL 已在 Supabase 执行，`check:db` 全绿） |
| 阶段 1 · MVP · **M1 画得出来** | ✅ 完成：拖入建节点、四边连线、拖动/删除、缩放平移、MiniMap |
| 阶段 1 · MVP · M2 改存得住 | ✅ 完成：属性面板、双击改名、拖拽改尺寸、撤销重做、分组泳道（嵌套/折叠）、自动保存与冲突处理 |
| 阶段 1 · MVP · M3 交得出 | ✅ 完成：JSON 导出/导入、PNG 2× 导出、使用说明 |
| 阶段 2 · 完整编辑器 | 未开始 |
| 阶段 3 · 版本 / 导出 / 图库 | 未开始 |
| 阶段 4 · 打磨交付 | 未开始 |

> 按确认结果，规格 §10 的 **AI 生成能力整章裁除**，不在任何阶段实现。

## 快速开始

### 1. 建表（一次性，不用本地数据库）

打开 Supabase Dashboard → 选中项目 → **SQL Editor** → New query → 粘贴 [supabase/schema.sql](supabase/schema.sql) **全文** → Run。

这一段会建好 5 张 `arch_*` 表、约束、索引、`updated_at` 触发器、RLS 策略与授权，**以及保存函数 `arch_save_diagram`**，**可重复执行**（改表后重跑一遍即可补齐）。文件名段有撞名自检：若这些名字已被别的项目的表占用，会直接报错停下，不会静默复用。

> 保存函数存在与否可以用 `npm run check:db` 一眼看出来：最后一项「arch_save_diagram 函数可用」不通过，就说明 SQL 只跑了建表、没跑到函数段（第 9 段）。

> 与 toolbox 共用同一个 Supabase 项目也没问题：本项目所有对象都是 `arch_` 前缀，授权语句只覆盖这 5 张表。

### 2. 配置环境变量

```bash
copy .env.example .env.local      # Windows
# cp .env.example .env.local      # macOS / Linux
```

填两项（这两个值本来就会打进前端包，不是机密；安全边界全在 RLS）：

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

取法：Supabase Dashboard → **Settings → API** → `Project URL` / `anon public` key。
**不要**用 `service_role` key —— 它能绕过所有 RLS。

### 3. 开发

```bash
npm install
npm run dev        # http://127.0.0.1:5273
npm run check:db   # 另开一个终端：验证建表与 RLS 是否就绪
```

`check:db` 全绿说明：项目可达、5 张表已建、anon 可读写、CHECK 约束生效。

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发（单进程，端口 5273） |
| `npm run typecheck` | 全量类型检查 |
| `npm test` | `@arch/schema` 单测（43 条：V1–V10、正交路由、往返转换） |
| `npm run build` | 生产构建到 `apps/web/dist` |
| `npm run check:db` | 数据库连通性 / RLS 自检 |

## 目录结构

```
web-architect/
├─ supabase/schema.sql            # ★ 建库唯一来源：5 张 arch_* 表 + 约束 + RLS
├─ scripts/check-db.mjs           # npm run check:db
├─ packages/schema/               # ★ 单一事实来源：类型 / 常量 / Zod / 校验 / 工厂 / 映射 / 正交路由
│  ├─ src/{types,constants,zod,validate,factory,convert,geometry,ortho}.ts
│  └─ fixtures/sample-saas.json   # 回归基线样图
├─ apps/web/
│  └─ src/
│     ├─ lib/{env.ts,supabase.ts}         # 环境自检 + Supabase 客户端
│     ├─ data/{diagramRepo.ts,useDbStatus.ts}  # 唯一读写入口 + 连通性探针
│     ├─ components/{TopBar,ComponentPanel,CanvasShell,StatusBar,StartupError}.tsx
│     ├─ store/useDiagramStore.ts
│     └─ styles/index.css
└─ docs/{规格, 计划, adr/}
```

## 数据库对象命名

与 toolbox 共用同一个库，所有对象统一 `arch_` 前缀（列名/类型与规格 §7.3 完全一致）：

| 规格表名 | 本库表名 |
|---|---|
| `architecture_diagram` | `arch_diagram` |
| `diagram_group` | `arch_group` |
| `diagram_node` | `arch_node` |
| `diagram_edge` | `arch_edge` |
| `diagram_snapshot` | `arch_snapshot` |

索引 `arch_idx_*`、约束 `arch_ck_*`、触发器 `arch_tg_diagram_touch`、函数 `arch_touch_updated_at()` 同前缀；表名在 `@arch/schema` 的 `TABLES` 常量里，代码中不写裸表名。

## 节点图标规则

节点**只存图标 key**，写在 `extJson.iconKey`，**不存 base64、不存 url**（图标本体由前端按 key 查表渲染）。

允许集合共 16 个 key，32 个节点类型全覆盖，完整表见 [节点图标映射表](docs/节点图标映射表.md)。常用几个：

| nodeType | iconKey | | nodeType | iconKey |
|---|---|---|---|---|
| `waf` / `firewall` | `tabler:shield-lock` | | `server` | `tabler:server` |
| `vip` | `tabler:plug-connected` | | `vm` | `tabler:server-2` |
| `nginx` | `devicon:nginx` | | `container` | `tabler:box` |
| `k8s-cluster` | `devicon:kubernetes` | | `switch` | `tabler:network` |
| `pod` | `cncf:pod` | | `subnet` | `tabler:route` |
| `db` / `cache` / `mq` / `oss` | `tabler:database` | | `lb` / `proxy` / `ingress` / `gateway` | `tabler:arrow-right-square` |
| `external` | `tabler:world` | | `text` / `legend` | `tabler:text` |
| `router` | `tabler:router` | | `group` / `zone` / `custom` | `tabler:cube` |

- `createNode()` 自动写入，调用方不用管；
- 合法的自定义 key **原样保留**（M2 属性面板的图标选择器可直接改），只有缺失 / 非法 / `data:` / url 才会被 V11 修复；
- 详见 [ADR-0005](docs/adr/0005-node-icon-key.md)。

## 与规格的偏差（均记录在 ADR）

| 偏差 | 原因 |
|---|---|
| 删除 §10 AI 生成全章 | 你的决定：不做 AI，也不预留接口 |
| 删除自建后端（§7 HTTP API 不再实现） | 与 toolbox 同构，直连 Supabase；写库走 Postgres 函数（ADR-0004） |
| 节点类型不直接用 `nodeType` 作 ReactFlow 类型名 | `group` / `default` 与内置类型冲突（ADR-0001） |
| `toSchema` 不做绝对坐标换算 | 规格 §11.1 的 `abs()` 与 §6.2「组内节点用局部坐标」矛盾（ADR-0001） |
| 表名等对象加 `arch_` 前缀 | 与另一项目共用同一个 Supabase 实例（ADR-0003） |
| npm workspaces 代替 pnpm | 本机 pnpm 12 的全局锁目录被系统权限拒绝，与代码无关（ADR-0002） |
| Web 端口 5273 | 5173 在开发机上被其它项目占用 |

## 启动报错？

缺 `VITE_SUPABASE_*` 时页面不白屏，而是显示「启动失败」+ 缺了哪几个变量 + 三步修复。
若 `check:db` 报「表不存在」，说明 `schema.sql` 还没跑；报「RLS 拦住 anon」，重跑 `schema.sql` 的第 8 段即可。

> 改了 `.env.local` 必须**重启** `npm run dev`：Vite 只在启动时读取 `import.meta.env`。

## 现在能做什么

- 从左侧面板**拖组件到画布**建房（按分类自动带默认尺寸与副文本）
- 选中节点后，从四边的小圆点**拖出连线**到另一个节点的任意边，自动走正交折线（拐点 4px 圆角）
- 拖动节点、Delete 删除节点或连线、滚轮缩放（10%–400%）、空格拖拽平移、MiniMap 导航
- 点击画布空白处取消选中；状态栏实时显示节点/连线/分组数量与缩放比例

> 当前刷新页面会丢内容：落库是 M2 的内容（走 `arch_save_diagram` 这个 Postgres 函数，一次调用一个事务）。

## M2 已交付（2026-11-04）

1. 右侧属性面板：节点（名称/副文本/尺寸/三色/图标/锁定/隐藏）、连线（颜色/线宽/虚线/标注/线型/箭头）、分组（名称/尺寸/三色/折叠/删除）；图标支持从 7400+ 个 Iconify 图标里搜索选择
2. 双击行内改名（节点与分组标题）、拖拽 resize（写回 width/height，走 C3）
3. 分组泳道：拖入拖出自动换算局部坐标、整体拖动子元素不漂移、嵌套 ≤3、折叠保留数据、删除分组不删内容
4. 命令栈：`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`，栈深 50，同一手势合并为一步
5. 存库：`arch_save_diagram` RPC（一次调用 = 一个事务）+ 800ms 防抖 + 串行队列 + 版本冲突提示（重新载入 / 覆盖保存）

## M3 已交付（2026-11-04）

1. 导出 JSON：自描述格式（不含 `version`），可直接给别的实例导入
2. 导出 PNG：2× 分辨率、包围盒裁剪、40px 白边；导出前自动取消选中，描边与手柄不入图
3. 导入 JSON：补结构 → 校验 → 整体重编 id（组归属与连线端点同步改写）→ 作为新图打开并落库；不合法处降级修复并给出提示
4. `docs/使用说明.md`：启动、建图、分组、保存与冲突、导入导出、故障排查、快捷键

## 下一步（阶段 1 收尾）

1. 按规格 §4.3 的 A1–A4、A7、D1、D2、D4、D6 逐条过验收门（每项留证据）
2. 用 `sample-saas.json` 复刻一张完整样图，作为导出与验收的基准
3. 收尾：README 截图更新、`.env.example` 补齐

## 开发约定

- **每批改动完成后都要提交并推送到 `origin/main`**（本项目的规定动作，不要攒着）。
- 提交信息写清楚"改了什么 + 为什么"，测试/验收结论附在正文里。
- `.env.local`、`.cache/`、`dist/` 不入库；新增数据库对象一律 `arch_` 前缀。


