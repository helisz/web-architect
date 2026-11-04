# ADR-0013 排版收敛、文字对齐、全局锁定与剪贴板

- 日期：2026-11-04
- 状态：已采纳
- 相关：ADR-0005（iconKey）、ADR-0012（虚线三档）、`supabase/patch-diagram-ext.sql`

## 背景

用户 2026-11-04 第二批给了 7 条：

1. 「去掉字号的快速选择。字体除了 mono 之外一律用：Inter, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", system-ui, -apple-system, sans-serif」
2. 「节点标题 12px 500 字重，副文本 10px（mono 字体）」
3. 「整个节点文字可以左右对齐、居中，上下对齐，包括文本节点」
4. 「副文本允许回车换行」
5. 「全局给个锁定编辑的 toggle 按钮放画布范围的右上角」
6. 「线条虚线 icon 用示意图，而不是文字」
7. 「导出里加个复制到剪切板的功能，默认复制 2x png 非透明底」

追问后的定案：

- 字号：普通节点名称 12px/500，**文本节点标题仍 28px 加粗**（用户原话「文本节点标题仍 28px 加粗」）；
- 对齐：单节点改 + 多选批量改都要，节点和文本节点都支持；
- 副文本换行：**固定高度、最多两行、超出截断**（不做自动长高）；
- 锁定范围：可选中、平移、缩放、搜索；禁止拖动 / 改尺寸 / 改属性 / 连线 / 删除 / 拖入；
- 锁定持久化：**随图保存**（换电脑、换浏览器也生效）；
- 剪贴板：一个按钮，固定 2× + 白底，剪贴板不可用时自动改成下载。

## 决策

### 1. 字号只留数字输入，删掉常用字号档

`FONT_SIZE_PRESETS` 整组删除（连同属性面板那一排按钮）。保留 8–72 的数字输入 +
`parseFontSize` 的空值容忍，避免打字过程被清空。理由：用户明确说"去掉快速选择"，
而常用档确实和"12px 名称"这套排版互相打架。

### 2. 字体栈一处定义，全站继承

`apps/web/src/styles/index.css` 里 `--font-ui` 写成
`Inter, 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', system-ui, -apple-system, sans-serif`，
body 用它；`--font-mono` 单独留给副文本 / 坐标 / 代码片段。**不打包 Inter**（没有 `@fontsource` 依赖）：
本机有就用，没有就落 PingFang / 雅黑，视觉上不会跳。

### 3. 排版缩到两档：12px/500 与 10px mono

`textStyle.ts` 的 `DEFAULTS` 改成：

| 类型 | 字号 | 字重 | 对齐 |
|---|---|---|---|
| `title`（文本节点大标题） | 28 | 700 | 左 / 中 |
| `text`（普通节点名称） | 12 | 400→继承 BASE 500 | 左 / 中 |
| `sticky` / `annotation` | 12 | 400 | 左 / 顶 |
| `element` | 12 | 400 | 中 / 中 |

`textStyleOf` 里字重仍是"`bold` 优先，否则取默认档"，所以关掉粗体的标题回到 500 而不是 700。
12px/500 是用户点名的"节点标题"，靠 `DEFAULTS.text.weight = 400` 与 `BASE.weight = 500` 组合实现：
未显式设字重时普通节点落到 BASE 的 500。

### 4. 对齐用 flex + extJson，不进数据库

- 存储：`extJson.align`（`left|center|right`）、`extJson.valign`（`top|middle|bottom`）；
  非法值在 `textStyleOf` 里回退默认，不写新表列（`ext_json` 本来就在保存/差异/快照链路里完整往返）。
- 渲染：`ArchNode` 容器改为 `justifyContent: horizontalToFlex(align)` +
  `alignItems: verticalToFlex(valign)` + `textAlign: align`，不再用按 nodeType 写死的
  `justify-*` / `items-*` / `text-left` 类。文本节点同样吃这套（用户要求"包括文本节点"）。
- 编辑：属性面板「文字」区放两组三按钮（⇤ ↔ ⇥、⤒ ⬍ ⤓），带 `aria-label`；
  多选时 `AlignButtons` 也出现在交集里（`MultiField` 增 `align` / `valign`，`withTextStyle` 批量写）。

### 5. 副文本换行：`whitespace-pre-line` + 固定两行

