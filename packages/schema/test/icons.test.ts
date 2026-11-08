import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ICON_KEYS,
  DEFAULT_ICON_KEY,
  GROUP_ICON_KEY,
  ICON_KEY_BY_NODE_TYPE,
  NODE_TYPES,
  createEmptyDiagram,
  createNode,
  iconKeyFor,
  isIconKey,
  looksLikeEmbeddedImage,
  resolveIconKey,
  validateDiagram,
} from '../src/index.js';

/** 用户最初指定的 10 条映射，逐条钉死，避免以后被"优化"掉 */
const USER_DECIDED: Record<string, string> = {
  vip: 'tabler:router',
  // 2026-11-04 用户要求：nginx 换成「N」方块标记，不用 NGINX 全称 wordmark
  nginx: 'arch:nginx',
  'k8s-cluster': 'devicon:kubernetes',
  pod: 'k8s:pod',
  db: 'tabler:database',
  gateway: 'tabler:arrow-right-square',
  external: 'tabler:world',
  text: 'tabler:typography',
  custom: 'tabler:cube',
};

const diagramWith = (nodePatch: Record<string, unknown>) => {
  const base = createEmptyDiagram({ name: '图标测试' });
  const node = createNode('db', base.diagramId, { x: 0, y: 0 });
  return {
    ...base,
    nodes: [{ ...node, ...nodePatch }],
  } as typeof base;
};

