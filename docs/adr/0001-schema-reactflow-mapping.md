# ADR-0001：Schema ⇄ ReactFlow 映射的三处修正

- 状态：已采纳
- 日期：2026-11-04
- 关联：技术规格 §6.2、§11.1、§11.2；阶段计划 C1 / C2 / C3

## 背景

规格 §11.1 给出了 `toFlow` / `toSchema` 的参考实现，但其中三处与 §6.2 的数据模型定义冲突，或会在运行时产生脏数据。若不修正，表现为：拖动一次分组框后全图坐标漂移、节点被渲染成 ReactFlow 内置的 group 样式、保存时报 `NaN` 校验失败。

## 决策

### C1：删掉 `toSchema` 里的 `abs()` 换算

规格 §11.1 的 `abs()` 会把带 `parentId` 的节点坐标换算成绝对坐标，但函数注释与 §6.2 都要求：**组内节点的 x/y 是相对父组的局部坐标**（与 ReactFlow `parentId` 语义一致）。

- 采纳：`toSchema` 直接取 `n.position`，不做任何二次换算。
- 绝对坐标只在一个地方用：计算导出包围盒、判断拖入/拖出分组。
- 相关 helper：`absoluteNodePosition()` / `absoluteGroupPosition()`（`packages/schema/src/validate.ts`）。

### C2：节点类型名不用 `nodeType` 原名

规格写法是 `type: n.nodeType`，需要注册 32 个 ReactFlow 节点类型；其中 `group`、`default` 等与 ReactFlow 内置类型同名，会被内置实现覆盖。

- 采纳：只注册两个 ReactFlow 类型 —— `archNode`（所有业务节点，靠 `data.nodeType` 分派图标与默认尺寸）与 `swimlane`（分组）。
- 好处：新增 nodeType 不需要动画布层，也不会与内置类型冲突。

### C3：尺寸与层级取值方式

- `style.width` 在 resize 之后可能是 `"160px"` 这样的字符串，`Number()` 会得到 `NaN` 并被 V6 拒绝。统一用 `parseFloat`，并优先读 `node.measured?.width`。
- `sort` 只用于层级排序，不与 ReactFlow 的 `zIndex` 混用；渲染时的 `zIndex` 由「分组 < 连线 < 节点 < 覆盖层」的固定规则计算。

## 影响

- 阶段 1 · M1 的 `toFlow` / `toSchema` 按本 ADR 实现，并配往返单测（`packages/schema/test/convert.test.ts` 已覆盖 DB 方向）。
- 验收项 A3「组整体移动后子节点不漂移」直接回归 C1。

## 后续

- C9（折叠时 Schema 存展开态高度，40px 只在渲染层生效）与 C10（`extent: 'parent'` 会让节点拖不出分组）在 M2 实现时同样按本 ADR 的原则处理：**Schema 存事实，视图存呈现**。
