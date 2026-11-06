import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ToolIcon, type ToolIconName } from './ToolIcons.js';

/**
 * 右键菜单（规格 §4.6）：空白 / 节点 / 连线 / 分组 四套。
 *
 * 做成通用组件：调用方只给"菜单模型"，位置、子菜单、点外面关闭都由这里管，
 * 免得四套菜单各写一遍事件处理。
 *
 * 2026-11-06 修整（用户要求）：
 * - **对齐**：以前带二级菜单的行没有图标/勾选槽，文字比普通行少缩进 12px，菜单看着是错开的。
 *   现在所有行统一 `[图标 16px][文字 1fr][右侧 hint / ›]` 三列网格，有没有二级菜单都对齐；
 *   分组标题也补同样的左缩进。
 * - **图标**：按内容给每行配图标（按 label 关键字映射，避免把 50 处调用点全改一遍）；
 *   颜色类条目显示真实色块（`swatch`），比一个通用调色板图标直观。
 */

export type MenuNode =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      hint?: string;
      disabled?: boolean;
      danger?: boolean;
      checked?: boolean;
      /** 颜色类条目：直接画一个色块，优先于 icon */
      swatch?: string;
      onSelect: () => void;
    }
  | { kind: 'submenu'; label: string; items: MenuNode[]; disabled?: boolean; swatch?: string }
  | { kind: 'header'; label: string };

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuNode[];
  onClose: () => void;
}

/**
 * 按文字内容选图标。顺序有讲究：先判特例，再判通用词。
 * 没匹配到就返回 undefined（那一格留空，但占位照旧，对齐不受影响）。
 */
export function menuIconFor(label: string): ToolIconName | undefined {
  const text = label.trim();
  if (text === '解锁' || text === '解锁分组') return 'unlock';
  if (text === '锁定' || text === '锁定分组') return 'lock';
  if (text === '展开') return 'chevronDown';
  if (text === '折叠') return 'chevronUp';
  if (text.startsWith('置顶')) return 'arrowUp';
  if (text.startsWith('置底')) return 'arrowDown';
  if (text.startsWith('删除')) return 'trash';
  if (text.startsWith('复制') || text === '粘贴') return 'copy';
  if (text.startsWith('编辑') || text.startsWith('重命名')) return 'pencil';
  if (text.includes('分组')) return 'folder';
  if (text.startsWith('加入分组') || text.startsWith('移出分组')) return 'folder';
  if (text.includes('连线') || text.includes('线型') || text === '正交折线' || text === '直线' || text === '曲线')
    return 'link';
  if (text.includes('反转')) return 'swap';
  if (text.includes('颜色') || text.includes('样式') || text.includes('着色')) return 'palette';
  if (text.includes('默认')) return 'reset';
  if (text.includes('缩放复位')) return 'reset';
  if (text.includes('适配视图')) return 'fit';
  if (text.includes('全选')) return 'grid';
  if (text.includes('网格')) return 'grid';
  if (text.includes('导出 JSON')) return 'export';
  if (text.includes('导出 PNG') || text.includes('导出 SVG')) return 'image';
  if (text.includes('导出')) return 'export';
  if (text.includes('设置') || text.includes('属性面板')) return 'sliders';
  if (text.includes('节点')) return 'plus';
  if (text.includes('标注')) return 'pencil';
  return undefined;
}

/** 行内三列网格：图标列固定 16px，文字列吃掉剩余宽度，右侧放 hint 或 › */
const ROW = 'grid w-full grid-cols-[16px_1fr_auto] items-center gap-2 px-2.5 py-1.5 text-left text-[13px]';

function RowIcon({ name, tone }: { name?: ToolIconName; tone?: string }) {
  return (
    <span className={`grid h-4 w-4 place-items-center ${tone ?? 'text-[var(--text-secondary)]'}`}>
      {name ? <ToolIcon name={name} size={14} /> : null}
    </span>
  );
}

