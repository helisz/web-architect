import { useEffect, useState } from 'react';

/**
 * 极简 hash 路由（用户 2026-11-04 定稿；2026-11-08 第二次重构，按"主页 → 产品 → 列表 → 详情"分层）。
 *
 * 规范地址（**每一层都有明确父级**）：
 * ```
 * #/home                         主页「选择要做什么」         父：—
 * ├─ #/diagrams                 架构图列表                   父：主页
 * │   └─ #/diagram/<id>         架构图详情                   父：架构图列表
 * └─ #/flows                    流程列表                     父：主页
 *     ├─ #/flow/<id>            流程详情                     父：流程列表
 *     └─ #/flows/templates      模板库                       父：流程列表
 *         └─ #/flows/templates/<id>  模板编辑                父：模板库
 * ```
 *
 * 旧地址（2026-11-08 之前的写法）仍然能打开，但会被**改写成真正的规范地址**：
 * `#/gallery` → `#/diagrams`、`#/d/<id>` → `#/diagram/<id>`、
 * `#/f/<id>` → `#/flow/<id>`、`#/templates` → `#/flows/templates`、`#/t/<id>` → `#/flows/templates/<id>`。
 *
 * 为什么用 hash 而不是 history API：纯静态 SPA（Vite dev server / 任意静态托管），
 * hash 不需要服务端 rewrite，刷新与直接分享链接都不会 404。
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'diagrams' }
  | { kind: 'diagram'; diagramId: string }
  | { kind: 'flows' }
  | { kind: 'flow'; flowId: string }
  | { kind: 'templates' }
  | { kind: 'template'; templateId: string };

export const HOME_HASH = '#/home';
export const DIAGRAMS_HASH = '#/diagrams';
export const FLOWS_HASH = '#/flows';
export const TEMPLATES_HASH = '#/flows/templates';

/** 只做宽松校验：真伪由数据库决定，这里挡住明显不是 id 的垃圾 hash */
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

