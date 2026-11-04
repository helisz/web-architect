# ADR-0007：规格分歧 C1–C15 的定案与落地位置

- 状态：已采纳（2026-11-04）
- 相关：ADR-[0001](0001-schema-reactflow-mapping.md)、[0004](0004-no-backend.md)、[0005](0005-node-icon-key.md)、[0006](0006-export-and-perf-tradeoffs.md)

## 背景

实现过程中发现规格 v1.0 有 15 处内部不一致或与平台能力冲突（编号 C1–C15，最早的清单散落在
[`../阶段实施计划.md`](../阶段实施计划.md) 的表格里）。这份 ADR 把它们**收拢成一页**，写清
"最后怎么定的"和"写在哪个文件里"，避免以后翻聊天记录。

表中的"状态"只有三种含义：
- **按规格实现**：规格没问题，照做；
- **改写后实现**：规格有笔误/冲突，按右列结论实现；
- **已消解**：后续需求变化让这条不再是问题（例如 AI 能力整章裁除）。

## 定案表

| # | 规格原文位置 | 冲突/风险 | 定案 | 落地位置 | 状态 |
|---|---|---|---|---|---|
| C1 | §11.1 `toSchema` 的 `abs()` | 注释要求"相对父组的局部坐标"，`abs()` 却返回绝对坐标 | 分组/节点直接取 `position`（局部坐标），**删掉 `abs()`**；绝对坐标只用于导出、命中判定、标签定位 | `apps/web/src/canvas/flowMapping.ts`、`packages/schema/src/geometry.ts` | 改写后实现 |
| C2 | §11.1 `type: n.nodeType` | 32 种 `nodeType` 当 ReactFlow 类型会与内置 `group`/`default` 撞名，且要注册 32 个组件 | 统一单一组件 `archNode`，真实类型放 `data.nodeType`；分组用 `archGroup` | `apps/web/src/canvas/ArchNode.tsx`、`flowMapping.ts` | 改写后实现 |
| C3 | §11.1 `zIndex: n.sort`、`Number(style.width)` | `style.width` 可能是 `"160px"` → `Number()` 得 NaN，污染 Schema | 尺寸只从 `node.width/height` 取；写入前 `Math.round` 并过校验器 | `flowMapping.ts`、`packages/schema/src/validate.ts` | 改写后实现 |
| C4 | §6.4 V4 | 后端无法判断"坐标是相对还是绝对" | 降级为启发式：节点矩形完全落在组外 → warning + 自动换算；严格保证由前端负责 | `packages/schema/src/validate.ts`（V4） | 改写后实现 |
| C5 | §10.3 vs §7.3 | edge `label` 上限 JSON Schema 40 / DDL 255 | AI 裁除后 JSON Schema 不再需要；以 255 为唯一硬约束，UI 提示 40 | `packages/schema/src/constants.ts`、属性面板 | 已消解 |
| C6 | §9.1 vs §9.3 | PUT 示例带尾斜杠，接口清单没有 | 无后端，REST 路由不存在；PostgREST 调用一律无尾斜杠 | `apps/web/src/data/*.ts` | 已消解 |
| C7 | §9.2 | 失败包只有业务 `code`，无 HTTP 映射 | 无自建 API；错误直接来自 PostgREST，前端把 `code` + `message` 一起显示 | `apps/web/src/data/diagramRepo.ts` | 已消解 |
| C8 | §7.5 | "每 5 次保存存一次密档"粒度太粗 | 首次必存 + 每 5 版 或 距上次 ≥30 分钟（先到）+ **手动命名快照**（本批新增） | `supabase/schema.sql`（`arch_save_diagram`）、`apps/web/src/data/snapshotRepo.ts` | 改写后实现 |
| C9 | §4.3 + §11.2 | 折叠时组高压缩到 40px，Schema 是否跟着改没说 | Schema 永远存展开态 `height`；40px 只在渲染层生效 | `apps/web/src/canvas/ArchGroupNode.tsx` | 按规格实现 |
| C10 | §11.2 `extent: 'parent'` | 设了 `extent` 节点拖不出父组，规格要求"拖出即移出" | 不设 `extent`；松手时按节点**中心**判定归属 | `apps/web/src/canvas/Canvas.tsx` | 改写后实现 |
| C11 | §11.3 冲突绕行 | 每帧扫全部节点矩形，300+ 节点 O(n²) | 段-矩形相交用 20px 空间网格（`RectIndex`）；**>200 个障碍时收窄搜索窗，候选 >8 直接走规则路由**（本批新增） | `packages/schema/src/ortho.ts` | 改写后实现 |
| C12 | §12 PDF | `svg-to-pdfkit` 不支持 `foreignObject`，中文/文本全丢 | 改为 2× PNG 嵌入 PDF（A4/A3 横向）；SVG 由 `html-to-image` 生成 | `apps/web/src/export/exportPdf.ts`、ADR-0006 | 改写后实现 |
| C13 | §6.2 vs §7.3 | `tags` TS 可选 / DDL `NOT NULL DEFAULT '{}'`；MySQL `JSON` ≠ PG `TEXT[]` | 统一 `string[]`，PG 用 `TEXT[]`，缺失即空数组 | `packages/schema/src/types.ts`、`supabase/schema.sql` | 改写后实现 |
| C14 | §2.3 / §8.5 | 800ms 防抖 + `baseVersion` → 单用户连续编辑也会自冲突 | 保存走**串行队列**（同一时刻只有 1 个在途请求，后续合并）+ 版本冲突给"覆盖/重载" | `apps/web/src/data/usePersistence.ts` | 改写后实现 |
| C15 | 用户补充规则 | 图标存 base64/URL → 体积大、外链失效 | 只存 `extJson.iconKey`，限定 10 个预定义 key，校验器兜底 | `packages/schema/src/icons.ts`、ADR-0005 | 改写后实现 |

## 本轮（A2/A3/B1–B8/D1–D3）对上面几条的补充

- **C8**：快照除了自动生成，还能手动"存为快照"（同版本已存在则改名）；版本历史每行带 96px 缩略图。
  `arch_snapshot` 本来就对 anon 开放 insert/update，无需改表。
- **C11**：1000 节点实测暴露两个真问题（都在本批修掉）：
  1. 冻结期间仍无条件算一遍 `toFlowEdges` —— 白干 1000 条边的映射与路径计算；
  2. 每条边在大矩形里枚举候选通道 —— 大图收窄窗口，候选过多放弃绕行。
- **C14**：保存链条原来没有 `catch`，一次异常会让 `chain` 变成永久 rejected，之后**所有保存都静默失效**；
  现在捕获异常、显示到状态栏、链条继续。另：`arch_patch_diagram` 里 `project_id` 的 CASE 分支
  类型不一致（uuid vs varchar）会报 42804，前端改为"增量失败就退回整图保存"。

## 后果

- 规格与实现的差异集中在这一份文档里，`阶段实施计划.md` 的历史表格保留作为过程记录。
- 后续若重新引入 AI 生成（§10），C5、C6、C7 需要重新评估。
