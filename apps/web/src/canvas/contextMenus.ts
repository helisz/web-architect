import {
  CLEAR_COLOR,
  COMPONENT_CATEGORIES,
  EDGE_DEFAULTS,
  NODE_DEFAULTS,
  type ArchitectureDiagram,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
  type NodeType,
  type Point,
} from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import type { MenuNode } from '../components/ContextMenu.js';

/**
 * 右键菜单模型（规格 §4.6）。
 *
 * 四套菜单：空白 / 节点 / 连线 / 分组。
 * 这里只产"要显示什么、点了干什么"，怎么摆、怎么收由 ContextMenu 组件负责。
 */

/** 画布侧才能提供的东西（坐标系换算、视图操作、导出） */
export interface MenuEnv {
  /** 右键位置（flow 坐标），"在此添加节点"用 */
  flowPoint: Point;
  fitView: () => void;
  resetZoom: () => void;
  exportJson: () => void;
  exportPng: () => void;
}

const EDGE_STROKES: { label: string; value: string }[] = [
  { label: '灰', value: EDGE_DEFAULTS.strokeColor },
  { label: '蓝', value: '#245BDB' },
  { label: '红', value: '#D83931' },
  { label: '绿', value: '#2EA121' },
  { label: '橙', value: '#DE7802' },
  { label: '紫', value: '#6425D0' },
];

const GROUP_TINTS: { label: string; bg: string; border: string }[] = [
  { label: '浅灰', bg: '#F5F6F7', border: '#E5E6EB' },
  { label: '浅蓝', bg: '#C5D2EC', border: '#64A5FF' },
  { label: '浅绿', bg: '#B7EDB1', border: '#39B54A' },
  { label: '浅紫', bg: '#E0D9F2', border: '#9D65E0' },
  // 透明也必须写成 #RRGGBBAA：Schema 只认十六进制，CSS 的 `transparent` 会被校验器拒掉
  { label: '透明', bg: CLEAR_COLOR, border: '#E5E6EB' },
];

/** 新节点落在右键位置（居中） */
function createNodeAt(type: NodeType): void {
  const store = useDiagramStore.getState();
  const env = currentEnv();
  if (!env) return;
  const { width, height } = defaultSize(type);
  store.addNode(type, {
    x: env.flowPoint.x - width / 2,
    y: env.flowPoint.y - height / 2,
  });
}

function defaultSize(type: NodeType): { width: number; height: number } {
  const spec = COMPONENT_CATEGORIES.flatMap((c) => c.items).find((item) => item.nodeType === type);
  return { width: spec?.width ?? NODE_DEFAULTS.width, height: spec?.height ?? NODE_DEFAULTS.height };
}

/* Canvas 挂载时把 env 放进来，菜单动作才能拿到 flow 坐标与视图操作 */
let envRef: MenuEnv | null = null;
export function setMenuEnv(env: MenuEnv | null): void {
  envRef = env;
}
function currentEnv(): MenuEnv | null {
  return envRef;
}

function groupOptions(diagram: ArchitectureDiagram, nodeIds: string[]): MenuNode[] {
  const items: MenuNode[] = [
    {
      kind: 'item',
      label: '移出分组',
      disabled: !nodeIds.some((id) => diagram.nodes.find((n) => n.nodeId === id)?.groupId),
      onSelect: () => {
        const store = useDiagramStore.getState();
        for (const id of nodeIds) store.reparentNode(id, null);
      },
    },
    { kind: 'separator' },
  ];
  const groups = [...diagram.groups].sort((a, b) => b.sort - a.sort);
  if (groups.length === 0) {
    items.push({ kind: 'item', label: '（还没有分组）', disabled: true, onSelect: () => {} });
    return items;
  }
  for (const group of groups) {
    items.push({
      kind: 'item',
      label: group.label || '未命名分组',
      onSelect: () => {
        const store = useDiagramStore.getState();
        for (const id of nodeIds) store.reparentNode(id, group.groupId);
      },
    });
  }
  return items;
}

