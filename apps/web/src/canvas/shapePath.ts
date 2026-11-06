import type { NodeType } from '@arch/schema';

/**
 * 形状 / 流程图节点的轮廓路径（2026-11-06 用户新增）。
 *
 * 为什么单独放一个纯函数文件：
 * - 画布上的 ArchNode 和属性面板里的「形状」小按钮都要画同一批图形，
 *   路径只能有一份，否则两边迟早画得不一样；
 * - 纯函数不依赖 React / DOM，改完能直接跑测试和类型检查。
 *
 * 几何约定（用户明确要求）：轮廓尽量穿过包围盒**四条边的中点**。
 * React Flow 默认的 top/right/bottom/left 四个 Handle 就摆在边中点上，
 * 轮廓擦着这四个点走，连线端点看起来才"长在图形上"。
 * 严格满足的有：矩形、圆角矩形、椭圆、菱形、六边形、圆柱、胶囊、文档、箭头块。
 *
 * 两处例外是几何本身决定的，不是画错：
 * - **三角形**（顶点在顶边中点、底边贴底）的左右两条斜边不可能经过左右边中点，
 *   否则底边就没法贴住包围盒底部；
 * - **平行四边形**的左右斜边同理，两条平行斜边无法同时穿过左右边中点。
 * 这两类保持标准外形（否则就不像三角形/平行四边形了），左右 Handle 会离斜边
 * 有一小段距离；上下两个 Handle 仍然精确落在轮廓上。
 */

/** 走「轮廓渲染」分支的节点类型：10 个形状 + 7 个流程图 */
export const SHAPE_NODE_TYPES = [
  'shape-rect',
  'shape-round',
  'shape-circle',
  'shape-diamond',
  'shape-triangle',
  'shape-hexagon',
  'shape-cylinder',
  'shape-parallelogram',
  'shape-document',
  'shape-arrow',
  'flow-start',
  'flow-process',
  'flow-decision',
  'flow-data',
  'flow-document',
  'flow-predefined',
  'flow-connector',
] as const satisfies readonly NodeType[];

export type ShapeNodeType = (typeof SHAPE_NODE_TYPES)[number];

const SHAPE_SET: ReadonlySet<string> = new Set(SHAPE_NODE_TYPES);

/** 是否走轮廓渲染（属性面板据此决定显不显示「形状」分区） */
export function isShapeNodeType(type: NodeType | string): type is ShapeNodeType {
  return SHAPE_SET.has(type);
}

export interface ShapeGeometry {
  /** 主轮廓：填 node.bgColor、描边 node.borderColor */
  d: string;
  /**
   * 只描边、不填充的装饰线。
   * 圆柱的顶盖弧和「预定义过程」的左右竖线都靠它，
   * 拆成独立子路径是因为它们不能参与填充，否则会在图形里糊出一块。
   */
  lines?: string[];
}

/** 坐标保留两位小数：路径字符串短一点，且远小于 1px 的误差看不出来 */
const n = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * 生成某个形状的 SVG path。
 *
 * 参数是**节点当前盒子**的宽高，viewBox 也用同一组宽高，
 * 所以节点被 NodeResizer 拉成任意比例时图形会跟着拉伸，不会留白边。
 * 不认识的类型返回 null（调用方只在 isShapeNodeType 为真时调用它）。
 */
