import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react';
import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  type Flow,
  type FlowNode,
  type FlowNodeStatus,
  type FlowTemplate,
} from '@arch/schema';
import { listTemplates, loadFlow, saveFlow, type TemplateSummary } from '../data/flowRepo.js';
import { missingParams, resolveParams, runNodeRequest } from '../flow/runner.js';
import { navigateToFlows, type Route } from '../lib/route.js';
import { PageHeader } from './PageHeader.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 流程画布（用户 2026-11-08）。
 *
 * 复用 ReactFlow，但节点是「流程节点」：引用一个模板，显示它自己那次请求的结果。
 * - 左侧列出可用模板，点一下就加到画布中间；
 * - 节点卡片显示状态点 + 高亮字段（其余折叠）+ 跳转按钮；
 * - 进入页面自动请求一次，之后手动刷新。
 */

interface RunState {
  status: FlowNodeStatus;
  fields: { path: string; label: string; value: string; highlight: boolean }[];
  error: string | null;
  elapsedMs: number;
  httpStatus: number | null;
  payload: unknown;
  at: number;
}

const STATUS_COLOR: Record<FlowNodeStatus, string> = {
  success: '#2F7D46',
  failure: '#C4342B',
  unknown: '#A3A29A',
  error: '#C4342B',
  loading: '#D9A21B',
};

const STATUS_TEXT: Record<FlowNodeStatus, string> = {
  success: '正常',
  failure: '异常',
  unknown: '未知',
  error: '请求失败',
  loading: '请求中',
};

type FlowNodeData = {
  node: FlowNode;
  run?: RunState;
  onRefresh: (nodeId: string) => void;
  onOpen?: (url: string) => void;
};

