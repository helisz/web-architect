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
import { flushNow } from '../data/usePersistence.js';
import { DiagramBadge } from './DiagramBadge.js';

const SAVE_LABEL: Record<string, string> = {
  saved: '已保存',
  saving: '保存中…',
  dirty: '未保存',
};

/**
 * 保存按钮（用户 2026-11-07）：软盘图标 + 右下角状态灯，悬停弹出保存详情。
 *
 * 状态灯：绿=已保存、灰=有改动未保存、琥珀=保存中、红=冲突或保存被禁用。
 * 点击 = 立刻写一次（等价 Ctrl+S，绕过节流）。
 */
function SaveButton() {
  const saveState = useDiagramStore((s) => s.saveState);
  const lastSavedAt = useDiagramStore((s) => s.lastSavedAt);
  const version = useDiagramStore((s) => s.diagram.version);
  const persisted = useDiagramStore((s) => s.persisted);
  const saveDisabled = useDiagramStore((s) => s.saveDisabled);
  const saveError = useDiagramStore((s) => s.saveError);
  const conflict = useDiagramStore((s) => s.conflict);

  const blocked = saveDisabled || conflict !== null;
  const tone = blocked
    ? 'bg-[var(--err)]'
    : saveState === 'saving'
      ? 'bg-amber-500'
      : saveState === 'dirty'
        ? 'bg-[var(--text-tertiary)]'
        : 'bg-emerald-500';
  const stateText = blocked
    ? conflict
      ? '有冲突，需要先处理'
      : '保存不可用'
    : (SAVE_LABEL[saveState] ?? saveState);
  const detail = conflict?.message ?? saveError ?? null;

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        title={blocked ? stateText : '保存（Ctrl+S）'}
        aria-label="保存"
        disabled={blocked}
        onClick={() => flushNow()}
        className="relative grid h-8 w-8 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ToolIcon name="save" size={17} />
        {/* 状态灯：右下角一颗小圆点，描一圈底色把它和图标分开 */}
        <span
          aria-hidden
          className={`absolute bottom-1 right-1 h-[7px] w-[7px] rounded-full ring-2 ring-[var(--panel-bg)] ${tone} ${
            saveState === 'saving' ? 'animate-pulse' : ''
          }`}
        />
      </button>

      {/* 悬停弹出：保存状态详情 */}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 rounded-[var(--radius-card)] border border-[var(--glass-line)] bg-[var(--panel-bg)] p-2.5 text-[11px] leading-5 opacity-0 shadow-[0_10px_28px_rgba(26,26,24,0.14)] transition-opacity duration-150 group-hover:opacity-100"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-secondary)]">保存状态</span>
          <span className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
            {stateText}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-secondary)]">上次保存</span>
          <span className="mono text-[var(--text-primary)]">
            {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未保存'}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[var(--text-secondary)]">当前版本</span>
          <span className="mono text-[var(--text-primary)]">v{version}</span>
        </div>
        {detail && (
          <p className="mt-1 line-clamp-3 border-t border-[var(--panel-border)] pt-1 text-[var(--err)]">{detail}</p>
        )}
        <p className="mt-1 border-t border-[var(--panel-border)] pt-1 text-[var(--text-tertiary)]">
          {persisted ? '点击保存，或按 Ctrl+S' : '这张图还没写过库，先做一次改动会自动创建'}
        </p>
      </div>
    </div>
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
          ? 'bg-[var(--accent-50)] text-[var(--primary-text)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
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
  const rename = useDiagramStore((s) => s.rename);
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
  // 图名（2026-11-08）：默认只读，点铅笔进入编辑，确定才保存
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const commitName = (): void => {
    const next = nameDraft.trim() || '未命名架构图';
    if (next !== name) rename(next);
    setEditingName(false);
  };
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
          className="-ml-1 grid h-8 w-8 shrink-0 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="chevronLeft" size={18} />
        </button>
        {/* 图名图标 = 图名前两个字符（2026-11-08），和图库卡片共用 */}
        <DiagramBadge name={name} />
        {editingName ? (
          <span className="flex min-w-0 items-center gap-1">
            <input
              autoFocus
              aria-label="图名"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setEditingName(false);
                e.stopPropagation();
              }}
              onBlur={() => commitName()}
              className="w-52 min-w-0 rounded border border-[var(--primary)] px-1.5 py-1 text-[13px] font-semibold outline-none"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitName}
              className="shrink-0 rounded bg-[var(--primary-solid)] px-1.5 py-0.5 text-[11px] text-white hover:brightness-95"
            >
              确定
            </button>
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-1">
            <span className="max-w-[220px] truncate text-[13px] font-semibold" title={name || '未命名架构图'}>
              {name || '未命名架构图'}
            </span>
            <button
              type="button"
              title="修改图名"
              aria-label="修改图名"
              onClick={() => {
                setNameDraft(name);
                setEditingName(true);
              }}
              className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <ToolIcon name="pencil" size={13} />
            </button>
          </span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {/* 2026-11-07 用户要求：隐藏「已保存」文字与版本号（状态/版本看保存按钮的 hover 弹层）；
              保存 → 撤销 → 重做 → 版本历史 全部收在这一簇 */}
          <SaveButton />
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
        </div>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        {guest ? (
          <span className="pr-1 text-[11px] text-[#92400E]" title="游客模式：数据存在浏览器本地，不连数据库">
            本机存储
          </span>
        ) : missingEnv.length > 0 ? (
          <span className="text-xs text-amber-600">缺环境变量：{missingEnv.join(', ')}</span>
        ) : null}
        <Divider />
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
        <IconButton
          icon="import"
          label="导入 JSON（会作为一个新图打开，原有图不受影响）"
          onClick={() => fileRef.current?.click()}
        />
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
            aria-label="导出"
            aria-expanded={menuOpen}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-ctl)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] data-[open=true]:bg-[var(--accent-50)] data-[open=true]:text-[var(--accent-600)]"
            data-open={menuOpen}
          >
            <ToolIcon name="export" size={17} />
          </button>
          {menuOpen && (
            <div
              className="glass absolute right-0 z-[80] mt-1 w-48 overflow-hidden rounded-[var(--radius-card)] py-1"
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
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-hover)]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}