# ADR-0018：连线改路线（拖端点换锚点 + 折点）

日期：2026-11-05
状态：已采纳
相关：ADR-0012（正交路由只走 `getSmoothStepPath`）、ADR-0017（上一批边框细节）

## 背景

用户提了两件事：① 连线要能多选、能删；② 拖动连线能改路线（先评估）。

评估结论（URL 实测）：
- ① **已经能用**：`Shift+点` 多选、选框相交也会选中线、`Delete` 弹二次确认并一次删掉多条。缺的只是体验：确认框不报线名、多选连线只能改颜色、框选会把穿过的线一起选走（误删风险）。
- ② 拖线身**什么都不发生**（viewport 与数据都不变），手势是空的；单击=选中、双击=改标注已占用，拖拽可以放心用。

## 决策

### 一、连线批量编辑（用户 2026-11-05 选定三项）

1. 删除确认框列出线名：`接入网关 → 业务服务（443/TLS）`，最多 4 条 + 「等」。端点可以是分组，显示分组名。
2. 多选连线支持批量改 **线宽 / 线型 / 箭头 / 虚线**（此前只有名称与线条颜色）。字段交集规则不变（`multiEdit.ts` 的 `SUPPORT`），连线多选时面板标题改为「已选中 N 条连线」。
3. 框选**只选节点与分组**：`onSelectionEnd` 里把边框选中的连线从选中集合剔除，连线靠单击 / `Shift+单击` 选中。
   - 后续（ADR-0020）放宽为规则 A：框里**没有**节点/分组时，自己按几何选穿过的连线；有节点时仍只选节点。
   - 为什么不用 `selectable: false`：那会同时废掉单击选中；也不去动 `SelectionMode.Partial`，因为它同时决定节点的相交判定。

### 二、拖拽改路线（用户 2026-11-05 选定 A+B）

- **拖端点**（源/目标各一个小圆点）→ 换锚点：把指针换算成流程坐标，取"离节点哪条边最近"，只改 `sourceAnchor` / `targetAnchor`（现有字段，零存储改动）。
- **拖线上的小＋** → 加折点：折点存在 `edge.extJson.waypoints = [{x,y}…]`，10px 吸附，上限 12 个。
- **双击折点** → 删掉它（双击线本身仍然是改标注，靠 `stopPropagation` 分开）。
- 三种线型都支持折点：直线=折线（5px 圆角）、正交=横纵段、贝塞尔=Catmull-Rom 穿过每个折点。
- **无折点时继续走 React Flow 官方生成器**，保证老图逐像素不变。

## 关键实现

- `canvas/edgeGeometry.ts`（新）：`readWaypoints` / `writeWaypoints`（坏值丢弃、去重、护栏 ±100000）、`snap`、`orthoPoints`、`buildPath`、`pointAt`、`midpointInsertIndex`。纯函数，单测 21 条。
- `canvas/ArchEdge.tsx`：拖动过程只改本地状态（`anchorDrag` / `draftWaypoints`）做预览，`pointerup` 才 `patchEdge` —— 一次撤销、一次自动保存。
- 手柄叠在节点连接点（`.react-flow__handle`）上，DOM 中节点在标签渲染器之后，会抢走点击（实测 `elementFromPoint` 命中 `react-flow__handle`）；手柄容器加 `zIndex: 20` 才拿回点击。
- 手柄随画布缩放反向缩放（`scale(1/zoom)`），视觉尺寸恒为 12px；连线有标注时"小＋"放在路径 1/4 处，避免盖住文字。
- 拖动模式下不显示手柄：`panMode` 从 `Canvas` 的 `useState` 提到模块级 `store/useCanvasMode.ts`，`ArchEdge` 才能读到（不进撤销栈、不持久化）。

## 数据与兼容

- **不需要数据库迁移**：`extJson` 是 jsonb，schema 里是 `z.record(z.string(), z.unknown())`，保存/读取链路（`toSavePayload`、`arch_save_diagram`、`arch_patch_diagram` 的 `ext_json = excluded.ext_json`）都已带它；`validateDiagram` 的修复分支用 `{...extJson}` 合并，不会丢掉 `waypoints`。
- 老数据没有 `waypoints` → 走原路径，零风险；新数据在旧版本客户端里会被忽略（多余字段不报错）。

## 放弃的方案

- 只做"整条线偏移"（一个 `centerOffset` 自由度）：能力太弱，以后还得重做。
- 让 React Flow 内建线型扛折点：内建生成器只吃两个端点，做不到。
- 折点用 `edge.waypoints` 独立列：要写迁移，且 `extJson` 已经够用。
