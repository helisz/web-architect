import { useEffect, useRef, useState } from 'react';
import { Canvas } from './canvas/Canvas.js';
import { ComponentPanel } from './components/ComponentPanel.js';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog.js';
import { SaveBanner } from './components/SaveBanner.js';
import { StartupError } from './components/StartupError.js';
import { ToastHost } from './components/ToastHost.js';
import { TopBar } from './components/TopBar.js';
import { Gallery } from './components/Gallery.js';
import { GuestBanner } from './components/GuestBanner.js';
import { GuestImportDialog } from './components/GuestImportDialog.js';
import { AuthSplash, LoginPage } from './components/LoginPage.js';
import { VersionPanel } from './components/VersionPanel.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { supabaseConfig } from './lib/env.js';
import { canLoadData, useAuth } from './lib/auth.js';
import { useGuestSession } from './data/guestSession.js';
import { guestDiagramCount, guestImportAsked } from './data/guestRepo.js';
import { navigateToGallery, useRoute } from './lib/route.js';
import { useAutosave, useRouteDiagram } from './data/usePersistence.js';
import { useWriterLock } from './data/tabLock.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useDiagramStore } from './store/useDiagramStore.js';

/**
 * 三栏骨架（规格 §3.1）：
 * 顶部 48px / 左 240px / 中 自适应 / 右 300px / 底部状态已并入画布左下角。
 *
 * 路由（用户 2026-11-04）：`#/` 是图库主页，`#/d/<diagramId>` 是具体某张图。
 * 右侧一列是复用的：选中元素 → 属性面板；点「版本」→ 版本历史（互斥）。
 *
 * 架构：无自建后端，浏览器用 anon key 直连 Supabase（ADR-0004）。
 */
export default function App() {
  // 登录（用户 2026-11-04 第三批）：Pages 是公开站点，数据权限收到 authenticated
  const auth = useAuth();
  const route = useRoute();
  // 游客模式（用户 2026-11-05）：没有会话也能进图库和画布，数据只写本机 localStorage
  const guest = useGuestSession((s) => s.guest);
  const exitGuest = useGuestSession((s) => s.exit);
  const [importOpen, setImportOpen] = useState(false);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const booted = useDiagramStore((s) => s.booted);
  const bootError = useDiagramStore((s) => s.bootError);
  const versionOpen = useDiagramStore((s) => s.versionOpen);
  const setVersionOpen = useDiagramStore((s) => s.setVersionOpen);
  const diagramId = useDiagramStore((s) => s.diagram.diagramId);
  const onCanvas = route.kind === 'diagram';

  // 图库页不跑画布快捷键：那边按 d / Delete 不该动任何图
  useShortcuts(onCanvas);
  useAutosave();
  // 只有登录后才拉数据（否则未登录那几次 401 会把 bootError 写进 store，登录后不再重试）
  useRouteDiagram(route, guest || canLoadData(auth.status));
  // 同一张图只让一个标签页在写：这是版本冲突最主要的来源
  useWriterLock(onCanvas ? diagramId : '', booted && onCanvas);

  // 右侧只有一列：选中元素时属性面板优先，版本栏让位
  useEffect(() => {
    if (versionOpen && selectedIds.length > 0) setVersionOpen(false);
  }, [versionOpen, selectedIds.length, setVersionOpen]);

  /*
   * 登录成功那一刻一律去图库（用户 2026-11-05）。
   * 只认「signed-out → signed-in」这次跃迁：刷新页面时 useAuth 也会经历 loading → signed-in，
   * 那时如果无条件跳图库，正在看 `#/d/<id>` 的人会被踢出去。
   */
  const prevAuthStatus = useRef(auth.status);
  useEffect(() => {
    if (prevAuthStatus.current === 'signed-out' && auth.status === 'signed-in') navigateToGallery();
    prevAuthStatus.current = auth.status;
  }, [auth.status]);

  /**
   * 从游客变成登录用户（用户 2026-11-05）：
   * 先退出游客模式（不然保存还会写 localStorage），再问一次要不要把本机的图导入账号。
   * 游客数据此时**原样保留**，等用户在弹窗里点"导入"才真正搬走。
   */
  useEffect(() => {
    if (auth.status !== 'signed-in' || !guest) return;
    const hasData = guestDiagramCount() > 0;
    exitGuest();
    if (hasData && !guestImportAsked()) setImportOpen(true);
  }, [auth.status, guest, exitGuest]);

  // 先过登录这道门：没会话就只看登录页，连图库都不渲染（数据请求一律不发）
  // 游客模式（用户 2026-11-05）不走这道门：没有会话也能进图库和画布，数据存本机
  if (auth.status === 'loading' && !guest) return <AuthSplash />;
  if (auth.status === 'signed-out' && !guest) {
    return (
      <>
        <LoginPage auth={auth} />
        <ToastHost />
      </>
    );
  }

  // 游客不需要 Supabase 配置：没有 env 也能画图（数据只在本机）
  if (!supabaseConfig && !guest) return <StartupError />;

  // 图库页不需要等任何图载入，先渲染出来（列表自己拉数据）
  if (!onCanvas) {
    return (
      <>
        {guest && <GuestBanner />}
        <Gallery />
        <ToastHost />
        {importOpen && <GuestImportDialog onClose={() => setImportOpen(false)} />}
      </>
    );
  }

  if (bootError) {
    return (
      <StartupError
        title="打开架构图失败"
        detail={bootError}
        hint="这张图可能已被删除，或者 Supabase 连不上。可以回到图库换一张，或检查 supabase/schema.sql 是否已执行。"
        backToGallery
      />
    );
  }

  if (!booted) {
    return (
      <div className="grid h-full place-items-center bg-[var(--canvas-bg)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <p className="text-sm text-[var(--text-secondary)]">正在打开这张架构图…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)] text-[var(--text-primary)]">
      {guest && <GuestBanner />}
      <TopBar />
      <SaveBanner />
      <div className="flex min-h-0 flex-1">
        <ComponentPanel />
        <Canvas />
        {selectedIds.length > 0 ? <PropertyPanel /> : versionOpen && <VersionPanel onClose={() => setVersionOpen(false)} />}
      </div>
      <DeleteConfirmDialog />
      <ToastHost />
      {importOpen && <GuestImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}