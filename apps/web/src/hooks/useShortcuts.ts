import { useEffect } from 'react';
import { flushNow } from '../data/usePersistence.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 全局快捷键（规格 §4.1 / §5.5）：
 *
 * - Ctrl/Cmd + Z          撤销
 * - Ctrl/Cmd + Shift + Z  重做（Ctrl+Y 同样）
 * - Ctrl/Cmd + A          全选
 * - Ctrl/Cmd + C / V      复制 / 粘贴
 * - Ctrl/Cmd + D          原地复制一份
 * - Ctrl/Cmd + F          搜索定位
 * - Delete / Backspace    删除选中（RF 自己处理，这里兜底分组）
 * - L                     锁定 / 解锁
 * - ] / [                 置顶 / 置底
 * - N                     在视口中心新建一个通用节点
 * - Esc                   取消选择 / 关闭面板
 *
 * 输入框里一律不拦（让浏览器原生编辑键生效），避免"改图名时按 Ctrl+Z 把图撤了"。
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useDiagramStore.getState();

      // 确认框打开时锁死撤销/重做，避免"一边弹窗一边改历史"导致的错乱
      if (state.pendingDelete) {
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();
        if (mod && (key === 'z' || key === 'y')) event.preventDefault();
        if (key === 'escape') state.cancelDelete();
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true;
      if (isEditing) return;

      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (key === 'escape') {
        if (state.searchOpen) state.setSearchOpen(false);
        else if (state.layerPanelOpen) state.setLayerPanelOpen(false);
        else state.select(null);
        return;
      }

      if (mod) {
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          state.undo();
          return;
        }
        if ((key === 'z' && event.shiftKey) || key === 'y') {
          event.preventDefault();
          state.redo();
          return;
        }
        if (key === 'a') {
          event.preventDefault();
          state.selectAll();
          return;
        }
        if (key === 'c') {
          state.copySelection();
          return;
        }
        if (key === 'v') {
          event.preventDefault();
          state.pasteClipboard();
          return;
        }
        if (key === 'd') {
          event.preventDefault();
          state.copySelection();
          useDiagramStore.getState().pasteClipboard();
          return;
        }
        if (key === 'f') {
          event.preventDefault();
          state.setSearchOpen(true);
          return;
        }
        if (key === 's') {
          // 显式保存：不等节流，立刻写一次（"我知道我在干什么，现在就存"）
          event.preventDefault();
          flushNow();
          return;
        }
        return;
      }

      // 无修饰键的单键快捷方式
      if (key === 'l') {
        event.preventDefault();
        state.toggleLock(state.selectedIds);
        return;
      }
      if (key === ']') {
        event.preventDefault();
        state.bringToFront(state.selectedIds);
        return;
      }
      if (key === '[') {
        event.preventDefault();
        state.sendToBack(state.selectedIds);
        return;
      }
      if (key === 'n') {
        event.preventDefault();
        const viewport = state.diagram.viewport;
        const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
        const width = pane?.width ?? 800;
        const height = pane?.height ?? 600;
        // 视口中心 → flow 坐标
        const center = {
          x: (width / 2 - viewport.x) / viewport.zoom - 80,
          y: (height / 2 - viewport.y) / viewport.zoom - 40,
        };
        state.addNode('custom', center);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
