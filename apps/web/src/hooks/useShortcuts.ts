import { useEffect } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 全局快捷键（规格 §5.5）：
 *
 * - Ctrl/Cmd + Z         撤销
 * - Ctrl/Cmd + Shift + Z 重做
 * - Ctrl/Cmd + Y         重做（Windows 习惯）
 *
 * 输入框里不拦（让浏览器原生撤销生效），避免"改图名时按 Ctrl+Z 把图撤了"。
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable === true;
      if (isEditing) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        useDiagramStore.getState().undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        useDiagramStore.getState().redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
