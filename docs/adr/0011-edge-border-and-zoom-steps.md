# ADR-0011 连线贴边框 + 标准曲线 + 20% 缩放档位

- 日期：2026-11-04
- 状态：已采纳
- 相关：ADR-0001（Schema ↔ ReactFlow 映射）、ADR-0006（导出与性能取舍）、ADR-0010（hash 路由）

## 背景

用户这一批给了五条反馈，全都指向"画出来的线不像线"：

1. 拖线时看不见箭头和线，"很多次偶然有一次可以"；
2. 默认应该带**单向箭头**，方向按拖线方向；
3. 箭头、线头跟节点**不连接**，总差一截；
4. 曲线路径"非常怪异"，箭头端点还扭曲，建议"用 ReactFlow 的标准线条"；
5. 缩放改成 **20% 档位**，`+`/`−` 也是，Fit view 之后再调也要落在 20% 的倍数上。

## 决策

### 1. 端点由"节点矩形 + 锚点"算，不用 handle 的 DOM 矩形

ReactFlow 12 的 `getHandleBounds()` 存的是 handle 元素的**外接矩形**
（`x = handleRect.left - nodeRect.left`，右/下边还要再加一个宽/高）。我们的手柄为了好点中，
曾经做成 24×24 —— 于是 RF 认为端点在手柄外沿，所有 `bezier` / `straight` 线头的落点比节点
边框偏出去 **11px**（实测 `M271,140 … 509,360`，正确值应是 `260 / 520`）。这正是用户说的
"箭头首尾还是跟节点不连接"。

改法：三种线型统一走 `ArchEdge`，端点用 `anchorPoint(nodeRect, anchor)` 直接落在边框上
（和正交路由、导出共用同一套 `@arch/schema` 几何函数）；handle 只负责"能不能拉、能不能接"。

- 手柄本体缩回 **8px**（RF 量的是它，跟默认一致，误差 ≤1px）；
- 24px 的命中区改成 `::after` 伪元素 —— 伪元素不参与 RF 的测量，事件照样冒泡到手柄；
- 未选中时手柄是 45% 透明（以前是 `opacity:0`，等于"看不出能从哪拉线"）。

### 2. 曲线 / 直线用 ReactFlow 标准算法，只是换入参

`getBezierPath()` / `getStraightPath()` 是 RF 自己的实现（用户要的"标准线条"），
我们只把 `sourceX/Y`、`targetX/Y` 换成边框点，`sourcePosition` / `targetPosition` 由锚点映射。
正交线仍然是 `buildOrthoPath`（圆角 + 绕障碍），因为 RF 没有这个能力。

### 3. 箭头自绘，尺寸固定、箭尖戳在边框上

以前用 `MarkerType.ArrowClosed` + `width/height: 14`：RF 的 `<marker>` 默认
`markerUnits="strokeWidth"`，线宽 2px 时箭头真的被放大成 28px，且 `refX=0` 让箭尖悬在线头外，
看起来"扭曲又没接上"（第 4 条后半句）。

改成每条边自绘一个 marker：`markerUnits="userSpaceOnUse"`、`markerWidth/Height=10`、
`refX=9.5`（箭尖压在线端点上 0.5px）、`orient="auto-start-reverse"`（`backward` / `both` 自动反向）、
`fill` 走 style（选中色是 CSS 变量，写在 SVG 属性里不生效）。

### 4. 新线默认 `arrow: 'forward'`

`EDGE_DEFAULTS.arrow` 从 `'none'` 改成 `'forward'`。这是对规格 §5.2 规则 3 的有意偏离：
那条写的是"默认无箭头，方向靠布局表达"，实际用起来"谁指向谁"完全看不出来。老图的 `arrow`
是显式存的，不会被默认值改掉；要改在右侧面板里改。

### 5. 缩放是固定 20% 阶梯，不是 ×1.2

`apps/web/src/canvas/zoom.ts`：

- `ZOOM_LEVELS = 0.2, 0.4, … 4.0`；
- `nextZoom(zoom, ±1)` 取"下一个比当前大的档 / 小的档"，所以 Fit view 出来的 87% 按 `+` 是 100%、按 `−` 是 80%；
- `zoomAroundCenter()` 保证缩放前后**视口中心那个点**不动（`setViewport` 只改 zoom 会往左上跑）；
- `+`/`−`/Fit 三个按钮自己画（`Controls` 的 `showZoom={false}` `showFitView={false}`），因为内置按钮是 ×1.2；
- Ctrl+滚轮在**捕获阶段**拦截：d3-zoom 的 wheel 监听挂在内层 pane 上，冒泡阶段处理的话它已经先缩过一次，
  档位就不再是整数倍（实测会得到 2.36 这种值）。160ms 节流，免得触控板一次手势跳好几档；
- 状态条的「100%」以前只改 store 副本、画面不动（`CanvasStatus` 在 `ReactFlowProvider` 外面），
  现在用 `arch:zoom-reset` 事件通知画布内的组件真正 `setViewport(1)`。

## 影响

- `OrthoEdge.tsx` 删除，换成 `ArchEdge.tsx`（三种线型一支组件）+ `ArchConnectionLine.tsx`（拖线预览：主色虚线 + 箭头 + 起点圆点）；
  `flowMapping` 的 `type` 统一为 `archEdge`，marker 不再由映射层生成。
- `ArchEdge` 里所有 hook 提到最外层。以前的 `OrthoEdge` 在节点还没测量时 `return null`，
  会跳过 `useStore`，React 报 `change in the order of Hooks`（这次在冒烟复用的长生命周期标签页里抓到过）。
- 导出（SVG/PNG）走的是同一套 `buildOrthoPath`，端点行为不变。
- 单测：`zoom.test.ts` 覆盖档位（含 0.873→1.0、0.9→1.0 这种浮点边界）；`canvas.test.ts` 的线型断言改成 `archEdge`；`store.test.ts` 的默认箭头断言改成 `forward`。
- 偏差记录：规格 §5.2 规则 3（默认无箭头）与 §11.5 第 7 条按第 4 节执行的"新默认"覆盖，其余不变。
