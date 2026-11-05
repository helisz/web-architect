import { useMemo, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { COMPONENT_CATEGORIES, GROUP_PRESETS, STRUCTURE_NODE_SPECS, iconKeyFor } from '@arch/schema';
import type { ComponentSpec, GroupPreset } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';

/** 拖拽时写入 dataTransfer 的 MIME，M1 的画布 drop 处理器读它 */
export const NODE_TYPE_MIME = 'application/x-arch-node-type';
/** 拖拽建分组用另一个 MIME：分组不是节点类型，不能混进 nodeType */
export const GROUP_MIME = 'application/x-arch-group';

/** 分组卡片的统一外观：拖拽 + 图标 + 名字 */
function StructureCard({
  iconKey,
  label,
  title,
  payload,
  dashed,
}: {
  iconKey: string;
  label: string;
  title: string;
  payload: string;
  dashed?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(GROUP_MIME, payload);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={title}
      className={`group flex h-8 min-w-0 cursor-grab items-center gap-1.5 rounded-md border bg-[var(--panel-bg)] px-1.5 hover:border-[var(--primary)] active:cursor-grabbing ${
        dashed ? 'border-dashed border-[var(--panel-border)]' : 'border-[var(--panel-border)]'
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#F3F4F6] text-[var(--text-secondary)] group-hover:bg-[#EFF6FF] group-hover:text-[var(--primary)]">
        <NodeIcon iconKey={iconKey} size={14} />
      </span>
      <span className="truncate text-xs text-[var(--text-primary)]">{label}</span>
    </div>
  );
}

/** 通用分组（不带业务语义，纯空框） */
function GroupCard() {
  return (
    <StructureCard
      iconKey="tabler:cube"
      label="分组"
      title="拖到画布创建分组（把节点拖进框里即归组，最多嵌套 3 层）"
      payload="group"
      dashed
    />
  );
}

/** 预设分组：服务器 / 集群 / nginx —— 建出来就是带图标和副文本的普通分组 */
function PresetCard({ preset }: { preset: GroupPreset }) {
  return (
    <StructureCard
      iconKey={preset.iconKey}
      label={preset.label}
      title={`拖到画布创建「${preset.groupLabel}」分组（${preset.width}×${preset.height}，自带图标与副文本，可改名）`}
      payload={preset.key}
    />
  );
}

function ComponentCard({ item }: { item: ComponentSpec }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NODE_TYPE_MIME, item.nodeType);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`拖到画布创建「${item.label}」（${item.width}×${item.height}）`}
      className="group flex h-8 min-w-0 cursor-grab items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1.5 hover:border-[var(--primary)] active:cursor-grabbing"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#F3F4F6] text-[var(--text-secondary)] group-hover:bg-[#EFF6FF] group-hover:text-[var(--primary)]">
        <NodeIcon iconKey={iconKeyFor(item.nodeType)} size={14} />
      </span>
      <span className="truncate text-xs text-[var(--text-primary)]">{item.label}</span>
    </div>
  );
}

/** 左侧组件面板（规格 §3.2 / §3.3）：240px，结构 + 文本 + 分类 + 搜索 */
export function ComponentPanel() {
  const [keyword, setKeyword] = useState('');
  // 整栏可隐藏（用户 2026-11-05）：顶栏「组件库」按钮切换，选择记在 localStorage
  const open = useDiagramStore((s) => s.componentPanelOpen);

  const categories = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return COMPONENT_CATEGORIES;
    return COMPONENT_CATEGORIES.map((category) => ({
      ...category,
      items: category.items.filter(
        (item) =>
          item.label.toLowerCase().includes(kw) ||
          item.nodeType.includes(kw) ||
          category.label.includes(kw),
      ),
    })).filter((category) => category.items.length > 0);
  }, [keyword]);

  const presets = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return GROUP_PRESETS;
    return GROUP_PRESETS.filter(
      (p) => p.label.toLowerCase().includes(kw) || p.key.includes(kw),
    );
  }, [keyword]);

  const total = categories.reduce((sum, c) => sum + c.items.length, 0) + presets.length;
  const setOpen = (next: boolean): void => useDiagramStore.getState().setComponentPanelOpen(next);

  // 收起后留一条窄边（用户 2026-11-05 反馈：顶栏那个小图标根本找不到）：
  // 竖排「组件库」+ 展开箭头，永远贴在左边缘，随时点得回来。
  if (!open) {
    return (
      <aside className="flex w-7 shrink-0 flex-col items-center border-r border-[var(--panel-border)] bg-[var(--panel-bg)] py-1.5">
        <button
          type="button"
          title="展开组件库"
          aria-label="展开组件库"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="grid h-7 w-7 place-items-center rounded text-[13px] text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--primary)]"
        >
          ›
        </button>
        <button
          type="button"
          title="展开组件库"
          aria-label="展开组件库"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="mt-2 flex-1 cursor-pointer select-none text-[11px] tracking-[0.2em] text-[var(--text-secondary)] hover:text-[var(--primary)]"
          style={{ writingMode: 'vertical-rl' }}
        >
          组件库
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--panel-border)] bg-[var(--panel-bg)]">
      {/* 面板头（用户 2026-11-05）：给一个明确的「组件库 + 收起」入口，不再只靠顶栏图标 */}
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-2 py-1">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">组件库</span>
        <button
          type="button"
          title="收起组件库"
          aria-label="收起组件库"
          aria-expanded
          onClick={() => setOpen(false)}
          className="grid h-6 w-6 place-items-center rounded text-[13px] text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--primary)]"
        >
          ‹
        </button>
      </div>
      {/* 搜索框去掉外框（用户 2026-11-05）：只留一条细分隔线，输入时文字本身给反馈 */}
      <div className="border-b border-[var(--panel-border)] px-2 py-1.5">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索组件…"
          className="w-full border-0 bg-transparent px-1 py-1 text-xs outline-none placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className="mb-3">
          <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
            结构
          </h3>
          <div className="grid grid-cols-2 gap-1">
            <GroupCard />
            {presets.map((preset) => (
              <PresetCard key={preset.key} preset={preset} />
            ))}
            {presets === GROUP_PRESETS &&
              STRUCTURE_NODE_SPECS.filter(
                (spec) => !keyword.trim() || spec.label.includes(keyword.trim()),
              ).map((spec) => <ComponentCard key={spec.nodeType} item={spec} />)}
          </div>
        </section>

        {categories.map((category) => (
          <section key={category.key} className="mb-3">
            <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              {category.label}
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {category.items.map((item) => (
                <ComponentCard key={item.nodeType} item={item} />
              ))}
            </div>
          </section>
        ))}
        {total === 0 && (
          <p className="px-1 py-4 text-center text-xs text-[var(--text-secondary)]">没有匹配的组件</p>
        )}
      </div>
    </aside>
  );
}
