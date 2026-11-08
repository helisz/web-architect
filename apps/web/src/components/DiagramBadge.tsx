import type { CSSProperties } from 'react';

/**
 * 图名首字图标（用户 2026-11-08）。
 *
 * 规则：取图名的**第一个字符**（中文汉字、英文字母都算一个字符），
 * 去掉首尾空白；空名回落到「架」。2026-11-08 用户定稿：只显示第一个并居中。
 *
 * 编辑器顶栏和 图库卡片共用同一个组件，保证两处看到的是同一枚图标。
 */
export function initialsOf(name: string): string {
  const text = (name ?? '').trim();
  if (!text) return '架';
  // 按 code point 取，避免把 emoji / 生僻字切成半个
  return [...text][0] ?? '架';
}

export function DiagramBadge({
  name,
  size = 'md',
  className = '',
  style,
}: {
  name: string;
  /** md = 24px（顶栏）、sm = 20px、stretch = 撑满父级行高（图库两行标题） */
  size?: 'md' | 'sm' | 'stretch';
  className?: string;
  style?: CSSProperties;
}) {
  const box =
    size === 'md'
      ? 'h-6 w-6 text-[13px]'
      : size === 'sm'
        ? 'h-5 w-5 text-[11px]'
        : 'h-full aspect-square text-[13px]';
  return (
    <span
      aria-hidden
      title={name || '未命名架构图'}
      style={style}
      className={`grid shrink-0 place-items-center rounded-[var(--radius-card)] bg-[var(--primary-solid)] font-semibold leading-none text-white ${box} ${className}`}
    >
      {initialsOf(name)}
    </span>
  );
}
