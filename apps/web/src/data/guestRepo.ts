import type { ArchitectureDiagram, ValidationIssue } from '@arch/schema';
import { DEFAULT_CREATOR_ID, SCHEMA_VERSION, validateDiagram } from '@arch/schema';
import { newId } from '@arch/schema';
import type { DiagramPage, DiagramSummary, ListOptions, LoadedDiagram, SaveResult } from './diagramRepo.js';
import { reissueIds } from './transfer.js';

/**
 * 游客试用：localStorage 后端（用户 2026-11-05）。
 *
 * 和 `diagramRepo` 同一套函数签名，由 `diagramRepo` 按模式分派 —— 图库、画布、
 * 自动保存都不需要知道自己跑在哪一种后端上。
 *
 * 存储布局（全部 `arch:guest:` 前缀，和登录态的 `arch:*` 键完全隔开）：
 * - `arch:guest:on`            是否处于游客模式（在 guestSession 里）
 * - `arch:guest:index`         图列表（卡片用的元数据）
 * - `arch:guest:d:<id>`        整张图（就是导出的那份 JSON，导入导出互通）
 * - `arch:guest:asked`         已经问过"要不要导入到账号"，不再重复打扰
 *
 * 限制（用户 2026-11-05 定）：最多 20 张、单张 1.5MB。超了报明确错误，
 * 绝不静默丢数据 —— localStorage 大约 5MB，一张 200 节点的图 ~120KB。
 */

const INDEX_KEY = 'arch:guest:index';
const BODY_PREFIX = 'arch:guest:d:';
const ASKED_KEY = 'arch:guest:asked';

export const MAX_GUEST_DIAGRAMS = 20;
export const MAX_GUEST_BYTES = 1_500_000;

interface GuestIndexEntry {
  diagramId: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  nodeCount: number;
  edgeCount: number;
}

function readIndex(): GuestIndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is GuestIndexEntry =>
        Boolean(row) && typeof (row as GuestIndexEntry).diagramId === 'string' && typeof (row as GuestIndexEntry).name === 'string',
    );
  } catch {
    return [];
  }
}

function writeIndex(entries: GuestIndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    throw new Error('本机浏览器存储写不进去（可能是隐私模式或空间已满），请导出 JSON 备份');
  }
}

function bodyKey(diagramId: string): string {
  return `${BODY_PREFIX}${diagramId}`;
}

