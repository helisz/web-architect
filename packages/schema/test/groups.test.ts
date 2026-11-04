import { describe, expect, it } from 'vitest';
import {
  createEmptyDiagram,
  createGroup,
  createNode,
  descendantGroupIds,
  GROUP_HEADER_HEIGHT,
  GROUP_HEADER_HEIGHT_SINGLE,
  groupAbsoluteRect,
  groupDepth,
  groupHeaderHeight,
  groupOffset,
  hitGroup,
  isAncestorOf,
  isHiddenByCollapse,
  isSingleLineGroup,
  nodeAbsoluteRect,
  removeGroupLifting,
  setGroupParent,
  setNodeGroup,
} from '../src/index.js';

/** 造一张"两层组"的图：外层 zone(100,50) → 内层 dmz(40,30) */
function nested() {
  const diagram = createEmptyDiagram();
  const zone = createGroup(diagram.diagramId, { x: 100, y: 50 }, { label: '外区', width: 600, height: 400 });
  const dmz = createGroup(diagram.diagramId, { x: 40, y: 30 }, { label: '内区', parentGroupId: zone.groupId, width: 300, height: 200 });
  const node = createNode('waf', diagram.diagramId, { x: 10, y: 10 }, { label: 'WAF' });
  return { diagram: { ...diagram, groups: [zone, dmz], nodes: [node] }, zone, dmz, node };
}

