import { useMemo, useState } from 'react';
import { COMPONENT_CATEGORIES, iconKeyFor } from '@arch/schema';
import type { ComponentSpec } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';

/** 拖拽时写入 dataTransfer 的 MIME，M1 的画布 drop 处理器读它 */
export const NODE_TYPE_MIME = 'application/x-arch-node-type';
/** 拖拽建分组用另一个 MIME：分组不是节点类型，不能混进 nodeType */
export const GROUP_MIME = 'application/x-arch-group';

/** 分组（泳道）卡片：拖进画布得到一个可命名、可折叠、可嵌套的框 */
function GroupCard() {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(GROUP_MIME, 'group');
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title="拖到画布创建分组（把节点拖进框里即归组，最多嵌套 3 层）"
      className="group flex h-8 cursor-grab items-center gap-1.5 rounded-md border border-dashed border-[var(--panel-border)] bg-[var(--panel-bg)] px-1.5 hover:border-[var(--primary)] active:cursor-grabbing"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[#F3F4F6] text-[11px] text-[var(--text-secondary)] group-hover:bg-[#EFF6FF] group-hover:text-[var(--primary)]">
        ▤
      </span>
      <span className="truncate text-xs text-[var(--text-primary)]">分组 / 泳道</span>
    </div>
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

/** 左侧组件面板（规格 §3.2 / §3.3）：240px，9 大分类 + 搜索 */
export function ComponentPanel() {
  const [keyword, setKeyword] = useState('');

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

  const total = categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="border-b border-[var(--panel-border)] p-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索组件…"
          className="w-full rounded border border-[var(--panel-border)] px-2 py-1.5 text-xs outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className="mb-3">
          <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
            结构
          </h3>
          <div className="space-y-1">
            <GroupCard />
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

      <div className="border-t border-[var(--panel-border)] p-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
        拖拽到画布即创建节点 · 共 {total} 个组件
        <br />
        自定义图标上传在阶段 2 接入
      </div>
    </aside>
  );
}



