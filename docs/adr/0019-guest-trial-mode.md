# ADR-0019：游客试用（不登录、数据只存本机）

日期：2026-11-05
状态：已采纳
相关：ADR-0004（浏览器直连 Supabase）、ADR-0014（Pages 登录闸门）

## 背景

站点发布在 GitHub Pages 上，RLS 收到 `authenticated`，所以不登录什么都看不到 —— 想看一眼效果的人被登录页挡住了。用户要求：**不登录也能进图库和编辑，数据存 localStorage，不落库**。

## 决策

登录页加一个次要按钮「不登录，先试用」，进入**游客模式**：

- 图库、画布、属性面板、分组、连线、导入导出、撤销重做**全部可用**（不做功能阉割，减少分支）
- 所有读写走 `guestRepo`（localStorage），**0 次 Supabase 请求**
- 顶栏账号区换成「本机」胶囊 + 登录按钮，顶部常驻一条黄色横幅说明数据只在这台电脑
- 上限：最多 20 张、单张 1.5MB；写不进去（配额满/隐私模式）报错而不是静默丢
- 版本历史关闭（配额撑不住快照），点了给 toast 说明；草稿机制也不启用（数据本来就在本机）
- 登录后弹一次询问：要不要把本机的图导入账号（重编 id，导入成功清本机副本，问过一次就不再打扰）

## 为什么不用「Supabase 匿名登录」

1. 数据**还是会落库**，直接违背需求；
2. 要给 anon 用户加 RLS 策略，等于把「收紧到 authenticated」这件事又开一个口子；
3. 匿名会话刷新即换人（除非持久化 token），图找不回来；
4. 匿名数据要定期清理，否则库会脏。

## 实现

- `data/guestSession.ts`：模块级 zustand `{ guest, enter, exit }` + `isGuestMode()`，flag 存 `arch:guest:on`，跨标签页同步（`storage` 事件）。用模块级 store 而不是 props，是因为 `diagramRepo` / `usePersistence` 这些非组件模块也要判断模式。
- `data/guestRepo.ts`：和 `diagramRepo` **同名同签名的 11 个函数**（list/load/save/patch/create/rename/duplicate/delete/tags/persistExt + 迁移辅助）。存储布局：
  - `arch:guest:index` 图列表（卡片元数据）
  - `arch:guest:d:<id>` 整张图，就是导出的那份 JSON
  - `arch:guest:asked` 已经问过导入
- `data/diagramRepo.ts`：每个函数开头一行 `if (isGuestMode()) return guest.xxx(...)` 分派，调用点零改动。
- `data/usePersistence.ts`：`runSave` 对游客走整图写盘（不 diff、不重定基、不判版本冲突），成功照常 `applySaved`；草稿写入在游客下跳过。
- `data/snapshotRepo.ts`：游客 `listSnapshots` 返回空。
- `components/GuestBanner.tsx` / `GuestAccount.tsx` / `GuestImportDialog.tsx`；`App.tsx` 的登录闸门改成 `signed-out && !guest` 才拦。

## 已知取舍

- 图的 `extJson`（全局锁定编辑）不在 `diagramSchema` 里，Zod 会剥掉；云端由 `assembleDiagram` 单独取回，本机在 `readBody` 里补回来 —— 否则「锁定编辑」刷新一次就自己解锁。
- 游客不做增量保存：整图写 localStorage 的耗时远低于维护 diff 的成本。
- 导入账号必须重编 id（复用 `reissueIds`）：游客图的 id 是本机生成的，撞上云端已有 id 会被 `arch_save_diagram` 当成更新别人的图。
- 卡片点击命中区的问题（卡片中间被标签/操作行覆盖）是既有行为，与游客无关。
