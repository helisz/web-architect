import { useEffect, useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 批量添加（用户 2026-11-07）。
 *
 * 点动态容器里的「＋」打开：一个小的浮层，右上角 ✕ 关闭、右下角「应用」，
 * 中间是多行文本框（每行一个节点）+ 右侧节点类型下拉。
 *
 * 为什么不做成模态遮罩：用户要的是"小的输入框"，弹在画布上方不挡住看稿；
 * 位置固定在画布区域顶部居中，尺寸稳定，不会随着容器位置乱跳。
 */

const NODE_TYPES = [
  { value: 'element' as const, label: '单行元素' },
  { value: 'element-h' as const, label: '单行元素(水平)' },
];

/** 一次最多把多少行变成节点（防手滑贴整篇文档） */
const MAX_LINES = 200;

export function BatchAddDialog() {
  const target = useDiagramStore((s) => s.batchTarget);
  const openBatch = useDiagramStore((s) => s.openBatch);
  const batchAdd = useDiagramStore((s) => s.batchAddToDynamic);
  const pushToast = useDiagramStore((s) => s.pushToast);
  const group = useDiagramStore((s) =>
    s.diagram.groups.find((g) => g.groupId === s.batchTarget) ?? null,
  );

  const [text, setText] = useState('');
  const [nodeType, setNodeType] = useState<'element' | 'element-h'>('element');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!target) return;
    setText('');
    // 打开就聚焦，直接能打字
    const timer = window.setTimeout(() => areaRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [target]);

  const lines = useMemo(
    () => text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0),
    [text],
  );
  const tooMany = lines.length > MAX_LINES;

  if (!target || !group) return null;

  const close = (): void => openBatch(null);

  const apply = (): void => {
    if (lines.length === 0) return;
    const added = batchAdd(target, lines.slice(0, MAX_LINES), nodeType);
    openBatch(null);
    pushToast(added > 0 ? `已添加 ${added} 个节点` : '没有可添加的内容', added > 0 ? 'success' : 'info');
  };

  return (
    <div
      role="dialog"
      aria-label="批量添加节点"
      className="glass anim-window fixed left-1/2 top-[84px] z-50 w-[380px] -translate-x-1/2 rounded-lg p-3"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">批量添加</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
            加到「{group.label || '动态组'}」· 每行一个节点
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          title="关闭"
          aria-label="关闭"
          className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="close" size={14} />
        </button>
      </div>

      <div className="flex gap-2">
        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter 直接应用
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
            if (e.key === 'Escape') close();
            e.stopPropagation();
          }}
          rows={7}
          placeholder={'一行一个节点，例如：\n防火墙\n负载均衡\n数据库'}
          className="mono h-[150px] min-w-0 flex-1 resize-none rounded border border-[var(--hair-strong)] bg-white px-2 py-1.5 text-[12px] leading-5 outline-none focus:border-[var(--primary)]"
        />
        <select
          value={nodeType}
          onChange={(e) => setNodeType(e.target.value as 'element' | 'element-h')}
          title="节点类型"
          aria-label="节点类型"
          className="h-fit w-[104px] shrink-0 rounded border border-[var(--hair-strong)] bg-white px-1 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
        >
          {NODE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${tooMany ? 'text-[var(--err)]' : 'text-[var(--text-secondary)]'}`}>
          {lines.length === 0
            ? '每行一个节点'
            : `${lines.length} 个节点${tooMany ? `（最多 ${MAX_LINES} 个）` : ''}`}
        </span>
        <button
          type="button"
          onClick={apply}
          disabled={lines.length === 0}
          className="rounded bg-[var(--primary)] px-3 py-1 text-[12px] text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
        >
          应用
        </button>
      </div>
    </div>
  );
}
