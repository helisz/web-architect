import { useDbStatus } from '../data/useDbStatus.js';
import { missingEnv } from '../lib/env.js';
import { useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { EdgeSettings } from './EdgeSettings.js';
import { useTransfer } from '../hooks/useTransfer.js';
import { AccountMenu } from './AccountMenu.js';
import { GuestAccount } from './GuestAccount.js';
import { useGuestSession } from '../data/guestSession.js';
import { ToolIcon, type ToolIconName } from './ToolIcons.js';
import { goToGallery } from '../data/navigate.js';

const SAVE_LABEL: Record<string, string> = {
  saved: '已保存',
  saving: '保存中…',
  dirty: '未保存',
};

function SaveBadge({ state }: { state: string }) {
  // 用户 2026-11-04：去掉底色/边框，只留状态色文字，和版本号同一行同一字号
  const tone =
    state === 'saved'
      ? 'text-emerald-600'
      : state === 'saving'
        ? 'text-amber-600'
        : 'text-[var(--text-secondary)]';
  return <span className={`shrink-0 text-[11px] leading-4 ${tone}`}>{SAVE_LABEL[state] ?? state}</span>;
}

/**
 * 数据库状态：绿点 + 数据库图标，状态原因只在 tooltip 里说（用户 2026-11-04 要求）。
 * 失败仍然是红点 —— 颜色本身就要能看出问题，不必先 hover。
 */
function DbStatus() {
  const state = useDbStatus();

  const { color, title } =
    state.kind === 'checking'
      ? { color: '#9CA3AF', title: '正在探测 Supabase…' }
      : state.kind === 'up'
        ? { color: '#10B981', title: `数据库正常 · ${state.latencyMs}ms（PostgREST 可达，arch_diagram 可读）` }
        : { color: '#DC2626', title: `数据库不可用：${state.message}` };

  return (
    <span className="flex items-center gap-1 pr-1" title={title} aria-label={title}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <ToolIcon name="database" size={15} className="text-[var(--text-secondary)]" />
    </span>
  );
}

/** 顶栏图标按钮：32×32，靠 title 做 tooltip */
function IconButton({
  icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: ToolIconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded ${
        active
          ? 'bg-[#EFF6FF] text-[var(--primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)]'
      } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      <ToolIcon name={icon} size={17} />
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-[var(--panel-border)]" />;
}

/**
 * 顶部栏（规格 §3.2）。用户 2026-11-04 定稿：48px 高，功能按钮只留图标 + tooltip，
 * 只有「导入 / 导出」保留 icon + 文字。
 */
/** 顶栏最右：当前账号 + 退出登录（用户 2026-11-04 第三批） */

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
  const { exportJson, exportPng, exportSvg, exportPdf, exportCsv, copyImage, importJson } =
    useTransfer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const showGrid = useDiagramStore((s) => s.showGrid);
  const componentPanelOpen = useDiagramStore((s) => s.componentPanelOpen);
  const versionOpen = useDiagramStore((s) => s.versionOpen);
  // 游客模式（用户 2026-11-05）：账号区换成本机胶囊，版本历史与数据库探针都不适用
  const guest = useGuestSession((s) => s.guest);
  const pushToast = useDiagramStore((s) => s.pushToast);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-3">
      <div className="flex min-w-0 items-center gap-2">
        {/* 最左边：回图库（用户 2026-11-04：原来的「图库」按钮换成这个） */}
        <button
          type="button"
          onClick={() => void goToGallery()}
          title="返回图库"
          aria-label="返回图库"
          className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="chevronLeft" size={18} />
        </button>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-[var(--primary)] text-[13px] font-semibold text-white">
          架
        </span>
        <input
          aria-label="图名"
          value={name}
          onChange={(e) => rename(e.target.value)}
          className="w-52 min-w-0 rounded border border-transparent px-1.5 py-1 text-[13px] font-semibold outline-none hover:border-[var(--panel-border)] focus:border-[var(--primary)]"
        />
        <div className="flex shrink-0 items-baseline gap-2">
          <SaveBadge state={saveState} />
          <span
            className="mono text-[11px] leading-4 text-[var(--text-secondary)]"
            title={lastSavedAt ? `上次保存 ${new Date(lastSavedAt).toLocaleString()}` : '尚未保存'}
          >
            v{version}
          </span>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        {guest ? (
          <span className="pr-1 text-[11px] text-[#92400E]" title="游客模式：数据存在浏览器本地，不连数据库">
            本机存储
          </span>
        ) : missingEnv.length > 0 ? (
          <span className="text-xs text-amber-600">缺环境变量：{missingEnv.join(', ')}</span>
        ) : (
          <DbStatus />
        )}
        <Divider />
        <IconButton
          icon="undo"
          label="撤销（Ctrl+Z）"
          disabled={pastCount === 0 || historyLocked}
          onClick={() => undo()}
        />
        <IconButton
          icon="redo"
          label="重做（Ctrl+Shift+Z / Ctrl+Y）"
          disabled={futureCount === 0 || historyLocked}
          onClick={() => redo()}
        />
        <Divider />
        <IconButton
          icon="history"
          label="版本历史（快照与回滚）"
          active={versionOpen}
          onClick={() => {
            // 游客不存历史版本：数据只在本机，5MB 配额也撑不住快照
            if (guest) {
              pushToast('游客模式不保存历史版本；需要留档请导出 JSON', 'info');
              return;
            }
            // 版本栏和属性面板共用右侧一列：开版本栏就先清掉选中
            useDiagramStore.getState().select(null);
            useDiagramStore.getState().setVersionOpen(true);
          }}
        />
        <EdgeSettings />
        {/* 用户 2026-11-05：图层按钮挪到画布右上角（拖动模式左边），顶栏这里换成组件库开关 */}
        <IconButton
          icon="panelLeft"
          label={componentPanelOpen ? '隐藏组件库' : '显示组件库'}
          active={componentPanelOpen}
          onClick={() => useDiagramStore.getState().setComponentPanelOpen(!componentPanelOpen)}
        />
        <IconButton
          icon="grid"
          label={showGrid ? '隐藏网格' : '显示网格'}
          active={showGrid}
          onClick={() => useDiagramStore.getState().toggleGrid()}
        />
        <Divider />
        <IconButton
          icon="search"
          label="搜索定位（Ctrl+F）"
          onClick={() => useDiagramStore.getState().setSearchOpen(true)}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="导入 JSON（会作为一个新图打开，原有图不受影响）"
          className="ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[#F3F4F6] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="import" size={15} />
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
            title="导出为 JSON / PNG / SVG / PDF / CSV"
            className="flex shrink-0 items-center gap-1 rounded bg-[var(--primary)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)]"
          >
            <ToolIcon name="export" size={15} />
            导出 ▾
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-md border border-[var(--panel-border)] bg-white py-1 shadow-md"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuLabel>工程文件</MenuLabel>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  exportJson();
                }}
              >
                导出 JSON
              </MenuItem>

              <MenuLabel>图片</MenuLabel>
              {/* 复制到剪贴板（用户 2026-11-04 第二批）：固定 2× 白底 PNG，粘到文档/IM 里就能用 */}
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void copyImage();
                }}
              >
                复制图片（2× PNG，白底）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPng(1);
                }}
              >
                导出 PNG（1×）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPng(2);
                }}
              >
                导出 PNG（2×，推荐）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPng(3);
                }}
              >
                导出 PNG（3×）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPng(2, true);
                }}
              >
                导出 PNG（2×，透明底）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportSvg();
                }}
              >
                导出 SVG
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPdf('a4');
                }}
              >
                导出 PDF（A4 横向）
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  void exportPdf('a3');
                }}
              >
                导出 PDF（A3 横向）
              </MenuItem>

              <MenuLabel>清单</MenuLabel>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  exportCsv('nodes');
                }}
              >
                导出节点 CSV
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuOpen(false);
                  exportCsv('edges');
                }}
              >
                导出连线 CSV
              </MenuItem>
            </div>
          )}
        </div>

        {/* 账号挪到最右边（用户 2026-11-05）；跟导出按钮之间加一条分隔线，别贴着 */}
        <Divider />
        {guest ? <GuestAccount /> : <AccountMenu />}
      </div>
    </header>
  );
}

/** 导出菜单的分组标题 */
function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-[var(--text-secondary)]">
      {children}
    </p>
  );
}

/** 导出菜单项 */
function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[#F3F4F6]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}