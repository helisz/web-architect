# ADR-0014 发布到 GitHub Pages：子路径、手动发布与登录闸门

- 日期：2026-11-04
- 状态：已采纳
- 相关：ADR-0004（无自建后端）、ADR-0003（表前缀）、`supabase/patch-auth-rls.sql`、`deploy/pages.env`、`.github/workflows/pages.yml`

## 背景

用户 2026-11-04 第三批：「写 github pages 配置，然后发布到 pages 去。」

仓库是 public（`helisz/web-architect`），Pages 站点因而也是公开的。而这份应用原来假设
"匿名 anon key 直连 + RLS 对 anon 全开"（ADR-0004）：只要拿到 anon key（它必然随前端 JS 包公开），
任何人都能读、改、删 `arch_*` 里的全部图。追问后用户选择：

1. **先收紧 RLS 到登录用户，再发布**；
2. 构建凭据用**仓库内公开配置**（`deploy/pages.env`），不必先去 Settings 配 Secrets。

## 决策

### 1. 子路径用 `VITE_BASE_PATH` 显式指定

Pages 项目站点在 `/<repo>/` 下，资源前缀必须是 `/web-architect/`。`vite.config.ts` 读
`process.env.VITE_BASE_PATH ?? '/'`：本地开发仍是 `/`，CI 里由工作流传
`VITE_BASE_PATH=/${{ github.event.repository.name }}/`（**按仓库名算，改名不用改代码**）。

哈希路由在这里帮了大忙：所有页面都在 `#/...` 之后，所以不需要 404 兜底页、
不需要 SPA 重写规则 —— `index.html` 一个文件就够了，刷新、分享链接都对。

### 2. 发布是手动动作（workflow_dispatch），不跟 push 走

`on: workflow_dispatch` 是有意的：站点一旦上线就是公开的，而 RLS 的收紧只能由管理员在
SQL Editor 里做（service_role 才能跑 DDL）。如果跟 push 走，会存在"站点已公开、权限还全开"
的窗口，正好违背用户选的顺序。

发布顺序因此是固定的三步（写在 `pages.yml` 头部注释和运行手册里）：

1. 跑 `supabase/patch-auth-rls.sql`；
2. Dashboard → Authentication → Providers → Email → 关掉 *Allow new users to sign up*；
3. Actions → Deploy to GitHub Pages → Run workflow。

### 3. 登录闸门：只做登录，不做注册

- `apps/web/src/lib/auth.ts`：`useAuth()` 管会话（`getSession()` + `onAuthStateChange`），
  `signInWithPassword()` 登录，报错翻成中文（"邮箱或密码不对" / "没激活邮箱" / "连不上"）。
- `components/LoginPage.tsx`：邮箱 + 密码 + 错误条 + "账号找管理员要"的一行说明。
- `App.tsx`：`loading` → 启动页；`signed-out` → 登录页（**图库也不渲染**，一个数据请求都不发）；
  `signed-in` → 原来的三栏。
- 顶栏最右：圆形首字母 + 下拉里的"退出登录"。

不提供注册的理由：公开站点 + `authenticated` 全开 = 谁都能注册再改图。
关掉 signup 之后，能登录的只有**项目里已经存在的账号** —— 也就是 toolbox 在同一
Supabase 项目里建的那些 Auth 用户（Supabase Auth 用户是项目级的，同一个邮箱密码
两个应用都能登），所以不需要为这张图单独维护一套账号。

### 4. RLS 收到 authenticated（`patch-auth-rls.sql`）

- 表权限：`revoke all ... from anon`，只 `grant select/insert/update/delete ... to authenticated`；
- 函数权限：用 `DO` 块遍历 `public.arch_%` 的全部函数，`revoke from anon, public` +
  `grant to authenticated`（将来加函数不会漏）；
- 策略：5 张表各一条 `for all to authenticated using (true) with check (true)`；
- 末尾 `notify pgrst, 'reload schema'` + 两条自检查询。

**没有**做按用户隔离（没有 owner 列）：一个团队共用一个账号，谁都能改所有图 ——
与工具箱一致。真要做多租户隔离是另一件事（5 张表加 owner + 策略改造）。

### 5. 构建凭据放仓库里

`deploy/pages.env` 写了 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`。
这两个值本来就会进前端包（F12 可见），不是机密；权限边界是 RLS，不是这个 key。
工作流把它 `cp` 成 `.env.production`；如果以后在 Settings → Secrets 配了同名项，
则追加到 `.env.production.local` 覆盖（Vite 的 `.local` 优先级最高），换项目不用改代码。

另外加了一步 `grep supabase.co apps/web/dist/assets/*.js`：环境变量没进去就立刻失败，
而不是等用户打开线上页面看到 `StartupError`。

## 代价与遗留

- 每次发布要手动点一下 Run workflow（换来的是"先收权限再上线"）。
- 子路径写死在 CI 里；将来绑自定义域名（`base` 应为 `/`）需要改工作流那一行。
- 登录只有邮箱 + 密码：如果 toolbox 那边有人是**只走魔法链接**、从没设过密码，
  得先在 Dashboard 给他设一个密码（或者以后支持魔法链接登录）。
- 站点公开可访问（登录页可见），且 anon key 公开 —— 安全边界完全依赖
  `patch-auth-rls.sql` 已执行 + signup 已关闭，这两项都是**人工步骤**，文档里反复强调。
