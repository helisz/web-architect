import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * 右键菜单（规格 §4.6）：空白 / 节点 / 连线 / 分组 四套。
 *
 * 做成通用组件：调用方只给"菜单模型"，位置、子菜单、点外面关闭都由这里管，
 * 免得四套菜单各写一遍事件处理。
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
      onSelect: () => void;
    }
  | { kind: 'submenu'; label: string; items: MenuNode[]; disabled?: boolean }
  | { kind: 'header'; label: string };

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuNode[];
  onClose: () => void;
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
    <ul className="min-w-[168px] py-1">
      {items.map((item, index) => {
        if (item.kind === 'separator') {
          return <li key={`sep-${index}`} className="my-1 h-px bg-[var(--panel-border)]" />;
        }
        if (item.kind === 'header') {
          return (
            <li
              key={`head-${index}`}
              className="px-3 py-1 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]"
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
                className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[13px] hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setOpenIndex(open ? null : index)}
              >
                <span>{item.label}</span>
                <span className="text-[var(--text-secondary)]">›</span>
              </button>
              {open && (
                <div className="absolute left-full top-0 z-10 -mt-1 max-h-[320px] overflow-y-auto rounded-md border border-[var(--panel-border)] bg-white shadow-lg">
                  <MenuList items={item.items} onClose={onClose} depth={depth + 1} />
                </div>
              )}
            </li>
          );
        }
        return (
          <li key={`item-${index}`}>
            <button
              type="button"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[13px] hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40 ${
                item.danger ? 'text-[#D83931]' : ''
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="w-3 text-[10px] text-[var(--primary)]">{item.checked ? '✓' : ''}</span>
                {item.label}
              </span>
              {item.hint && <span className="mono text-[11px] text-[var(--text-secondary)]">{item.hint}</span>}
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
      className="fixed z-50 overflow-visible rounded-md border border-[var(--panel-border)] bg-white shadow-lg"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuList items={items} onClose={onClose} depth={0} />
    </div>
  );
}