/** 颜色条目的色块：透明用棋盘格，其它直接填色 */
function Swatch({ color }: { color: string }) {
  const clear = color === 'transparent' || /^#[0-9a-f]{6}00$/i.test(color) || color === '#00000000';
  return (
    <span
      className="h-3.5 w-3.5 border border-[var(--hair-strong)]"
      style={
        clear
          ? {
              background:
                'repeating-conic-gradient(#fff 0% 25%, #E7E6E1 0% 50%) 0 0 / 5px 5px, linear-gradient(135deg, transparent 44%, #A3A29A 44% 56%, transparent 56%)',
            }
          : { background: color }
      }
    />
  );
}

function MenuList({
  items,
  onClose,
  depth,
}: {
  items: MenuNode[];
  onClose: () => void;
  depth: number;
}): JSX.Element {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <ul className="min-w-[180px] py-1">
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <li key={`sep-${index}`} className="my-1 h-px bg-[var(--panel-border)]" />;
        }
        if (item.kind === 'header') {
          return (
            <li
              key={`head-${index}`}
              className="px-2.5 py-1 pl-[34px] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-tertiary)]"
            >
              {item.label}
            </li>
          );
        }
        if (item.kind === 'submenu') {
          const open = openIndex === index;
          return (
            <li
              key={`sub-${index}`}
              className="relative"
              onMouseEnter={() => setOpenIndex(index)}
              onMouseLeave={() => setOpenIndex((current) => (current === index ? null : current))}
            >
              <button
                type="button"
                disabled={item.disabled}
                className={`${ROW} hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 ${
                  open ? 'bg-[var(--bg-hover)]' : ''
                }`}
                onClick={() => setOpenIndex(open ? null : index)}
              >
                {item.swatch ? <Swatch color={item.swatch} /> : <RowIcon name={menuIconFor(item.label)} />}
                <span className="truncate">{item.label}</span>
                <span className="text-[var(--text-tertiary)]">
                  <ToolIcon name="chevronRight" size={13} />
                </span>
              </button>
              {open && (
                <div className="absolute left-full top-0 z-10 -mt-1 max-h-[320px] overflow-y-auto border border-[var(--glass-line)] bg-white shadow-[0_8px_24px_rgba(26,26,24,0.12)]">
                  <MenuList items={item.items} onClose={onClose} depth={depth + 1} />
                </div>
              )}
            </li>
          );
        }
        const tone = item.danger ? 'text-[var(--err)]' : undefined;
        return (
          <li key={`item-${index}`}>
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={`${ROW} hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? 'text-[var(--err)]' : ''
              }`}
            >
              {item.swatch ? <Swatch color={item.swatch} /> : <RowIcon name={menuIconFor(item.label)} tone={item.checked ? 'text-[var(--primary)]' : tone} />}
              <span className="truncate">{item.label}</span>
              <span className="flex items-center gap-2">
                {item.checked && <span className="text-[11px] text-[var(--primary)]">✓</span>}
                {item.hint && (
                  <span className="mono text-[11px] text-[var(--text-tertiary)]">{item.hint}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // 关闭回调每次渲染都是新函数；用 ref 存最新的，事件监听只注册一次。
  // （之前把 onClose 放进 deps，父级一有状态变化就"移除→重注册"，
  //   实测在连续重渲染时会出现监听缺口，按 Esc 关不掉菜单。）
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // 贴边时往回收，别让菜单跑出视口
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;
    setPos({ x: Math.min(x, Math.max(8, maxX)), y: Math.min(y, Math.max(8, maxY)) });
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current();
    };
    // 捕获阶段：画布上的 pointerdown 会先被 RF 吃掉，这里抢在冒泡前关掉
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="fixed z-50 overflow-visible border border-[var(--glass-line)] bg-white shadow-[0_10px_28px_rgba(26,26,24,0.14)]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} depth={0} />
    </div>
  );
}
