import type { ArchitectureDiagram } from '@arch/schema';

/**
 * 崩溃兜底用的本地草稿。
 *
 * 保存间隔拉长到"空闲 3 秒 / 最长 30 秒"之后，断电或误关页面最坏会丢 30 秒的编辑。
 * 所以每隔 1.5 秒把当前图覆盖写进 localStorage（同步、便宜、不进网络），
 * 下次打开同一张图时如果发现草稿比库里的内容"新"且版本一致，就自动恢复。
 *
 * 只在**已落库**的图上写草稿：临时图/压测图不写，免得下次打开冒出别的图。
 */
const PREFIX = 'arch:draft:';
/** 超过这个时间就不恢复（一天前的草稿，多半是用户故意不要的） */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Draft {
  at: number;
  version: number;
  diagram: ArchitectureDiagram;
}

function key(diagramId: string): string {
  return `${PREFIX}${diagramId}`;
}

export function saveDraft(diagram: ArchitectureDiagram): void {
  try {
    const draft: Draft = { at: Date.now(), version: diagram.version, diagram };
    localStorage.setItem(key(diagram.diagramId), JSON.stringify(draft));
  } catch {
    /* 配额满 / 隐私模式：草稿是加固手段，失败不影响正常保存 */
  }
}

export function readDraft(diagramId: string): Draft | null {
  try {
    const raw = localStorage.getItem(key(diagramId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed?.diagram || typeof parsed.at !== 'number' || typeof parsed.version !== 'number') return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(key(diagramId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(diagramId: string): void {
  try {
    localStorage.removeItem(key(diagramId));
  } catch {
    /* ignore */
  }
}
