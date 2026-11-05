/**
 * 解析结果的中转站（用户 2026-11-05）。
 *
 * 为什么要"暂存 + 到画布再落图"：
 * 解析是在图库（`#/gallery`）里完成的，但落图必须发生在目标图的画布上下文里，
 * 否则撤销栈里没有"空图"这一步，用户按 Ctrl+Z 就什么都撤不回来。
 *
 * 所以顺序是：图库先建一张空图并保存 → 把结果放这里（连同目标图 id）→ 跳到画布 →
 * 画布载入后取出结果、作为**一步**写进图里。这样一次撤销就能回到空图。
 *
 * 纯内存，不写 localStorage：解析结果只在这次跳转里有意义，刷新即作废。
 */

import type { LandingSpec } from './landing.js';

interface Staged {
  spec: LandingSpec;
  /** 只有当前打开的图等于它时才落图，避免跳错图 */
  diagramId: string;
}

let staged: Staged | null = null;

export function stageAiImport(spec: LandingSpec, diagramId: string): void {
  staged = { spec, diagramId };
}

export function peekStagedImport(): Staged | null {
  return staged;
}

/** 只有目标图匹配才取走（并且取走即清空，不会二次落图） */
export function takeStagedImport(diagramId: string): LandingSpec | null {
  if (!staged || staged.diagramId !== diagramId) return null;
  const spec = staged.spec;
  staged = null;
  return spec;
}

export function clearStagedImport(): void {
  staged = null;
}
