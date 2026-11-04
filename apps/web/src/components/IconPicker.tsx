import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import { ALLOWED_ICON_KEYS } from '@arch/schema';
import {
  ensureBrandLibrary,
  ensureCoreLibrary,
  isBrandReady,
  isCoreReady,
  librarySize,
  searchIcons,
  subscribeIcons,
  type IconChoice,
} from '../icons/index.js';

const PREFIX_LABELS: { value: string; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'tabler', label: '通用' },
  { value: 'devicon', label: '品牌' },
  { value: 'k8s', label: 'K8s' },
  { value: 'arch', label: '自绘' },
];

export interface IconPickerProps {
  value: string;
  onSelect: (iconKey: string) => void;
  onClose: () => void;
}

/**
 * 图标选择器：搜索 + 选择。
 *
 * 打开时先加载核心库（tabler + k8s），品牌库在后台继续下；
 * 常用 16 个固定放最上面，常用场景不用搜索。
 */
export function IconPicker({ value, onSelect, onClose }: IconPickerProps) {
  const [keyword, setKeyword] = useState('');
  const [prefix, setPrefix] = useState('all');
  const [coreReady, setCoreReady] = useState(isCoreReady());
  const [brandReady, setBrandReady] = useState(isBrandReady());
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeIcons(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let cancelled = false;
    void ensureCoreLibrary().then(() => {
      if (!cancelled) setCoreReady(true);
    });
    // 品牌库不阻塞首屏：核心库好了再去拉
    void ensureCoreLibrary()
      .then(() => ensureBrandLibrary())
      .then(() => {
        if (!cancelled) setBrandReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const results = useMemo<IconChoice[]>(() => {
    if (!coreReady) return [];
    return searchIcons(keyword, prefix);
    // tick 变化（品牌库到位）时重新搜索
  }, [keyword, prefix, coreReady, tick]);

  const total = librarySize();
  const curated = ALLOWED_ICON_KEYS;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[520px] w-[580px] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--panel-border)] px-3 py-2">
          <span className="text-sm font-semibold">选择图标</span>
          <span className="mono text-[11px] text-[var(--text-secondary)]">
            {coreReady ? `已加载 ${total} 个` : '加载图标库…'}
            {coreReady && !brandReady && '（品牌库加载中）'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded px-2 py-0.5 text-xs text-[var(--text-secondary)] hover:bg-[#F3F4F6]"
          >
            关闭
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2">
          <input
            autoFocus
            placeholder="搜索图标，例如 database / nginx / pod"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="w-full rounded border border-[var(--panel-border)] px-2 py-1 text-xs outline-none focus:border-[var(--primary)]"
          />
          <div className="flex shrink-0 gap-1">
            {PREFIX_LABELS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPrefix(item.value)}
                className={`rounded px-2 py-1 text-[11px] ${
                  prefix === item.value
                    ? 'bg-[var(--primary)] text-white'
                    : 'border border-[var(--panel-border)] text-[var(--text-secondary)] hover:bg-[#F9FAFB]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {keyword === '' && prefix === 'all' && (
            <>
              <p className="mb-1 text-[11px] text-[var(--text-secondary)]">常用</p>
              <div className="mb-3 grid grid-cols-10 gap-1">
                {curated.map((key) => (
                  <IconCell key={key} iconKey={key} active={key === value} onSelect={onSelect} />
                ))}
              </div>
            </>
          )}

          {!coreReady && <p className="py-6 text-center text-xs text-[var(--text-secondary)]">正在加载图标库…</p>}

          {coreReady && results.length === 0 && (
            <p className="py-6 text-center text-xs text-[var(--text-secondary)]">没有匹配的图标</p>
          )}

          {coreReady && results.length > 0 && (
            <div className="grid grid-cols-10 gap-1">
              {results.map((choice) => (
                <IconCell
                  key={choice.key}
                  iconKey={choice.key}
                  title={choice.key}
                  active={choice.key === value}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}

          {coreReady && results.length >= 240 && (
            <p className="pt-2 text-center text-[11px] text-[var(--text-secondary)]">
              只显示前 240 个，继续输入可以缩小范围
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function IconCell({
  iconKey,
  title,
  active,
  onSelect,
}: {
  iconKey: string;
  title?: string;
  active: boolean;
  onSelect: (iconKey: string) => void;
}) {
  return (
    <button
      type="button"
      title={title ?? iconKey}
      onClick={() => onSelect(iconKey)}
      className={`grid h-9 place-items-center rounded border ${
        active
          ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
          : 'border-transparent text-[var(--text-primary)] hover:border-[var(--primary)] hover:bg-[#F9FAFB]'
      }`}
    >
      <Icon icon={iconKey} width={20} height={20} />
    </button>
  );
}
