# ADR-0005 · 节点图标只存 key，不存图片

- 状态：已采纳（2026-11-04）
- 相关：`packages/schema/src/icons.ts`、`validate.ts` 的 V11、`arch_node.ext_json`

## 背景

节点需要区分"这是 WAF / 这是 K8s 集群 / 这是数据库"。把图标存成 base64 或外链 URL 有三个明确的问题：

1. **体积**：一张 20KB 的 base64 图标 × 200 个节点 = 4MB，存进 `jsonb` 后每次保存都要整体传输；
2. **失效**：外链 URL 会 404、会被防盗链、内网部署时根本访问不到；
3. **不可换肤**：图标写死在数据里，将来换图标风格得批量改数据。

## 决策

节点只存**图标 key**（字符串），写在 `extJson.iconKey`，取值限定为预定义集合：

| nodeType | iconKey |
|---|---|
| `waf` | `tabler:shield-lock` |
| `vip` | `tabler:router` |
| `nginx` | `devicon:nginx` |
| `k8s-cluster` | `devicon:kubernetes` |
| `pod` | `cncf:pod` |
| `db` | `tabler:database` |
| `gateway` | `tabler:arrow-right-square` |
| `external` | `tabler:world` |
| `text` | `tabler:text` |
| `custom` | `tabler:cube` |

> 2026-11-04 补丁：为解决"一排方块 / 一排路由"的歧义，按方案 (a) 再补 6 个 key（`tabler:server`、`tabler:server-2`、`tabler:box`、`tabler:network`、`tabler:route`、`tabler:plug-connected`），32 个节点类型现已全覆盖。完整表见 [节点图标映射表](../节点图标映射表.md)。

规则细节：

1. **自动匹配**：`createNode()` 按 `nodeType` 写入 `extJson.iconKey`，不需要调用方关心；
2. **唯一合法集合**：`ALLOWED_ICON_KEYS` 是唯一合法取值（现 16 个），未知类型回落 `tabler:cube`；
3. **不生成 base64 / 不生成 url**：`looksLikeEmbeddedImage()` 会把 `data:`、`http://`、`https://` 开头的值判为违规；
4. **校验器兜底（V11）**：`validateDiagram({repair:true})` 会补齐缺失的 key、改写非法 key、拒绝内联图片；**合法的自定义值原样保留**（M2 图标选择器要用手工覆盖）；
5. **渲染在视图层**：图标本体由前端图标集按 key 查表渲染，Schema 只保证 key 合法。

## 影响

- 导出 JSON / 存库都只有几十字节的字符串，200 节点也不过几 KB；
- 换图标风格只改前端图标表，数据不动；
- 校验责任明确：**能不能存进去由 Schema 决定**，**长什么样由前端决定**；
- 未列出的 22 个节点类型（`firewall`/`lb`/`server`/`switch`/`zone`…）最初回落 `tabler:cube`；同日按方案 (a) 补齐映射与 6 个新 key，现已 32 类型全覆盖，见 [节点图标映射表](../节点图标映射表.md)。

## 未采纳的方案

- **存 SVG 源码**：体积比 base64 小，但仍把表现层塞进数据层，且不好做统一风格的换肤；
- **存外链 URL**：内网/离线部署直接失效；
- **存完整的 iconify 名称并允许任意集合**：`tabler:anything` 也能通过，等于没有约束，改坏数据无从发现。

## 2026-11-04 补记：图标改为真实渲染

- 起初只落库了 `extJson.iconKey`，画布上并没有画图标（当时只验证了数据层）。现补上渲染：`NodeIcon` 读 key → 本地图标包。
- 图标来源为 Iconify 官方包，取 `@iconify-json/tabler`、`@iconify-json/devicon`、`@iconify-json/k8s` 三份，由 `npm run build:icons` 按白名单裁剪（16 个 key ≈ 15 kB），**不整包引入**（tabler 全集 ~1.4 MB）。
- 上游不存在 `cncf` 集合与 `tabler:text`，分别换成 `k8s:pod`、`tabler:typography`；`apps/web/test/icons.test.ts` 增加守门测试：任何 key 若在本地图标包里找不到，测试直接失败。
