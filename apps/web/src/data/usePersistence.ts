import { useEffect, useRef } from 'react';
import { createEmptyDiagram } from '@arch/schema';
import type { ArchitectureDiagram } from '@arch/schema';
import { listDiagrams, loadDiagram, saveDiagram, type SaveResult } from './diagramRepo.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 启动流程：打开最近编辑的一张图；库里没有就新建并立刻落一次库。
 *
 * 为什么新建也要立刻存：否则用户拖了两个节点就刷新，画布是空的 —— 图上
 * 什么都没有时没有"脏"可保存，反而会丢图。
 */
export function useBootstrap(): void {
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const setBooted = useDiagramStore((s) => s.setBooted);
  const setBootError = useDiagramStore((s) => s.setBootError);
  const applySaved = useDiagramStore((s) => s.applySaved);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const summaries = await listDiagrams();
        const target = summaries[0];

        if (target) {
          const loaded = await loadDiagram(target.diagramId);
          if (cancelled) return;
          if (loaded.issues.length > 0) {
            console.warn('[arch] 载入时修复了若干问题：', loaded.issues.slice(0, 10));
          }
          setDiagram(loaded.diagram, { persisted: true });
        } else {
          const fresh = createEmptyDiagram({ name: '未命名架构图' });
          if (cancelled) return;
          setDiagram(fresh);
          const saved = await saveDiagram(fresh, null);
          if (cancelled) return;
          if (saved.ok) applySaved(saved.version, saved.savedAt);
          else if (saved.reason === 'missing_function') {
            // 保存函数还没建：允许继续编辑，但别让自动保存每 800ms 撞一次
            useDiagramStore.getState().setSaveDisabled(true);
            useDiagramStore.getState().setSaveError(saved.message);
          } else if (saved.reason !== 'version_conflict') {
            setBootError(saved.message);
            return;
          }
        }

        if (!cancelled) setBooted(true);
      } catch (error) {
        if (cancelled) return;
        setBootError(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applySaved, setBooted, setBootError, setDiagram]);
}

/* ------------------------------------------------------------------ */
/* 自动保存                                                            */
/* ------------------------------------------------------------------ */

/** 编辑停顿多久后存盘 */
const DEBOUNCE_MS = 800;

/**
 * 串行队列：同一时刻只允许一个保存请求在途（C14）。
 *
 * 只保留"最新一次"待存内容 —— 中间态没有意义，存最新的就行。
 */
let chain: Promise<void> = Promise.resolve();
let pending: ArchitectureDiagram | null = null;

function enqueue(diagram: ArchitectureDiagram): void {
  pending = diagram;
  chain = chain.then(async () => {
    const next = pending;
    pending = null;
    if (!next) return;
    await runSave(next);
  });
}

async function runSave(diagram: ArchitectureDiagram): Promise<void> {
  const store = useDiagramStore.getState();
  store.markSaving();

  // 首次保存（服务端还没有这张图）必须不带基线，否则会插出一条重复的图
  const result: SaveResult = await saveDiagram(diagram, store.persisted ? diagram.version : null);

  const after = useDiagramStore.getState();
  // 保存期间用户又改了 → 不要把状态改成"已保存"
  const stillCurrent = after.diagram.diagramId === diagram.diagramId;

  if (result.ok) {
    if (!stillCurrent) return;
    const dirtyAgain = after.saveState === 'dirty';
    after.applySaved(result.version, result.savedAt);
    // applySaved 会把状态置为 saved；若在途期间又脏了，恢复成 dirty 让队列继续
    if (dirtyAgain) after.markDirty();
    return;
  }

  if (result.reason === 'version_conflict') {
    after.setConflict({ currentVersion: result.currentVersion, message: result.message });
    after.markDirty();
    return;
  }

  if (result.reason === 'missing_function') {
    after.setSaveDisabled(true);
    after.setSaveError(result.message);
    after.markDirty();
    return;
  }

  if (result.reason === 'invalid') {
    // 数据不合法：不进网络、不丢状态，只把"哪个字段不对"摆到界面上
    after.setSaveError(result.message);
    after.markDirty();
    return;
  }

  after.setSaveError(result.message);
  after.markDirty();
}

/**
 * 脏了就在 800ms 后存；冲突未解决时暂停自动保存，避免把冲突刷成错误风暴。
 */
export function useAutosave(): void {
  const diagram = useDiagramStore((s) => s.diagram);
  const saveState = useDiagramStore((s) => s.saveState);
  const booted = useDiagramStore((s) => s.booted);
  const conflict = useDiagramStore((s) => s.conflict);
  const saveDisabled = useDiagramStore((s) => s.saveDisabled);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!booted || conflict || saveDisabled || saveState !== 'dirty') return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      enqueue(useDiagramStore.getState().diagram);
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [diagram, saveState, booted, conflict, saveDisabled]);

  // 关页面前尽量把未存的改动刷出去
  useEffect(() => {
    const flush = (): void => {
      const state = useDiagramStore.getState();
      if (state.saveState === 'dirty' && !state.conflict && !state.saveDisabled) enqueue(state.diagram);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);
}

/** 冲突时"重新载入"：丢掉本地改动，以库内为准 */
export async function reloadFromServer(): Promise<void> {
  const store = useDiagramStore.getState();
  const loaded = await loadDiagram(store.diagram.diagramId);
  store.setDiagram(loaded.diagram, { persisted: true });
}

/** 冲突时"覆盖保存"：跳过版本校验，把自己的版本压上去 */
export function forceSave(): void {
  const store = useDiagramStore.getState();
  store.setConflict(null);
  chain = chain.then(async () => {
    const current = useDiagramStore.getState();
    current.markSaving();
    const result = await saveDiagram(current.diagram, null);
    const after = useDiagramStore.getState();
    if (result.ok) after.applySaved(result.version, result.savedAt);
    else {
      after.setSaveError(result.message);
      after.markDirty();
    }
  });
}


