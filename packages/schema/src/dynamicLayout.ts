import type { Point } from './types.js';

/**
 * 动态分组 / 动态组的自动排版（用户 2026-11-07）。
 *
 * 规则（用户定稿）：
 * - 节点按"行优先"填格子：1 2 3 / 4 5 6；
 * - **每列的宽度 = 该列里最宽的节点**（列与列之间互不影响）；
 * - 行高 = 该行里最高的节点；
 * - 节点之间横竖都留一个网格单位（10px）。
 *
 * 为什么做成纯函数：批量添加时要算容器该多大，拖动缩放手柄时要按新宽度重排列数，
 * 两处必须用同一套坐标；放在 schema 里还能单测。
 */

/** 节点间距：一个网格单位 */
export const DYNAMIC_GAP = 10;

export interface LayoutItem {
  id: string;
  width: number;
  height: number;
}

export interface LayoutSlot extends Point {
  id: string;
}

export interface DynamicLayout {
  /** 列数（没有子元素时为 0） */
  cols: number;
  /** 每个子元素的左上角（相对内容区原点，不含容器内距） */
  slots: LayoutSlot[];
  /** 内容区宽高（不含容器内距） */
  contentWidth: number;
  contentHeight: number;
  /** 每一列的宽度（= 该列最宽节点） */
  colWidths: number[];
}

const EMPTY: DynamicLayout = { cols: 0, slots: [], contentWidth: 0, contentHeight: 0, colWidths: [] };

/** 用固定列数排一次；供 `layoutDynamicItems` 与单元测试直接调用 */
export function layoutWithCols(items: readonly LayoutItem[], cols: number): DynamicLayout {
  const total = items.length;
  if (total === 0) return EMPTY;
  const count = Math.max(1, Math.min(Math.floor(cols) || 1, total));

  const rows = Math.ceil(total / count);
  const colWidths = new Array<number>(count).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);

  items.forEach((item, index) => {
    const col = index % count;
    const row = Math.floor(index / count);
    colWidths[col] = Math.max(colWidths[col]!, item.width);
    rowHeights[row] = Math.max(rowHeights[row]!, item.height);
  });

  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c < count; c += 1) {
    colX.push(x);
    x += colWidths[c]! + DYNAMIC_GAP;
  }
  const rowY: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r += 1) {
    rowY.push(y);
    y += rowHeights[r]! + DYNAMIC_GAP;
  }

  const slots = items.map((item, index) => ({
    id: item.id,
    x: colX[index % count]!,
    y: rowY[Math.floor(index / count)]!,
  }));

  return {
    cols: count,
    slots,
    // 最后一个 gap 不算进内容尺寸
    contentWidth: Math.max(0, x - DYNAMIC_GAP),
    contentHeight: Math.max(0, y - DYNAMIC_GAP),
    colWidths,
  };
}

/**
 * 自动排版入口。
 *
 * - 给了 `cols` → 按它排（批量添加后"接近方形"用这个）；
 * - 给了 `innerWidth` → 选**能放下的最大列数**（拖动缩放时用这个），一列都放不下就退回 1 列；
 * - 都没给 → 接近方形（√N，最多 3 列）。
 */
export function layoutDynamicItems(
  items: readonly LayoutItem[],
  options: { cols?: number; innerWidth?: number } = {},
): DynamicLayout {
  const total = items.length;
  if (total === 0) return EMPTY;

  if (options.cols !== undefined) return layoutWithCols(items, options.cols);

  if (options.innerWidth !== undefined && Number.isFinite(options.innerWidth)) {
    const limit = Math.max(0, options.innerWidth);
    let best = layoutWithCols(items, 1);
    for (let c = 2; c <= total; c += 1) {
      const next = layoutWithCols(items, c);
      if (next.contentWidth <= limit) best = next;
      // 列数再增加只会更宽（列宽非零），放不下就可以停
      else break;
    }
    return best;
  }

  return layoutWithCols(items, Math.min(3, Math.ceil(Math.sqrt(total))));
}

/**
 * 批量添加后的默认列数：接近方形、最多 3 列。
 * （用户 2026-11-07："元素太多自然分两列，拉宽变三列"）
 */
export function defaultDynamicCols(count: number): number {
  if (count <= 1) return 1;
  return Math.min(3, Math.ceil(Math.sqrt(count)));
}
