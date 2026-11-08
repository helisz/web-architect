import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由（用户 2026-11-04 定稿，2026-11-05 改成显式 /gallery，
 * 2026-11-08 加入「流程」产品线）。
 *
 * - `#/home`        → 产品选择（登录后默认落地）
 * - `#/gallery`     → 架构图列表
 * - `#/d/<id>`      → 某一张架构图
 * - `#/flows`       → 流程列表
 * - `#/f/<id>`      → 某一张流程
 * - `#/templates`   → 模板库
 * - `#/t/<id>`      → 某个模板的编辑器
 * - 其它 → 回 `#/home`，并**把地址改写成规范形式**
 *
 * 为什么用 hash 而不是 history API：本项目是纯静态 SPA（Vite dev server / 任意静态托管），
 * hash 不需要服务端 rewrite 配合，刷新和直接分享链接都不会 404。
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'gallery' }
  | { kind: 'diagram'; diagramId: string }
  | { kind: 'flows' }
  | { kind: 'flow'; flowId: string }
  | { kind: 'templates' }
  | { kind: 'template'; templateId: string };

const DIAGRAM_PREFIX = '#/d/';
const FLOW_PREFIX = '#/f/';
const TEMPLATE_PREFIX = '#/t/';

export const HOME_HASH = '#/home';
/** 图库的规范地址（用户 2026-11-05：要有个单独的 /gallery 路由） */
export const GALLERY_HASH = '#/gallery';
export const FLOWS_HASH = '#/flows';
export const TEMPLATES_HASH = '#/templates';

/** 只做宽松校验：真伪由数据库那边决定，这里挡住明显不是 id 的垃圾 hash */
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

function idOf(hash: string, prefix: string): string | null {
  if (!hash.startsWith(prefix)) return null;
  const raw = hash.slice(prefix.length).split(/[?&#]/)[0]?.trim() ?? '';
  return ID_RE.test(raw) ? raw : null;
}

export function readRoute(hash: string = window.location.hash): Route {
  const diagramId = idOf(hash, DIAGRAM_PREFIX);
  if (diagramId) return { kind: 'diagram', diagramId };

  const flowId = idOf(hash, FLOW_PREFIX);
  if (flowId) return { kind: 'flow', flowId };

  const templateId = idOf(hash, TEMPLATE_PREFIX);
  if (templateId) return { kind: 'template', templateId };

  if (hash === GALLERY_HASH) return { kind: 'gallery' };
  if (hash === FLOWS_HASH) return { kind: 'flows' };
  if (hash === TEMPLATES_HASH) return { kind: 'templates' };
  return { kind: 'home' };
}

export function diagramHash(diagramId: string): string {
  return `${DIAGRAM_PREFIX}${diagramId}`;
}

export function flowHash(flowId: string): string {
  return `${FLOW_PREFIX}${flowId}`;
}

export function templateHash(templateId: string): string {
  return `${TEMPLATE_PREFIX}${templateId}`;
}

/**
 * 把非规范地址收敛成规范形式（`#/`、空 hash、`#/d/垃圾` 都回 `#/home`）。
 * 用 replaceState 而不是赋值 hash：不制造多余的历史记录，后退键才顺手。
 */
export function normalizeHash(): void {
  const route = readRoute();
  if (route.kind !== 'home') return;
  if (window.location.hash === HOME_HASH) return;
  try {
    window.history.replaceState(null, '', HOME_HASH);
  } catch {
    window.location.hash = HOME_HASH;
  }
}

function navigate(next: string): void {
  if (window.location.hash === next) return;
  window.location.hash = next;
}

/** 打开某张图：只改 hash，由路由订阅去载入 */
export function navigateToDiagram(diagramId: string): void {
  navigate(diagramHash(diagramId));
}

export function navigateToFlow(flowId: string): void {
  navigate(flowHash(flowId));
}

export function navigateToTemplate(templateId: string): void {
  navigate(templateHash(templateId));
}

/** 回图库 */
export function navigateToGallery(): void {
  navigate(GALLERY_HASH);
}

/** 回产品选择页 */
export function navigateToHome(): void {
  navigate(HOME_HASH);
}

export function navigateToFlows(): void {
  navigate(FLOWS_HASH);
}

export function navigateToTemplates(): void {
  navigate(TEMPLATES_HASH);
}

/** 订阅 hash 变化（浏览器后退/前进也能用） */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => readRoute());
  useEffect(() => {
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    // 首屏把 `#/`、空 hash 之类的旧地址改写成规范形式（不产生新历史）
    normalizeHash();
    setRoute(readRoute());
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
