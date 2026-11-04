import { jsPDF } from 'jspdf';

/**
 * PDF 导出（规格 §12：A4 / A3 横向，供打印汇报）。
 *
 * 实现方式：先用 `renderPng`（2×）得到位图，再等比摆进 PDF 页面。
 *
 * 为什么不是"SVG → PDF"：画布节点是 HTML，序列化出来的 SVG 用 `foreignObject`
 * 承载内容，而现成的 SVG→PDF 转换器（svg-to-pdfkit / rsvg / inkscape）都不渲染
 * foreignObject —— 实测导出的 PDF 只有空白页。位图方案牺牲矢量，但打印清晰度
 * 由 2× 分辨率保证，且与 PNG 导出完全一致。
 */

export type PdfPageSize = 'a4' | 'a3';

export interface PdfOptions {
  size?: PdfPageSize;
  /** 页边距（pt） */
  margin?: number;
  /** 图片最大缩放 1 = 原尺寸；太大时按页面可用区缩 */
  maxScale?: number;
}

/** 把 dataURL 图片的像素尺寸读出来（PDF 排版要用） */
export async function imagePixelSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * 位图 → 单页横向 PDF。
 *
 * 大图铺满页面可用区，小图按 1:1 居中（不放大，避免糊）；
 * 页面方向固定横向 —— 架构图几乎没有竖版。
 */
export async function buildPdfFromPng(pngDataUrl: string, options: PdfOptions = {}): Promise<Blob> {
  const { size = 'a4', margin = 24, maxScale = 1 } = options;

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: size });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;

  const natural = await imagePixelSize(pngDataUrl); // 像素
  // 按 72dpi 视作 pt 尺寸，再按可用区与 maxScale 收
  const fit = Math.min(availableWidth / natural.width, availableHeight / natural.height);
  const scale = Math.min(fit, maxScale);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const x = (pageWidth - width) / 2;
  const y = (pageHeight - height) / 2;

  pdf.addImage(pngDataUrl, 'PNG', x, y, width, height, undefined, 'FAST');
  return pdf.output('blob');
}