function FlowNodeCard({ data, selected }: NodeProps & { data: FlowNodeData }) {
  const { node, run } = data;
  const [expanded, setExpanded] = useState(false);
  const status = run?.status ?? 'loading';
  const highlighted = (run?.fields ?? []).filter((f) => f.highlight);
  const rest = (run?.fields ?? []).filter((f) => !f.highlight);
  const systemUrl = node.templateSnapshot.system.url;
  const systemLabel = node.templateSnapshot.system.label || '跳转到系统';

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-white ${
        selected ? 'border-[var(--primary)]' : 'border-[var(--hair-strong)]'
      }`}
      style={{ borderTopWidth: 2, borderTopColor: STATUS_COLOR[status] }}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5">
        <span
          aria-label={`状态：${STATUS_TEXT[status]}`}
          title={STATUS_TEXT[status]}
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: STATUS_COLOR[status] }}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">
          {node.label || '未命名节点'}
        </span>
        <button
          type="button"
          aria-label="刷新这个节点"
          className="nodrag grid h-4 w-4 shrink-0 place-items-center text-[var(--text-tertiary)] hover:text-[var(--primary-text)]"
          onClick={(event) => {
            event.stopPropagation();
            data.onRefresh(node.nodeId);
          }}
        >
          <ToolIcon name="redo" size={11} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2.5">
        {run?.error && (
          <p className="mb-1 line-clamp-3 text-[10px] leading-4 text-[var(--err)]">{run.error}</p>
        )}
        {highlighted.length > 0 ? (
          highlighted.map((field) => (
            <div key={field.path} className="flex items-baseline gap-1.5 py-[1px]">
              <span className="w-[64px] shrink-0 truncate text-[10px] text-[var(--text-secondary)]">
                {field.label}
              </span>
              <span className="mono min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--text-primary)]">
                {field.value || '—'}
              </span>
            </div>
          ))
        ) : (
          !run?.error && <p className="text-[10px] text-[var(--text-tertiary)]">还没有数据</p>
        )}

        {rest.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              className="nodrag text-[10px] text-[var(--text-tertiary)] hover:text-[var(--primary-text)]"
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? '收起' : `展开其余 ${rest.length} 个字段`}
            </button>
            {expanded && (
              <div className="mt-1 max-h-[120px] overflow-y-auto">
                {rest.map((field) => (
                  <div key={field.path} className="flex items-baseline gap-1.5 py-[1px]">
                    <span className="w-[64px] shrink-0 truncate text-[10px] text-[var(--text-tertiary)]">
                      {field.label}
                    </span>
                    <span className="mono min-w-0 flex-1 truncate text-[10px] text-[var(--text-secondary)]">
                      {field.value || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[var(--hair)] px-2 py-1">
        <span className="mono text-[9px] text-[var(--text-tertiary)]">
          {run ? `${STATUS_TEXT[status]} · ${run.elapsedMs}ms` : '—'}
        </span>
        {systemUrl && (
          <button
            type="button"
            className="nodrag mono text-[9px] text-[var(--primary-text)] hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              window.open(systemUrl, '_blank', 'noopener');
            }}
          >
            {systemLabel} →
          </button>
        )}
      </div>
    </div>
  );
}

const nodeTypes = { flowNode: FlowNodeCard };

function FlowCanvasInner({ flowId, route }: { flowId: string; route: Route }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(true);

  const versionRef = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const { screenToFlowPosition } = useReactFlow();

  /* ── 载入 ── */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loaded, templateRows] = await Promise.all([loadFlow(flowId), listTemplates()]);
        if (cancelled) return;
        if (!loaded) {
          setError('这个流程不存在，可能已被删除');
          return;
        }
        setFlow(loaded);
        setTemplates(templateRows);
        versionRef.current = loaded.version;
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  /* ── 请求单个节点 ── */
  const runNode = useCallback(async (node: FlowNode) => {
    setRuns((prev) => ({
      ...prev,
      [node.nodeId]: {
        ...(prev[node.nodeId] ?? { fields: [], elapsedMs: 0, httpStatus: null, payload: null, at: 0 }),
        status: 'loading',
        error: null,
      },
    }));

    const config = node.templateSnapshot;
    const params = resolveParams(config, node.params);
    const missing = missingParams(config, params);
    if (missing.length > 0) {
      setRuns((prev) => ({
        ...prev,
        [node.nodeId]: {
          status: 'error',
          fields: [],
          error: `参数没填：${missing.join('、')}`,
          elapsedMs: 0,
          httpStatus: null,
          payload: null,
          at: Date.now(),
        },
      }));
      return;
    }

    const result = await runNodeRequest(config, params);
    setRuns((prev) => ({
      ...prev,
      [node.nodeId]: {
        status: result.status,
        fields: result.fields,
        error: result.error,
        elapsedMs: result.elapsedMs,
        httpStatus: result.httpStatus,
        payload: result.payload,
        at: Date.now(),
      },
    }));
  }, []);

  /** 首次载入 / 手动全量刷新：并发发起，最多 6 个同时在飞 */
  const refreshAll = useCallback(
    async (nodes: FlowNode[]) => {
      const queue = [...nodes];
      const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await runNode(next);
        }
      });
      await Promise.all(workers);
    },
    [runNode],
  );

  const hydrated = useRef(false);
  useEffect(() => {
    if (!flow || hydrated.current) return;
    hydrated.current = true;
    void refreshAll(flow.nodes);
  }, [flow, refreshAll]);

  /* ── 保存（防抖 800ms） ── */
  const scheduleSave = useCallback((next: Flow) => {
    setSaveState('dirty');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaveState('saving');
      void (async () => {
        const result = await saveFlow(next, versionRef.current);
        if (result.ok) {
          versionRef.current = result.version ?? versionRef.current;
          setSaveState('saved');
        } else {
          setSaveState('dirty');
          setError(result.message ?? '保存失败');
        }
      })();
    }, 800);
  }, []);

  const mutate = useCallback(
    (updater: (current: Flow) => Flow) => {
      setFlow((current) => {
        if (!current) return current;
        const next = updater(current);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  /* ── ReactFlow 节点 / 连线 ── */
  const nodes: Node[] = useMemo(() => {
    if (!flow) return [];
    return flow.nodes.map((node) => ({
      id: node.nodeId,
      type: 'flowNode',
      position: { x: node.x, y: node.y },
      // ReactFlow v12 的 width/height 是"实测尺寸"，要指定初始尺寸得走 style
      style: { width: node.width, height: node.height },
      data: {
        node,
        run: runs[node.nodeId],
        onRefresh: (nodeId: string) => {
          const target = flow.nodes.find((n) => n.nodeId === nodeId);
          if (target) void runNode(target);
        },
      } satisfies FlowNodeData,
      selected: selectedId === node.nodeId,
    }));
  }, [flow, runs, runNode, selectedId]);

  const edges: Edge[] = useMemo(() => {
    if (!flow) return [];
    return flow.edges.map((edge) => ({
      id: edge.edgeId,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      label: edge.label || undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: edge.strokeColor },
      style: { stroke: edge.strokeColor, strokeWidth: edge.strokeWidth },
    }));
  }, [flow]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!flow) return;
      const nextNodes = applyNodeChanges(changes, nodes.map((n) => ({ ...n })));
      const moved = changes.some((c) => c.type === 'position' && c.dragging === false);
      const selected = changes.find((c) => c.type === 'select');
      if (selected && selected.type === 'select') {
        setSelectedId(selected.selected ? selected.id : null);
      }
      if (!moved) return;
      mutate((current) => ({
        ...current,
        nodes: current.nodes.map((node) => {
          const match = nextNodes.find((n) => n.id === node.nodeId);
          return match ? { ...node, x: match.position.x, y: match.position.y } : node;
        }),
      }));
    },
    [flow, mutate, nodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!flow) return;
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
      if (removed.length === 0) return;
      mutate((current) => ({ ...current, edges: current.edges.filter((e) => !removed.includes(e.edgeId)) }));
      void applyEdgeChanges(changes, edges);
    },
    [edges, flow, mutate],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) return;
      mutate((current) => ({
        ...current,
        edges: [
          ...current.edges,
          {
            edgeId: crypto.randomUUID(),
            flowId: current.flowId,
            sourceNodeId: connection.source!,
            targetNodeId: connection.target!,
            label: '',
            strokeColor: '#AFACA2',
            strokeWidth: 2,
            sort: current.edges.length,
          },
        ],
      }));
      void addEdge(connection, edges);
    },
    [edges, mutate],
  );

  /* ── 加节点 ── */
  const addNode = async (summary: TemplateSummary) => {
    if (!flow) return;
    try {
      const { loadTemplate } = await import('../data/flowRepo.js');
      const template: FlowTemplate | null = await loadTemplate(summary.templateId);
      if (!template) {
        setError('模板读不出来，可能已被删除');
        return;
      }
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const node: FlowNode = {
        nodeId: crypto.randomUUID(),
        flowId: flow.flowId,
        templateId: template.templateId,
        label: template.name,
        x: Math.round(center.x - FLOW_NODE_WIDTH / 2),
        y: Math.round(center.y - FLOW_NODE_HEIGHT / 2),
        width: FLOW_NODE_WIDTH,
        height: FLOW_NODE_HEIGHT,
        params: resolveParams(template.config, {}),
        templateSnapshot: template.config,
        sort: flow.nodes.length,
      };
      mutate((current) => ({ ...current, nodes: [...current.nodes, node] }));
      void runNode(node);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const selectedNode = flow?.nodes.find((n) => n.nodeId === selectedId) ?? null;

  if (error && !flow) {
    return (
      <div className="grid h-full place-items-center bg-[var(--canvas-bg)]">
        <div className="text-center">
          <p className="text-[13px] text-[var(--text-secondary)]">{error}</p>
          <button
            type="button"
            onClick={navigateToFlows}
            className="mt-3 rounded-[var(--radius-ctl)] border border-[var(--panel-border)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)]"
          >
            回流程列表
          </button>
        </div>
      </div>
    );
  }

  if (!flow) {
    return (
      <div className="grid h-full place-items-center bg-[var(--canvas-bg)] text-[13px] text-[var(--text-secondary)]">
        正在打开流程…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <PageHeader
        route={route}
        title={flow.name || '未命名流程'}
        meta={saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '未保存'}
        actions={
          <>
            <button
              type="button"
              onClick={() => setPaletteOpen((v) => !v)}
              className="rounded-[var(--radius-ctl)] border border-[var(--panel-border)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary-text)]"
            >
              {paletteOpen ? '收起模板' : '添加节点'}
            </button>
            <button
              type="button"
              onClick={() => void refreshAll(flow.nodes)}
              className="rounded-[var(--radius-ctl)] bg-[var(--primary-solid)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-solid-hover)]"
            >
              全部刷新
            </button>
          </>
        }
      >
        <input
          className="min-w-0 max-w-[320px] flex-1 border-none bg-transparent text-[13px] font-semibold text-[var(--text-primary)] outline-none"
          value={flow.name}
          aria-label="流程名称"
          onChange={(e) => {
            const name = e.target.value;
            mutate((current) => ({ ...current, name }));
          }}
        />
      </PageHeader>

      {error && (
        <p className="shrink-0 border-b border-[#E8B4A6] bg-[#FDF1EE] px-3 py-2 text-[12px] text-[var(--err)]">
          {error}
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {paletteOpen && (
          <aside className="flex w-[200px] shrink-0 flex-col border-r border-[var(--hair)] bg-white">
            <p className="border-b border-[var(--hair)] px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
              模板（点一下加节点）
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {templates.length === 0 && (
                <p className="px-2 py-3 text-[11px] leading-4 text-[var(--text-tertiary)]">
                  还没有模板。先去模板库建一个。
                </p>
              )}
              {templates.map((tpl) => (
                <button
                  key={tpl.templateId}
                  type="button"
                  onClick={() => void addNode(tpl)}
                  className="mb-1 flex w-full items-center gap-1.5 border border-transparent px-1.5 py-1.5 text-left hover:border-[var(--primary)] hover:bg-[var(--accent-50)]"
                >
                  <span className="mono shrink-0 text-[9px] text-[var(--text-tertiary)]">
                    {tpl.visibility === 'public' ? '公' : '私'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
                    {tpl.name}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={10} size={1} color="var(--dot)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {selectedNode && (
          <aside className="absolute right-3 top-3 z-20 w-[260px] rounded-[var(--radius-card)] border border-[var(--glass-line)] bg-white/95 p-3 shadow-[var(--glass-shadow)]">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">节点</span>
              <button
                type="button"
                className="ml-auto text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                onClick={() => setSelectedId(null)}
              >
                关闭
              </button>
            </div>
            <label className="mb-2 flex flex-col gap-0.5">
              <span className="text-[10px] text-[var(--text-secondary)]">名称</span>
              <input
                className="w-full border border-[var(--hair-strong)] px-2 py-1 text-[11px] outline-none focus:border-[var(--primary)]"
                value={selectedNode.label}
                onChange={(e) => {
                  const label = e.target.value;
                  mutate((current) => ({
                    ...current,
                    nodes: current.nodes.map((n) =>
                      n.nodeId === selectedNode.nodeId ? { ...n, label } : n,
                    ),
                  }));
                }}
              />
            </label>
            {selectedNode.templateSnapshot.params.map((spec) => (
              <label key={spec.name} className="mb-2 flex flex-col gap-0.5">
                <span className="text-[10px] text-[var(--text-secondary)]">
                  {spec.label || spec.name}
                  {spec.required && <span className="ml-1 text-[var(--primary-text)]">*</span>}
                </span>
                <input
                  type={spec.secret ? 'password' : 'text'}
                  className="w-full border border-[var(--hair-strong)] px-2 py-1 text-[11px] outline-none focus:border-[var(--primary)]"
                  value={selectedNode.params[spec.name] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    mutate((current) => ({
                      ...current,
                      nodes: current.nodes.map((n) =>
                        n.nodeId === selectedNode.nodeId
                          ? { ...n, params: { ...n.params, [spec.name]: value } }
                          : n,
                      ),
                    }));
                  }}
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() => void runNode(selectedNode)}
              className="mt-1 w-full border border-[var(--primary)] py-1 text-[11px] text-[var(--primary-text)] hover:bg-[var(--accent-50)]"
            >
              用这些参数请求一次
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

export function FlowCanvas({ flowId, route }: { flowId: string; route: Route }) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner flowId={flowId} route={route} />
    </ReactFlowProvider>
  );
}