function readBody(diagramId: string): ArchitectureDiagram | null {
  try {
    const raw = localStorage.getItem(bodyKey(diagramId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const result = validateDiagram(parsed as ArchitectureDiagram, { repair: true });
    if (!result.diagram) return null;
    /**
     * 图的 `extJson`（全局锁定编辑等元数据）不在 `diagramSchema` 里，Zod 会把它剥掉
     * —— 云端由 `assembleDiagram` 从主表单独取回，本机这边得自己补。
     * 少了它，「锁定编辑」刷新一次就自己解锁了。
     */
    const ext = (parsed as { extJson?: unknown }).extJson;
    const extJson = ext && typeof ext === 'object' ? (ext as Record<string, unknown>) : {};
    return { ...result.diagram, extJson };
  } catch {
    return null;
  }
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 2;
  }
}

function writeBody(diagram: ArchitectureDiagram): void {
  const json = JSON.stringify(diagram);
  if (byteLength(json) > MAX_GUEST_BYTES) {
    const mb = (byteLength(json) / 1_000_000).toFixed(2);
    throw new Error(`这张图有 ${mb}MB，超过游客模式单张 1.5MB 的上限。导出 JSON 后登录，或者拆成几张图`);
  }
  try {
    localStorage.setItem(bodyKey(diagram.diagramId), json);
  } catch {
    throw new Error('本机浏览器存储满了（游客模式约 5MB）。删掉几张旧图，或导出 JSON 备份后登录');
  }
}

function removeBody(diagramId: string): void {
  try {
    localStorage.removeItem(bodyKey(diagramId));
  } catch {
    // 删不掉也不影响：index 里已经没有了
  }
}

function toSummary(entry: GuestIndexEntry): DiagramSummary {
  return {
    diagramId: entry.diagramId,
    name: entry.name,
    version: entry.version,
    updatedAt: entry.updatedAt,
    tags: entry.tags,
  };
}

function upsertEntry(diagram: ArchitectureDiagram, at: string): GuestIndexEntry {
  const entries = readIndex();
  const existing = entries.find((e) => e.diagramId === diagram.diagramId);
  const next: GuestIndexEntry = {
    diagramId: diagram.diagramId,
    name: diagram.name,
    version: diagram.version,
    createdAt: existing?.createdAt ?? diagram.createdAt ?? at,
    updatedAt: at,
    tags: existing?.tags ?? [],
    nodeCount: diagram.nodes.filter((n) => !n.isDeleted).length,
    edgeCount: diagram.edges.filter((e) => !e.isDeleted).length,
  };
  const rest = entries.filter((e) => e.diagramId !== diagram.diagramId);
  writeIndex([next, ...rest]);
  return next;
}

/* ------------------------------------------------------------------ */
/* 和 diagramRepo 对齐的接口                                            */
/* ------------------------------------------------------------------ */

export async function listDiagrams(options: ListOptions = {}): Promise<DiagramPage> {
  const { search, tag, sort = 'updated', limit = 12, offset = 0 } = options;
  let rows = readIndex();

  const needle = search?.trim().toLowerCase();
  if (needle) rows = rows.filter((row) => row.name.toLowerCase().includes(needle));
  if (tag) rows = rows.filter((row) => row.tags.includes(tag));

  if (sort === 'name') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  else if (sort === 'version') rows = [...rows].sort((a, b) => b.version - a.version);
  else rows = [...rows].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return {
    rows: rows.slice(offset, offset + Math.max(0, limit)).map(toSummary),
    total: rows.length,
  };
}

export async function listAllTags(): Promise<string[]> {
  const set = new Set<string>();
  for (const row of readIndex()) for (const tag of row.tags) set.add(tag);
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export async function updateDiagramTags(diagramId: string, tags: string[]): Promise<void> {
  const cleaned = [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 12);
  const entries = readIndex();
  const index = entries.findIndex((e) => e.diagramId === diagramId);
  if (index < 0) return;
  entries[index] = { ...entries[index]!, tags: cleaned };
  writeIndex(entries);
}

export async function persistDiagramExt(diagramId: string, extJson: Record<string, unknown>): Promise<void> {
  const diagram = readBody(diagramId);
  if (!diagram) return;
  writeBody({ ...diagram, extJson });
}

export async function loadDiagram(diagramId: string): Promise<LoadedDiagram> {
  const stored = readBody(diagramId);
  if (!stored) throw new Error(`这张图不存在（本机游客数据里没有 ${diagramId}）`);
  const issues: ValidationIssue[] = [];
  return { diagram: stored, issues };
}

export async function createDiagram(diagram: ArchitectureDiagram): Promise<SaveResult> {
  return saveDiagram(diagram, null);
}

export async function renameDiagram(diagramId: string, name: string): Promise<void> {
  const clean = name.trim() || '未命名架构图';
  const diagram = readBody(diagramId);
  const at = new Date().toISOString();
  if (diagram) writeBody({ ...diagram, name: clean, updatedAt: at });
  const entries = readIndex();
  const index = entries.findIndex((e) => e.diagramId === diagramId);
  if (index >= 0) {
    entries[index] = { ...entries[index]!, name: clean, updatedAt: at };
    writeIndex(entries);
  }
}

export async function duplicateDiagram(diagramId: string): Promise<{ diagramId: string; name: string }> {
  const source = readBody(diagramId);
  if (!source) throw new Error('这张图不存在，复制不了');
  const copy = reissueIds(source);
  const name = `${source.name}（副本）`.slice(0, 80);
  const result = await saveDiagram({ ...copy, name, creatorId: DEFAULT_CREATOR_ID, schemaVersion: SCHEMA_VERSION }, null);
  if (!result.ok) throw new Error(result.message);
  return { diagramId: copy.diagramId, name };
}

export async function deleteDiagram(diagramId: string): Promise<void> {
  writeIndex(readIndex().filter((e) => e.diagramId !== diagramId));
  removeBody(diagramId);
}

export async function saveDiagram(diagram: ArchitectureDiagram, _baseVersion: number | null): Promise<SaveResult> {
  const at = new Date().toISOString();
  const entries = readIndex();
  const existing = entries.find((e) => e.diagramId === diagram.diagramId);
  if (!existing && entries.length >= MAX_GUEST_DIAGRAMS) {
    throw new Error(`游客模式最多 ${MAX_GUEST_DIAGRAMS} 张图。删掉几张旧图，或导出 JSON 后登录`);
  }

  const version = (existing?.version ?? 0) + 1;
  const next: ArchitectureDiagram = {
    ...diagram,
    version,
    createdAt: diagram.createdAt || at,
    updatedAt: at,
    creatorId: diagram.creatorId || DEFAULT_CREATOR_ID,
  };
  writeBody(next);
  upsertEntry(next, at);
  return { ok: true, version, savedAt: at, snapshot: false };
}

export async function patchDiagram(
  diagram: ArchitectureDiagram,
  _version: number,
  _patch: unknown,
): Promise<SaveResult> {
  // 游客不做增量：localStorage 写整图的成本远低于维护 diff 的复杂度
  return saveDiagram(diagram, null);
}

/* ------------------------------------------------------------------ */
/* 迁移到账号（登录时问一次）                                          */
/* ------------------------------------------------------------------ */

/** 本机有几张游客图（顶栏/横幅和登录询问都用它） */
export function guestDiagramCount(): number {
  return readIndex().length;
}

export function guestDiagramsMeta(): DiagramSummary[] {
  return readIndex().map(toSummary);
}

/** 读出全部游客图（导入账号时用；已经重编 id 由调用方决定） */
export function loadAllGuestDiagrams(): ArchitectureDiagram[] {
  const out: ArchitectureDiagram[] = [];
  for (const entry of readIndex()) {
    const diagram = readBody(entry.diagramId);
    if (diagram) out.push(diagram);
  }
  return out;
}

/** 清空本机游客数据（导入成功后 / 用户主动清理） */
export function clearGuestData(): void {
  for (const entry of readIndex()) removeBody(entry.diagramId);
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    // ignore
  }
}

/** 是否已经问过"要不要导入"（同一浏览器只问一次） */
export function guestImportAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGuestImportAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // ignore
  }
}

/** 供单测/调试：生成一个空图的 id（避免每个调用方各自 newId） */
export function makeGuestDiagramId(): string {
  return newId();
}
