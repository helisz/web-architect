import { useCallback } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { exportFileName, parseImport, serializeDiagram } from '../data/transfer.js';
import { downloadDataUrl, downloadText, renderPng } from '../export/exportPng.js';

/**
 * 导出 / 导入（M3）。
 *
 * 导出 PNG 前会临时取消选中并把 DOM 刷两帧：选中态的加粗描边和 resize 手柄
 * 是画在节点里的，不先清掉就会被栅格化进图里。
 */
export function useTransfer() {
  const diagram = useDiagramStore((s) => s.diagram);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const select = useDiagramStore((s) => s.select);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const setSaveError = useDiagramStore((s) => s.setSaveError);
  const setNotice = useDiagramStore((s) => s.setNotice);

  const exportJson = useCallback(() => {
    downloadText(serializeDiagram(diagram), exportFileName(diagram, 'json'));
  }, [diagram]);

  const exportPng = useCallback(async () => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) {
      setSaveError('找不到画布，无法导出 PNG');
      return;
    }

    select(null);
    // 等两帧：一帧让 React 提交"取消选中"，一帧让浏览器完成重绘
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    try {
      const dataUrl = await renderPng(viewport, { margin: 40, pixelRatio: 2 });
      downloadDataUrl(dataUrl, exportFileName(diagram, 'png'));
    } catch (error) {
      setSaveError(`导出 PNG 失败：${(error as Error).message}`);
    } finally {
      if (selectedId) select(selectedId);
    }
  }, [diagram, select, selectedId, setSaveError]);

  const importJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      const result = parseImport(text);
      if (!result.ok) {
        setSaveError(`导入失败：${result.error}`);
        return;
      }
      // 导入 = 换一张新图（id 已重编），自动保存会把它作为一个新图存进去
      setDiagram(result.diagram);
      setNotice(
        result.warnings.length > 0
          ? `已导入 ${result.diagram.nodes.length} 个节点；其中 ${result.warnings.length} 处不合法已自动修复（${result.warnings[0]}）`
          : null,
      );
    },
    [setDiagram, setNotice],
  );

  return { exportJson, exportPng, importJson };
}


