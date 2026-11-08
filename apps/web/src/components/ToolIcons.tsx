/**
 * 顶栏 / 画布上用的界面图标（16–18px，描边风格）。
 *
 * 为什么不复用 `NodeIcon`：那是"节点图标"，只认 `ALLOWED_ICON_KEYS` 里的 20 个 key，
 * 且要经过 Iconify 的离线集合。界面按钮的图标是另一套东西（撤销、图层、网格…），
 * 手写 path 最稳，也不给打包体积加负担。
 */
export type ToolIconName =
  | 'undo'
  | 'redo'
  | 'history'
  | 'gallery'
  | 'sliders'
  | 'layers'
  | 'flow'
  | 'grid'
  | 'search'
  | 'database'
  | 'import'
  | 'export'
  | 'lock'
  | 'unlock'
  | 'close'
  | 'chevronLeft'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'pencil'
  | 'copy'
  | 'trash'
  | 'move'
  | 'hand'
  | 'panelLeft'
  | 'arrowUp'
  | 'arrowDown'
  | 'chevronUp'
  | 'chevronDown'
  | 'chevronRight'
  | 'palette'
  | 'link'
  | 'unlink'
  | 'reset'
  | 'folder'
  | 'swap'
  | 'image'
  | 'save'
  | 'tag';

const PATHS: Record<ToolIconName, string> = {
  undo: 'M9 14 5 10l4-4M5 10h11a4 4 0 0 1 0 8h-2',
  redo: 'M15 14l4-4-4-4M19 10H8a4 4 0 0 0 0 8h2',
  history: 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5M12 8v4l3 2',
  gallery: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  sliders: 'M4 7h5M13 7h7M4 12h9M17 12h3M4 17h3M11 17h9M11 5v4M15 10v4M9 15v4',
  layers: 'M12 3 21 8l-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17l9 5 9-5',
  // 流程（2026-11-08）：两个方框 + 一条折线箭头，和「图层」区分开
  flow: 'M4 4h6v5H4zM14 15h6v5h-6zM7 9v5a2 2 0 0 0 2 2h5M12 13l2 3-2 3',
  grid: 'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12ZM14.5 14.5 20 20',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  import: 'M12 3v11M8 10l4 4 4-4M4 20h16',
  export: 'M12 14V3M8 7l4-4 4 4M4 20h16',
  lock: 'M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  unlock: 'M6 11h12v9H6zM8.5 11V7.5A3.5 3.5 0 0 1 15 5.4',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  // 四角对准画布边框的"适配视图"图标
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  // 图库卡片的行内动作（用户 2026-11-05：按钮换图标）
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  copy: 'M9 9h10v11H9zM5 15H4V5h10v1',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  // 画布上的「拖动模式」：四向箭头 = 平移
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  // 抓手 = 平移画布（用户 2026-11-05：拖动模式换成「手」）
  // 左侧组件库开关：一个矩形左边一条竖线
  panelLeft: 'M4 4h16v16H4zM9.5 4v16',
  hand: 'M8 12.5V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a5 5 0 0 1-3.7-1.7l-3.4-3.8a1.6 1.6 0 0 1 2.3-2.2L8 15',
  // 右键菜单用（2026-11-06）：置顶/置底、折叠、着色、连线、解组、复位、分组、导出图片
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  palette: 'M12 3a9 9 0 000 18h2a2.5 2.5 0 000-5 2 2 0 012-2h3a2 2 0 002-2 9 9 0 00-9-9zM8.5 10h.01M8.5 14h.01M12 7h.01',
  link: 'M9.5 14.5l5-5M8 12l-2 2a3 3 0 004.2 4.2l2-2M16 12l2-2A3 3 0 0013.8 5.8l-2 2',
  unlink: 'M6.5 6.5l11 11M9.5 9.5a2.5 2.5 0 11-3.5-3.5 2.5 2.5 0 013.5 3.5zM18 18a2.5 2.5 0 11-3.5-3.5A2.5 2.5 0 0118 18z',
  reset: 'M4 5v5h5M20 19v-5h-5M19.5 9a8 8 0 00-13.9-2.5M4.5 15a8 8 0 0013.9 2.5',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  swap: 'M7 8h10l-3-3M17 16H7l3 3',
  image: 'M4 5h16v14H4zM8.5 10.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4 16l5-4 4 3 3-2 4 3',
  // 软盘（tabler device-floppy，合并成一条 d）
  save: 'M6 4h10l4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M10 14a2 2 0 1 0 4 0a2 2 0 1 0-4 0m4-10v4H8V4',
  // 标签（tabler tag）
  tag: 'M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592-5.592a2.41 2.41 0 0 0 0-3.408l-7.71-7.71A2 2 0 0 0 11.172 3H6a3 3 0 0 0-3 3M7.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
};

export function ToolIcon({
  name,
  size = 16,
  className,
}: {
  name: ToolIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