function edgeTargetOptions(nodeId: string): MenuNode[] {
  const store = useDiagramStore.getState();
  const others = store.diagram.nodes.filter((n) => n.nodeId !== nodeId);
  if (others.length === 0) {
    return [{ kind: 'item', label: '（没有其他节点）', disabled: true, onSelect: () => {} }];
  }
  return others.map((other) => ({
    kind: 'item' as const,
    label: other.label || other.nodeType,
    onSelect: () => useDiagramStore.getState().addEdge(nodeId, other.nodeId, 'right', 'left'),
  }));
}

/* ------------------------------------------------------------------ */
/* 四套菜单                                                            */
/* ------------------------------------------------------------------ */

export function buildBlankMenu(): MenuNode[] {
  const store = useDiagramStore.getState();
  const env = currentEnv();
  const clipboardCount = (store.clipboard?.nodes.length ?? 0) + (store.clipboard?.groups.length ?? 0);

  const categories: MenuNode[] = COMPONENT_CATEGORIES.map((category) => ({
    kind: 'submenu' as const,
    label: category.label,
    items: category.items.map((item) => ({
      kind: 'item' as const,
      label: item.label,
      onSelect: () => createNodeAt(item.nodeType),
    })),
  }));

  return [
    { kind: 'submenu', label: '添加节点', items: categories },
    {
      kind: 'item',
      label: '添加分组',
      onSelect: () => {
        const point = currentEnv()?.flowPoint ?? { x: 0, y: 0 };
        store.addGroup({ x: point.x - 180, y: point.y - 120 }, { width: 360, height: 240 });
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '粘贴',
      hint: 'Ctrl+V',
      disabled: clipboardCount === 0,
      onSelect: () => store.pasteClipboard(),
    },
    { kind: 'item', label: '全选', hint: 'Ctrl+A', onSelect: () => store.selectAll() },
    { kind: 'separator' },
    { kind: 'item', label: '适配视图', onSelect: () => env?.fitView() },
    {
      kind: 'submenu',
      label: '导出',
      items: [
        { kind: 'item', label: '导出 JSON', onSelect: () => env?.exportJson() },
        { kind: 'item', label: '导出 PNG（2×）', onSelect: () => env?.exportPng() },
      ],
    },
    {
      kind: 'submenu',
      label: '画布设置',
      items: [
        {
          kind: 'item',
          label: '显示网格',
          checked: store.showGrid,
          onSelect: () => store.toggleGrid(),
        },
        { kind: 'item', label: '缩放复位到 100%', onSelect: () => env?.resetZoom() },
      ],
    },
  ];
}

export function buildNodeMenu(node: DiagramNode): MenuNode[] {
  const store = useDiagramStore.getState();
  const selected = store.selectedIds.includes(node.nodeId);
  const ids = selected && store.selectedIds.length > 1 ? store.selectedIds : [node.nodeId];
  const nodeIds = ids.filter((id) => store.diagram.nodes.some((n) => n.nodeId === id));
  const single = nodeIds.length === 1;

  return [
    {
      kind: 'item',
      label: '编辑名称',
      disabled: !single || node.locked,
      onSelect: () => {
        useDiagramStore.getState().select(node.nodeId);
        useDiagramStore.getState().requestEdit(node.nodeId);
      },
    },
    { kind: 'item', label: '复制', hint: 'Ctrl+C', onSelect: () => {
        useDiagramStore.getState().select(node.nodeId);
        useDiagramStore.getState().copySelection();
      } },
    {
      kind: 'item',
      label: ids.length > 1 ? `删除 ${ids.length} 个` : '删除',
      hint: 'Delete',
      danger: true,
      onSelect: () => useDiagramStore.getState().requestDelete(ids),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: nodeIds.every((id) => useDiagramStore.getState().diagram.nodes.find((n) => n.nodeId === id)?.locked) ? '解锁' : '锁定',
      hint: 'L',
      onSelect: () => useDiagramStore.getState().toggleLock(nodeIds),
    },
    { kind: 'item', label: '置顶', hint: ']', onSelect: () => useDiagramStore.getState().bringToFront(ids) },
    { kind: 'item', label: '置底', hint: '[', onSelect: () => useDiagramStore.getState().sendToBack(ids) },
    { kind: 'separator' },
    { kind: 'submenu', label: '加入分组', items: groupOptions(store.diagram, nodeIds) },
    {
      kind: 'submenu',
      label: '设为起点连线',
      disabled: !single,
      items: single ? edgeTargetOptions(node.nodeId) : [],
    },
    {
      kind: 'submenu',
      label: '样式',
      items: [
        {
          kind: 'item',
          label: '打开属性面板',
          onSelect: () => useDiagramStore.getState().select(node.nodeId),
        },
        {
          kind: 'item',
          label: '恢复默认样式',
          onSelect: () => {
            const state = useDiagramStore.getState();
            for (const id of nodeIds) {
              state.patchNode(id, {
                bgColor: NODE_DEFAULTS.bgColor,
                borderColor: NODE_DEFAULTS.borderColor,
                textColor: NODE_DEFAULTS.textColor,
              });
            }
          },
        },
      ],
    },
  ];
}

export function buildEdgeMenu(edge: DiagramEdge): MenuNode[] {
  const patchEdge = useDiagramStore.getState().patchEdge;
  return [
    {
      kind: 'item',
      label: '编辑标注',
      onSelect: () => {
        const store = useDiagramStore.getState();
        store.select(edge.edgeId);
        store.requestEdit(edge.edgeId);
      },
    },
    {
      kind: 'submenu',
      label: '改线型',
      items: [
        { kind: 'item' as const, label: '正交折线', checked: edge.edgeType === 'ortho', onSelect: () => patchEdge(edge.edgeId, { edgeType: 'ortho' }) },
        { kind: 'item' as const, label: '直线', checked: edge.edgeType === 'straight', onSelect: () => patchEdge(edge.edgeId, { edgeType: 'straight' }) },
        { kind: 'item' as const, label: '曲线', checked: edge.edgeType === 'bezier', onSelect: () => patchEdge(edge.edgeId, { edgeType: 'bezier' }) },
      ],
    },
    {
      kind: 'submenu',
      label: '改颜色',
      items: EDGE_STROKES.map((color) => ({
        kind: 'item' as const,
        label: color.label,
        checked: edge.strokeColor.toLowerCase() === color.value.toLowerCase(),
        onSelect: () => patchEdge(edge.edgeId, { strokeColor: color.value }),
      })),
    },
    {
      kind: 'item',
      label: '反转方向',
      onSelect: () =>
        patchEdge(edge.edgeId, {
          sourceNodeId: edge.targetNodeId,
          targetNodeId: edge.sourceNodeId,
          sourceAnchor: edge.targetAnchor,
          targetAnchor: edge.sourceAnchor,
        }),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '删除连线',
      hint: 'Delete',
      danger: true,
      onSelect: () => useDiagramStore.getState().requestDelete([edge.edgeId]),
    },
  ];
}

export function buildGroupMenu(group: DiagramGroup): MenuNode[] {
  return [
    {
      kind: 'item',
      label: '重命名',
      onSelect: () => {
        const store = useDiagramStore.getState();
        store.select(group.groupId);
        store.requestEdit(group.groupId);
      },
    },
    {
      kind: 'item',
      label: group.collapsed ? '展开' : '折叠',
      onSelect: () => useDiagramStore.getState().toggleGroupCollapsed(group.groupId),
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: '解组（保留内容）',
      onSelect: () => useDiagramStore.getState().ungroup(group.groupId),
    },
    {
      kind: 'item',
      label: '删除分组',
      danger: true,
      onSelect: () => useDiagramStore.getState().requestDelete([group.groupId]),
    },
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: '着色',
      items: GROUP_TINTS.map((tint) => ({
        kind: 'item' as const,
        label: tint.label,
        onSelect: () =>
          useDiagramStore.getState().patchGroup(group.groupId, {
            bgColor: tint.bg,
            borderColor: tint.border,
          }),
      })),
    },
    { kind: 'item', label: '置顶', onSelect: () => useDiagramStore.getState().bringToFront([group.groupId]) },
    { kind: 'item', label: '置底', onSelect: () => useDiagramStore.getState().sendToBack([group.groupId]) },
  ];
}

