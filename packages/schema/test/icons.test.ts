import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ICON_KEYS,
  DEFAULT_ICON_KEY,
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
  waf: 'tabler:shield-lock',
  vip: 'tabler:router',
  nginx: 'devicon:nginx',
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

  it('32 个节点类型全部有显式映射，不留隐形兜底', () => {
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

  it('允许集合 = 用户 10 个 + 方案 (a) 补充 6 个', () => {
    expect(ALLOWED_ICON_KEYS).toHaveLength(16);
    for (const key of Object.values(USER_DECIDED)) expect(ALLOWED_ICON_KEYS).toContain(key);
    for (const extra of [
      'tabler:server',
      'tabler:server-2',
      'tabler:box',
      'tabler:network',
      'tabler:route',
      'tabler:plug-connected',
    ]) {
      expect(ALLOWED_ICON_KEYS).toContain(extra);
    }
  });

  it('容器与占位类保留 cube（不需要再拆）', () => {
    expect(iconKeyFor('group')).toBe('tabler:cube');
    expect(iconKeyFor('zone')).toBe('tabler:cube');
    expect(iconKeyFor('custom')).toBe('tabler:cube');
    expect(iconKeyFor('legend')).toBe('tabler:typography');
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
    expect(resolveIconKey({ nodeType: 'waf', extJson: { iconKey: 'tabler:shield-lock' } })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'waf', extJson: { iconKey: 'oops' } })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'waf' })).toBe('tabler:shield-lock');
    expect(resolveIconKey({ nodeType: 'server' })).toBe('tabler:server');
  });
});



