import { Icon, addCollection, getIcon } from '@iconify/react';
import { useEffect, useReducer } from 'react';
import { DEFAULT_ICON_KEY, isIconKey, type IconKey } from '@arch/schema';
import { ICON_COLLECTIONS } from './iconData.js';

/**
 * 图标（唯一出口）。
 *
 * 三段式加载，主包只多 ~10 kB：
 * 1. **常用子集**（16 个）内联，画布首屏零延迟；
 * 2. **核心库**（tabler 5000+、k8s）打开选择器时加载，约 350 kB（gzip）；
 * 3. **品牌库**（devicon 800+，约 1.9 MB gzip）后台增量加载，不挡首屏。
 *
 * 图案全部来自 Iconify 官方 npm 包，本项目不绘制任何图标。
 */
for (const collection of ICON_COLLECTIONS) addCollection(collection);

export interface IconChoice {
  key: string;
  name: string;
  prefix: string;
}

interface Catalog {
  prefix: string;
  names: string[];
}

const catalogs: Catalog[] = [];
let corePromise: Promise<void> | null = null;
let brandPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 订阅"又有新图标可用"，让 NodeIcon / 选择器自动补渲染 */
export function subscribeIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function register(prefix: string, module: unknown): void {
  if (catalogs.some((catalog) => catalog.prefix === prefix)) return;
  const collection = (module as { default?: unknown }).default ?? module;
  const data = collection as { prefix: string; icons: Record<string, unknown> };
  addCollection(data as never);
  catalogs.push({ prefix, names: Object.keys(data.icons) });
  notify();
}

/** 核心库：通用线性图标 + Kubernetes 专用，打开选择器时加载 */
export function ensureCoreLibrary(): Promise<void> {
  corePromise ??= (async () => {
    const [tabler, k8s] = await Promise.all([
      import('@iconify-json/tabler/icons.json'),
      import('@iconify-json/k8s/icons.json'),
    ]);
    register('tabler', tabler);
    register('k8s', k8s);
  })();
  return corePromise;
}

/** 品牌库：nginx / docker / redis 这类彩色 logo，后台加载 */
export function ensureBrandLibrary(): Promise<void> {
  brandPromise ??= (async () => {
    const devicon = await import('@iconify-json/devicon/icons.json');
    register('devicon', devicon);
  })();
  return brandPromise;
}

export function isCoreReady(): boolean {
  return catalogs.some((catalog) => catalog.prefix === 'tabler');
}

export function isBrandReady(): boolean {
  return catalogs.some((catalog) => catalog.prefix === 'devicon');
}

/** 图标库里当前可搜索的图标总数 */
export function librarySize(): number {
  return catalogs.reduce((sum, catalog) => sum + catalog.names.length, 0);
}

/**
 * 搜索图标：先按"名字以关键词开头"排前面，再按包含关系。
 * 需要先 `ensureCoreLibrary()`（品牌库可选，加载后结果自然变多）。
 */
export function searchIcons(keyword: string, prefix = 'all', limit = 240): IconChoice[] {
  const needle = keyword.trim().toLowerCase();
  const starts: IconChoice[] = [];
  const contains: IconChoice[] = [];

  for (const catalog of catalogs) {
    if (prefix !== 'all' && catalog.prefix !== prefix) continue;
    for (const name of catalog.names) {
      if (needle && !name.includes(needle)) continue;
      const choice = { key: `${catalog.prefix}:${name}`, name, prefix: catalog.prefix };
      if (!needle || name.startsWith(needle)) starts.push(choice);
      else contains.push(choice);
      if (starts.length + contains.length > limit * 4) break;
    }
  }

  starts.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  return [...starts, ...contains].slice(0, limit);
}

/** 按需把某个 key 所在的库补齐（老数据里可能是品牌图标） */
export async function ensureIconLoaded(iconKey: string): Promise<void> {
  const prefix = iconKey.split(':')[0];
  if (prefix === 'devicon') await ensureBrandLibrary();
  else await ensureCoreLibrary();
}

export interface NodeIconProps {
  iconKey: string;
  size?: number;
  className?: string;
}

export function NodeIcon({ iconKey, size = 16, className }: NodeIconProps) {
  const key: IconKey = isIconKey(iconKey) ? iconKey : DEFAULT_ICON_KEY;
  const [, forceUpdate] = useReducer((value: number) => value + 1, 0);
  const loaded = Boolean(getIcon(key));

  useEffect(() => subscribeIcons(() => forceUpdate()), []);

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    void ensureIconLoaded(key).then(() => {
      if (!cancelled) forceUpdate();
    });
    return () => {
      cancelled = true;
    };
  }, [key, loaded]);

  if (!loaded) {
    return <span aria-hidden style={{ display: 'inline-block', width: size, height: size }} className={className} />;
  }
  return <Icon icon={key} width={size} height={size} className={className} />;
}
