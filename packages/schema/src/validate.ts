import { LIMITS, NODE_DEFAULTS, EDGE_DEFAULTS, GROUP_DEFAULTS, TOKENS, CLEAR_COLOR, CLEAR_COLORS } from './constants.js';
import { NODE_TYPES } from './types.js';
import { rectContainsRect, rectsIntersect } from './geometry.js';
import { iconKeyFor, isIconKey, LEGACY_ICON_ALIASES, looksLikeEmbeddedImage } from './icons.js';
import type {
  ArchitectureDiagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  Point,
  ValidationIssue,
  ValidationResult,
} from './types.js';
import { COLOR_RE, diagramSchema } from './zod.js';

/**
 * 语义 / 引用校验（规格 §6.4 V1–V10）。
 *
 * 设计要点：
 * - 结构问题（类型、枚举、数值）交给 zod（zod.ts），这里只做单字段管不了的规则；
 * - strict 模式只报告、不改数据，供 PUT 校验返回 400；
 * - repair 模式尽力修复并返回修复后的 Diagram，供导入 / 合并场景使用。
 */

export interface ValidateOptions {
  /** 尽力修复而非直接报错 */
  repair?: boolean;
  /** 服务端已知的当前版本号，用于 V9（version 只增不减） */
  existingVersion?: number;
}

