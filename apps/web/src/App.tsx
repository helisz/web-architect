import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas.js';
import { ComponentPanel } from './components/ComponentPanel.js';
import { DeleteConfirmDialog } from './components/DeleteConfirmDialog.js';
import { SaveBanner } from './components/SaveBanner.js';
import { StartupError } from './components/StartupError.js';
import { TopBar } from './components/TopBar.js';
import { Gallery } from './components/Gallery.js';
import { VersionPanel } from './components/VersionPanel.js';
import { PropertyPanel } from './components/PropertyPanel.js';
import { supabaseConfig } from './lib/env.js';
import { useAutosave, useBootstrap } from './data/usePersistence.js';
import { useWriterLock } from './data/tabLock.js';
import { useShortcuts } from './hooks/useShortcuts.js';
import { useDiagramStore } from './store/useDiagramStore.js';

/**
 * 三栏骨架（规格 §3.1）：
 * 顶部 48px / 左 240px / 中 自适应 / 右 300px / 底部状态条已并入画布左下角。
 *
 * 右侧一列是复用的：选中元素 → 属性面板；点「版本」→ 版本历史。
 * 两者互斥（用户 2026-11-04 选 A），所以选中时直接收起版本栏。
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
  const diagramId = useDiagramStore((s) => s.diagram.diagramId);

  useBootstrap();
  useShortcuts();
  useAutosave();
  // 同一张图只让一个标签页在写：这是版本冲突最主要的来源
  useWriterLock(diagramId, booted);

  // 右侧只有一列：选中元素时属性面板优先，版本栏让位
  useEffect(() => {
    if (versionOpen && selectedIds.length > 0) setVersionOpen(false);
  }, [versionOpen, selectedIds.length, setVersionOpen]);

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
        {selectedIds.length > 0 ? <PropertyPanel /> : versionOpen && <VersionPanel onClose={() => setVersionOpen(false)} />}
      </div>
      <DeleteConfirmDialog />
    </div>
  );
}
