import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDiagram } from '@arch/schema';
import { buildGroupMenu } from '../src/canvas/contextMenus.js';
import { useDiagramStore } from '../src/store/useDiagramStore.js';

const store = () => useDiagramStore.getState();

beforeEach(() => {
  store().setDiagram(createEmptyDiagram({ name: '菜单' }));
});

const labels = (menu: ReturnType<typeof buildGroupMenu>): string[] =>
  menu.map((item) => (item.kind === 'separator' ? '—' : item.label));

describe('分组右键菜单（用户 2026-11-04）', () => {
  it('未锁定时给出重命名 / 折叠 / 锁定 / 解组 / 删除 / 着色', () => {
    const group = store().addGroup({ x: 0, y: 0 }, { label: '分组' });
    const menu = labels(buildGroupMenu(group));
    expect(menu).toContain('重命名');
    expect(menu).toContain('折叠');
    expect(menu).toContain('锁定分组');
    expect(menu).toContain('解组（保留内容）');
    expect(menu).toContain('删除分组');
    expect(menu).toContain('着色');
  });

  it('锁定后只剩「解锁分组」一项', () => {
    const group = store().addGroup({ x: 0, y: 0 }, { label: '分组' });
    store().toggleLock([group.groupId]);
    const locked = store().diagram.groups[0]!;
    expect(labels(buildGroupMenu(locked))).toEqual(['解锁分组']);
  });
});