interface Ctx {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const fail = (ctx: Ctx, path: string, code: string, message: string): void => {
  ctx.errors.push({ path, code, message });
};

const warn = (ctx: Ctx, path: string, code: string, message: string): void => {
  ctx.warnings.push({ path, code, message });
};

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/* ------------------------------------------------------------------ */
/* 几何辅助：分组绝对坐标（嵌套时逐级累加）                             */
/* ------------------------------------------------------------------ */

export function absoluteGroupPosition(
  group: DiagramGroup,
  byId: Map<string, DiagramGroup>,
): Point {
  let x = group.x;
  let y = group.y;
  let cursor = group.parentGroupId ? byId.get(group.parentGroupId) : undefined;
  let guard = 0;
  const seen = new Set<string>([group.groupId]);
  while (cursor && guard < 32) {
    if (seen.has(cursor.groupId)) break;
    seen.add(cursor.groupId);
    x += cursor.x;
    y += cursor.y;
    cursor = cursor.parentGroupId ? byId.get(cursor.parentGroupId) : undefined;
    guard += 1;
  }
  return { x, y };
}

/** 节点的画布绝对坐标（节点坐标相对父组） */
export function absoluteNodePosition(
  node: DiagramNode,
  byId: Map<string, DiagramGroup>,
): Point {
  if (!node.groupId) return { x: node.x, y: node.y };
  const group = byId.get(node.groupId);
  if (!group) return { x: node.x, y: node.y };
  const base = absoluteGroupPosition(group, byId);
  return { x: base.x + node.x, y: base.y + node.y };
}

function groupDepth(group: DiagramGroup, byId: Map<string, DiagramGroup>): number {
  let depth = 0;
  let cursor = group.parentGroupId ? byId.get(group.parentGroupId) : undefined;
  const seen = new Set<string>([group.groupId]);
  while (cursor) {
    if (seen.has(cursor.groupId)) return Number.POSITIVE_INFINITY; // 成环
    seen.add(cursor.groupId);
    depth += 1;
    cursor = cursor.parentGroupId ? byId.get(cursor.parentGroupId) : undefined;
  }
  return depth;
}

/* ------------------------------------------------------------------ */
/* repair 前置：把结构层可救的问题先救回来                              */
/* ------------------------------------------------------------------ */

const DEFAULTS_BY_KIND = {
  groupBg: GROUP_DEFAULTS.bgColor,
  groupBorder: GROUP_DEFAULTS.borderColor,
  groupTitle: '#374151',
  nodeBg: NODE_DEFAULTS.bgColor,
  nodeBorder: NODE_DEFAULTS.borderColor,
  nodeText: TOKENS.textPrimary,
  edgeStroke: EDGE_DEFAULTS.strokeColor,
} as const;

function repairStructure(input: ArchitectureDiagram, ctx: Ctx): ArchitectureDiagram {
  const clone = structuredClone(input);
  const fixColor = (value: unknown, fallback: string, path: string): string => {
    /**
     * "清除背景 / 清除边框"在 UI 上是一个「透明」格，但 Schema 只收 #RRGGBB(AA)，
     * 所以这一格落到数据里必须是全透明的 #00000000。旧数据里写成 `transparent`
     * （或 CSS 的 `none`）的，在这里一次性换成合法值，避免保存被校验器拒掉。
     */
    if (typeof value === 'string' && CLEAR_COLORS.includes(value.trim().toLowerCase())) {
      return CLEAR_COLOR;
    }
    if (typeof value === 'string' && COLOR_RE.test(value)) return value;
    warn(ctx, path, 'COLOR_REPAIRED', `非法颜色已回填默认值 ${fallback}`);
    return fallback;
  };
  const truncate = (value: unknown, max: number, path: string): string => {
    if (typeof value !== 'string') return '';
    if (value.length <= max) return value;
    warn(ctx, path, 'LABEL_TRUNCATED', `文本超长已截断至 ${max} 字`);
    return value.slice(0, max);
  };
  const finite = (value: unknown, path: string): number => {
    if (isFiniteNumber(value)) return value;
    warn(ctx, path, 'NUMBER_REPAIRED', '非法数值已归零');
    return 0;
  };

  clone.groups = (clone.groups ?? []).map((g, i) => ({
    ...g,
    label: truncate(g.label, LIMITS.labelMax, `groups[${i}].label`),
    // 老数据/手写 JSON 没有 subLabel：补空串，不算修复错误
    subLabel: truncate(g.subLabel ?? '', LIMITS.subLabelMax, `groups[${i}].subLabel`),
    x: finite(g.x, `groups[${i}].x`),
    y: finite(g.y, `groups[${i}].y`),
    width: Math.max(LIMITS.groupMinWidth, finite(g.width, `groups[${i}].width`)),
    height: Math.max(LIMITS.groupMinHeight, finite(g.height, `groups[${i}].height`)),
    bgColor: fixColor(g.bgColor, DEFAULTS_BY_KIND.groupBg, `groups[${i}].bgColor`),
    borderColor: fixColor(g.borderColor, DEFAULTS_BY_KIND.groupBorder, `groups[${i}].borderColor`),
    titleColor: fixColor(g.titleColor, DEFAULTS_BY_KIND.groupTitle, `groups[${i}].titleColor`),
  }));

  clone.nodes = (clone.nodes ?? []).map((n, i) => {
    // 未知 nodeType（旧版本、外部导入、手工改库）一律降级为 custom：
    // 数据库的 arch_ck_node_type 只校验格式，不校验枚举，因此"存得进去但打不开"
    // 是真实风险，这里兜住，避免整张图因一个节点而无法载入。
    const knownType = (NODE_TYPES as readonly string[]).includes(n.nodeType);
    if (!knownType) {
      warn(ctx, `nodes[${i}].nodeType`, 'NODE_TYPE_FALLBACK', `未知节点类型 ${String(n.nodeType)}，已降级为 custom`);
    }
    return {
      ...n,
      nodeType: knownType ? n.nodeType : 'custom',
      label: truncate(n.label, LIMITS.labelMax, `nodes[${i}].label`),
      subLabel: truncate(n.subLabel, LIMITS.subLabelMax, `nodes[${i}].subLabel`),
      x: finite(n.x, `nodes[${i}].x`),
      y: finite(n.y, `nodes[${i}].y`),
      width: Math.max(LIMITS.nodeMinWidth, finite(n.width, `nodes[${i}].width`)),
      height: Math.max(LIMITS.nodeMinHeight, finite(n.height, `nodes[${i}].height`)),
      bgColor: fixColor(n.bgColor, DEFAULTS_BY_KIND.nodeBg, `nodes[${i}].bgColor`),
      borderColor: fixColor(n.borderColor, DEFAULTS_BY_KIND.nodeBorder, `nodes[${i}].borderColor`),
      textColor: fixColor(n.textColor, DEFAULTS_BY_KIND.nodeText, `nodes[${i}].textColor`),
    };
  });

  clone.edges = (clone.edges ?? []).map((e, i) => ({
    ...e,
    label: e.label === undefined || e.label === null ? undefined : truncate(e.label, LIMITS.labelMax, `edges[${i}].label`),
    strokeColor: fixColor(e.strokeColor, DEFAULTS_BY_KIND.edgeStroke, `edges[${i}].strokeColor`),
    strokeWidth: finite(e.strokeWidth, `edges[${i}].strokeWidth`),
  }));

  return clone;
}

/* ------------------------------------------------------------------ */
/* V11 图标规则                                                        */
/* ------------------------------------------------------------------ */

/**
 * 每个节点都必须带 `extJson.iconKey`，取值只能来自 `ALLOWED_ICON_KEYS`，
 * 且始终跟随 `nodeType` 推导（不存 base64、不存 url）。
 *
 * - repair 模式：直接改正（缺 → 补、非集合内 → 改、base64/url → 改）；
 * - strict 模式：只报告，不改数据。
 */
function enforceIconRule(d: ArchitectureDiagram, ctx: Ctx, repair: boolean): void {
  d.nodes.forEach((n, i) => {
    const path = `nodes[${i}].extJson.iconKey`;
    const stored = n.extJson?.iconKey;
    const expected = iconKeyFor(n.nodeType);

    if (stored !== undefined && looksLikeEmbeddedImage(stored)) {
      warn(ctx, path, 'EMBEDDED_ICON_REJECTED', '不接受 base64 / url 形式的图标，只允许预定义 iconKey');
      if (repair) n.extJson = { ...(n.extJson ?? {}), iconKey: expected };
      return;
    }

    /*
     * 老 key 归一（用户 2026-11-05：nginx 的旧全称 logo 要彻底换掉）。
     * 静默改写、不报 warning —— 这纯属外观升级，不该在界面上弹提示；
     * repair 模式落盘一次，库里存的值也就跟着干净了。
     */
    const alias = typeof stored === 'string' ? LEGACY_ICON_ALIASES[stored] : undefined;
    if (alias) {
      if (repair) n.extJson = { ...(n.extJson ?? {}), iconKey: alias };
      return;
    }

    if (!isIconKey(stored)) {
      warn(
        ctx,
        path,
        'ICON_KEY_REPAIRED',
        stored === undefined ? `缺少图标 key，已按 nodeType 推导为 ${expected}` : `图标 key 不在预定义集合内，已改为 ${expected}`,
      );
      if (repair) n.extJson = { ...(n.extJson ?? {}), iconKey: expected };
      return;
    }

    // 合法但与 nodeType 默认值不同：视为手工覆盖，保留不动
    // （只有缺失 / 非法 / 内联图片才改写，避免把用户选的图标冲掉）
  });
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

export function validateDiagram(
  input: ArchitectureDiagram,
  opts: ValidateOptions = {},
): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [] };
  const candidate = opts.repair ? repairStructure(input, ctx) : input;

