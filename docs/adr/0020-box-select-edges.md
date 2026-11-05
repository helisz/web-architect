# ADR-0020：框选连线（自己算命中，React Flow 不会做）

日期：2026-11-05
状态：已采纳
相关：ADR-0018（连线改路线）、ADR-0017

## 背景

用户反馈：拖一个框，里面只有连线，想高亮选中这些线再改样式或删除 —— 现在是选不中的。

查证（源码 + 实测）：

- `@xyflow/react` 的框选只算**节点**：`getNodesInside(nodeLookup, rect, transform, partial)`；
- 连线是**跟着节点走**的：遍历已选节点的 `connectionLookup`，把它们相连的边一并选上；
- 所以「框里一条线、没有节点」在 RF 里恒等于 0 选中，无论怎么调 props 都不会变。

上一批按用户要求加的「框选剔除连线」（防止框节点时顺手删掉一堆线）只是把这个现象变得更明确。

## 决策

规则 A（用户选定）：

1. 框里有节点或分组 → 沿用现状，只留节点/分组，连线剔除；
2. 框里**没有**节点/分组 → 自己按几何把穿过的连线都选上；
3. `Shift` + 框选 = 追加到已有选择（RF 一开始框选就会 `resetSelectedElements()` 清空，所以要自己在 pointerdown 抓快照）；
4. 选中态视觉不动（用户选择「保持现状」：主色 + 0.5px）。

## 实现要点

- **矩形只能自己记**：RF 在调用 `onSelectionEnd` **之前**就把 `userSelectionRect` 置空（`store.setState({ userSelectionRect: null })` 在 `onSelectionEnd?.()` 之前），所以拿不到矩形。改为在画布容器上 `onPointerDownCapture` 记起点（只认落在 `.react-flow__pane` 上的左键），`onSelectionEnd` 里用 `screenToFlowPosition` 把起点和收尾点换算成流程坐标。
- **命中用渲染出来的 path**：`<path>` 的坐标就是流程坐标（父级 `<g class="react-flow__viewport">` 负责平移缩放），拿 `getTotalLength()` / `getPointAtLength()` 采样成折线，再做「线段 × 矩形」相交（Liang–Barsky）。这样直线 / 正交折线 / 贝塞尔一套代码全解决，不用把三种生成器重写一遍。
- **先粗筛**：`getBBox()` 与矩形不相交直接跳过，几百条线时省掉绝大部分采样。
- **采样密度**：每 6px 一个点、2~48 段。太少会漏掉「长线跨过小框」，太多浪费。
- **纯函数单独成文件**：`canvas/edgeHitTest.ts`（`segmentIntersectsRect` / `polylineIntersectsRect` / `samplePath` / `edgeIdsInRect`），19 条单测，`samplePath` 只依赖 `{getTotalLength,getPointAtLength}` 两个方法，测试塞桩对象即可，不需要真 SVG。
- 框选仍在锁定编辑下可用（只是改不了样式），拖动模式下 `panActive` 时不记录起点（那是平移手势）。

## 放弃的方案

- 给 RF 提 issue 等它支持边命中：等不起。
- 用我们自己算出的折线做命中（`edgeGeometry`）：无折点的线走 RF 官方生成器，重算出来和真实渲染有偏差，看得见的线才该被选中。
- 把整个选框改成自绘：等于重写 RF 的框选，收益不抵风险。
