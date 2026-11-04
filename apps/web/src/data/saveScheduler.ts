/**
 * 自动保存的节流策略（纯函数，好测）。
 *
 * 以前是"变脏就 800ms 后存"，实测一次 2 小时的编辑会话写了 300 次库、60 条快照
 * —— 想事情停 1 秒、点一下颜色、每次属性微调都会单独落一次。
 *
 * 现在的三档策略：
 * - 空闲 **3 秒** 才存（结构性改动 1 秒，那类操作不能等）；
 * - 连续编辑也不无限攒：距本轮第一次变脏满 **30 秒** 强制存一次；
 * - 两次写库之间至少隔 **10 秒**，把连续的小操作合并成一次。
 */
export const IDLE_MS = 3000;
export const STRUCTURAL_IDLE_MS = 1000;
export const MAX_WAIT_MS = 30_000;
export const MIN_INTERVAL_MS = 10_000;

export interface ScheduleInput {
  /** 当前时间（毫秒） */
  now: number;
  /** 本轮"第一次变脏"的时间；`null` 表示刚变脏（用 now 起算） */
  dirtySince: number | null;
  /** 上一次真正发起写库的时间；`0` 表示本会话还没写过 */
  lastWriteAt: number;
  /** 这次改动动了节点/连线/分组的集合（增删），而不是改属性 */
  structural: boolean;
}

/** 距离下一次该写库还有多久（毫秒，≥ 0） */
export function nextDelay(input: ScheduleInput): number {
  const { now, lastWriteAt, structural } = input;
  const idle = structural ? STRUCTURAL_IDLE_MS : IDLE_MS;
  const sinceDirty = input.dirtySince === null ? 0 : Math.max(0, now - input.dirtySince);
  // 攒太久就强制写：拖了一分钟还没停手，也不能一直不落库
  const untilForced = Math.max(0, MAX_WAIT_MS - sinceDirty);
  // 最小间隔：刚写过就别急着再写
  const untilAllowed = lastWriteAt === 0 ? 0 : Math.max(0, MIN_INTERVAL_MS - (now - lastWriteAt));
  return Math.max(Math.min(idle, untilForced), untilAllowed);
}

/**
 * 结构指纹：节点/连线/分组的 id 集合。
 *
 * 只是增删会变；改颜色、改文字、拖位置都不变 —— 用来把"结构性操作"和
 * "属性微调"分开，前者 1 秒就存，后者等到空闲 3 秒。
 */
export function structuralKey(parts: {
  nodes: readonly { nodeId: string }[];
  edges: readonly { edgeId: string }[];
  groups: readonly { groupId: string }[];
}): string {
  const join = (ids: readonly string[]): string => [...ids].sort().join(',');
  return [
    join(parts.nodes.map((n) => n.nodeId)),
    join(parts.edges.map((e) => e.edgeId)),
    join(parts.groups.map((g) => g.groupId)),
  ].join('|');
}