function idAfter(hash: string, prefix: string): string | null {
  if (!hash.startsWith(prefix)) return null;
  const raw = hash.slice(prefix.length).split(/[?&#]/)[0]?.trim() ?? '';
  return ID_RE.test(raw) ? raw : null;
}

/** 规范地址 → Route */
export function readRoute(hash: string = window.location.hash): Route {
  const diagramId = idAfter(hash, '#/diagram/');
  if (diagramId) return { kind: 'diagram', diagramId };

  const templateId = idAfter(hash, '#/flows/templates/');
  if (templateId) return { kind: 'template', templateId };

  const flowId = idAfter(hash, '#/flow/');
  if (flowId) return { kind: 'flow', flowId };

  if (hash === DIAGRAMS_HASH) return { kind: 'diagrams' };
  if (hash === FLOWS_HASH) return { kind: 'flows' };
  if (hash === TEMPLATES_HASH) return { kind: 'templates' };
  if (hash === HOME_HASH) return { kind: 'home' };

  // ── 旧地址兼容（读得出来，随后由 normalizeHash 改写成规范地址）──
  const legacyDiagram = idAfter(hash, '#/d/');
  if (legacyDiagram) return { kind: 'diagram', diagramId: legacyDiagram };
  const legacyFlow = idAfter(hash, '#/f/');
  if (legacyFlow) return { kind: 'flow', flowId: legacyFlow };
  const legacyTemplate = idAfter(hash, '#/t/');
  if (legacyTemplate) return { kind: 'template', templateId: legacyTemplate };
  if (hash === '#/gallery') return { kind: 'diagrams' };
  if (hash === '#/templates') return { kind: 'templates' };

  return { kind: 'home' };
}

/** Route → 规范 hash */
export function hashOf(route: Route): string {
  switch (route.kind) {
    case 'diagrams':
      return DIAGRAMS_HASH;
    case 'diagram':
      return `#/diagram/${route.diagramId}`;
    case 'flows':
      return FLOWS_HASH;
    case 'flow':
      return `#/flow/${route.flowId}`;
    case 'templates':
      return TEMPLATES_HASH;
    case 'template':
      return `#/flows/templates/${route.templateId}`;
    default:
      return HOME_HASH;
  }
}

export function diagramHash(diagramId: string): string {
  return `#/diagram/${diagramId}`;
}

export function flowHash(flowId: string): string {
  return `#/flow/${flowId}`;
}

export function templateHash(templateId: string): string {
  return `#/flows/templates/${templateId}`;
}

/**
 * 每一页的父级（用户 2026-11-08：「上一页」= 固定父级，不跟浏览器历史）。
 *
 * 固定父级的好处：从书签直接打开详情页时，点「上一页」不会退出站点。
 */
export function parentOf(route: Route): Route | null {
  switch (route.kind) {
    case 'diagram':
      return { kind: 'diagrams' };
    case 'diagrams':
      return { kind: 'home' };
    case 'flow':
      return { kind: 'flows' };
    case 'template':
      return { kind: 'templates' };
    case 'templates':
      return { kind: 'flows' };
    case 'flows':
      return { kind: 'home' };
    default:
      return null;
  }
}

export interface Crumb {
  label: string;
  /** 最后一级（当前页）没有 hash，点了不跳 */
  hash?: string;
}

/** 面包屑：从主页一路到当前页（最后一项是本页，不可点） */
export function breadcrumbOf(route: Route): Crumb[] {
  switch (route.kind) {
    case 'diagrams':
      return [{ label: '主页', hash: HOME_HASH }, { label: '架构图' }];
    case 'diagram':
      return [
        { label: '主页', hash: HOME_HASH },
        { label: '架构图', hash: DIAGRAMS_HASH },
        { label: '详情' },
      ];
    case 'flows':
      return [{ label: '主页', hash: HOME_HASH }, { label: '流程' }];
    case 'flow':
      return [
        { label: '主页', hash: HOME_HASH },
        { label: '流程', hash: FLOWS_HASH },
        { label: '详情' },
      ];
    case 'templates':
      return [
        { label: '主页', hash: HOME_HASH },
        { label: '流程', hash: FLOWS_HASH },
        { label: '模板库' },
      ];
    case 'template':
      return [
        { label: '主页', hash: HOME_HASH },
        { label: '流程', hash: FLOWS_HASH },
        { label: '模板库', hash: TEMPLATES_HASH },
        { label: '编辑' },
      ];
    default:
      return [];
  }
}

/**
 * 把地址收敛成规范形式（旧地址 → 新地址，垃圾 hash → `#/home`）。
 * 用 replaceState 而不是赋值 hash：不制造多余历史记录，后退键才顺手。
 */
export function normalizeHash(): void {
  const canonical = hashOf(readRoute());
  if (window.location.hash === canonical) return;
  try {
    window.history.replaceState(null, '', canonical);
  } catch {
    window.location.hash = canonical;
  }
}

function navigate(next: string): void {
  if (window.location.hash === next) return;
  window.location.hash = next;
}

export function navigateToHome(): void {
  navigate(HOME_HASH);
}

export function navigateToGallery(): void {
  navigate(DIAGRAMS_HASH);
}

export function navigateToDiagram(diagramId: string): void {
  navigate(diagramHash(diagramId));
}

export function navigateToFlows(): void {
  navigate(FLOWS_HASH);
}

export function navigateToFlow(flowId: string): void {
  navigate(flowHash(flowId));
}

export function navigateToTemplates(): void {
  navigate(TEMPLATES_HASH);
}

export function navigateToTemplate(templateId: string): void {
  navigate(templateHash(templateId));
}

/** 去父级页面（「上一页」按钮用）；已在主页时什么都不做 */
export function navigateToParent(route: Route): void {
  const parent = parentOf(route);
  if (!parent) return;
  navigate(hashOf(parent));
}

/** 订阅 hash 变化（浏览器后退/前进也能用） */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => readRoute());
  useEffect(() => {
    const onHash = (): void => {
      // 手输 / 外链跳进来的旧地址也要就地改写成规范地址（用户 2026-11-08）
      normalizeHash();
      setRoute(readRoute());
    };
    window.addEventListener('hashchange', onHash);
    // 首屏把旧地址 / 空 hash 改写成规范形式（不产生新历史）
    normalizeHash();
    setRoute(readRoute());
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
