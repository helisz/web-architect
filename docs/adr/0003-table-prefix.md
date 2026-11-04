# ADR-0003：共用数据库时的对象命名（`arch_` 前缀）

- 状态：已采纳
- 日期：2026-11-04
- 关联：技术规格 §7.3；阶段计划 §11 D4

## 背景

本工具要复用**另一个项目已有的 Supabase 实例**（额度原因），两者的对象都落在 `public` schema。规格 §7.3 的表名（`architecture_diagram` / `diagram_group` / `diagram_node` / `diagram_edge` / `diagram_snapshot`）过于通用，与对方既有表、索引撞名的概率不为零；而 Postgres 的索引、约束、函数名在 schema 内是**全局唯一**的，不只是表名有风险。

## 决策

本项目创建的**所有**数据库对象统一使用 `arch_` 前缀：

| 规格名 | 本库名 |
|---|---|
| `architecture_diagram` | `arch_diagram` |
| `diagram_group` | `arch_group` |
| `diagram_node` | `arch_node` |
| `diagram_edge` | `arch_edge` |
| `diagram_snapshot` | `arch_snapshot` |

- 索引用 `arch_idx_*`，约束用 `arch_ck_*`，函数/触发器用 `arch_touch_updated_at()` / `arch_tg_diagram_touch`。
- 表名集中在 `@arch/schema` 的 `TABLES` 常量里，前端仓储层只允许引用常量，禁止手写表名字符串。
- 建库方式为粘贴式（`supabase/schema.sql` 可重复执行），因此**不能**靠"不用 `IF NOT EXISTS`"来防撞名；改为在文件末尾加**撞名自检**：若同名表已存在但缺少本项目必有的列（如 `arch_edge.source_anchor`），直接 `raise exception` 并提示停下确认。
- 授权（`grant ... to anon`）与 RLS 策略逐表书写，不写 `all tables in schema public`，避免波及其它项目的表。
- 列名、类型、默认值、索引字段与规格 §7.3 完全一致，只改对象名，不改结构。

用下划线而不是连字符，是因为 Postgres 未加引号的标识符不能含 `-`，`arch-xxx` 会迫使所有 SQL、ORM 映射、运维脚本永远加双引号，长期成本大于收益。

## 为什么不用独立 schema

`CREATE SCHEMA arch` 也能彻底隔离，而且不需要改任何表名。没有采用的原因是：Supabase 的 Data API / 仪表盘 / 备份视图默认只盯着 `public`，独立 schema 会在排查问题时多一层心智负担；当前只有一个共享库、冲突面很小，前缀足够。

若后续本项目对象增长到十几个表，再迁移到独立 schema 的代价也不高（`ALTER TABLE ... SET SCHEMA`）。

## 验证

- 在 PostgreSQL 16 容器（Docker，一次性）上实跑建表 SQL：5 张表建成、触发器 `arch_tg_diagram_touch` 生效（`updated_at > created_at`）、删主表级联清空 `arch_group` / `arch_node`、重复执行幂等。
- 撞名自检已验证：先手工建一张缺列的 `arch_diagram`，再跑脚本 → 明确报错停下。
- 容器已删除。真实 Supabase 库上的最终确认由 `npm run check:db` 完成（不跑本地数据库）。

## 影响

- 读取/写入代码里的表名全部来自 `TABLES` 常量。
- 规格文档本身不改（它是原始设计依据）；映射关系记录在本 ADR 与 `supabase/schema.sql` 头部注释里。
