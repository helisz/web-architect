import { Canvas } from './canvas/Canvas.js';
import { ComponentPanel } from './components/ComponentPanel.js';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog.js';
import { SaveBanner } from './components/SaveBanner.js';
import { StartupError } from './components/StartupError.js';
import { StatusBar } from './components/StatusBar.js';
import { TopBar } from './components/TopBar.js';
import { Gallery } from './components/Gallery.js';
import { VersionDialog } from './components/VersionDialog.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { supabaseConfig } from './lib/env.js';
import { useAutosave, useBootstrap } from './data/usePersistence.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useDiagramStore } from './store/useDiagramStore.js';

/**
 * 三栏骨架（规格 §3.1）：
 * 顶部 56px / 左 240px / 中 自适应 / 右 300px（仅选中时出现）/ 底 28px。
 *
 * 架构：无自建后端，浏览器用 anon key 直连 Supabase（ADR-0004）。
 */
export default function App() {
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const booted = useDiagramStore((s) => s.booted);
  const bootError = useDiagramStore((s) => s.bootError);
  const view = useDiagramStore((s) => s.view);
  const versionOpen = useDiagramStore((s) => s.versionOpen);
  const setVersionOpen = useDiagramStore((s) => s.setVersionOpen);

  useBootstrap();
  useShortcuts();
  useAutosave();

  // 缺环境变量时不白屏，直接给可操作的修复指引
  if (!supabaseConfig) return <StartupError />;

  if (bootError) {
    return (
      <StartupError
        title="打开架构图失败"
        detail={bootError}
        hint="检查 Supabase 是否可达、supabase/schema.sql（含 arch_save_diagram 函数）是否已执行，然后刷新页面。"
      />
    );
  }

  if (!booted) {
    return (
      <div className="grid h-full place-items-center bg-[var(--canvas-bg)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
          <p className="text-sm text-[var(--text-secondary)]">正在打开最近编辑的架构图…</p>
        </div>
      </div>
    );
  }

  if (view === 'gallery') return <Gallery />;

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)] text-[var(--text-primary)]">
      <TopBar />
      <SaveBanner />
      <div className="flex min-h-0 flex-1">
        <ComponentPanel />
        <Canvas />
        {selectedIds.length > 0 && <PropertyPanel />}
      </div>
      <StatusBar />
      <DeleteConfirmDialog />
      {versionOpen && <VersionDialog onClose={() => setVersionOpen(false)} />}
    </div>
  );
}




