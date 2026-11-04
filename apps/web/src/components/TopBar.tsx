import { useDbStatus } from '../data/useDbStatus.js';
import { missingEnv } from '../lib/env.js';
import { useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { EdgeSettings } from './EdgeSettings.js';
import { useTransfer } from '../hooks/useTransfer.js';

const SAVE_LABEL: Record<string, string> = {
  saved: '已保存',
  saving: '保存中…',
  dirty: '未保存',
};

function SaveBadge({ state }: { state: string }) {
  const tone =
    state === 'saved'
      ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
      : state === 'saving'
        ? 'text-amber-600 bg-amber-50 border-amber-200'
        : 'text-[var(--text-secondary)] bg-[#F3F4F6] border-[var(--panel-border)]';
  return (
    <span className={`rounded border px-2 py-0.5 text-xs ${tone}`}>{SAVE_LABEL[state] ?? state}</span>
  );
}

function DbDot() {
  const state = useDbStatus();

  const { color, text, title } =
    state.kind === 'checking'
      ? { color: '#9CA3AF', text: '连接中', title: '正在探测 Supabase' }
      : state.kind === 'up'
        ? { color: '#10B981', text: `数据库正常 ${state.latencyMs}ms`, title: 'PostgREST 可达，arch_diagram 可读' }
        : { color: '#DC2626', text: '数据库不可用', title: state.message };

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-xs text-[var(--text-secondary)]">{text}</span>
    </div>
  );
}

/**
 * 顶部栏（规格 §3.2）：56px。
 * 规格里的"AI 输入框"按决定整章裁除；撤销/重做/导出按钮留给 M2/M3。
 */
export function TopBar() {
  const name = useDiagramStore((s) => s.diagram.name);
  const version = useDiagramStore((s) => s.diagram.version);
  const rename = useDiagramStore((s) => s.rename);
  const saveState = useDiagramStore((s) => s.saveState);
  const lastSavedAt = useDiagramStore((s) => s.lastSavedAt);
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  // 直接选长度：数字稳定，不会触发 zustand 的无限重渲染
  const pastCount = useDiagramStore((s) => s.past.length);
  const futureCount = useDiagramStore((s) => s.future.length);
  // 删除确认框弹着的时候不允许动历史
  const historyLocked = useDiagramStore((s) => s.pendingDelete !== null);
  const { exportJson, exportPng, importJson } = useTransfer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const layerOpen = useDiagramStore((s) => s.layerPanelOpen);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded bg-[var(--primary)] text-sm font-semibold text-white">
          架
        </span>
        <input
          aria-label="图名"
          value={name}
          onChange={(e) => rename(e.target.value)}
          className="w-56 rounded border border-transparent px-2 py-1 text-sm font-semibold outline-none hover:border-[var(--panel-border)] focus:border-[var(--primary)]"
        />
        <SaveBadge state={saveState} />
        <span
          className="mono text-[11px] text-[var(--text-secondary)]"
          title={lastSavedAt ? `上次保存 ${new Date(lastSavedAt).toLocaleString()}` : '尚未保存'}
        >
          v{version}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {missingEnv.length > 0 ? (
          <span className="text-xs text-amber-600">缺环境变量：{missingEnv.join(', ')}</span>
        ) : (
          <DbDot />
        )}
        <div className="mx-2 h-5 w-px bg-[var(--panel-border)]" />
        <button
          type="button"
          disabled={pastCount === 0 || historyLocked}
          title="撤销（Ctrl+Z）"
          onClick={() => undo()}
          className="rounded border border-[var(--panel-border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-40"
        >
          撤销
        </button>
        <button
          type="button"
          disabled={futureCount === 0 || historyLocked}
          title="重做（Ctrl+Shift+Z / Ctrl+Y）"
          onClick={() => redo()}
          className="rounded border border-[var(--panel-border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-40"
        >
          重做
        </button>
        <EdgeSettings />
        <button
          type="button"
          onClick={() => useDiagramStore.getState().setLayerPanelOpen(!layerOpen)}
          title="图层（调整遮挡与上下层级）"
          className={`rounded border px-2.5 py-1 text-xs ${
            layerOpen
              ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
              : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[#F9FAFB]'
          }`}
        >
          图层
        </button>
        <button
          type="button"
          onClick={() => useDiagramStore.getState().setSearchOpen(true)}
          title="搜索定位（Ctrl+F）"
          className="rounded border border-[var(--panel-border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F9FAFB]"
        >
          搜索
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="导入 JSON（会作为一个新图打开，原有图不受影响）"
          className="rounded border border-[var(--panel-border)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F9FAFB]"
        >
          导入
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) await importJson(file);
          }}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            title="导出为 JSON / PNG"
            className="rounded bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)]"
          >
            导出 ▾
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-[var(--panel-border)] bg-white shadow-md"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F3F4F6]"
                onClick={() => {
                  setMenuOpen(false);
                  exportJson();
                }}
              >
                导出 JSON
              </button>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-xs hover:bg-[#F3F4F6]"
                onClick={async () => {
                  setMenuOpen(false);
                  await exportPng();
                }}
              >
                导出 PNG（2×）
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}


