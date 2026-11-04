# ADR-0015 每人只看自己的图：用 `creator_id` 当归属，服务端强制

- 日期：2026-11-04
- 状态：已采纳
- 相关：ADR-0014（登录闸门）、`supabase/patch-per-user-rls.sql`、`scripts/check-rls.mjs`

## 背景

ADR-0014 只解决了"陌生人不许进"：登录即可，权限是 `for all to authenticated using (true)`。
用户随后问"不同用户登录进去看到的图不一样吧"，答案是否 —— 所有人共用一个池子，
toolbox 的同事只要登录就能读改删全部 `arch_*` 行。

表里其实早有 `creator_id`，但从没写过真实用户：前端固定发 `'local-user'`
（`DEFAULT_CREATOR_ID`），保存函数照抄 payload。图库也不按人过滤。

用户选择 **A：每人只看自己的**（明确接受"不能协作"这个代价）。

## 决策

### 1. 归属由数据库决定，不由客户端声明

`arch_diagram` 上加 BEFORE INSERT/UPDATE 触发器 `arch_force_owner()`：

- INSERT：`auth.uid()` 存在时，`new.creator_id := auth.uid()::text`；
- UPDATE：有 JWT 时 `new.creator_id := old.creator_id`（归属不可改、不可认领）；
- 没有 JWT 时（SQL Editor / service_role 迁移）保持原值 —— 迁移脚本要靠这个。

为什么不改 `arch_save_diagram`（200 行 plpgsql）：触发器一处生效，覆盖保存、补丁、
导入、将来任何直连写入，且不用把那段函数体抄一遍。前端也因此**不需要知道自己的 uuid**。

### 2. 策略按归属判定，子表用 EXISTS 看父表

```sql
-- 主表
create policy arch_diagram_own on public.arch_diagram
  for all to authenticated
  using (creator_id = auth.uid()::text)
  with check (creator_id = auth.uid()::text);

-- 4 张子表（group/node/edge/snapshot）同构
create policy arch_node_own on public.arch_node
  for all to authenticated
  using (exists (select 1 from public.arch_diagram d
                 where d.diagram_id = arch_node.diagram_id
                   and d.creator_id = auth.uid()::text))
  with check (exists (…same…));
```

子表必须一起收：只藏主表的话，任何人仍能 `GET /rest/v1/arch_node?diagram_id=eq.<别人的图>`
把节点全读走 —— 图名藏住了，内容没藏住。

重建前用 DO 块把 `public.arch_*` 上的旧策略**全部** drop（不靠猜策略名），
所以之前 `arch_*_all` 那套、`patch-auth-rls.sql` 重建的那套都会被清掉，不会叠加。

### 3. 存量图要迁移，否则谁都看不见

老图的 `creator_id` 都是 `'local-user'`。策略生效后它们对所有人不可见（包括作者本人），
所以补丁里带一段迁移：

```sql
update public.arch_diagram d
set creator_id = u.id::text
from auth.users u
where u.email = 'YOUR_EMAIL@example.com'
  and d.creator_id = 'local-user';
```

用邮箱而不是 uuid，省得去 Dashboard 复制。**必须先改这一行的邮箱再跑整份文件**，
不跑就是"图不见了"（不是丢了，是看不见）。

### 4. 前端只改两处文案，不加权限逻辑

RLS 已经把列表和读取都过滤掉了，前端不需要"按用户查询"。改的是两处容易误会的提示：

- 图库空状态：说明"图库只显示你自己创建的图"；
- 打开别人的图：`loadDiagram` 拿到 `null`，提示改成"这张图不存在，**或者不是你创建的**"。

### 5. 自检脚本 `npm run check:rls`

用 `SMOKE_EMAIL` / `SMOKE_PASSWORD` 登录后验证 5 件事：能登录、匿名读被拒、
自己的图每行 `creator_id` 都是自己、按"不是自己"过滤读不到任何行、
子表（节点）不会泄漏别人的图。加 `--write`（`npm run check:rls:write`）再验一条：
伪造 `creatorId` 调保存函数，库里归属仍是自己，跑完自动删掉探针图。

## 代价

- **不能协作**：同一张图两个人不能同时看/改；分享方式退化为"导出 JSON 发给对方导入"
  （对方得到的是自己名下的一份副本，此后两条线各自演进）。
- 已有图的归属是一次性人工迁移；将来若要做"团队共享"，需要 ADR 里的方案 B
  （`arch_diagram_share` 表 + owner/成员双条件策略 + 分享 UI），本文件不预留。
- `creator_id` 是 `varchar(64)` 存 uuid 文本，没有外键到 `auth.users`：
  账号删除后图还在（归属变成孤儿）。这是有意的 —— 删账号不该连带删图。
