import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由（用户 2026-11-04 定稿）。
 *
 * - 根路径 / `#/` → 图库（主页）
 * - `#/d/<diagramId>` → 某一张图
 *
 * 为什么用 hash 而不是 history API：本项目是纯静态 SPA（Vite dev server / 任意静态托管），
 * hash 不需要服务端 rewrite 配合，刷新和直接分享链接都不会 404。
 */
export type Route = { kind: 'gallery' } | { kind: 'diagram'; diagramId: string };

const DIAGRAM_PREFIX = '#/d/';
/** 只做宽松校验：真伪由数据库那边决定，这里挡住明显不是 id 的垃圾 hash */
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

export function readRoute(hash: string = window.location.hash): Route {
  if (!hash.startsWith(DIAGRAM_PREFIX)) return { kind: 'gallery' };
  const raw = hash.slice(DIAGRAM_PREFIX.length).split(/[?&#]/)[0]?.trim() ?? '';
  return ID_RE.test(raw) ? { kind: 'diagram', diagramId: raw } : { kind: 'gallery' };
}

export function diagramHash(diagramId: string): string {
  return `${DIAGRAM_PREFIX}${diagramId}`;
}

/** 打开某张图：只改 hash，由路由订阅去载入 */
export function navigateToDiagram(diagramId: string): void {
  const next = diagramHash(diagramId);
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** 回图库：保留一个干净的 `#/`，方便后退键回到原来的图 */
export function navigateToGallery(): void {
  if (window.location.hash === '#/' || window.location.hash === '') {
    // 已经是图库了，别产生一条重复历史
    if (window.location.hash === '') window.location.hash = '#/';
    return;
  }
  window.location.hash = '#/';
}

/** 订阅 hash 变化（浏览器后退/前进也能用） */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => readRoute());
  useEffect(() => {
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    // 首屏若没有 hash，补一个 `#/`，让后退键有个落点
    if (!window.location.hash) window.location.replace('#/');
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
