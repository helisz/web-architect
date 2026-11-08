import {
  normalizeTemplateConfig,
  type Flow,
  type FlowEdge,
  type FlowNode,
  type FlowTemplate,
  type FlowTemplateConfig,
} from '@arch/schema';
import { supabase } from '../lib/supabase.js';
import { isGuestMode } from './guestSession.js';

/**
 * 流程与模板的数据访问（2026-11-08）。
 *
 * 和架构图那套完全独立（用户选定新建一套表）：
 * - 流程：`arch_flow` / `arch_flow_node` / `arch_flow_edge`，写入走 `arch_flow_save`（事务 + 乐观锁）
 * - 模板：`arch_flow_template`，公共模板所有人可读，私有模板只有自己
 *
 * 游客模式：全部落 localStorage（`arch:guest:flow:*`），一个请求都不发。
 */

function client() {
  if (!supabase) {
    throw new Error('Supabase 未配置：请在 .env.local 里填 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY');
  }
  return supabase;
}

export interface FlowSummary {
  flowId: string;
  name: string;
  description: string;
  version: number;
  updatedAt: string;
  nodeCount: number;
}

export interface TemplateSummary {
  templateId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  creatorId: string;
  updatedAt: string;
}

export interface SaveFlowResult {
  ok: boolean;
  version?: number;
  currentVersion?: number;
  message?: string;
}

/* ------------------------------------------------------------------ *
 * 游客：localStorage
 * ------------------------------------------------------------------ */

const GUEST_FLOW_INDEX = 'arch:guest:flow:index';
const GUEST_FLOW_PREFIX = 'arch:guest:flow:f:';
const GUEST_TPL_INDEX = 'arch:guest:flow:tpl-index';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('浏览器本机存储写不进去了（可能超限），先删掉一些流程再试');
  }
}

/* ------------------------------------------------------------------ *
 * 模板
 * ------------------------------------------------------------------ */

export async function listTemplates(): Promise<TemplateSummary[]> {
  if (isGuestMode()) {
    return readJson<TemplateSummary[]>(GUEST_TPL_INDEX, []);
  }
  const { data, error } = await client()
    .from('arch_flow_template')
    .select('template_id,name,description,visibility,creator_id,updated_at')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`读取模板列表失败：${error.message}`);
  return (data ?? []).map((row) => ({
    templateId: row.template_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    visibility: (row.visibility as 'public' | 'private') ?? 'private',
    creatorId: (row.creator_id as string) ?? '',
    updatedAt: row.updated_at as string,
  }));
}

export async function loadTemplate(templateId: string): Promise<FlowTemplate | null> {
  if (isGuestMode()) {
    const all = readJson<FlowTemplate[]>(GUEST_TPL_INDEX, []);
    const row = all.find((t) => t.templateId === templateId);
    if (!row) return null;
    return { ...row, config: normalizeTemplateConfig(row.config) };
  }
  const { data, error } = await client()
    .from('arch_flow_template')
    .select('*')
    .eq('template_id', templateId)
    .maybeSingle();
  if (error) throw new Error(`读取模板失败：${error.message}`);
  if (!data) return null;
  return {
    templateId: data.template_id as string,
    name: data.name as string,
    description: (data.description as string) ?? '',
    visibility: (data.visibility as 'public' | 'private') ?? 'private',
    creatorId: (data.creator_id as string) ?? '',
    updatedAt: (data.updated_at as string) ?? '',
    config: normalizeTemplateConfig(data.config),
  };
}

export async function saveTemplate(input: {
  templateId: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  config: FlowTemplateConfig;
}): Promise<void> {
  if (isGuestMode()) {
    const all = readJson<FlowTemplate[]>(GUEST_TPL_INDEX, []);
    const entry: FlowTemplate = {
      templateId: input.templateId,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      creatorId: 'guest',
      updatedAt: new Date().toISOString(),
      config: normalizeTemplateConfig(input.config),
    };
    const next = all.some((t) => t.templateId === input.templateId)
      ? all.map((t) => (t.templateId === input.templateId ? entry : t))
      : [entry, ...all];
    writeJson(GUEST_TPL_INDEX, next);
    return;
  }

  const { data: session } = await client().auth.getSession();
  const creatorId = session.session?.user?.id;
  if (!creatorId) throw new Error('未登录，不能保存模板');

  const { error } = await client()
    .from('arch_flow_template')
    .upsert(
      {
        template_id: input.templateId,
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        creator_id: creatorId,
        config: input.config,
        is_deleted: false,
      },
      { onConflict: 'template_id' },
    );
  if (error) {
    // 只有管理员能建公共模板（RLS 会拦），这里给一句能看懂的话
    if (error.code === '42501' || error.message.includes('row-level security')) {
      throw new Error('没有权限保存这个模板：公共模板只有管理员能建，普通用户可以存成私有模板');
    }
    throw new Error(`保存模板失败：${error.message}`);
  }
}