  // —— 结构闸（类型 / 枚举 / 数值 / 颜色格式）
  const parsed = diagramSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.reduce<string>((acc, seg) => {
        if (typeof seg === 'number') return `${acc}[${seg}]`;
        return acc ? `${acc}.${String(seg)}` : String(seg);
      }, '');
      fail(ctx, path || '$', 'SCHEMA_INVALID', issue.message);
    }
    return { ok: false, errors: ctx.errors, warnings: ctx.warnings };
  }

  const d = parsed.data as unknown as ArchitectureDiagram;
  const groupById = new Map<string, DiagramGroup>(d.groups.map((g) => [g.groupId, g]));
  const nodeById = new Map<string, DiagramNode>(d.nodes.map((n) => [n.nodeId, n]));

  // —— V8 规模上限
  if (d.nodes.length > LIMITS.maxNodes) {
    fail(ctx, 'nodes', 'LIMIT_EXCEEDED', `节点数 ${d.nodes.length} 超过上限 ${LIMITS.maxNodes}`);
  }
  if (d.edges.length > LIMITS.maxEdges) {
    fail(ctx, 'edges', 'LIMIT_EXCEEDED', `连线数 ${d.edges.length} 超过上限 ${LIMITS.maxEdges}`);
  }
  if (d.groups.length > LIMITS.maxGroups) {
    fail(ctx, 'groups', 'LIMIT_EXCEEDED', `分组数 ${d.groups.length} 超过上限 ${LIMITS.maxGroups}`);
  }

  // —— V1 diagramId 一致
  d.groups.forEach((g, i) => {
    if (g.diagramId !== d.diagramId) {
      fail(ctx, `groups[${i}].diagramId`, 'DIAGRAM_ID_MISMATCH', `期望 ${d.diagramId}，实得 ${g.diagramId}`);
    }
  });
  d.nodes.forEach((n, i) => {
    if (n.diagramId !== d.diagramId) {
      fail(ctx, `nodes[${i}].diagramId`, 'DIAGRAM_ID_MISMATCH', `期望 ${d.diagramId}，实得 ${n.diagramId}`);
    }
  });
  d.edges.forEach((e, i) => {
    if (e.diagramId !== d.diagramId) {
      fail(ctx, `edges[${i}].diagramId`, 'DIAGRAM_ID_MISMATCH', `期望 ${d.diagramId}，实得 ${e.diagramId}`);
    }
  });

  // —— V2 / V3 分组引用与嵌套
  const droppedGroupParent = new Set<string>();
  d.groups.forEach((g, i) => {
    if (!g.parentGroupId) return;
    const parent = groupById.get(g.parentGroupId);
    if (!parent) {
      if (opts.repair) {
        g.parentGroupId = null;
        droppedGroupParent.add(g.groupId);
        warn(ctx, `groups[${i}].parentGroupId`, 'REF_DROPPED', `父组 ${g.parentGroupId} 不存在，已提升为顶级分组`);
      } else {
        fail(ctx, `groups[${i}].parentGroupId`, 'REF_NOT_FOUND', `父组 ${g.parentGroupId} 不存在`);
      }
      return;
    }
    const depth = groupDepth(g, groupById);
    if (!Number.isFinite(depth)) {
      if (opts.repair) {
        g.parentGroupId = null;
        warn(ctx, `groups[${i}].parentGroupId`, 'CYCLE_BROKEN', '分组嵌套成环，已断开为顶级');
      } else {
        fail(ctx, `groups[${i}].parentGroupId`, 'GROUP_CYCLE', '分组嵌套成环');
      }
      return;
    }
    if (depth > LIMITS.maxGroupDepth) {
      fail(ctx, `groups[${i}].parentGroupId`, 'GROUP_DEPTH_EXCEEDED', `嵌套深度 ${depth} 超过上限 ${LIMITS.maxGroupDepth}`);
    }
    // 子组必须落在父组范围内（相对坐标，因此与父组自身尺寸比较）
    const childRect = { x: g.x, y: g.y, width: g.width, height: g.height };
    const parentRect = { x: 0, y: 0, width: parent.width, height: parent.height };
    if (!rectsIntersect(childRect, parentRect)) {
      if (opts.repair) {
        g.x = Math.max(0, Math.min(g.x, parent.width - g.width));
        g.y = Math.max(0, Math.min(g.y, parent.height - g.height));
        warn(ctx, `groups[${i}]`, 'COORD_CLAMPED', '子组坐标超出父组范围，已收敛到父组内');
      } else {
        warn(ctx, `groups[${i}]`, 'COORD_SUSPECT', '子组坐标落在父组范围之外，疑似用了绝对坐标');
      }
    }
  });

  // —— V2 / V4 节点分组引用与局部坐标
  d.nodes.forEach((n, i) => {
    if (!n.groupId) return;
    const group = groupById.get(n.groupId);
    if (!group) {
      if (opts.repair) {
        // 坐标是相对父组的，父组没了就得先换算成绝对坐标
        n.groupId = null;
        warn(ctx, `nodes[${i}].groupId`, 'REF_DROPPED', `分组 ${n.groupId} 不存在，节点已散落到画布`);
      } else {
        fail(ctx, `nodes[${i}].groupId`, 'REF_NOT_FOUND', `分组 ${n.groupId} 不存在`);
      }
      return;
    }
    // V4：组内节点的局部坐标必须落在父组尺寸内（完全在外 → 疑似绝对值）
    const nodeRect = { x: n.x, y: n.y, width: n.width, height: n.height };
    const groupRect = { x: 0, y: 0, width: group.width, height: group.height };
    if (!rectsIntersect(nodeRect, groupRect)) {
      if (opts.repair) {
        const base = absoluteGroupPosition(group, groupById);
        const abs = { x: base.x + n.x, y: base.y + n.y };
        n.x = Math.max(0, Math.min(abs.x - base.x, group.width - n.width));
        n.y = Math.max(0, Math.min(abs.y - base.y, group.height - n.height));
        warn(ctx, `nodes[${i}]`, 'COORD_CONVERTED', '组内节点坐标疑似绝对坐标，已换算并收敛到父组内');
      } else {
        warn(ctx, `nodes[${i}]`, 'COORD_SUSPECT', '组内节点坐标完全落在父组之外，疑似绝对坐标（V4 启发式）');
      }
    }
  });

  // —— V11 图标规则：只允许预定义 key，禁止 base64 / url
  enforceIconRule(d, ctx, opts.repair === true);

  // —— V2 连线引用 + V10 重复连线
  // 端点可以是节点，也可以是分组（用户 2026-11-04：分组之间、分组与节点之间都能连线）
  const keptEdges: DiagramEdge[] = [];
  const seenEdgeKeys = new Set<string>();
  d.edges.forEach((e, i) => {
    const sourceExists = nodeById.has(e.sourceNodeId) || groupById.has(e.sourceNodeId);
    const targetExists = nodeById.has(e.targetNodeId) || groupById.has(e.targetNodeId);
    if (!sourceExists || !targetExists) {
      if (opts.repair) {
        warn(ctx, `edges[${i}]`, 'REF_DROPPED', '悬空连线已丢弃');
        return;
      }
      fail(ctx, `edges[${i}].sourceNodeId`, 'REF_NOT_FOUND', `源节点 ${e.sourceNodeId} 不存在`);
      fail(ctx, `edges[${i}].targetNodeId`, 'REF_NOT_FOUND', `目标节点 ${e.targetNodeId} 不存在`);
      keptEdges.push(e);
      return;
    }
    const key = `${e.sourceNodeId}→${e.targetNodeId}|${e.sourceAnchor ?? ''}|${e.targetAnchor ?? ''}`;
    if (seenEdgeKeys.has(key)) {
      if (opts.repair) {
        warn(ctx, `edges[${i}]`, 'EDGE_MERGED', '重复连线已合并');
        return;
      }
      warn(ctx, `edges[${i}]`, 'EDGE_DUPLICATE', '存在同源同目标同锚点的重复连线（V10 自动合并）');
    } else {
      seenEdgeKeys.add(key);
      keptEdges.push(e);
    }
  });
  if (opts.repair) d.edges = keptEdges;

  // —— V9 version 只增不减
  if (opts.existingVersion !== undefined && d.version <= opts.existingVersion) {
    warn(ctx, 'version', 'VERSION_IGNORED', `客户端 version=${d.version} 不大于库内 ${opts.existingVersion}，将以服务端值为准`);
  }

  return {
    ok: ctx.errors.length === 0,
    errors: ctx.errors,
    warnings: ctx.warnings,
    diagram: d,
  };
}

/** 便捷封装：失败即抛，成功返回清理后的 Diagram */
export function assertValidDiagram(input: ArchitectureDiagram, opts: ValidateOptions = {}): ArchitectureDiagram {
  const result = validateDiagram(input, opts);
  if (!result.ok || !result.diagram) {
    const first = result.errors[0];
    const error = new Error(first ? `${first.path}: ${first.message}` : 'diagram validation failed');
    Object.assign(error, { code: 'VALIDATION_FAILED', issues: result.errors });
    throw error;
  }
  return result.diagram;
}

/** 供导出/包围盒使用：节点在画布上的绝对矩形 */
export function absoluteNodeRect(node: DiagramNode, groupById: Map<string, DiagramGroup>) {
  const p = absoluteNodePosition(node, groupById);
  return { x: p.x, y: p.y, width: node.width, height: node.height };
}

/** 供分组整体拖动时判断是否完全包含子节点（预留） */
export function groupContainsNode(group: DiagramGroup, node: DiagramNode): boolean {
  return rectContainsRect({ x: 0, y: 0, width: group.width, height: group.height }, {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  });
}