describe('分组几何（C1：局部坐标）', () => {
  it('groupOffset 累加祖先偏移', () => {
    const { diagram, dmz, zone } = nested();
    expect(groupOffset(diagram.groups, null)).toEqual({ x: 0, y: 0 });
    // 组的偏移 = 自身 + 祖先的位置：外层在 (100,50) 所以它自己的原点就在 (100,50)
    expect(groupOffset(diagram.groups, zone.groupId)).toEqual({ x: 100, y: 50 });
    // 内层组原点 = 外层 (100,50) + 内层相对 (40,30)
    expect(groupOffset(diagram.groups, dmz.groupId)).toEqual({ x: 140, y: 80 });
  });

  it('节点绝对坐标 = 组偏移 + 局部坐标', () => {
    const { diagram, dmz, node } = nested();
    const inGroup = { ...node, groupId: dmz.groupId };
    // 节点局部 (10,10) + 组偏移 (140,80) = 绝对 (150,90)
    expect(nodeAbsoluteRect(diagram.groups, inGroup)).toMatchObject({ x: 150, y: 90 });
  });

  it('组深度：顶层 1，嵌套 2', () => {
    const { diagram, zone, dmz } = nested();
    expect(groupDepth(diagram.groups, zone.groupId)).toBe(1);
    expect(groupDepth(diagram.groups, dmz.groupId)).toBe(2);
    expect(groupDepth(diagram.groups, null)).toBe(0);
  });

  it('hitGroup 命中更深的组，且跳过被折叠的组', () => {
    const { diagram, dmz, zone } = nested();
    // (150, 90) 同时落在外层与内层框内 → 取内层
    expect(hitGroup(diagram.groups, { x: 150, y: 90 })?.groupId).toBe(dmz.groupId);
    // 外层专有区域
    expect(hitGroup(diagram.groups, { x: 650, y: 400 })?.groupId).toBe(zone.groupId);
    // 空白处
    expect(hitGroup(diagram.groups, { x: 5000, y: 5000 })).toBeNull();

    const collapsed = diagram.groups.map((g) => (g.groupId === dmz.groupId ? { ...g, collapsed: true } : g));
    expect(hitGroup(collapsed, { x: 150, y: 90 })?.groupId).toBe(zone.groupId);
  });

  it('拖进组：屏幕位置不变，坐标换算成局部', () => {
    const { diagram, dmz, node } = nested();
    // 节点绝对位置 (300, 200) → 挂到内层组（偏移 140,80）后局部应为 (160,120)
    const moved = setNodeGroup({ ...diagram, nodes: [{ ...node, x: 300, y: 200 }] }, node.nodeId, dmz.groupId);
    const result = moved.nodes[0]!;
    expect(result.groupId).toBe(dmz.groupId);
    expect({ x: result.x, y: result.y }).toEqual({ x: 160, y: 120 });
    // 关键：再算回绝对坐标必须和原来一致（C1 回归点）
    expect(nodeAbsoluteRect(moved.groups, result)).toMatchObject({ x: 300, y: 200 });
  });

  it('拖出组：同样保持屏幕位置', () => {
    const { diagram, dmz, node } = nested();
    const inside = setNodeGroup({ ...diagram, nodes: [{ ...node, x: 300, y: 200 }] }, node.nodeId, dmz.groupId);
    const out = setNodeGroup(inside, node.nodeId, null);
    const result = out.nodes[0]!;
    expect(result.groupId).toBeNull();
    // 挂进去时局部变成 (160,120)，拉回顶层后恢复成绝对 (300,200)
    expect({ x: result.x, y: result.y }).toEqual({ x: 300, y: 200 });
  });

  it('不允许把组挂到自己的后代里（成环）', () => {
    const { diagram, zone, dmz } = nested();
    expect(isAncestorOf(diagram.groups, zone.groupId, dmz.groupId)).toBe(true);
    const attempt = setGroupParent(diagram, zone.groupId, dmz.groupId);
    expect(attempt.groups.find((g) => g.groupId === zone.groupId)?.parentGroupId).toBeNull();
  });

  it('删除组：子组一起删，节点提升到上一层且位置不变', () => {
    const { diagram, dmz, zone, node } = nested();
    const attached = setNodeGroup({ ...diagram, nodes: [{ ...node, x: 300, y: 200 }] }, node.nodeId, dmz.groupId);
    const removed = removeGroupLifting(attached, zone.groupId);

    expect(descendantGroupIds(diagram.groups, zone.groupId)).toEqual([dmz.groupId]);
    expect(removed.groups).toHaveLength(0);
    const survivor = removed.nodes[0]!;
    expect(survivor.groupId).toBeNull();
    // 位置不变 → 绝对坐标仍是 (300,200)
    expect(nodeAbsoluteRect(removed.groups, survivor)).toMatchObject({ x: 300, y: 200 });
  });

  it('折叠后：直属节点与子组都算隐藏，顶层不受影响', () => {
    const { diagram, dmz, zone } = nested();
    expect(isHiddenByCollapse(diagram.groups, dmz.groupId)).toBe(false);

    // 折叠内层：直属内层的节点隐藏（传它的 groupId）；内层组自己作为子元素仍可见（传父级 id）
    const dmzCollapsed = diagram.groups.map((g) => (g.groupId === dmz.groupId ? { ...g, collapsed: true } : g));
    expect(isHiddenByCollapse(dmzCollapsed, dmz.groupId)).toBe(true);
    expect(isHiddenByCollapse(dmzCollapsed, dmz.parentGroupId ?? null)).toBe(false);

    // 折叠外层：内层组与其中的节点都被藏
    const zoneCollapsed = diagram.groups.map((g) => (g.groupId === zone.groupId ? { ...g, collapsed: true } : g));
    expect(isHiddenByCollapse(zoneCollapsed, dmz.groupId)).toBe(true);
    expect(isHiddenByCollapse(zoneCollapsed, null)).toBe(false);
  });

  it('组长/宽来自 Schema，不因折叠而改写（C9）', () => {
    const { diagram, zone } = nested();
    const collapsed = { ...zone, collapsed: true };
    expect(groupAbsoluteRect(diagram.groups, collapsed)).toMatchObject({ width: 600, height: 400 });
  });
});

describe('分组标题栏高度（用户 2026-11-04）', () => {
  it('通用分组标了 singleLine：不给副文本，标题栏按一行高度', () => {
    const { diagram } = nested();
    const plain = createGroup(diagram.diagramId, { x: 0, y: 0 }, {
      label: '分组',
      extJson: { singleLine: true },
      subLabel: '不该显示',
    });
    expect(isSingleLineGroup(plain)).toBe(true);
    expect(groupHeaderHeight(plain)).toBe(GROUP_HEADER_HEIGHT_SINGLE);
  });

  it('预设分组有副文本：两行高度', () => {
    const { diagram } = nested();
    const preset = createGroup(diagram.diagramId, { x: 0, y: 0 }, {
      label: '服务器',
      subLabel: '物理机 / 虚拟机',
    });
    expect(isSingleLineGroup(preset)).toBe(false);
    expect(groupHeaderHeight(preset)).toBe(GROUP_HEADER_HEIGHT);
  });

  it('没有副文本的普通分组也只用一行高度（不留空白第二行）', () => {
    const { diagram } = nested();
    const empty = createGroup(diagram.diagramId, { x: 0, y: 0 }, { label: '空组' });
    expect(groupHeaderHeight(empty)).toBe(GROUP_HEADER_HEIGHT_SINGLE);
  });
});