describe('图标规则：nodeType → iconKey', () => {
  it('用户指定的 10 条原样保留（vip 因方案 (a) 单独说明，见下一条）', () => {
    for (const [nodeType, iconKey] of Object.entries(USER_DECIDED)) {
      if (nodeType === 'vip') continue;
      expect(iconKeyFor(nodeType)).toBe(iconKey);
    }
    expect(USER_DECIDED.vip).toBe('tabler:router');
  });

  it('方案 (a)：vip 拆到 tabler:plug-connected，避免与 switch/router/subnet 撞图', () => {
    expect(iconKeyFor('vip')).toBe('tabler:plug-connected');
    expect(iconKeyFor('switch')).toBe('tabler:network');
    expect(iconKeyFor('router')).toBe('tabler:router');
    expect(iconKeyFor('subnet')).toBe('tabler:route');
  });

  it('方案 (a)：server / vm / container 不再共用方块', () => {
    expect(iconKeyFor('server')).toBe('tabler:server');
    expect(iconKeyFor('vm')).toBe('tabler:server-2');
    expect(iconKeyFor('container')).toBe('tabler:box');
    expect(new Set([iconKeyFor('server'), iconKeyFor('vm'), iconKeyFor('container')]).size).toBe(3);
  });

  it('49 个节点类型全部有显式映射，不留隐形兜底', () => {
    for (const nodeType of NODE_TYPES) {
      expect(ICON_KEY_BY_NODE_TYPE[nodeType], `${nodeType} 缺少映射`).toBeTypeOf('string');
      expect(isIconKey(ICON_KEY_BY_NODE_TYPE[nodeType])).toBe(true);
    }
    expect(Object.keys(ICON_KEY_BY_NODE_TYPE)).toHaveLength(NODE_TYPES.length);
  });

  it('所有映射值都在预定义集合内，且不含 base64 / url', () => {
    for (const iconKey of Object.values(ICON_KEY_BY_NODE_TYPE)) {
      expect(ALLOWED_ICON_KEYS).toContain(iconKey);
      // 前缀允许数字（如 k8s:pod），名字用小写与连字符
      expect(iconKey).toMatch(/^[a-z0-9]+:[a-z0-9-]+$/);
      expect(looksLikeEmbeddedImage(iconKey)).toBe(false);
    }
  });

  it('允许集合 = 原有 19 个 + 形状/流程图 14 个 + 2026-11-07 拆图标 11 个 + 横条图标 1 个', () => {
    expect(ALLOWED_ICON_KEYS).toHaveLength(47);
    // 用户 2026-11-05：旧的 nginx 全称 logo 从常用集里彻底移除，只留自绘的方框 N
    expect(ALLOWED_ICON_KEYS).not.toContain('devicon:nginx');
    for (const key of Object.values(USER_DECIDED)) expect(ALLOWED_ICON_KEYS).toContain(key);
    for (const extra of [
      'tabler:server',
      'tabler:server-2',
      'tabler:box',
      'tabler:network',
      'tabler:route',
      'tabler:plug-connected',
      // 2026-11-04 追加：nginx 标记（官方 logo 的 N 方块）+ 纯字母 N + 集群堆叠
      'arch:nginx',
      'arch:nginx-mono',
      'tabler:letter-n',
      'tabler:stack-2',
      // 2026-11-06 追加：形状 / 流程图节点用到的几何与流程符号
      'tabler:rectangle',
      'tabler:square-rounded',
      'tabler:circle',
      'tabler:diamond',
      'tabler:triangle',
      'tabler:hexagon',
      'tabler:cylinder',
      'tabler:shape',
      'tabler:file-text',
      'tabler:arrow-big-right',
      'tabler:player-play',
      'tabler:git-branch',
      'tabler:settings',
      'tabler:circle-dot',
      // 2026-11-07 档 2：把撞车图标拆开
      'tabler:arrows-split-2',
      'tabler:arrows-exchange',
      'tabler:plug',
      'tabler:heading',
      'tabler:note',
      'tabler:message-circle',
      'tabler:lock-access',
      'k8s:namespace',
      'k8s:deployment',
      'k8s:service',
      'k8s:ingress',
      // 2026-11-07：单行元素(水平) 的横条图标 + 动态分组/动态组的卡片图标
      'tabler:layout-navbar',
      'tabler:square-plus',
      'tabler:square-dashed',
    ]) {
      expect(ALLOWED_ICON_KEYS).toContain(extra);
    }
  });

  it('2026-11-07：原先撞图的组已经拆开', () => {
    // 负载均衡 / 反向代理 / Ingress / 专线 各用各的（网关保留用户指定的 arrow-right-square）
    expect(iconKeyFor('lb')).toBe('tabler:arrows-split-2');
    expect(iconKeyFor('proxy')).toBe('tabler:arrows-exchange');
    expect(iconKeyFor('ingress')).toBe('k8s:ingress');
    expect(iconKeyFor('link')).toBe('tabler:plug');
    expect(iconKeyFor('gateway')).toBe('tabler:arrow-right-square');
    // K8s 四件套：cluster 用品牌标，其余用官方 k8s 图标
    expect(new Set(['k8s-cluster', 'namespace', 'deployment', 'service'].map(iconKeyFor)).size).toBe(4);
    // 文本四件套
    expect(new Set(['title', 'text', 'sticky', 'annotation'].map(iconKeyFor)).size).toBe(4);
    // 防火墙 / VPN
    expect(iconKeyFor('firewall')).not.toBe(iconKeyFor('vpn'));
  });

  it('占位类保留 cube；分组图标独立于 nodeType', () => {
    // 2026-11-07：group / zone / legend 三个"伪节点"已下线，分组改用 GROUP_ICON_KEY
    expect(GROUP_ICON_KEY).toBe('tabler:cube');
    expect(iconKeyFor('custom')).toBe('tabler:cube');
    expect(iconKeyFor('text')).toBe('tabler:typography');
  });

  it('未知类型回落到 tabler:cube，不会抛错', () => {
    expect(iconKeyFor('不存在的类型')).toBe(DEFAULT_ICON_KEY);
    expect(iconKeyFor('')).toBe(DEFAULT_ICON_KEY);
  });

  it('isIconKey 只校验形状，不比对白名单（图标库 7000+ 个都能用）', () => {
    expect(isIconKey('tabler:database')).toBe(true);
    expect(isIconKey('tabler:server')).toBe(true);
    expect(isIconKey('tabler:not-exist')).toBe(true);
    expect(isIconKey('devicon:docker')).toBe(true);
    expect(isIconKey('oops')).toBe(false);
    expect(isIconKey('tabler:')).toBe(false);
    expect(isIconKey('data:image/png;base64,AAAA')).toBe(false);
    expect(isIconKey(undefined)).toBe(false);
    expect(isIconKey(42)).toBe(false);
  });

  it('looksLikeEmbeddedImage 能识别 data uri 与 http(s) url', () => {
    expect(looksLikeEmbeddedImage('data:image/svg+xml;base64,PHN2Zz4=')).toBe(true);
    expect(looksLikeEmbeddedImage('https://cdn.example.com/icon.svg')).toBe(true);
    expect(looksLikeEmbeddedImage('HTTP://X/Y.PNG')).toBe(true);
    expect(looksLikeEmbeddedImage('tabler:cube')).toBe(false);
  });
});

describe('创建节点时自动写入 iconKey', () => {
  it('每个类型创建出来的节点都带合法 key', () => {
    const d = createEmptyDiagram();
    for (const nodeType of NODE_TYPES) {
      const node = createNode(nodeType, d.diagramId, { x: 0, y: 0 });
      expect(node.extJson?.iconKey).toBe(iconKeyFor(nodeType));
      expect(isIconKey(node.extJson?.iconKey)).toBe(true);
    }
  });

  it('覆盖其它字段不会丢 iconKey', () => {
    const node = createNode('k8s-cluster', 'd1', { x: 10, y: 20 }, { label: '生产集群', width: 200 });
    expect(node.extJson?.iconKey).toBe('devicon:kubernetes');
    expect(node.label).toBe('生产集群');
  });

  it('显式传入 iconKey 时以传入值为准（交由校验器兜底）', () => {
    const node = createNode('db', 'd1', { x: 0, y: 0 }, { extJson: { iconKey: 'tabler:world' } });
    expect(node.extJson?.iconKey).toBe('tabler:world');
  });
});

