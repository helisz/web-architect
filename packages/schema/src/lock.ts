import type { ArchitectureDiagram } from './types.js';

/**
 * 全局「锁定编辑」（用户 2026-11-04 第二批）。
 *
 * 存在 `arch_diagram.ext_json` 里（`editLocked: true`），随图保存 —— 换电脑、换浏览器
 * 打开这张图，它仍然是锁定的。需要一次性 SQL：`supabase/patch-diagram-ext.sql`。
 *
 * 没跑 SQL 时也不会坏：读不到 ext_json 就当作未锁定，切换锁定时前端静默退回本地状态
 * （见 `useDiagramStore.setEditLocked`）。
 */
export function isEditLocked(diagram: Pick<ArchitectureDiagram, 'extJson'> | undefined): boolean {
  return diagram?.extJson?.editLocked === true;
}

/** 生成新的 extJson（保留其它键） */
export function withEditLock(
  extJson: Record<string, unknown> | undefined,
  locked: boolean,
): Record<string, unknown> {
  return { ...(extJson ?? {}), editLocked: locked };
}

/** diagram.extJson 只接受普通对象，其它一律当空 */
export function normalizeDiagramExt(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
