import { takeOverWriter } from '../data/tabLock.js';
import { forceSave, reloadFromServer } from '../data/usePersistence.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 保存异常提示条。
 *
 * 几种情况必须让人看见、且能一键处理：
 * - 另一个标签页正在写这张图（本页不自动保存）
 * - 版本冲突（另一个标签页/另一台机器改过同一张图）
 * - 保存失败（网络、约束、函数缺失…）
 */
export function SaveBanner() {
  const conflict = useDiagramStore((s) => s.conflict);
  const saveError = useDiagramStore((s) => s.saveError);
  const saveDisabled = useDiagramStore((s) => s.saveDisabled);
  const writerRole = useDiagramStore((s) => s.writerRole);
  const diagramId = useDiagramStore((s) => s.diagram.diagramId);
  const setSaveError = useDiagramStore((s) => s.setSaveError);
  const setConflict = useDiagramStore((s) => s.setConflict);
  const notice = useDiagramStore((s) => s.notice);
  const setNotice = useDiagramStore((s) => s.setNotice);

  if (saveDisabled) {
    return (
      <div className="flex items-center gap-3 border-b border-[#FDE68A] bg-[#FFFAEB] px-4 py-2 text-xs text-[#B54708]">
        <span className="font-medium">保存不可用</span>
        <span>
          数据库里还没有 <span className="mono">arch_save_diagram</span> 函数：把{' '}
          <span className="mono">supabase/schema.sql</span> 全文重新粘进 Supabase SQL Editor 跑一遍，
          然后刷新页面。当前改动只存在浏览器里，刷新会丢。
        </span>
      </div>
    );
  }

  /**
   * 跟随者：另一个标签页在写这张图。
   *
   * 不写库是为了不抢版本号（冲突的最大来源）。注意这里不是只读：
   * 用户真在本页动手改时，useAutosave 会自动把写权抢过来。
   */
  if (writerRole === 'follower') {
    return (
      <div className="flex items-center gap-3 border-b border-[#BAE6FD] bg-[#F0F9FF] px-4 py-2 text-xs text-[#075985]">
        <span className="font-medium">另一个标签页正在编辑</span>
        <span>为避免互相覆盖，本页暂时不自动保存；在本页改动会自动接手编辑。</span>
        <button
          type="button"
          className="ml-auto rounded border border-[#BAE6FD] bg-white px-2 py-1 hover:bg-[#E0F2FE]"
          onClick={() => takeOverWriter(diagramId)}
        >
          在此页继续编辑
        </button>
      </div>
    );
  }

  if (conflict) {
    return (
      <div className="flex items-center gap-3 border-b border-[#FDE68A] bg-[#FFFAEB] px-4 py-2 text-xs text-[#B54708]">
        <span className="font-medium">版本冲突</span>
        <span>
          库内已是
          {conflict.currentVersion !== undefined ? ` v${conflict.currentVersion}` : '更新版本'}，
          你的改动基于更早的版本。
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded border border-[#FDE68A] bg-white px-2 py-1 hover:bg-[#FFFAEB]"
            onClick={() => void reloadFromServer()}
          >
            放弃本地改动，重新载入
          </button>
          <button
            type="button"
            className="rounded border border-[#B54708] bg-[#B54708] px-2 py-1 text-white hover:bg-[#93370D]"
            onClick={() => forceSave()}
          >
            用我的版本覆盖
          </button>
        </div>
      </div>
    );
  }

  if (saveError) {
    return (
      <div className="flex items-center gap-3 border-b border-[#F5C2C7] bg-[#FEF3F2] px-4 py-2 text-xs text-[#B42318]">
        <span className="font-medium">保存失败</span>
        <span className="mono truncate">{saveError}</span>
        <button
          type="button"
          className="ml-auto rounded border border-[#F5C2C7] bg-white px-2 py-1 hover:bg-[#FEF3F2]"
          onClick={() => {
            setSaveError(null);
            setConflict(null);
            void reloadFromServer();
          }}
        >
          重新载入
        </button>
      </div>
    );
  }

  // 中性提示：导入时被自动修复的地方。用信息色，不吓人，也不被保存成功清掉。
  if (notice) {
    return (
      <div className="flex items-center gap-3 border-b border-[#BAE6FD] bg-[#F0F9FF] px-4 py-2 text-xs text-[#075985]">
        <span className="font-medium">提示</span>
        <span className="truncate">{notice}</span>
        <button
          type="button"
          className="ml-auto rounded border border-[#BAE6FD] bg-white px-2 py-1 hover:bg-[#E0F2FE]"
          onClick={() => setNotice(null)}
        >
          知道了
        </button>
      </div>
    );
  }

  return null;
}

