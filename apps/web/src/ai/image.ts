/**
 * 上传图片的预处理（用户 2026-11-05）。
 *
 * 为什么必须压缩：手机/截图动辄 3000px、4MB，base64 之后更大，直接塞进请求里
 * 既慢又容易撞上厂商的体积上限；压到长边 ≤1536 后识别率基本不变（模型内部
 * 也会降采样），体积通常掉到 1/5。
 *
 * 另一个容易忽略的点：PNG 透明区在转 JPEG 时会变黑，先铺一层白底再画。
 */

export const MAX_IMAGE_SIDE = 1536;
export const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const JPEG_QUALITY = 0.86;

export interface PreparedImage {
  /** data:image/jpeg;base64,... */
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  /** 压缩后的字节数（估算：base64 长度 × 3/4） */
  bytes: number;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  fileName: string;
}

export class ImagePrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePrepError';
  }
}

const ACCEPTED = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/bmp'];

export function isAcceptedImageType(mime: string): boolean {
  return ACCEPTED.includes(mime.toLowerCase());
}

/** 等比缩放到长边 ≤ maxSide；本来就更小则不动（不放大，放大只会更糊） */
export function scaleForMaxSide(width: number, height: number, maxSide = MAX_IMAGE_SIDE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) return { width, height };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/** base64 字符串 → 字节数（不真的解码） */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new ImagePrepError('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new ImagePrepError('这张图片解不开，换一张试试（支持 PNG / JPG / WebP）'));
    image.src = dataUrl;
  });
}

export async function prepareImage(blob: Blob, fileName = 'architecture.png'): Promise<PreparedImage> {
  if (!isAcceptedImageType(blob.type)) {
    throw new ImagePrepError('只支持 PNG / JPG / WebP / GIF / BMP 图片');
  }
  if (blob.size > MAX_SOURCE_BYTES) {
    throw new ImagePrepError(`图片太大了（${Math.round(blob.size / 1024 / 1024)}MB），请压到 16MB 以内`);
  }
  const sourceDataUrl = await readAsDataUrl(blob);
  const image = await loadImage(sourceDataUrl);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  const target = scaleForMaxSide(originalWidth, originalHeight);

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepError('浏览器不支持 Canvas，没法处理图片');
  // 白底：PNG 的透明会被 JPEG 编码成黑色
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, target.width, target.height);

  const encoded = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  // 截图类 PNG 重新编码成 JPEG 有时反而更大（大片纯色），且会掉清晰度：
  // 尺寸没变、原图又更小的话，直接发原图。
  const unchanged = target.width === originalWidth && target.height === originalHeight;
  const keepOriginal =
    unchanged &&
    (blob.type === 'image/png' || blob.type === 'image/jpeg' || blob.type === 'image/webp') &&
    blob.size <= dataUrlBytes(encoded);
  if (keepOriginal) {
    return {
      dataUrl: sourceDataUrl,
      mime: blob.type,
      width: originalWidth,
      height: originalHeight,
      bytes: blob.size,
      originalBytes: blob.size,
      originalWidth,
      originalHeight,
      fileName,
    };
  }

  const dataUrl = encoded;
  return {
    dataUrl,
    mime: 'image/jpeg',
    width: target.width,
    height: target.height,
    bytes: dataUrlBytes(dataUrl),
    originalBytes: blob.size,
    originalWidth,
    originalHeight,
    fileName,
  };
}

/** 从剪贴板事件里挑出第一张图（用户在画布外粘贴也没关系） */
export function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  const items = Array.from(data.items ?? []);
  for (const item of items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/** 从拖拽事件里挑出第一张图 */
export function imageFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  const files = Array.from(data.files ?? []);
  return files.find((file) => file.type.startsWith('image/')) ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
