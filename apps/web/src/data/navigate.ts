import { flushPendingSave } from '../data/usePersistence.js';
import { navigateToDiagram, navigateToGallery } from '../lib/route.js';

/**
 * 带"先存再走"的导航。
 *
 * 用户 2026-11-04 定稿：回图库 / 换图之前先把未保存的改动刷一次。
 * 这里只做一层薄包装，判定与失败处理都在 `flushPendingSave` 里。
 */
export async function goToGallery(): Promise<void> {
  await flushPendingSave();
  navigateToGallery();
}

export async function goToDiagram(diagramId: string): Promise<void> {
  await flushPendingSave();
  navigateToDiagram(diagramId);
}
