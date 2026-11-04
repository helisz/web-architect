import type { Viewport } from '@arch/schema';

/**
 * 视口（平移/缩放）只存本地，不占版本号。
 *
 * 以前视口也画在 `arch_diagram.viewport` 里：每挪一次画布、每缩放一次，
 * 只要跟别的内容改动凑到一起，就会跟着一起写库，还顺手把版本号 +1；
 * 版本号一涨，5 版一次的快照也跟着涨。
 *
 * 现在视口在本地保存/恢复：打开同一张图时尽量回到你上次看的位置，
 * 只有"内容也变了、要写库"的时候才顺带把视口带上去。
 */
const PREFIX = 'arch:viewport:';

export function saveLocalViewport(diagramId: string, viewport: Viewport): void {
  try {
    localStorage.setItem(`${PREFIX}${diagramId}`, JSON.stringify(viewport));
  } catch {
    /* ignore */
  }
}

export function readLocalViewport(diagramId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${diagramId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Viewport;
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number' || typeof parsed?.zoom !== 'number') return null;
    // 缩放到离谱的值（手改 localStorage）就别用了
    if (parsed.zoom < 0.1 || parsed.zoom > 4) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalViewport(diagramId: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${diagramId}`);
  } catch {
    /* ignore */
  }
}