export function shapePath(nodeType: NodeType | string, w: number, h: number): ShapeGeometry | null {
  // 兜底成 1px：脏数据里的 0 宽高会让弧线的半径变成 0，SVG 直接不画
  const W = Math.max(1, w);
  const H = Math.max(1, h);

  switch (nodeType) {
    // —— 直角矩形：矩形和"处理"共用，语义不同但轮廓一致 ——
    case 'shape-rect':
    case 'flow-process': {
      return { d: `M 0 0 H ${n(W)} V ${n(H)} H 0 Z` };
    }

    // —— 预定义过程：矩形 + 左右各一条内缩竖线（线不进填充） ——
    case 'flow-predefined': {
      const inset = Math.min(14, W * 0.12);
      return {
        d: `M 0 0 H ${n(W)} V ${n(H)} H 0 Z`,
        lines: [`M ${n(inset)} 0 V ${n(H)}`, `M ${n(W - inset)} 0 V ${n(H)}`],
      };
    }

    // —— 圆角矩形：半径封顶 16px，小节点也不会把角磨成胶囊 ——
    case 'shape-round': {
      const r = Math.min(16, W / 2, H / 2);
      return {
        d: [
          `M ${n(r)} 0`,
          `H ${n(W - r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 ${n(W)} ${n(r)}`,
          `V ${n(H - r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 ${n(W - r)} ${n(H)}`,
          `H ${n(r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 0 ${n(H - r)}`,
          `V ${n(r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 ${n(r)} 0`,
          'Z',
        ].join(' '),
      };
    }

    // —— 圆形 / 连接点：用椭圆而不是正圆，非等比拉伸时四个边中点仍在轮廓上 ——
    case 'shape-circle':
    case 'flow-connector': {
      const rx = W / 2;
      const ry = H / 2;
      return {
        d: [
          `M 0 ${n(ry)}`,
          `A ${n(rx)} ${n(ry)} 0 1 1 ${n(W)} ${n(ry)}`,
          `A ${n(rx)} ${n(ry)} 0 1 1 0 ${n(ry)}`,
          'Z',
        ].join(' '),
      };
    }

    // —— 菱形 / 判断：四个顶点正好落在四条边的中点 ——
    case 'shape-diamond':
    case 'flow-decision': {
      return {
        d: `M ${n(W / 2)} 0 L ${n(W)} ${n(H / 2)} L ${n(W / 2)} ${n(H)} L 0 ${n(H / 2)} Z`,
      };
    }

    // —— 三角形：顶点在顶边中点，底边贴住包围盒底部 ——
    case 'shape-triangle': {
      return {
        d: `M ${n(W / 2)} 0 L ${n(W)} ${n(H)} L 0 ${n(H)} Z`,
      };
    }

    // —— 六边形：左右两个尖点正好在左右边中点 ——
    case 'shape-hexagon': {
      return {
        d: [
          `M ${n(W * 0.25)} 0`,
          `L ${n(W * 0.75)} 0`,
          `L ${n(W)} ${n(H / 2)}`,
          `L ${n(W * 0.75)} ${n(H)}`,
          `L ${n(W * 0.25)} ${n(H)}`,
          `L 0 ${n(H / 2)}`,
          'Z',
        ].join(' '),
      };
    }

    // —— 圆柱 / 立方体：上下是两个半椭圆盖，左右两条竖直腰 ——
    case 'shape-cylinder': {
      const rx = W / 2;
      const ry = H * 0.18;
      return {
        // 上盖凸到顶边中点、下盖凸到底边中点，两条腰穿过左右边中点
        d: [
          `M 0 ${n(ry)}`,
          `A ${n(rx)} ${n(ry)} 0 0 1 ${n(W)} ${n(ry)}`,
          `L ${n(W)} ${n(H - ry)}`,
          `A ${n(rx)} ${n(ry)} 0 0 1 0 ${n(H - ry)}`,
          'Z',
        ].join(' '),
        // 顶盖前沿（下半弧）：补上这一笔才有"圆柱"的厚度感
        lines: [`M 0 ${n(ry)} A ${n(rx)} ${n(ry)} 0 0 0 ${n(W)} ${n(ry)}`],
      };
    }

    // —— 平行四边形 / 数据：上下两条水平边保留，左右斜切 ——
    case 'shape-parallelogram':
    case 'flow-data': {
      const skew = W * 0.18;
      return {
        d: [
          `M ${n(skew)} 0`,
          `L ${n(W)} 0`,
          `L ${n(W - skew)} ${n(H)}`,
          `L 0 ${n(H)}`,
          'Z',
        ].join(' '),
      };
    }

    // —— 文档：底部一道波浪；中点被精确抬到包围盒底边，下 Handle 仍贴轮廓 ——
    case 'shape-document':
    case 'flow-document': {
      const dip = H * 0.12;
      return {
        d: [
          'M 0 0',
          `H ${n(W)}`,
          `V ${n(H - dip)}`,
          // 三阶贝塞尔的 t=0.5 正好落在 (W/2, H)，见上面的几何说明
          `C ${n(W * 0.75)} ${n(H + dip)}, ${n(W * 0.25)} ${n(H - dip / 3)}, 0 ${n(H - dip)}`,
          'Z',
        ].join(' '),
      };
    }

    // —— 箭头块：五边形（矩形 + 右侧三角），右边缘中点就是箭尖 ——
    case 'shape-arrow': {
      return {
        d: [
          'M 0 0',
          `H ${n(W * 0.62)}`,
          `L ${n(W)} ${n(H / 2)}`,
          `L ${n(W * 0.62)} ${n(H)}`,
          'H 0',
          'Z',
        ].join(' '),
      };
    }

    // —— 开始 / 结束：胶囊（两端半圆），左右顶点在左右边中点 ——
    case 'flow-start': {
      const r = Math.min(H / 2, W / 2);
      return {
        d: [
          `M ${n(r)} 0`,
          `H ${n(W - r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 ${n(W - r)} ${n(H)}`,
          `H ${n(r)}`,
          `A ${n(r)} ${n(r)} 0 0 1 ${n(r)} 0`,
          'Z',
        ].join(' '),
      };
    }

    default:
      return null;
  }
}

