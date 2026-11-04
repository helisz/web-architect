import { TABLES } from '@arch/schema';
import { supabase as supabaseClient } from '../lib/supabase.js';

/** supabase 在缺环境变量时为 null；能走到这里说明配置已校验过 */
const db = () => {
  if (!supabaseClient) throw new Error('Supabase 未配置');
  return supabaseClient;
};
import type { SaveResult } from './diagramRepo.js';
import type { SavePayload } from './payloadDiff.js';
import { thumbnailDataUrl } from '../export/thumbnail.js';

/**
 * 快照与回滚（阶段 3 · D7）。
 *
 * 快照由保存函数按 C8 策略自动写（首次 / 每 5 版 / 距上次 ≥30 分钟），
 * 这里只负责"列出来 / 看内容 / 回滚"。
 *
 * 回滚 = 把快照 payload 原样交给 `arch_save_diagram`（baseVersion 传 null 强制覆盖），
 * 版本号由函数 +1 —— 所以回滚不是"倒带"，而是"把旧内容当成一次新提交"，
 * 满足 D7 的 `version = max + 1`，历史也不会丢。
 */

export interface SnapshotRow {
  snapshot_id: string;
  version: number;
  name: string;
  created_at: string;
  created_by: string | null;
  payload: SavePayload | null;
}

export interface SnapshotSummary {
  snapshotId: string;
  version: number;
  name: string;
  createdAt: string;
  createdBy: string;
  /** 快照里的节点 / 连线 / 分组数量（列表里直接显示，省一次点击） */
  counts: { nodes: number; edges: number; groups: number } | null;
  /** 缩略图 data URL（用 payload 现算，不额外占存储） */
  thumbnail: string | null;
}

const countOf = (payload: SavePayload | null): SnapshotSummary['counts'] => {
  if (!payload) return null;
  return {
    nodes: payload.nodes?.length ?? 0,
    edges: payload.edges?.length ?? 0,
    groups: payload.groups?.length ?? 0,
  };
};

/** 列出某张图的快照（新 → 旧，最多 50 条） */
export async function listSnapshots(diagramId: string): Promise<SnapshotSummary[]> {
  const { data, error } = await db()
    .from(TABLES.snapshot)
    .select('snapshot_id, version, name, created_at, created_by, payload')
    .eq('diagram_id', diagramId)
    .order('version', { ascending: false })
    .limit(50);

  if (error) throw new Error(error.message);
  return ((data ?? []) as SnapshotRow[]).map((row) => ({
    snapshotId: row.snapshot_id,
    version: row.version,
    name: row.name,
    createdAt: row.created_at,
    createdBy: row.created_by ?? '',
    counts: countOf(row.payload),
    thumbnail: row.payload ? thumbnailDataUrl(row.payload, 96) : null,
  }));
}

/** 取某个快照的完整 payload（预览 / 回滚用） */
export async function loadSnapshotPayload(snapshotId: string): Promise<SavePayload | null> {
  const { data, error } = await db()
    .from(TABLES.snapshot)
    .select('payload')
    .eq('snapshot_id', snapshotId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return ((data as { payload: SavePayload | null } | null)?.payload ?? null) ?? null;
}

/**
 * 手动保存当前版本为快照（C8 的"手动命名快照"）。
 *
 * payload 用服务端的 `arch_diagram_payload` 重建 —— 这样快照内容与库里的行完全一致，
 * 也不需要在浏览器里再拼一遍 payload。
 * 同一版本已有快照时（`arch_uq_snapshot_version`）改成重命名，不报错。
 */
export async function saveManualSnapshot(
  diagramId: string,
  version: number,
  name: string,
): Promise<{ created: true } | { created: false; renamed: true }> {
  const { data: payload, error: payloadError } = await db().rpc('arch_diagram_payload', {
    p_diagram_id: diagramId,
  });
  if (payloadError) throw new Error(payloadError.message);

  const snapshotId = crypto.randomUUID();
  const { error } = await db().from(TABLES.snapshot).insert({
    snapshot_id: snapshotId,
    diagram_id: diagramId,
    version,
    name,
    payload,
    created_by: 'manual',
  });

  if (!error) return { created: true };

  // 23505 = unique_violation：这一版已经有快照了，把名字改掉即可
  if ((error as { code?: string }).code === '23505') {
    const { error: renameError } = await db()
      .from(TABLES.snapshot)
      .update({ name })
      .eq('diagram_id', diagramId)
      .eq('version', version);
    if (renameError) throw new Error(renameError.message);
    return { created: false, renamed: true };
  }

  throw new Error(error.message);
}

/**
 * 回滚（B6）：优先走 `arch_restore_snapshot` RPC（版本 +1 的逻辑在库里）；
 * 函数还没装时退回到"取 payload → 整图保存"，行为一致，只是多一次往返。
 *
 * 不校验 payload —— 它来自我们自己的库，落库时已经校验过一次；
 * 再校验反而会因为"当时合法的旧枚举"被现在的规则拒掉。
 */
export async function restoreSnapshot(
  snapshotId: string,
  fallbackPayload?: SavePayload,
): Promise<SaveResult> {
  const { data, error } = await db().rpc('arch_restore_snapshot', { p_snapshot_id: snapshotId });

  if (error) {
    const message = error.message ?? String(error);
    const missing = (error as { code?: string }).code === 'PGRST202' || message.includes('arch_restore_snapshot');
    if (!missing) return { ok: false, reason: 'failed', message };
    // 没有 RPC：退回整图保存
    if (!fallbackPayload) return { ok: false, reason: 'missing_function', message };
    return restoreSnapshotBySave(fallbackPayload);
  }

  return parseSaveResponse(data);
}

/** 旧路径：直接以 payload 发起整图保存（baseVersion = null 表示强制覆盖） */
export async function restoreSnapshotBySave(payload: SavePayload): Promise<SaveResult> {
  const { data, error } = await db().rpc('arch_save_diagram', {
    p_payload: payload,
    p_base_version: null,
  });

  if (error) {
    const message = error.message ?? String(error);
    if ((error as { code?: string }).code === 'PGRST202' || message.includes('arch_save_diagram')) {
      return { ok: false, reason: 'missing_function', message };
    }
    return { ok: false, reason: 'failed', message };
  }

  return parseSaveResponse(data);
}

/** 保存类 RPC 的返回都长这样：{ version, savedAt, snapshot } */
function parseSaveResponse(data: unknown): SaveResult {
  const response = (Array.isArray(data) ? data[0] : data) as
    | { version: number; savedAt: string; snapshot: boolean }
    | null;
  if (!response || typeof response.version !== 'number') {
    return { ok: false, reason: 'failed', message: '回滚返回结构异常' };
  }
  return { ok: true, version: response.version, savedAt: response.savedAt, snapshot: response.snapshot };
}

