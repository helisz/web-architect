import { describe, expect, it } from 'vitest';
import { ALLOWED_ICON_KEYS, ICON_KEY_BY_NODE_TYPE, NODE_TYPES, iconKeyFor } from '@arch/schema';
import { ICON_COLLECTIONS } from '../src/icons/iconData.js';

/**
 * 图标必须在本地图标包里能找到。
 *
 * 这是"库里没有就报错"的守门测试：一旦有人往 ALLOWED_ICON_KEYS 里加了
 * 图标包里不存在的 key，构建不会失败、但界面上会是个空白方块，
 * 所以用测试把它挡在前面。
 */
describe('图标数据', () => {
  const available = new Set<string>();
  for (const collection of ICON_COLLECTIONS) {
    for (const name of Object.keys(collection.icons)) {
      available.add(`${collection.prefix}:${name}`);
    }
  }

  it('每个允许的 iconKey 都能在本地图标包中找到', () => {
    const missing = ALLOWED_ICON_KEYS.filter((key) => !available.has(key));
    expect(missing).toEqual([]);
  });

  it('每个节点类型映射出的 iconKey 都是合法且可渲染的', () => {
    for (const nodeType of NODE_TYPES) {
      const key = iconKeyFor(nodeType);
      expect(ALLOWED_ICON_KEYS).toContain(key);
      expect(available.has(key)).toBe(true);
    }
  });

  it('映射表覆盖全部节点类型，没有漏项', () => {
    for (const nodeType of NODE_TYPES) {
      expect(ICON_KEY_BY_NODE_TYPE[nodeType]).toBeTruthy();
    }
  });

  it('图标体内不内联图片（C15：只存 key，不存 base64/url）', () => {
    for (const collection of ICON_COLLECTIONS) {
      for (const [name, icon] of Object.entries(collection.icons)) {
        expect(icon.body, `${collection.prefix}:${name}`).not.toContain('data:');
        // devicon 的 logo 里可能有 xmlns 引用，但不该出现远程 URL
        expect(icon.body, `${collection.prefix}:${name}`).not.toMatch(/https?:\/\//);
      }
    }
  });
});
