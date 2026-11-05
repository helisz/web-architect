# ADR-0016 导航与画布模式：显式 `#/gallery`、登录落图库、拖动模式

- 日期：2026-11-05
- 状态：已采纳

## 背景

用户对图库/编辑器的导航与操作提了一批改进：

1. 图库要有自己的路由 `/gallery`，而不是复用根路径。
2. 登录成功后应该进图库。
3. 图库卡片太宽、按钮太多，点卡片本身就该进图。
4. 顶栏账号要固定在最右边，并且鼠标移上去就展开。
5. 画布上除了「锁定编辑」，还需要一个「编辑 / 拖动」开关，等价于"一直按住空格"。

## 决策

### 1. 路由：`#/gallery` + `#/d/<id>`，其它一律收敛

- 图库的规范地址是 `#/gallery`；图仍是 `#/d/<diagramId>`。
- `#/`、空 hash、`#/d/<垃圾 id>` 都按图库渲染，并**用 `history.replaceState` 把地址改写成 `#/gallery`**。
  用 replaceState 而不是给 `location.hash` 赋值：不制造多余历史记录，后退键行为不变。
- 不引入 history API：仍是纯静态托管，hash 路由天然不需要服务端 rewrite（ADR-0014 的结论不变）。

### 2. 登录成功一律落图库

只认 `signed-out → signed-in` 这一次跃迁（`prevAuthStatus` ref）。

为什么不用"登录后一律 `navigateToGallery()`"：`useAuth` 每次刷新都会经历 `loading → signed-in`，
无条件跳转会把正在看 `#/d/<id>`（刷新、分享链接）的人踢回图库。用户选择"忽略登录前的地址"，
指的是**登录动作**之后去哪里，不是刷新行为。

### 3. 图库卡片：固定 320px 列、整卡可点、动作用图标

- 栅格 `repeat(auto-fill, 320px)`：卡片不再随窗口拉伸，1440 宽屏 4 列、1920 约 5 列。
- 整张卡片就是一个 `button`（`absolute inset-0` 透明层），标题不再是按钮，也没有「打开」按钮；
  卡片内的改名/复制/删除是图标按钮，`z-10` 浮在透明层之上并 `stopPropagation`。
- 动作用 ToolIcon 新增的 `pencil` / `copy` / `trash`，只给 `title` + `aria-label`。
- 「返回画布」按钮删除：既然登录后就在图库、卡片可点，这个出口只是噪音。

### 4. 账号菜单：hover + click

`AccountMenu` 同时挂 `onMouseEnter/onMouseLeave` 和 `onClick`，并监听 `mousedown` 在点外部时收起。
只做 hover 的话触屏和键盘用户没有出口，所以两种都留。

### 5. 拖动模式（`panMode`）

- 语义：拖空白 = 平移画布，**节点不可拖**（用户选"节点拖不动"，避免手滑把图拖乱）。
- 实现：`panOnDrag={panMode || spaceHeld}`、`selectionOnDrag={!(panMode || spaceHeld)}`。
- **坑**：React Flow 的全局 `nodesDraggable` 会被每个节点自带的 `draggable` 字段覆盖，而
  `flowMapping.toFlowNodes` 一直显式写 `draggable: !n.locked`。所以门控必须在映射层生效：
  `toFlowNodes(diagram, selectedIds, { draggable: !editLocked && !panMode })`，缓存键同步加上
  `draggable`（否则切换模式时 WeakMap 命中旧对象，节点仍然能拖）。
- `panMode` 只存在内存里，不随图保存（这是操作习惯，不是图的内容）；锁定编辑仍然随图保存。

## 后果

- 老书签 `#/` 仍可用，只是地址会被改写成 `#/gallery`。
- 分享链接 `#/d/<id>`：未登录时先落图库（用户选择），从卡片再进图。
- 卡片宽度固定后，名称过长靠 `truncate` 省略，完整名字在 `aria-label` / tooltip 里。
