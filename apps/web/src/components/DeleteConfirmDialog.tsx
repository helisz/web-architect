import { useDiagramStore } from '../store/useDiagramStore.js';

/**
 * 删除二次确认。
 *
 * 所有删除（单节点、框选一批、分组、连线）都先落到 `pendingDelete`，
 * 点"删除"才真正写进 Schema —— 避免误按 Delete 直接丢内容。
 */
export function DeleteConfirmDialog() {
  const pending = useDiagramStore((s) => s.pendingDelete);
  const diagram = useDiagramStore((s) => s.diagram);
  const confirmDelete = useDiagramStore((s) => s.confirmDelete);
  const cancelDelete = useDiagramStore((s) => s.cancelDelete);

  if (!pending) return null;

  const nodeLabels = pending.nodeIds
    .map((id) => diagram.nodes.find((n) => n.nodeId === id)?.label)
    .filter((label): label is string => Boolean(label));
  const groupLabels = pending.groupIds
    .map((id) => diagram.groups.find((g) => g.groupId === id)?.label)
    .filter((label): label is string => Boolean(label));

  /*
   * 连线也要报名字（用户 2026-11-05）：只说「2 条连线」根本不知道自己删的是哪两条。
   * 用「A → B（443/TLS）」的形式，端点是分组也能显示分组名。
   */
  const endpointName = (id: string): string =>
    diagram.nodes.find((n) => n.nodeId === id)?.label ||
    diagram.groups.find((g) => g.groupId === id)?.label ||
    '未命名';
  const edgeLabels = pending.edgeIds
    .map((id) => diagram.edges.find((e) => e.edgeId === id))
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge))
    .map((edge) => {
      const pair = `${endpointName(edge.sourceNodeId)} → ${endpointName(edge.targetNodeId)}`;
      return edge.label ? `${pair}（${edge.label}）` : pair;
    });

  // 删节点会连带删掉挂在它上面的连线，提前告诉用户
  const nodeSet = new Set(pending.nodeIds);
  const cascadedEdges = diagram.edges.filter(
    (e) => !pending.edgeIds.includes(e.edgeId) && (nodeSet.has(e.sourceNodeId) || nodeSet.has(e.targetNodeId)),
  ).length;
  const total = pending.nodeIds.length + pending.edgeIds.length + pending.groupIds.length + cascadedEdges;

  const names = [...groupLabels, ...nodeLabels, ...edgeLabels];
  const preview = names.slice(0, 4).join('、');
  const rest = names.length > 4 ? ' 等' : '';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" role="dialog" aria-modal>
      <div className="w-[360px] rounded-lg bg-white p-4 shadow-xl">
        <p className="text-sm font-semibold">确认删除？</p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          将删除 {pending.nodeIds.length > 0 && `${pending.nodeIds.length} 个节点`}
          {pending.groupIds.length > 0 && `${pending.nodeIds.length > 0 ? '、' : ''}${pending.groupIds.length} 个分组`}
          {pending.edgeIds.length > 0 &&
            `${pending.nodeIds.length + pending.groupIds.length > 0 ? '、' : ''}${pending.edgeIds.length} 条连线`}
          {cascadedEdges > 0 && `，以及连带 ${cascadedEdges} 条连线`}。
          {preview && <span className="mt-1 block text-[var(--text-primary)]">（{preview}{rest}）</span>}
          <span className="mt-1 block">分组删除后，里面的节点会提到上一层，不会一起消失。</span>
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelDelete}
            className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
          >
            取消
          </button>
          <button
            type="button"
            autoFocus
            onClick={confirmDelete}
            className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700"
          >
            删除 {total} 项
          </button>
        </div>
      </div>
    </div>
  );
}