/**
 * 形状节点的四个连线手柄落点（占包围盒的百分比）。
 *
 * 为什么需要这张表：React Flow 默认把手柄放在四条边的中点，但三角形和平行四边形的
 * 斜边不经过边中点 —— 照默认放，连线端点会浮在图形外面约 14~35px，看着像没连上
 * （2026-11-06 实测）。这里给每个形状一张表，手柄改由 `left/top` 百分比定位，
 * 端点和画出来的轮廓就能重合。
 *
 * 没列出的形状（矩形、圆、菱形、六边形、胶囊等）四条边中点本来就在轮廓上，
 * 直接返回 null，沿用默认位置。
 */
export interface HandleOffset {
  /** 手柄中心距盒子左/上边的百分比 */
  left: number;
  top: number;
}

export function handleOffsets(
  nodeType: NodeType | string,
  w: number,
  h: number,
): Record<'top' | 'right' | 'bottom' | 'left', HandleOffset> | null {
  const safeW = Math.max(1, w);
  const safeH = Math.max(1, h);
  if (nodeType === 'shape-triangle') {
    // 顶点在顶边中点，底边贴满；左右手柄取两条斜边的中点
    return {
      top: { left: 50, top: 0 },
      right: { left: 75, top: 50 },
      bottom: { left: 50, top: 100 },
      left: { left: 25, top: 50 },
    };
  }
  if (nodeType === 'shape-parallelogram' || nodeType === 'flow-data') {
    // 顶点：(0.25w,0) (w,0) (0.75w,h) (0,h)；上/下边中点各偏 12.5%，
    // 左/右手柄取两条斜边的中点，正好在轮廓上
    return {
      top: { left: 62.5, top: 0 },
      right: { left: 87.5, top: 50 },
      bottom: { left: 37.5, top: 100 },
      left: { left: 12.5, top: 50 },
    };
  }
  if (nodeType === 'flow-start') {
    // 胶囊：左右两端是半圆，手柄贴到圆弧最外点即可（边中点本来就在圆弧上）
    void safeW;
    void safeH;
    return null;
  }
  return null;
}
