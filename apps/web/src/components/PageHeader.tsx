import { ToolIcon } from './ToolIcons.js';
import {
  breadcrumbOf,
  hashOf,
  navigateToParent,
  parentOf,
  type Crumb,
  type Route,
} from '../lib/route.js';

/**
 * 统一的页面头部（用户 2026-11-08）。
 *
 * 规则：**任何非主页的页面**左边固定两个按钮，右边放页面自己的动作。
 *   ← 上一页   → 固定父级（不跟浏览器历史，书签直接打开也不会跑到站外）
 *   ⌂ 主页     → 回「选择要做什么」
 * 中间是面包屑，每一级都能点。
 *
 * 首页（`#/home`）不渲染这两个按钮 —— 它本身就是主页。
 */

function CrumbTrail({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="面包屑" className="flex min-w-0 items-center gap-1">
      {items.map((crumb, index) => {
        const last = index === items.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {crumb.hash ? (
              <a
                href={crumb.hash}
                className="shrink-0 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--primary-text)]"
              >
                {crumb.label}
              </a>
            ) : (
              <span
                className={`truncate text-[11px] ${
                  last ? 'font-medium text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]'
                }`}
              >
                {crumb.label}
              </span>
            )}
            {!last && <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">/</span>}
          </span>
        );
      })}
    </nav>
  );
}

const navButtonClass =
  'grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-ctl)] border border-transparent text-[var(--text-secondary)] transition-colors hover:border-[var(--hair-strong)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent';

/** 只要这两个按钮（画布页的顶栏自己排布时用） */
export function PageNavButtons({ route }: { route: Route }) {
  const parent = parentOf(route);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        title={parent ? '返回上一页' : '已经在首页'}
        aria-label="返回上一页"
        disabled={!parent}
        onClick={() => navigateToParent(route)}
        className={navButtonClass}
      >
        <ToolIcon name="chevronLeft" size={16} />
      </button>
      <button
        type="button"
        title="回到主页（选择要做什么）"
        aria-label="回到主页"
        onClick={() => {
          window.location.hash = '#/home';
        }}
        className={navButtonClass}
      >
        <ToolIcon name="home" size={15} />
      </button>
    </div>
  );
}

export interface PageHeaderProps {
  route: Route;
  /** 页面标题（面包屑右边的粗体） */
  title: string;
  /** 标题右边的小字（数量、保存状态…） */
  meta?: React.ReactNode;
  /** 右侧动作区 */
  actions?: React.ReactNode;
  /** 面包屑额外附注（例如详情页把名称塞进最后一级） */
  crumbs?: Crumb[];
  /** 标题改成可编辑的输入框时用：传了就渲染 children 而不是 title */
  children?: React.ReactNode;
  /** 高度：列表页 48px，编辑页 48px（统一） */
  className?: string;
}

export function PageHeader({
  route,
  title,
  meta,
  actions,
  crumbs,
  children,
  className = '',
}: PageHeaderProps) {
  const trail = crumbs ?? breadcrumbOf(route);
  return (
    <header
      className={`flex h-12 shrink-0 items-center gap-2 border-b border-[var(--hair)] bg-white px-3 ${className}`}
    >
      <PageNavButtons route={route} />
      <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-[var(--hair)]" />
      <CrumbTrail items={trail} />
      <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-[var(--hair)]" />
      {children ?? (
        <h1 className="min-w-0 shrink-0 truncate text-[13px] font-semibold text-[var(--text-primary)]">
          {title}
        </h1>
      )}
      {meta && <span className="mono shrink-0 text-[10px] text-[var(--text-tertiary)]">{meta}</span>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 主页按钮用的 hash（其它模块要拼链接时用） */
export const HOME_LINK = hashOf({ kind: 'home' });
