# ADR-0012 连线：改用 React Flow 官方折线路由、虚线三档、分组作为端点

- 日期：2026-11-04
- 状态：已采纳
- 相关：ADR-0011（端点贴边框、箭头固定尺寸）、`supabase/patch-edge-group-endpoints.sql`

## 背景

用户 2026-11-04 反馈三件事：

1. 「连线还是怪异，走线有时候会绕圈、有时候会偏斜。你看下 plugin reactflow 默认策略是怎么样的」
2. 「连线可以配置实线、短虚线、长虚线，默认实线」
3. 「分组也可以连线」

第 1 条是根因问题：端点贴边框已经修好，剩下的怪相来自**自研折线路由** `packages/schema/src/ortho.ts`
（`buildOrthoPath`）：它会为躲开中间节点把通道平移到"最近的可通行空隙"，再对同侧出线做"绕联合包围盒"，
于是出现了多余的折角（视觉上的绕圈）和几像素的错位（视觉上的偏斜）。

## 决策

### 1. 正交线型改用官方 `getSmoothStepPath`

`ArchEdge` 的三种线型全部走 React Flow 官方生成器：`getSmoothStepPath`（默认 `offset=20`、
`borderRadius=5`、`stepPosition=0.5`）、`getBezierPath`、`getStraightPath`。

保留上一批的**端点贴边框**（用"节点矩形 + 锚点"自算端点，绕开 RF 对 handle DOM 的测量），
所以这次只换路径生成，不动端点语义。

同时下线：

- `packages/schema/src/ortho.ts`（`orthoPoints` / `toRoundedPath` / `buildOrthoPath`）与其 23 条测试；
- `flowMapping.visibleObstacles` 与 `toFlowEdges` 的 obstacles 参数、`Canvas` 里的
  `frozenObstacles` / `liveObstacles` / `edgeObstacles` 冻结机制 —— 既然不再绕障碍，
  每帧扫一遍节点算矩形纯属浪费。

旧实现留在 git 历史（`301d75a` 及以前），需要时可取回。

**代价**：不再主动躲开中间节点。测试同一张图里"右→左 / 右→右 / 下→上"三种组合，
路径全部为轴对齐，同侧出线只画一小段 U —— 与 RF 内建线型的观感一致，符合用户
"照插件默认来"的要求。

### 2. 虚线收敛为三档

`EDGE_DASH_PRESETS`：实线（`null`，默认）/ 短虚线（`6 4`）/ 长虚线（`12 8`）。
属性面板原来是下拉（含点线 `2 3`、点划线 `12 4 2 4`），现在换成三个按钮。

兼容：老数据里的自定义值不静默改写，`dashPresetOf` 把它归到 `custom`，面板提示
「当前是自定义虚线（值）」，点任一档才覆盖。

### 3. 分组作为连线端点

- Schema/DB：`arch_edge.source_node_id` / `target_node_id` 现在可以存 `arch_group.group_id`
  （两者共用一套 uuid 空间）。原 DDL 把这两列外键到 `arch_node`，必须去掉——
  一个 uuid 列没法同时外键到两张表。新增幂等脚本 `supabase/patch-edge-group-endpoints.sql`，
  老库跑一次即可；`schema.sql` 已同步（新库不再建这两个外键）。
- 一致性改由应用层维护（因为外键没了）：
  - `applyDeletion`（多选/删分组）过滤掉端点在待删分组里的连线；
  - `removeGroup` / `ungroup` 同样清掉挂在被删分组上的连线；
  - 载入时 Schema 校验 V2 允许端点是分组，端点是"既非节点也非分组"的悬空连线仍被丢弃。
- UI：`SwimlaneNode` 增加四边 `source` Handle（id 即锚点名，复用 `.arch-handle` 样式，
  平时透明、移到分组上显形；锁定的分组不给手柄）。配合既有的 `ConnectionMode.Loose`，
  分组 ↔ 分组、分组 ↔ 节点都能拖。折叠父组时子组的连线会跟着隐藏（与节点一致）。
- 导出 CSV 的端点名称支持分组，标成「分组名（分组）」。

## 影响

- 交互动线更简单：**所有线型都由 RF 官方函数生成**，自定义只剩端点定位与箭头 marker。
- 需要在 Supabase 跑一次 SQL 才能保存分组连线；没跑之前**不会**破坏已有数据
  （只是插入新连线时被外键拒绝，保存报错）。
- 少了一个 schema 模块与一套绕行测试（-23 用例）；新增 5 条虚线用例与 8 条分组连线用例。

## 未采纳的方案

- **保留绕行 + 调参数**：绕行能否好看取决于打分函数，反复调参仍会在"密集节点"和"两端同侧"
  两种场景翻车，且用户明确要求照插件默认行为。
- **给 arch_edge 加 source_kind 列**：能保留外键，但要改 payload / upsert / 差异 / 回滚全链路，
  还要用户重跑一遍完整 SQL；收益只是"数据库层面能挡住脏 id"，而应用层已经有 V2 兜底。
- **把分组连线做成独立的 arch_group_edge 表**：增加一套表与 RPC，连线样式/锚点/箭头要重复实现，
  在 Schema 里还得分两套边数组，复杂度远高于收益。