- 渲染：`mono line-clamp-2 whitespace-pre-line break-words text-[10px] leading-[13px]`，
  副文本两行 = 26px；实测 `clientHeight=26 / scrollHeight=52`（4 行输入被截断），
  `-webkit-line-clamp: 2`、`overflow: hidden`。
- 输入：分组副文本从 `<input>` 换成 `<textarea rows=2>`，否则用户根本打不出换行。
- 分组标题栏高度：两行 `46`（4 内边距 + 16 标题 + 26 副文本），单行 `32`；
  实测画布 zoom 0.8 时渲染 37px（46×0.8），zoom 1 下即 46。

**没有**做"按行数自动长高"：用户选的是固定高度 + 截断，自动长高会让分组标题栏高度变得不可预测，
连带影响分组手柄与连线的锚点位置。

### 6. 全局锁定放在 store 的 `set` 上，而不是逐个动作里

锁定的判断只有一句话：**这次写入如果换了 `diagram` 对象，就算改图**。

```ts
if (!bypassLock && isEditLocked(state.diagram) &&
    next.diagram !== undefined && next.diagram !== state.diagram) return state;
```

为什么在这一层：

- 改图动作有三十多个（`addNode` / `patchNode` / `addEdge` / `deleteSelection` / 对齐 / 分布 /
  复制粘贴 / 拖入 / 分组变换…），逐个加判断必然漏一个，而"锁了还能改"是最难被发现的 bug；
- 只改 UI / 选中 / 视口的写入天然不含 `diagram` 键，自动放行；
- 例外用 `withLockBypass()` 显式开口：`setViewport`（平移缩放）、`toggleGroupCollapsed`
  （纯浏览状态，不改几何）、`setEditLocked`（自己得能改自己）。

配套的 UI 层收口（双重保险，也给用户可感知的反馈）：

| 位置 | 锁定后 |
|---|---|
| 画布右上角 | 🔒「已锁定 / 锁定编辑」toggle，`aria-pressed` |
| ReactFlow | `nodesDraggable={false}` / `nodesConnectable={false}` / `edgesReconnectable={false}` / `deleteKeyCode={null}` |
| 拖入 | `onDrop` 直接 return |
| 右键菜单 | 节点 / 连线 / 空白三种都不弹（里面全是改图项） |
| 行内改名 | 双击不改名（`ArchNode` / `SwimlaneNode`） |
| 属性面板 | 顶部一条「已锁定编辑，属性只能查看」，控件外层 `pointer-events-none opacity-60 aria-disabled` |

**持久化**：`arch_diagram.ext_json`（新列，`supabase/patch-diagram-ext.sql`）。
写入走一次 REST `update`（和"图库改标签"同一条路径），**不进保存函数**：
锁定是元数据，不该占版本号、不该触发快照、不该和画布内容抢冲突。
没跑 SQL 时列不存在，update 失败只打一条 `console.warn`，锁定退化成"本机当次会话有效"。

### 7. 虚线：画真实线型的示意图标

三档按钮里不再放"实线 / 短虚线 / 长虚线"文字，改成 44×10 的 inline `<svg>`：
`<line stroke-dasharray={preset.value}>` 直接画出来，选中态换主色。文字保留在
`title` + `aria-label` 上（无障碍与 tooltip 都还在，`aria-pressed` 不变）。

### 8. 复制图片：固定 2× 白底，失败退化成下载

`exportPng.ts` 新增：

```ts
copyPngToClipboard(viewport)  // ClipboardItem + navigator.clipboard.write
```

`renderPng` 产出的 dataURL 先 `fetch` 成 Blob（剪贴板只认 Blob）。不支持
`ClipboardItem` 或权限被拒时抛错，`useTransfer.copyImage` 捕获后**自动改为下载**
`图名@2x.png`，并提示"剪贴板不可用（…），已改成下载 PNG"——用户要的就是
"一个按钮"，不该出现第二个按钮或静默失败。

## 代价与遗留

- 不打包 Inter：没装 Inter 的机器落到 PingFang / 雅黑，字形略有差异。
- 副文本固定两行：超过两行的内容在画布上被截断（数据仍完整保存，点开属性面板能看到全文）。
- 锁定靠 store 单点拦截：将来若有代码绕过 store 直接 `setState`（目前没有），锁定会被绕过。
- 全局锁定需要跑一次 `supabase/patch-diagram-ext.sql`；不跑则"换设备仍锁定"不生效。
