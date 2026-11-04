import { useCallback } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { exportFileName, parseImport, serializeDiagram } from '../data/transfer.js';
import { decodeSvgDataUrl, downloadBlob, downloadDataUrl, downloadText, renderPng, renderSvg } from '../export/exportPng.js';
import { saveDiagram } from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';
import { buildPdfFromPng, type PdfPageSize } from '../export/exportPdf.js';
import { toEdgesCsv, toNodesCsv } from '../export/exportCsv.js';

/**
 * 导出 / 导入（M3）。
 *
 * 导出 PNG 前会临时取消选中并把 DOM 刷两帧：选中态的加粗描边和 resize 手柄
 * 是画在节点里的，不先清掉就会被栅格化进图里。SVG / PDF 走同一条渲染路径，
 * 所以三种图片输出长得完全一样。
 */
export function useTransfer() {
  const diagram = useDiagramStore((s) => s.diagram);
  const selectedId = useDiagramStore((s) => s.selectedId);
  const select = useDiagramStore((s) => s.select);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const pushToast = useDiagramStore((s) => s.pushToast);

  /** 文件名：带倍率时插在扩展名前面（图名@2x.png），别拼成 图名.png@2x */
  const fileName = useCallback(
    (ext: string, suffix = '') => {
      const base = exportFileName(diagram, ext);
      if (!suffix) return base;
      const dot = base.lastIndexOf('.');
      return `${base.slice(0, dot)}${suffix}${base.slice(dot)}`;
    },
    [diagram],
  );

  /** 导出前清掉选中态；返回"恢复选中"的收尾函数 */
  const prepare = useCallback(async (): Promise<() => void> => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport) throw new Error('找不到画布');
    select(null);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    return () => {
      if (selectedId) select(selectedId);
    };
  }, [select, selectedId]);

  const exportJson = useCallback(() => {
    downloadText(serializeDiagram(diagram), exportFileName(diagram, 'json'));
  }, [diagram]);

  /** PNG：scale 为 1 / 2 / 3 倍像素密度 */
  const exportPng = useCallback(
    async (scale: 1 | 2 | 3 = 2, transparent = false) => {
      let restore: (() => void) | null = null;
      try {
        restore = await prepare();
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!;
        const dataUrl = await renderPng(viewport, { margin: 40, pixelRatio: scale, transparent });
        const suffix = transparent ? `@${scale}x-transparent` : scale === 1 ? '' : `@${scale}x`;
        downloadDataUrl(dataUrl, fileName('png', suffix));
      } catch (error) {
        pushToast(`导出 PNG 失败：${(error as Error).message}`, 'error');
      } finally {
        restore?.();
      }
    },
    [diagram, fileName, prepare, pushToast],
  );

  const exportSvg = useCallback(async () => {
    let restore: (() => void) | null = null;
    try {
      restore = await prepare();
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!;
      const dataUrl = await renderSvg(viewport, { margin: 40 });
      // html-to-image 给的是 data URL，这里解回真正的 SVG 文本再落盘
      const svg = decodeSvgDataUrl(dataUrl);
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), fileName('svg'));
    } catch (error) {
      pushToast(`导出 SVG 失败：${(error as Error).message}`, 'error');
    } finally {
      restore?.();
    }
  }, [diagram, prepare, pushToast]);

  const exportPdf = useCallback(
    async (size: PdfPageSize = 'a4') => {
      let restore: (() => void) | null = null;
      try {
        restore = await prepare();
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!;
        const png = await renderPng(viewport, { margin: 24, pixelRatio: 2 });
        downloadBlob(await buildPdfFromPng(png, { size }), fileName('pdf'));
      } catch (error) {
        pushToast(`导出 PDF 失败：${(error as Error).message}`, 'error');
      } finally {
        restore?.();
      }
    },
    [diagram, prepare, pushToast],
  );

  const exportCsv = useCallback(
    (kind: 'nodes' | 'edges') => {
      const csv = kind === 'nodes' ? toNodesCsv(diagram) : toEdgesCsv(diagram);
      downloadText(csv, fileName('csv', kind === 'nodes' ? '-nodes' : '-edges'), 'text/csv');
    },
    [diagram, fileName],
  );

  const importJson = useCallback(
    async (file: File) => {
      const text = await file.text();
      const result = parseImport(text);
      if (!result.ok) {
        // 导入失败是这个动作自己的事，不该占顶部"重新载入"那条横幅
        pushToast(`导入失败：${result.error}`, 'error');
        return;
      }
      // 导入 = 换一张新图（id 已重编）。
      // 自动保存只处理"已落库"的图，所以这里必须显式存一次，
      // 否则刷新页面导入内容就没了。
      setDiagram(result.diagram);
      const saved = await saveDiagram(result.diagram, null);
      if (saved.ok) {
        useDiagramStore.getState().applySaved(saved.version, saved.savedAt);
        rememberSavedPayload(result.diagram);
      } else {
        pushToast(`导入已载入，但保存失败：${saved.message}`, 'error');
      }
      if (result.warnings.length > 0) {
        pushToast(
          `已导入 ${result.diagram.nodes.length} 个节点；其中 ${result.warnings.length} 处不合法已自动修复（${result.warnings[0]}）`,
          'info',
        );
      } else {
        pushToast(`已导入 ${result.diagram.nodes.length} 个节点`, 'success');
      }
    },
    [setDiagram, pushToast],
  );

  return { exportJson, exportPng, exportSvg, exportPdf, exportCsv, importJson };
}


