import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDiagram, createNode } from '@arch/schema';

/**
 * 游客后端（localStorage）单测。
 *
 * 项目测试跑在 node 环境，没有 localStorage —— 和 localState.test.ts 一样打个内存桩，
 * 再用**动态 import** 加载被测模块（模块初始化时会读 flag / 建 store）。
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

const guest = await import('../src/data/guestRepo.js');
const { useGuestSession } = await import('../src/data/guestSession.js');
const repo = await import('../src/data/diagramRepo.js');

function blank(name = '游客图') {
  return createEmptyDiagram({ name });
}

function withNode(diagram = blank(), label = 'WAF') {
  const node = createNode('waf', diagram.diagramId, { x: 10, y: 20 }, { label });
  return { ...diagram, nodes: [node] };
}

beforeEach(() => {
  storage.clear();
  useGuestSession.setState({ guest: true });
});

describe('游客仓储：基本读写', () => {
  it('空的时候列表是空的，也没有标签', async () => {
    const page = await guest.listDiagrams({});
    expect(page.total).toBe(0);
    expect(page.rows).toEqual([]);
    expect(await guest.listAllTags()).toEqual([]);
  });

  it('新建后能列出来，保存会推版本号并更新 updatedAt', async () => {
    const diagram = withNode();
    const created = await guest.saveDiagram(diagram, null);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.version).toBe(1);

    const page = await guest.listDiagrams({});
    expect(page.total).toBe(1);
    expect(page.rows[0]!.name).toBe('游客图');
    expect(page.rows[0]!.version).toBe(1);

    // 老图重存：version 递增（和云端 save 的语义一致，顶栏那个 v 数字才不会卡住）
    const saved = await guest.saveDiagram({ ...diagram, name: '改过名' }, 1);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.version).toBe(2);
    expect((await guest.listDiagrams({})).rows[0]!.name).toBe('改过名');
  });

  it('loadDiagram 读回节点，缺图时报"不存在"（路由靠这句话回图库）', async () => {
    const diagram = withNode();
    await guest.saveDiagram(diagram, null);
    const loaded = await guest.loadDiagram(diagram.diagramId);
    expect(loaded.diagram.nodes).toHaveLength(1);
    expect(loaded.diagram.nodes[0]!.label).toBe('WAF');

    await expect(guest.loadDiagram('not-a-real-id')).rejects.toThrow(/图不存在/);
  });

  it('名字/标签/复制/删除都是本机操作', async () => {
    const diagram = blank('原名');
    await guest.saveDiagram(diagram, null);

    await guest.renameDiagram(diagram.diagramId, '  新名字  ');
    expect((await guest.listDiagrams({})).rows[0]!.name).toBe('新名字');

    await guest.updateDiagramTags(diagram.diagramId, [' 生产 ', '生产', '']);
    expect((await guest.listDiagrams({})).rows[0]!.tags).toEqual(['生产']);
    expect(await guest.listAllTags()).toEqual(['生产']);

    const copy = await guest.duplicateDiagram(diagram.diagramId);
    expect(copy.name).toBe('新名字（副本）');
    expect(copy.diagramId).not.toBe(diagram.diagramId);
    expect((await guest.listDiagrams({})).total).toBe(2);
    // 副本里的节点也要重编 id（不然又指回原图的节点）
    expect((await guest.loadDiagram(copy.diagramId)).diagram.nodes).toHaveLength(0);

    await guest.deleteDiagram(diagram.diagramId);
    const after = await guest.listDiagrams({});
    expect(after.total).toBe(1);
    expect(after.rows[0]!.diagramId).toBe(copy.diagramId);
  });

  it('搜索 / 标签筛选 / 排序 / 分页都在本地算', async () => {
    for (const [name, tag] of [
      ['支付网关', '生产'],
      ['订单服务', '测试'],
      ['推荐服务', '生产'],
    ] as const) {
      const d = blank(name);
      await guest.saveDiagram(d, null);
      if (tag) await guest.updateDiagramTags(d.diagramId, [tag]);
    }

    expect((await guest.listDiagrams({ search: '服务' })).total).toBe(2);
    expect((await guest.listDiagrams({ tag: '生产' })).total).toBe(2);
    // zh-CN 排序走拼音：订(d) < 推(t) < 支(z)
    expect((await guest.listDiagrams({ sort: 'name' })).rows.map((r) => r.name)).toEqual([
      '订单服务',
      '推荐服务',
      '支付网关',
    ]);
    const page = await guest.listDiagrams({ limit: 2, offset: 2 });
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(3);
  });

  it('persistDiagramExt 只改扩展字段，不推版本号', async () => {
    const diagram = blank();
    await guest.saveDiagram(diagram, null);
    await guest.persistDiagramExt(diagram.diagramId, { editLocked: true });
    const loaded = await guest.loadDiagram(diagram.diagramId);
    expect(loaded.diagram.extJson).toEqual({ editLocked: true });
    expect((await guest.listDiagrams({})).rows[0]!.version).toBe(1);
  });
});

describe('游客仓储：上限与配额', () => {
  it(`最多 ${guest.MAX_GUEST_DIAGRAMS} 张，第 21 张给明确错误`, async () => {
    for (let i = 0; i < guest.MAX_GUEST_DIAGRAMS; i++) {
      await guest.saveDiagram(blank(`图 ${i + 1}`), null);
    }
    expect((await guest.listDiagrams({})).total).toBe(guest.MAX_GUEST_DIAGRAMS);

    await expect(guest.saveDiagram(blank('超了'), null)).rejects.toThrow(/最多 20 张/);
    // 已存在的图还能继续存（上限只挡新建）
    const existing = (await guest.listDiagrams({})).rows[0]!;
    await expect(guest.saveDiagram({ ...blank(existing.name), diagramId: existing.diagramId }, 1)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('单张超过 1.5MB 拒绝写入，并且不留半张图', async () => {
    const big = withNode(blank('巨图'));
    // 用超长副文本把 JSON 撑到 1.5MB 以上
    big.nodes[0]!.subLabel = 'x'.repeat(guest.MAX_GUEST_BYTES + 1024);
    await expect(guest.saveDiagram(big, null)).rejects.toThrow(/1\.5MB/);
    expect((await guest.listDiagrams({})).total).toBe(0);
  });
});

describe('游客仓储：数据隔离与迁移', () => {
  it('只写 arch:guest:*，不碰 arch:draft / 数据库表', async () => {
    await guest.saveDiagram(withNode(blank('隔离测试')), null);
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('arch:guest:')).toBe(true);
    expect(keys.some((k) => k.startsWith('arch:draft:'))).toBe(false);
  });

  it('loadAllGuestDiagrams 能整体取出（导入账号用），clearGuestData 清干净', async () => {
    await guest.saveDiagram(withNode(blank('A'), 'A 节点'), null);
    await guest.saveDiagram(withNode(blank('B'), 'B 节点'), null);
    expect(guest.guestDiagramCount()).toBe(2);

    const all = guest.loadAllGuestDiagrams();
    expect(all.map((d) => d.name).sort()).toEqual(['A', 'B']);
    expect(all.every((d) => d.nodes.length === 1)).toBe(true);

    guest.clearGuestData();
    expect(guest.guestDiagramCount()).toBe(0);
    expect((await guest.listDiagrams({})).total).toBe(0);
  });

  it('问过一次导入之后就记住，不再打扰', async () => {
    expect(guest.guestImportAsked()).toBe(false);
    guest.markGuestImportAsked();
    expect(guest.guestImportAsked()).toBe(true);
  });
});

describe('模式分派：游客不碰 Supabase', () => {
  it('isGuestMode 为真时，diagramRepo 的读写走本机（未配置 Supabase 也不报错）', async () => {
    const diagram = withNode(blank('分派测试'));
    const saved = await repo.saveDiagram(diagram, null);
    expect(saved.ok).toBe(true);

    const page = await repo.listDiagrams({});
    expect(page.total).toBe(1);
    expect(page.rows[0]!.name).toBe('分派测试');

    const loaded = await repo.loadDiagram(diagram.diagramId);
    expect(loaded.diagram.nodes).toHaveLength(1);

    await repo.renameDiagram(diagram.diagramId, '走本机');
    expect((await repo.listDiagrams({})).rows[0]!.name).toBe('走本机');
  });

  it('退出游客模式后不再走本地（会真的去问 Supabase，拿不到数据就报错）', async () => {
    useGuestSession.setState({ guest: false });
    storage.removeItem('arch:guest:on');
    // 测试环境没有登录会话：PostgREST 要么报权限、要么报未配置，总之不是本地那份空列表
    await expect(repo.listDiagrams({})).rejects.toThrow();
    useGuestSession.setState({ guest: true });
  });
});