describe('校验与修复（V11）', () => {
  it('strict：缺 iconKey 只警告，不阻断', () => {
    const r = validateDiagram(diagramWith({ extJson: undefined }));
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('ICON_KEY_REPAIRED');
  });

  it('repair：缺 iconKey 按 nodeType 补齐', () => {
    const r = validateDiagram(diagramWith({ extJson: undefined }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('tabler:database');
  });

  it('repair：base64 图标被拒绝并替换成预定义 key', () => {
    const base64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const r = validateDiagram(diagramWith({ extJson: { iconKey: base64 } }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('tabler:database');
    expect(r.warnings.map((w) => w.code)).toContain('EMBEDDED_ICON_REJECTED');
  });

  it('repair：url 图标同样被拒绝', () => {
    const r = validateDiagram(diagramWith({ extJson: { iconKey: 'https://x.test/a.svg' } }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('tabler:database');
    expect(r.warnings.map((w) => w.code)).toContain('EMBEDDED_ICON_REJECTED');
  });

  it('repair：形状不合法的 key 按类型改写', () => {
    const r = validateDiagram(diagramWith({ extJson: { iconKey: 'not-a-key' } }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('tabler:database');
    expect(r.warnings.map((w) => w.code)).toContain('ICON_KEY_REPAIRED');
  });

  it('库里的任意图标（不在常用白名单）都保留，不会被冲成默认值', () => {
    const r = validateDiagram(diagramWith({ extJson: { iconKey: 'devicon:docker' } }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('devicon:docker');
    expect(r.warnings.map((w) => w.code)).not.toContain('ICON_KEY_REPAIRED');
  });

  it('repair：合法的自定义 iconKey 保留（手工覆盖不被冲掉）', () => {
    const r = validateDiagram(diagramWith({ extJson: { iconKey: 'tabler:world' } }), { repair: true });
    expect(r.diagram?.nodes[0]?.extJson?.iconKey).toBe('tabler:world');
    expect(r.warnings.map((w) => w.code)).not.toContain('ICON_KEY_SYNCED');
  });

  it('repair 保留 extJson 里的其它自定义字段', () => {
    const r = validateDiagram(
      diagramWith({ extJson: { ip: '10.0.0.8', port: 3306, iconKey: 'not-a-key' } }),
      { repair: true },
    );
    expect(r.diagram?.nodes[0]?.extJson).toEqual({ ip: '10.0.0.8', port: 3306, iconKey: 'tabler:database' });
  });

  it('未知 nodeType 降级为 custom，而不是让整张图打不开', () => {
    const r = validateDiagram(diagramWith({ nodeType: 'mssql-2019' }), { repair: true });
    expect(r.ok).toBe(true);
    expect(r.diagram?.nodes[0]?.nodeType).toBe('custom');
    expect(r.warnings.map((w) => w.code)).toContain('NODE_TYPE_FALLBACK');
    // 降级后 iconKey 仍然必须落在合法集合里（原来的值合法就保留）
    expect(isIconKey(r.diagram?.nodes[0]?.extJson?.iconKey)).toBe(true);
  });

  it('resolveIconKey：合法就用手上的，非法就按类型推导', () => {
    expect(resolveIconKey({ nodeType: 'firewall', extJson: { iconKey: 'tabler:shield-lock' } })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'firewall', extJson: { iconKey: 'oops' } })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'firewall' })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'server' })).toBe('tabler:server');
  });
});
describe('nginx 图标归一（用户 2026-11-05：手绘方框 N 完全替换旧全称 logo）', () => {
  it('老 key 一律映射到自绘的 arch:nginx', () => {
    for (const legacy of ['devicon:nginx', 'logos:nginx', 'simple-icons:nginx', 'cib:nginx']) {
      expect(resolveIconKey({ nodeType: 'server', extJson: { iconKey: legacy } })).toBe('arch:nginx');
    }
  });

  it('其它图标不受影响（别名表只认 nginx）', () => {
    expect(resolveIconKey({ nodeType: 'server', extJson: { iconKey: 'devicon:kubernetes' } })).toBe(
      'devicon:kubernetes',
    );
    expect(resolveIconKey({ nodeType: 'nginx', extJson: {} })).toBe('arch:nginx');
  });

  it('repair 模式会把库里的老 key 改成新 key（打开一次就自愈）', () => {
    const d = createEmptyDiagram({ name: 'nginx 归一' });
    const node = createNode('nginx', d.diagramId, { x: 0, y: 0 });
    node.extJson = { ...node.extJson, iconKey: 'devicon:nginx' };
    d.nodes.push(node);

    const result = validateDiagram(d, { repair: true });
    // 修复结果在 result.diagram 上（zod 会 clone，不会回写入参）
    expect(result.diagram?.nodes[0]!.extJson?.iconKey).toBe('arch:nginx');
    expect(result.errors).toHaveLength(0);
  });
});
