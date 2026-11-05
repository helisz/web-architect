import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由（用户 2026-11-04 定稿，2026-11-05 改成显式 /gallery）。
 *
 * - `#/gallery` → 图库
 * - `#/d/<diagramId>` → 某一张图
 * - 其它（含老的 `#/`、空 hash）→ 图库，并且**把地址改写成 `#/gallery`**
 *
 * 为什么用 hash 而不是 history API：本项目是纯静态 SPA（Vite dev server / 任意静态托管），
 * hash 不需要服务端 rewrite 配合，刷新和直接分享链接都不会 404。
 */
export type Route = { kind: 'gallery' } | { kind: 'diagram'; diagramId: string };

const DIAGRAM_PREFIX = '#/d/';
/** 图库的规范地址（用户 2026-11-05：要有个单独的 /gallery 路由） */
export const GALLERY_HASH = '#/gallery';
/** 只做宽松校验：真伪由数据库那边决定，这里挡住明显不是 id 的垃圾 hash */
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

export function readRoute(hash: string = window.location.hash): Route {
  if (hash.startsWith(DIAGRAM_PREFIX)) {
    const raw = hash.slice(DIAGRAM_PREFIX.length).split(/[?&#]/)[0]?.trim() ?? '';
    if (ID_RE.test(raw)) return { kind: 'diagram', diagramId: raw };
  }
  return { kind: 'gallery' };
}

export function diagramHash(diagramId: string): string {
  return `${DIAGRAM_PREFIX}${diagramId}`;
}

/**
 * 把非规范地址收敛成 `#/gallery`（`#/`、空 hash、`#/d/垃圾` 都算）。
 * 用 replaceState 而不是赋值 hash：不制造多余的历史记录，后退键才顺手。
 */
export function normalizeHash(): void {
  if (readRoute().kind === 'diagram') return;
  if (window.location.hash === GALLERY_HASH) return;
  try {
    window.history.replaceState(null, '', GALLERY_HASH);
  } catch {
    window.location.hash = GALLERY_HASH;
  }
}

/** 打开某张图：只改 hash，由路由订阅去载入 */
export function navigateToDiagram(diagramId: string): void {
  const next = diagramHash(diagramId);
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** 回图库 */
export function navigateToGallery(): void {
  if (window.location.hash === GALLERY_HASH) return;
  window.location.hash = GALLERY_HASH;
}

/** 订阅 hash 变化（浏览器后退/前进也能用） */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => readRoute());
  useEffect(() => {
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    // 首屏把 `#/`、空 hash 之类的旧地址改写成 `#/gallery`（不产生新历史）
    normalizeHash();
    setRoute(readRoute());
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
