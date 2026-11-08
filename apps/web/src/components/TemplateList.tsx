import { useCallback, useEffect, useState } from 'react';
import { deleteTemplate, listTemplates, saveTemplate, type TemplateSummary } from '../data/flowRepo.js';
import { emptyTemplateConfig } from '@arch/schema';
import { navigateToFlows, navigateToHome, navigateToTemplate } from '../lib/route.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 模板库（用户 2026-11-08）。
 *
 * 模板 = 流程节点的"类型定义"：一次接口请求 + 一套展示规则。
 * 管理员可以建公共模板（所有人可用），普通用户只能建私有模板（只有自己可见）。
 */

/** 公共模板只有管理员能建；普通用户点"新建公共"时给出提示 */
export function TemplateList() {
  const [rows, setRows] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRows(await listTemplates());
      setError(null);
    } catch (cause) {
      setError((cause as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async (visibility: 'public' | 'private'): Promise<void> => {
    setCreating(true);
    try {
      const templateId = crypto.randomUUID();
      await saveTemplate({
        templateId,
        name: visibility === 'public' ? '未命名公共模板' : '未命名模板',
        description: '',
        visibility,
        config: emptyTemplateConfig(),
      });
      navigateToTemplate(templateId);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (templateId: string): Promise<void> => {
    if (!window.confirm('删除这个模板？已经用它建好的流程节点不受影响（节点里存了快照）。')) return;
    try {
      await deleteTemplate(templateId);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--hair)] bg-white px-3">
        <button
          type="button"
          onClick={navigateToHome}
          aria-label="回产品选择"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-ctl)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="chevronLeft" size={16} />
        </button>
        <span className="text-[14px] font-semibold text-[var(--text-primary)]">模板库</span>
        <span className="mono text-[10px] tracking-[0.08em] text-[var(--text-tertiary)]">
          {rows === null ? '读取中…' : `共 ${rows.length} 个`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={navigateToFlows}
            className="rounded-[var(--radius-ctl)] border border-[var(--panel-border)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary-text)]"
          >
            去流程
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => void create('private')}
            className="rounded-[var(--radius-ctl)] border border-[var(--panel-border)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary-text)] disabled:opacity-60"
          >
            新建私有模板
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => void create('public')}
            className="rounded-[var(--radius-ctl)] bg-[var(--primary-solid)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-solid-hover)] disabled:opacity-60"
          >
            新建公共模板
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p className="mb-3 border border-[#E8B4A6] bg-[#FDF1EE] px-3 py-2 text-[12px] leading-5 text-[var(--err)]">
            {error}
          </p>
        )}

        {rows !== null && rows.length === 0 && (
          <div className="grid place-items-center py-20 text-center">
            <p className="text-[13px] text-[var(--text-secondary)]">还没有模板</p>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              模板定义「请求哪个接口、展示哪些字段、什么算成功」，流程节点按模板取数。
            </p>
          </div>
        )}

        {rows !== null && rows.length > 0 && (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((row) => (
              <li
                key={row.templateId}
                className="group relative flex flex-col border border-[var(--hair-strong)] bg-white p-3 transition-colors hover:border-[var(--primary)]"
              >
                <button
                  type="button"
                  aria-label={`编辑「${row.name}」`}
                  className="absolute inset-0 z-0"
                  onClick={() => navigateToTemplate(row.templateId)}
                />
                <div className="mb-1 flex items-center gap-2">
                  <span className="mono shrink-0 border border-[var(--hair-strong)] px-1 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                    {row.visibility === 'public' ? '公共' : '私有'}
                  </span>
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {row.name}
                  </span>
                </div>
                <div className="mono text-[10px] text-[var(--text-tertiary)]">
                  {new Date(row.updatedAt).toLocaleString('zh-CN')}
                </div>
                {row.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                    {row.description}
                  </p>
                )}
                <div className="relative z-10 mt-2 flex justify-end">
                  <button
                    type="button"
                    aria-label="删除模板"
                    onClick={() => void remove(row.templateId)}
                    className="grid h-6 w-6 place-items-center text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--err)] group-hover:opacity-100"
                  >
                    <ToolIcon name="trash" size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