export async function deleteTemplate(templateId: string): Promise<void> {
  if (isGuestMode()) {
    const all = readJson<FlowTemplate[]>(GUEST_TPL_INDEX, []);
    writeJson(
      GUEST_TPL_INDEX,
      all.filter((t) => t.templateId !== templateId),
    );
    return;
  }
  const { error } = await client()
    .from('arch_flow_template')
    .update({ is_deleted: true })
    .eq('template_id', templateId);
  if (error) throw new Error(`删除模板失败：${error.message}`);
}

/* ------------------------------------------------------------------ *
 * 流程
 * ------------------------------------------------------------------ */

export async function listFlows(): Promise<FlowSummary[]> {
  if (isGuestMode()) {
    return readJson<FlowSummary[]>(GUEST_FLOW_INDEX, []);
  }
  const { data, error } = await client()
    .from('arch_flow')
    .select('flow_id,name,description,version,updated_at')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`读取流程列表失败：${error.message}`);
  return (data ?? []).map((row) => ({
    flowId: row.flow_id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    version: (row.version as number) ?? 1,
    updatedAt: row.updated_at as string,
    nodeCount: 0,
  }));
}

export async function loadFlow(flowId: string): Promise<Flow | null> {
  if (isGuestMode()) {
    const stored = readJson<Flow | null>(`${GUEST_FLOW_PREFIX}${flowId}`, null);
    if (!stored) return null;
    return {
      ...stored,
      nodes: (stored.nodes ?? []).map((n) => ({
        ...n,
        templateSnapshot: normalizeTemplateConfig(n.templateSnapshot),
      })),
    };
  }

  const { data: master, error } = await client()
    .from('arch_flow')
    .select('*')
    .eq('flow_id', flowId)
    .maybeSingle();
  if (error) throw new Error(`读取流程失败：${error.message}`);
  if (!master) return null;

  const [{ data: nodeRows, error: nodeError }, { data: edgeRows, error: edgeError }] = await Promise.all([
    client().from('arch_flow_node').select('*').eq('flow_id', flowId).eq('is_deleted', false),
    client().from('arch_flow_edge').select('*').eq('flow_id', flowId).eq('is_deleted', false),
  ]);
  if (nodeError) throw new Error(`读取流程节点失败：${nodeError.message}`);
  if (edgeError) throw new Error(`读取流程连线失败：${edgeError.message}`);

  return {
    flowId: master.flow_id as string,
    name: master.name as string,
    description: (master.description as string) ?? '',
    version: (master.version as number) ?? 1,
    viewport: {
      x: Number(master.viewport_x ?? 0),
      y: Number(master.viewport_y ?? 0),
      zoom: Number(master.viewport_zoom ?? 1),
    },
    updatedAt: (master.updated_at as string) ?? '',
    nodes: (nodeRows ?? []).map((row) => ({
      nodeId: row.node_id as string,
      flowId: row.flow_id as string,
      templateId: (row.template_id as string) ?? null,
      label: (row.label as string) ?? '',
      x: Number(row.x ?? 0),
      y: Number(row.y ?? 0),
      width: Number(row.width ?? 300),
      height: Number(row.height ?? 200),
      params: (row.params as Record<string, string>) ?? {},
      templateSnapshot: normalizeTemplateConfig(row.template_snapshot),
      extJson: (row.ext_json as Record<string, unknown>) ?? undefined,
      sort: Number(row.sort ?? 0),
    })),
    edges: (edgeRows ?? []).map((row) => ({
      edgeId: row.edge_id as string,
      flowId: row.flow_id as string,
      sourceNodeId: row.source_node_id as string,
      targetNodeId: row.target_node_id as string,
      label: (row.label as string) ?? '',
      sourceAnchor: (row.source_anchor as string) ?? null,
      targetAnchor: (row.target_anchor as string) ?? null,
      strokeColor: (row.stroke_color as string) ?? '#AFACA2',
      strokeWidth: Number(row.stroke_width ?? 2),
      strokeDasharray: (row.stroke_dasharray as string) ?? null,
      extJson: (row.ext_json as Record<string, unknown>) ?? undefined,
      sort: Number(row.sort ?? 0),
    })),
  };
}

