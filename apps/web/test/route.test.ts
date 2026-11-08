import { describe, expect, it } from 'vitest';
import {
  breadcrumbOf,
  diagramHash,
  DIAGRAMS_HASH,
  flowHash,
  FLOWS_HASH,
  hashOf,
  HOME_HASH,
  parentOf,
  readRoute,
  templateHash,
  TEMPLATES_HASH,
} from '../src/lib/route.js';

/**
 * hash 路由（2026-11-08 第二次重构）：
 * 主页 → 产品（架构图 / 流程）→ 列表 → 详情，每一层都有明确父级。
 * 旧地址仍然能读，但会被改写成规范地址。
 */
describe('readRoute：规范地址', () => {
  it('没有 hash 时是主页', () => {
    expect(readRoute('')).toEqual({ kind: 'home' });
    expect(HOME_HASH).toBe('#/home');
  });

  it('四个列表 / 编辑部能认出来', () => {
    expect(readRoute(HOME_HASH)).toEqual({ kind: 'home' });
    expect(readRoute(DIAGRAMS_HASH)).toEqual({ kind: 'diagrams' });
    expect(readRoute(FLOWS_HASH)).toEqual({ kind: 'flows' });
    expect(readRoute(TEMPLATES_HASH)).toEqual({ kind: 'templates' });
  });

  it('三条详情路由互不串味', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute(`#/diagram/${id}`)).toEqual({ kind: 'diagram', diagramId: id });
    expect(readRoute(`#/flow/${id}`)).toEqual({ kind: 'flow', flowId: id });
    expect(readRoute(`#/flows/templates/${id}`)).toEqual({ kind: 'template', templateId: id });
  });

  it('忽略 id 后面的查询串和多余分隔符', () => {
    expect(readRoute('#/diagram/abc123?x=1')).toEqual({ kind: 'diagram', diagramId: 'abc123' });
    expect(readRoute('#/flow/abc123#top')).toEqual({ kind: 'flow', flowId: 'abc123' });
  });

  it('id 不像 id 就当主页，别硬载入一条不存在的记录', () => {
    expect(readRoute('#/diagram/a')).toEqual({ kind: 'home' });
    expect(readRoute('#/flow/')).toEqual({ kind: 'home' });
    expect(readRoute('#/flows/templates/有中文')).toEqual({ kind: 'home' });
  });
});

describe('readRoute：旧地址兼容', () => {
  it('老地址都能读出来（随后由 normalizeHash 改写成规范地址）', () => {
    const id = 'ca348941-0d2e-4f3a-9a1b-2c3d4e5f6a7b';
    expect(readRoute('#/gallery')).toEqual({ kind: 'diagrams' });
    expect(readRoute('#/templates')).toEqual({ kind: 'templates' });
    expect(readRoute(`#/d/${id}`)).toEqual({ kind: 'diagram', diagramId: id });
    expect(readRoute(`#/f/${id}`)).toEqual({ kind: 'flow', flowId: id });
    expect(readRoute(`#/t/${id}`)).toEqual({ kind: 'template', templateId: id });
  });

  it('不认识的 hash 一律回主页（少一个白屏来源）', () => {
    expect(readRoute('#/wat')).toEqual({ kind: 'home' });
    expect(readRoute('#d/abc123')).toEqual({ kind: 'home' });
    expect(readRoute('#/gallery/')).toEqual({ kind: 'home' });
  });
});

describe('父子关系（「上一页」= 固定父级）', () => {
  it('每一层的父级都是确定的', () => {
    expect(parentOf({ kind: 'diagrams' })).toEqual({ kind: 'home' });
    expect(parentOf({ kind: 'diagram', diagramId: 'x' })).toEqual({ kind: 'diagrams' });
    expect(parentOf({ kind: 'flows' })).toEqual({ kind: 'home' });
    expect(parentOf({ kind: 'flow', flowId: 'x' })).toEqual({ kind: 'flows' });
    expect(parentOf({ kind: 'templates' })).toEqual({ kind: 'flows' });
    expect(parentOf({ kind: 'template', templateId: 'x' })).toEqual({ kind: 'templates' });
  });

  it('主页没有父级（按钮置灰）', () => {
    expect(parentOf({ kind: 'home' })).toBeNull();
  });
});

describe('面包屑', () => {
  it('主页没有面包屑', () => {
    expect(breadcrumbOf({ kind: 'home' })).toEqual([]);
  });

  it('模板编辑是四层：主页 / 流程 / 模板库 / 编辑', () => {
    const crumbs = breadcrumbOf({ kind: 'template', templateId: 'x' });
    expect(crumbs.map((c) => c.label)).toEqual(['主页', '流程', '模板库', '编辑']);
    // 最后一级不可点
    expect(crumbs.at(-1)!.hash).toBeUndefined();
    expect(crumbs[0]!.hash).toBe(HOME_HASH);
  });

  it('架构图详情是三层：主页 / 架构图 / 详情', () => {
    expect(breadcrumbOf({ kind: 'diagram', diagramId: 'x' }).map((c) => c.label)).toEqual([
      '主页',
      '架构图',
      '详情',
    ]);
  });
});

describe('拼 hash', () => {
  it('拼出来的 hash 能被 readRoute 原样读回', () => {
    const id = '371eba88-1234-4abc-8def-0123456789ab';
    expect(readRoute(diagramHash(id))).toEqual({ kind: 'diagram', diagramId: id });
    expect(readRoute(flowHash(id))).toEqual({ kind: 'flow', flowId: id });
    expect(readRoute(templateHash(id))).toEqual({ kind: 'template', templateId: id });
  });

  it('hashOf 与各 navigate 函数用的是同一套地址', () => {
    expect(hashOf({ kind: 'home' })).toBe(HOME_HASH);
    expect(hashOf({ kind: 'diagrams' })).toBe(DIAGRAMS_HASH);
    expect(hashOf({ kind: 'flows' })).toBe(FLOWS_HASH);
    expect(hashOf({ kind: 'templates' })).toBe(TEMPLATES_HASH);
    expect(DIAGRAMS_HASH).toBe('#/diagrams');
    expect(TEMPLATES_HASH).toBe('#/flows/templates');
  });
});
