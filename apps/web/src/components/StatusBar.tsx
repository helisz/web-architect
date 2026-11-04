import { useDiagramStats, useDiagramStore } from '../store/useDiagramStore.js';

/** 底部状态栏（规格 §3.2）：28px，缩放 / 坐标 / 元素计数 / 快捷键提示 */
export function StatusBar() {
  const zoom = useDiagramStore((s) => s.diagram.viewport.zoom);
  const schemaVersion = useDiagramStore((s) => s.diagram.schemaVersion);
  const setViewport = useDiagramStore((s) => s.setViewport);
  const viewport = useDiagramStore((s) => s.diagram.viewport);
  const cursor = useDiagramStore((s) => s.cursor);
  const stats = useDiagramStats();

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 text-[11px] text-[var(--text-secondary)]">
      <button
        type="button"
        onClick={() => setViewport({ ...viewport, zoom: 1 })}
        className="mono rounded px-1 hover:bg-[#F3F4F6]"
        title="点击复位到 100%"
      >
        {Math.round(zoom * 100)}%
      </button>
      <span className="mono" title="光标所在的画布坐标（10px 网格）">
        x: {cursor ? Math.round(cursor.x) : '—'} / y: {cursor ? Math.round(cursor.y) : '—'}
      </span>
      <span>
        节点 {stats.nodeCount} · 连线 {stats.edgeCount} · 分组 {stats.groupCount}
      </span>
      <span className="ml-auto mono">schema v{schemaVersion}</span>
      <span className="hidden lg:inline">空格拖拽平移 · Ctrl+滚轮缩放 · Ctrl+F 搜索 · 右键菜单</span>
    </footer>
  );
}