/** 落库用的 payload：字段名与 `arch_flow_save` 里读的一致 */
function toSavePayload(flow: Flow): Record<string, unknown> {
  return {
    flowId: flow.flowId,
    name: flow.name,
    description: flow.description,
    viewport: flow.viewport,
    nodes: flow.nodes.map((node: FlowNode) => ({
      nodeId: node.nodeId,
      templateId: node.templateId ?? '',
      label: node.label,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      params: node.params,
      templateSnapshot: node.templateSnapshot,
      extJson: node.extJson ?? null,
      sort: node.sort,
    })),
    edges: flow.edges.map((edge: FlowEdge) => ({
      edgeId: edge.edgeId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label,
      sourceAnchor: edge.sourceAnchor ?? '',
      targetAnchor: edge.targetAnchor ?? '',
      strokeColor: edge.strokeColor,
      strokeWidth: edge.strokeWidth,
      strokeDasharray: edge.strokeDasharray ?? '',
      extJson: edge.extJson ?? null,
      sort: edge.sort,
    })),
  };
}

export async function saveFlow(flow: Flow, baseVersion: number | null): Promise<SaveFlowResult> {
  if (isGuestMode()) {
    const stored = readJson<Flow | null>(`${GUEST_FLOW_PREFIX}${flow.flowId}`, null);
    const version = (stored?.version ?? 0) + 1;
    const saved: Flow = { ...flow, version, updatedAt: new Date().toISOString() };
    writeJson(`${GUEST_FLOW_PREFIX}${flow.flowId}`, saved);

    const index = readJson<FlowSummary[]>(GUEST_FLOW_INDEX, []);
    const summary: FlowSummary = {
      flowId: flow.flowId,
      name: flow.name,
      description: flow.description,
      version,
      updatedAt: saved.updatedAt,
      nodeCount: flow.nodes.length,
    };
    writeJson(
      GUEST_FLOW_INDEX,
      index.some((row) => row.flowId === flow.flowId)
        ? index.map((row) => (row.flowId === flow.flowId ? summary : row))
        : [summary, ...index],
    );
    return { ok: true, version };
  }

  const { data, error } = await client().rpc('arch_flow_save', {
    p_flow: toSavePayload(flow),
    p_base_version: baseVersion,
  });
  if (error) {
    if (error.code === 'PGRST202' || error.message.includes('arch_flow_save')) {
      return {
        ok: false,
        message: '数据库里还没有 arch_flow_save 函数：请先执行 supabase/patch-flow.sql',
      };
    }
    return { ok: false, message: error.message };
  }

  const result = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; version?: number; currentVersion?: number; reason?: string }
    | null;

  if (!result) return { ok: false, message: '保存返回结构异常' };
  if (!result.ok) {
    return {
      ok: false,
      currentVersion: result.currentVersion,
      message: result.reason === 'version_conflict' ? '这张流程在别处被改过' : '保存失败',
    };
  }
  return { ok: true, version: result.version };
}

export async function deleteFlow(flowId: string): Promise<void> {
  if (isGuestMode()) {
    const index = readJson<FlowSummary[]>(GUEST_FLOW_INDEX, []);
    writeJson(
      GUEST_FLOW_INDEX,
      index.filter((row) => row.flowId !== flowId),
    );
    try {
      localStorage.removeItem(`${GUEST_FLOW_PREFIX}${flowId}`);
    } catch {
      // 删不掉就算了，索引里已经没了
    }
    return;
  }
  const { error } = await client().from('arch_flow').update({ is_deleted: true }).eq('flow_id', flowId);
  if (error) throw new Error(`删除流程失败：${error.message}`);
}

/** 新建一张空流程（不落库，由调用方 saveFlow） */
export function createEmptyFlow(name = '未命名流程'): Flow {
  return {
    flowId: crypto.randomUUID(),
    name,
    description: '',
    version: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    updatedAt: new Date().toISOString(),
  };
}
