import { readFileSync, writeFileSync } from 'node:fs';
import { CUSTOM_ICON_COLLECTIONS } from './custom-icons.mjs';

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
    // 2026-11-04 起就在白名单里、但生成脚本漏掉的两个（手改生成物补的）；补回脚本避免下次重跑丢图标
    'letter-n',
    'stack-2',
    // 2026-11-06：形状 / 流程图节点在组件库与属性面板里用到的几何、流程符号
    'rectangle',
    'square-rounded',
    'circle',
    'diamond',
    'triangle',
    'hexagon',
    'cylinder',
    'shape',
    'file-text',
    'arrow-big-right',
    'player-play',
    'git-branch',
    'settings',
    'circle-dot',
    // 2026-11-07 档 2：同图标拆开 —— 负载均衡 / 反向代理 / 专线 / 标题 / 便利贴 / 注释 / VPN
    //（网关保留用户指定的 arrow-right-square，不再另给）
    'arrows-split-2',
    'arrows-exchange',
    'plug',
    'heading',
    'note',
    'message-circle',
    'lock-access',
  ],
  devicon: ['nginx', 'kubernetes'],
  // 2026-11-07：K8s 四个类型不再共用 kubernetes 图标，各自用官方 k8s 图标
  k8s: ['pod', 'namespace', 'deployment', 'service', 'ingress'],
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

/*
 * 自绘集合（nginx 的 N 方块）单列一份源码（scripts/custom-icons.mjs）。
 * 以前它只存在于生成物 iconData.ts 里，谁跑一次 build:icons 就会被冲掉 ——
 * 现在脚本自己带上它，重跑多少次结果都一致。
 */
for (const collection of CUSTOM_ICON_COLLECTIONS) {
  collections.push(collection);
  total += Object.keys(collection.icons).length;
  console.log(`✓ ${collection.prefix}：${Object.keys(collection.icons).join(', ')}（自绘）`);
}

const file = `/* 由 scripts/build-icons.mjs 生成，请勿手改。
 * 图标来自 Iconify 官方包（@iconify-json/tabler、@iconify-json/devicon、@iconify-json/k8s），
 * 未做任何绘制修改，只做了按 key 的裁剪；arch 前缀的自绘图标见 scripts/custom-icons.mjs。
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
