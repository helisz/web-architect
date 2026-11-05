# ADR-0017：图层面板的树形层级、连线标注就地编辑与图标 key 归一

- 日期：2026-11-05
- 状态：已采纳
- 相关：ADR-0016（图库路由与拖动模式）、ADR-0014（图标 key 规则）

## 背景

用户第 9 批提了 8 条，其中 4 条是"看起来已有、其实差一点"或"结构上要重做"的：

1. **图层（第 5 条）**：按钮在顶栏，面板却是**平铺列表**；"拖动行"改的是 `sort`（遮挡顺序），
   既看不到分组层级，也不能改归属。用户要的是"能显示分组层级、能按分组整体拖动"。
2. **连线标注（第 7 条）**：属性面板本来就有「标注」输入框、画布中点也会渲染，但入口藏在右侧面板里，
   用户以为没有。要"双击连线就能打文字"。
3. **nginx（第 3 条）**：手绘的 `arch:nginx` 已经是默认 key，但**历史数据**里还存着 `devicon:nginx`
   （整词 wordmark），打开老图看到的仍是旧 logo。
4. **副文本（第 2 条）**：38px 标题栏内容刚好占满（2 + 16 + 20），再加 3px 间距就装不下。

## 决策

### 1. 图层面板 = 树 + 拖拽改归属，排序交给按钮

- 行由 `buildLayerRows()` 纯函数算出（`apps/web/src/components/layerTree.ts`）：分组按 `parentGroupId`
  嵌套，同层内先分组后节点、各自按 `sort` 降序，缩进 12px/层；收起的组不展开子项但仍显示内部元素数。
- **拖到分组行 = 放进该组**（节点 / 子分组都行）；**拖到底部投放区 = 移出分组**。
- 遮挡顺序改用行尾 `↑`/`↓`（置顶/置底），**不再兼任拖拽语义** —— 同一个手势两个含义是最容易误操作的设计。
- 越界在 UI 层先挡：成环（`isSelfOrDescendant`）、超过 3 层（`groupDepth + subtreeHeight`）直接 toast 拒绝，
  而不是交给 store 静默返回原状态（那样用户只会觉得"拖了没反应"）。
- 图层按钮从顶栏挪到画布右上角，排在拖动模式左边：三个按钮的层级是 **图层 | 拖动模式 | 锁定编辑**，
  都是在改"画布怎么响应鼠标"，放一起比散在顶栏和画布两处更容易找。

### 2. 双击连线 = 就地编辑标注（独立的小 store）

- React Flow 自带 `onEdgeDoubleClick`，双击线本身就能命中（`interactionWidth={12}` 的命中带）。
- 编辑态放**独立的 `useEdgeLabelEdit`**，不进 `diagramStore`，也不进 flow data：
  - 进 diagramStore 会污染撤销栈和保存链路；
  - 进 flow data 会污染 `flowMapping` 的 WeakMap 缓存键 —— 一个 UI 开关不该让整条边重新映射。
- 提交走 `patchEdge`（正常进历史、正常自动保存），Enter 提交、Esc 取消、失焦提交。
- 锁定编辑 / 拖动模式下双击不响应（与其它编辑入口一致）。

### 3. 旧图标 key 在**渲染层**归一，在**加载时**自愈

- `LEGACY_ICON_ALIASES`（`packages/schema/src/icons.ts`）：`devicon:nginx`、`logos:nginx`、
  `simple-icons:nginx`、`cib:nginx`、`fa6-brands:nginx` → 一律 `arch:nginx`。
  `resolveIconKey()` 先查别名表，再判合法性 —— 因此**不跑 SQL 也不会显示旧 logo**。
- `enforceIconRule` 在 repair 模式下顺手把库里的旧值改掉（静默，不报 warning），
  这样"打开一次老图"就等于自愈一次，下次保存落盘。
- `devicon:nginx` 从 `ALLOWED_ICON_KEYS` 移除（常用行不再出现两套 nginx），
  图标数据文件里对应条目也删掉（少 1 kB，且搜 "nginx" 只出手绘版）。
- 想彻底清库：`supabase/patch-nginx-icon.sql`（幂等，带自检查询）。

### 4. 副文本：38px 内单行省略 + `margin-top: 3px`

- 标题栏高度不变（带副文本 38px / 不带 24px），内容改为 `5 + 16 + 3 + 10 = 34px`：
  上边距 5、标题 16、间距 3、副文本**一行** 10px。
- 换行内容仍然完整存在 `subLabel` 里，属性面板能看到全文；画布上 `truncate`（`nowrap + ellipsis`）。
- 放弃"两行"的代价：长副文本（如两条 IP）画布上只能看到第一条，但换来标题栏不增高、不裁切。

### 5. 组件库整栏可隐藏 + 搜索框去外框

- 状态放 diagramStore 的 UI 段（`componentPanelOpen`），走既有的 `readPref/writePref`（`arch:prefs`）。
- 隐藏后**不留窄条**（用户选的方案），顶栏「组件库」按钮唤出；按钮 `aria-pressed` 反映当前状态。
- 搜索框去掉边框和聚焦边框，只留容器的细分隔线 —— 面板里已经有足够的视觉分层，
  再给一个方框反而显得"像个输入表单"。

## 影响

- 图层面板的拖拽语义变了（从"改顺序"变成"改归属"），老习惯需要适应；`↑`/`↓` 补上了排序能力。
- 图层面板新增树构建纯函数，可单测（`apps/web/test/layerTree.test.ts`，5 条）。
- nginx 老 key 永远画成新图标，`devicon:nginx` 不再出现在选择器里。
- 分组副文本在画布上只显示一行。

## 验证

- `apps/web/test/layerTree.test.ts`：嵌套顺序 / 内部计数 / 收起 / 成环 / 层数。
- `packages/schema/test/icons.test.ts`：别名映射 + repair 自愈；允许集合 19 个。
- CDP 实测见 `docs/验收记录.md` §18。
