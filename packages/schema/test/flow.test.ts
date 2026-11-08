import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  displayValue,
  emptyTemplateConfig,
  evaluateStatus,
  interpolate,
  normalizeTemplateConfig,
  placeholdersOf,
  readPath,
  safeParamName,
} from '../src/flow.js';

describe('流程：路径取值', () => {
  const payload = {
    data: {
      status: 'healthy',
      items: [{ name: '主库', cpu: 12 }, { name: '从库', cpu: 44 }],
      nested: { deep: { value: 7 } },
      flag: false,
    },
  };

  it('点号路径', () => {
    expect(readPath(payload, 'data.status')).toBe('healthy');
  });

  it('中括号下标与点号下标等价', () => {
    expect(readPath(payload, 'data.items[1].name')).toBe('从库');
    expect(readPath(payload, 'data.items.1.name')).toBe('从库');
  });

  it('深层嵌套', () => {
    expect(readPath(payload, 'data.nested.deep.value')).toBe(7);
  });

  it('取不到返回 undefined，不抛错', () => {
    expect(readPath(payload, 'data.nope.x')).toBeUndefined();
    expect(readPath(payload, 'data.items[9].name')).toBeUndefined();
    expect(readPath(null, 'a.b')).toBeUndefined();
    expect(readPath(payload, '')).toBeUndefined();
  });

  it('布尔值 false 要能取到（不能被当成空）', () => {
    expect(readPath(payload, 'data.flag')).toBe(false);
  });
});

describe('流程：占位符', () => {
  it('替换已知参数，未知参数变空串', () => {
    expect(interpolate('https://x/{{app}}/{{missing}}', { app: 'crm' })).toBe('https://x/crm/');
  });

  it('允许花括号内有空格', () => {
    expect(interpolate('{{ app }}', { app: 'crm' })).toBe('crm');
  });

  it('列出模板里用到的占位符（去重）', () => {
    expect(placeholdersOf('{{a}}?x={{b}}&y={{a}}')).toEqual(['a', 'b']);
  });

  it('参数名清洗：非法字符变下划线，空的给 p1/p2', () => {
    expect(safeParamName('a b', 0)).toBe('a_b');
    expect(safeParamName('   ', 2)).toBe('p3');
  });
});

describe('流程：拼接请求', () => {
  const config = normalizeTemplateConfig({
    data: {
      method: 'GET',
      url: 'https://api.test/status/{{app}}',
      headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
      body: [{ key: 'env', value: '{{env}}' }],
    },
    params: [],
  });

  it('GET：占位符进 URL，body 栏并进 query', () => {
    const request = buildRequest(config, { app: 'crm', token: 'tk', env: 'prod' });
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://api.test/status/crm?env=prod');
    expect(request.headers.Authorization).toBe('Bearer tk');
    expect(request.body).toBeUndefined();
  });

  it('POST：body 变成 JSON，且自动带 Content-Type', () => {
    const post = normalizeTemplateConfig({ ...config, data: { ...config.data, method: 'POST' } });
    const request = buildRequest(post, { app: 'crm', token: 'tk', env: 'prod' });
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.test/status/crm');
    expect(request.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(request.body!)).toEqual({ env: 'prod' });
  });

  it('URL 自带问号时用 & 连接（不会拼出 ??）', () => {
    const withQuery = normalizeTemplateConfig({ data: { ...config.data, url: 'https://api.test/x?a=1' } });
    expect(buildRequest(withQuery, { env: 'prod' }).url).toBe('https://api.test/x?a=1&env=prod');
  });
});

describe('流程：状态判定', () => {
  const config = normalizeTemplateConfig({
    status: { path: 'data.health', success: ['ok', 'UP'], failure: ['down'] },
  });

  it('命中成功列表（大小写不敏感，两边都 trim）', () => {
    expect(evaluateStatus(config, { data: { health: ' UP ' } })).toBe('success');
  });

  it('命中失败列表', () => {
    expect(evaluateStatus(config, { data: { health: 'down' } })).toBe('failure');
  });

  it('失败优先：同时出现在两边时判失败', () => {
    const both = normalizeTemplateConfig({ status: { path: 'h', success: ['x'], failure: ['x'] } });
    expect(evaluateStatus(both, { h: 'x' })).toBe('failure');
  });

  it('都不命中 / 没配路径 / 取不到 → unknown', () => {
    expect(evaluateStatus(config, { data: { health: 'weird' } })).toBe('unknown');
    expect(evaluateStatus(config, {})).toBe('unknown');
    expect(evaluateStatus(normalizeTemplateConfig({}), { a: 1 })).toBe('unknown');
  });
});

describe('流程：配置归一化', () => {
  it('空配置也能用，默认 GET + 10s 超时 + 失败优先的常见词表', () => {
    const config = emptyTemplateConfig();
    expect(config.data.method).toBe('GET');
    expect(config.data.timeoutMs).toBe(10000);
    expect(config.display).toEqual([]);
    expect(config.version).toBe(1);
  });

  it('脏数据被修掉：方法非法回落 GET、超时被夹在 1–60s', () => {
    const config = normalizeTemplateConfig({
      data: { method: 'DELETE', url: '  https://a  ', timeoutMs: 999999 },
    });
    expect(config.data.method).toBe('GET');
    expect(config.data.url).toBe('https://a');
    expect(config.data.timeoutMs).toBe(60000);
  });

  it('字段/参数/键值对里的空条目会被丢掉', () => {
    const config = normalizeTemplateConfig({
      display: [{ path: 'a' }, { path: '  ' }, { path: 'b', label: 'B', highlight: true }],
      params: [{ name: 'x' }, { name: '' }],
      data: { headers: [{ key: '', value: 'v' }, { key: 'k', value: 'v' }] },
    });
    expect(config.display.map((f) => f.path)).toEqual(['a', 'b']);
    expect(config.display[1]!.highlight).toBe(true);
    expect(config.params.map((p) => p.name)).toEqual(['x', 'p2']);
    expect(config.data.headers).toEqual([{ key: 'k', value: 'v' }]);
  });

  it('displayValue：对象转 JSON，null 变空串', () => {
    expect(displayValue({ a: 1 })).toBe('{"a":1}');
    expect(displayValue(null)).toBe('');
    expect(displayValue(0)).toBe('0');
  });
});
