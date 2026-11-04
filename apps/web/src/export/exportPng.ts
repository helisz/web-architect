import { toPng, toSvg } from 'html-to-image';

/**
 * PNG 导出（规格 §6.2）。
 *
 * 包围盒**不能**用 `getNodesBounds`：它读的是节点的 `position`，而分组子节点存的是
 * 父级相对坐标（见 C1），算出来的盒子会偏小、把内容切掉。这里直接量 DOM——
 * 屏幕矩形除以当前缩放就是视口坐标系里的位置，父子关系、缩放、平移全都不用管。
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PngOptions {
  /** 包围盒外留白（px），规格要求 40 */
  margin?: number;
  /** 2× 输出 */
  pixelRatio?: number;
  /** 透明背景（默认白底，贴进文档更稳） */
  transparent?: boolean;
}

export const EMPTY_EXPORT_ERROR = '画布是空的，先放几个节点再导出';

/** 包围盒 → 导出画布尺寸 + 把 (bounds.x, bounds.y) 平移到 (margin, margin) 的变换 */
export function frameFromBounds(
  bounds: Bounds,
  margin = 40,
): { width: number; height: number; transform: string } {
  return {
    width: Math.max(1, Math.ceil(bounds.width + margin * 2)),
    height: Math.max(1, Math.ceil(bounds.height + margin * 2)),
    transform: `translate(${margin - bounds.x}px, ${margin - bounds.y}px) scale(1)`,
  };
}

/**
 * 量出视口里所有可见节点的包围盒（视口坐标系，单位 px）。
 *
 * 折叠分组里被隐藏的节点尺寸为 0，自动跳过；一个可见节点都没有时返回 null。
 */
export function measureContentBounds(viewport: HTMLElement): Bounds | null {
  const viewportRect = viewport.getBoundingClientRect();
  const unscaledWidth = viewport.offsetWidth || viewportRect.width;
  const zoom = unscaledWidth > 0 ? viewportRect.width / unscaledWidth : 1;
  const scale = zoom > 0 ? zoom : 1;

  const nodeElements = Array.from(viewport.querySelectorAll<HTMLElement>('.react-flow__node'));
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const element of nodeElements) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const x = (rect.left - viewportRect.left) / scale;
    const y = (rect.top - viewportRect.top) / scale;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + rect.width / scale);
    maxY = Math.max(maxY, y + rect.height / scale);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export async function renderPng(viewport: HTMLElement, options: PngOptions = {}): Promise<string> {
  const { margin = 40, pixelRatio = 2, transparent = false } = options;

  const bounds = measureContentBounds(viewport);
  if (!bounds) throw new Error(EMPTY_EXPORT_ERROR);

  const frame = frameFromBounds(bounds, margin);

  return toPng(viewport, {
    width: frame.width,
    height: frame.height,
    pixelRatio,
    backgroundColor: transparent ? undefined : '#FFFFFF',
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      transform: frame.transform,
      transformOrigin: 'top left',
    },
    // 画布网格、Controls、MiniMap、水印都是"编辑器装饰"，交付图里不要
    filter: (domNode) => {
      const className = (domNode as HTMLElement).className;
      if (typeof className !== 'string') return true;
      return !/react-flow__(background|panel|attribution)/.test(className);
    },
  });
}

/**
 * SVG 导出（矢量）。
 *
 * 用 html-to-image 的 `toSvg` 序列化画布 DOM：节点是 HTML（含 foreignObject），
 * 这样"导出的 SVG 与画布长得一样"，浏览器 / Figma / Illustrator 都能打开。
 */
export async function renderSvg(viewport: HTMLElement, options: PngOptions = {}): Promise<string> {
  const { margin = 40, transparent = false } = options;

  const bounds = measureContentBounds(viewport);
  if (!bounds) throw new Error(EMPTY_EXPORT_ERROR);

  const frame = frameFromBounds(bounds, margin);

  return toSvg(viewport, {
    width: frame.width,
    height: frame.height,
    backgroundColor: transparent ? undefined : '#FFFFFF',
    style: {
      width: `${frame.width}px`,
      height: `${frame.height}px`,
      transform: frame.transform,
      transformOrigin: 'top left',
    },
    filter: (domNode) => {
      const className = (domNode as HTMLElement).className;
      if (typeof className !== 'string') return true;
      return !/react-flow__(background|panel|attribution)/.test(className);
    },
  });
}

/**
 * html-to-image 的 SVG 输出是 data URL，落盘前要还原成真正的 SVG 文本：
 * 直接把 data URL 写进 .svg 文件，打开会是空白。
 */
export function decodeSvgDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl;
  const body = dataUrl.slice(comma + 1);
  // 未编码的明文（含 <svg）直接用；否则 decodeURIComponent
  if (body.trimStart().startsWith('<svg')) return body;
  try {
    return decodeURIComponent(body);
  } catch {
    return body;
  }
}

/**
 * 复制到剪贴板（用户 2026-11-04 第二批）：默认 2× PNG、白底。
 *
 * 剪贴板只接受 Blob，而 `renderPng` 给的是 dataURL，所以先解码成二进制。
 * 实现优先级：ClipboardItem + navigator.clipboard.write（Chrome/Edge/Safari 都支持），
 * 不支持时（非安全上下文 / Firefox 老版本 / 权限被拒）抛错，由调用方退化成下载。
 */
export async function renderPngBlob(
  viewport: HTMLElement,
  options: PngOptions = {},
): Promise<Blob> {
  const dataUrl = await renderPng(viewport, { pixelRatio: 2, transparent: false, ...options });
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function copyPngToClipboard(viewport: HTMLElement): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('当前浏览器不支持把图片写进剪贴板');
  }
  const blob = await renderPngBlob(viewport, { pixelRatio: 2, transparent: false });
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** 触发浏览器下载（dataURL 版本，PNG 用这个） */
export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** 触发浏览器下载（Blob 版本，SVG / PDF / CSV 用这个） */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 触发浏览器下载（文本版本，JSON 用这个） */
export function downloadText(text: string, fileName: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, fileName);
  // 给浏览器一点时间发起下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
