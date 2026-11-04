import { readFileSync, writeFileSync } from 'node:fs';

/**
 * 从 @iconify-json/* 官方图标包里抽出本项目实际用到的图标，生成
 * `apps/web/src/icons/iconData.ts`。
 *
 * 为什么不直接整包引入：@iconify-json/tabler 有 5000+ 图标、约 1.4MB，
 * 全量 import 会把首屏拖慢一个数量级。这里按 key 白名单抽取，产物只有十几 kB，
 * 但图案仍然**原样来自官方包**，没有任何手绘路径。
 *
 * 用法：npm run build:icons（新增图标后重跑）
 */
const SOURCES = {
  tabler: '@iconify-json/tabler',
  devicon: '@iconify-json/devicon',
  k8s: '@iconify-json/k8s',
};

const WANTED = {
  tabler: [
    'shield-lock',
    'router',
    'database',
    'arrow-right-square',
    'world',
    'cube',
    'server',
    'server-2',
    'box',
    'network',
    'route',
    'plug-connected',
    'typography',
  ],
  devicon: ['nginx', 'kubernetes'],
  k8s: ['pod'],
};

const collections = [];
let total = 0;

for (const [prefix, pkg] of Object.entries(SOURCES)) {
  const source = JSON.parse(readFileSync(`node_modules/${pkg}/icons.json`, 'utf8'));
  const icons = {};
  for (const name of WANTED[prefix] ?? []) {
    const icon = source.icons[name];
    if (!icon) {
      throw new Error(`图标缺失：${prefix}:${name}（检查 ${pkg} 的版本或名称拼写）`);
    }
    icons[name] = icon.width || icon.height ? { body: icon.body, width: icon.width, height: icon.height } : { body: icon.body };
    total += 1;
  }
  collections.push({
    prefix,
    width: source.width,
    height: source.height,
    ...(source.info ? { info: source.info } : {}),
    icons,
  });
  console.log(`✓ ${prefix}：${Object.keys(icons).join(', ')}`);
}

const file = `/* 由 scripts/build-icons.mjs 生成，请勿手改。
 * 图标来自 Iconify 官方包（@iconify-json/tabler、@iconify-json/devicon、@iconify-json/k8s），
 * 未做任何绘制修改，只做了按 key 的裁剪。
 */

export interface IconData {
  body: string;
  width?: number;
  height?: number;
}

export interface IconCollection {
  prefix: string;
  width?: number;
  height?: number;
  icons: Record<string, IconData>;
}

export const ICON_COLLECTIONS: IconCollection[] = ${JSON.stringify(collections, null, 2)};
`;

writeFileSync('apps/web/src/icons/iconData.ts', file, 'utf8');
console.log(`✓ 已生成 apps/web/src/icons/iconData.ts（${total} 个图标，${(file.length / 1024).toFixed(1)} kB）`);
