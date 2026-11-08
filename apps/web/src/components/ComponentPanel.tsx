import { useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { COMPONENT_CATEGORIES, DYNAMIC_PRESETS, GROUP_ICON_KEY, GROUP_PRESETS, STRUCTURE_NODE_SPECS, iconKeyFor } from '@arch/schema';
import type { ComponentSpec, GroupPreset } from '@arch/schema';
import { NodeIcon } from '../icons/index.js';
import { ToolIcon } from './ToolIcons.js';

/** 拖拽时写入 dataTransfer 的 MIME，M1 的画布 drop 处理器读它 */
export const NODE_TYPE_MIME = 'application/x-arch-node-type';
/** 拖拽建分组用另一个 MIME：分组不是节点类型，不能混进 nodeType */
export const GROUP_MIME = 'application/x-arch-group';

/** 分组卡片的统一外观：拖拽 + 图标 + 名字 */
function StructureCard({
  iconKey,
  label,
  title,
  payload,
  dashed,
}: {
  iconKey: string;
  label: string;
  title: string;
  payload: string;
  dashed?: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(GROUP_MIME, payload);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={title}
      className={`group flex h-8 min-w-0 cursor-grab items-center gap-1.5 rounded-md border bg-[var(--panel-bg)] px-1.5 hover:border-[var(--primary)] active:cursor-grabbing ${
        dashed ? 'border-dashed border-[var(--panel-border)]' : 'border-[var(--panel-border)]'
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] group-hover:bg-[var(--accent-50)] group-hover:text-[var(--primary)]">
        <NodeIcon iconKey={iconKey} size={14} />
      </span>
      <span className="truncate text-xs text-[var(--text-primary)]">{label}</span>
    </div>
  );
}

/** 通用分组（不带业务语义，纯空框） */
function GroupCard() {
  return (
    <StructureCard
      iconKey="tabler:cube"
      label="分组"
      title="拖到画布创建分组（把节点拖进框里即归组，最多嵌套 3 层）"
      payload="group"
      dashed
    />
  );
}

/** 预设分组：服务器 / 集群 / nginx —— 建出来就是带图标和副文本的普通分组 */
function PresetCard({ preset }: { preset: GroupPreset }) {
  return (
    <StructureCard
      iconKey={preset.iconKey}
      label={preset.label}
      title={`拖到画布创建「${preset.groupLabel}」分组（${preset.width}×${preset.height}，自带图标与副文本，可改名）`}
      payload={preset.key}
    />
  );
}

/** 拖拽载荷：预设条目（处理/判断/数据…）和正牌类型共用同一个 nodeType，靠 label/size 区分 */
function nodePayload(item: ComponentSpec): string {
  return JSON.stringify({
    nodeType: item.nodeType,
    label: item.label,
    width: item.width,
    height: item.height,
    subLabel: item.defaultSubLabel,
  });
}

function ComponentCard({ item }: { item: ComponentSpec }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NODE_TYPE_MIME, nodePayload(item));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={`拖到画布创建「${item.label}」（${item.width}×${item.height}）`}
      className="group flex h-8 min-w-0 cursor-grab items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--panel-bg)] px-1.5 hover:border-[var(--primary)] active:cursor-grabbing"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--bg-hover)] text-[var(--text-secondary)] group-hover:bg-[var(--accent-50)] group-hover:text-[var(--primary)]">
        <NodeIcon iconKey={iconKeyFor(item.nodeType)} size={14} />
      </span>
      <span className="truncate text-xs text-[var(--text-primary)]">{item.label}</span>
    </div>
  );
}

/**
 * 收起态的图标栏（用户 2026-11-07）：不再整条藏起来，而是每个分类留一个图标，
 * 鼠标移上去弹出一列该分类的节点（可继续拖到画布）。
 */
const RAIL_ICONS: Record<string, string> = {
  structure: 'tabler:cube',
  shape: 'tabler:shape',
  flow: 'tabler:player-play',
  security: 'tabler:shield-lock',
  text: 'tabler:typography',
  compute: 'tabler:server',
  orchestration: 'devicon:kubernetes',
  network: 'tabler:world',
};

/** 左侧组件面板（规格 §3.2 / §3.3）：240px，结构 + 文本 + 分类 + 搜索 */
export function ComponentPanel() {
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // 整栏可隐藏（用户 2026-11-05）：顶栏「组件库」按钮切换，选择记在 localStorage
  const open = useDiagramStore((s) => s.componentPanelOpen);

  const categories = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return COMPONENT_CATEGORIES;
    return COMPONENT_CATEGORIES.map((category) => ({
      ...category,
      items: category.items.filter(
        (item) =>
          item.label.toLowerCase().includes(kw) ||
          item.nodeType.includes(kw) ||
          category.label.includes(kw),
      ),
    })).filter((category) => category.items.length > 0);
  }, [keyword]);

  const presets = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return GROUP_PRESETS;
    return GROUP_PRESETS.filter(
      (p) => p.label.toLowerCase().includes(kw) || p.key.includes(kw),
    );
  }, [keyword]);

  const structureNodes = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return STRUCTURE_NODE_SPECS;
    return STRUCTURE_NODE_SPECS.filter((spec) => spec.label.toLowerCase().includes(kw));
  }, [keyword]);
  const total =
    categories.reduce((sum, c) => sum + c.items.length, 0) + presets.length + structureNodes.length;

  /**
   * 收起态图标栏的数据源。
   * 弹层里直接用展开态的那两个卡片组件（StructureCard / ComponentCard），
   * 保证两边的外观、尺寸、拖拽载荷完全一致（用户 2026-11-07）。
   */
  const railGroups = useMemo(
    () => [
      {
        key: 'structure',
        label: '结构',
        icon: RAIL_ICONS.structure!,
        groups: [
          { key: 'group', label: '分组', iconKey: GROUP_ICON_KEY, payload: 'group', dashed: true },
          ...DYNAMIC_PRESETS.map((preset) => ({
            key: preset.key,
            label: preset.label,
            iconKey: preset.iconKey,
            payload: preset.key,
            dashed: preset.dashed,
          })),
          ...GROUP_PRESETS.map((preset) => ({
            key: `preset-${preset.key}`,
            label: preset.label,
            iconKey: preset.iconKey,
            payload: preset.key,
            dashed: false,
          })),
        ],
        nodes: STRUCTURE_NODE_SPECS,
      },
      ...COMPONENT_CATEGORIES.map((category) => ({
        key: category.key,
        label: category.label,
        icon: RAIL_ICONS[category.key] ?? iconKeyFor(category.items[0]!.nodeType),
        groups: [],
        nodes: category.items,
      })),
    ],
    [],
  );
  const setOpen = (next: boolean): void => useDiagramStore.getState().setComponentPanelOpen(next);

  /**
   * 收起/展开手柄（用户 2026-11-05 定稿）。
   *
   * 展开态：贴在面板右边框上的竖向圆角手柄，半颗压边框、半颗悬画布；
   * 收起态：面板整块不渲染（用户要求：别留白色窄框），只在画布左边缘露出同一颗手柄，
   *         左半边贴边、右边圆角，像从屏幕边上抽出来的拉手。
   * 两态都是：平时 15px 宽、`hover` 27px、高 56px、垂直居中、鼠标为手型。
   * 2026-11-07：用户要求手柄向右加宽 3px（12→15、24→27），并补 `cursor-pointer`。
   */
  const handleClass =
    'grid h-14 w-[15px] cursor-pointer place-items-center overflow-hidden bg-white text-[12px] leading-none text-[var(--text-secondary)] shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-[width,color,border-color] duration-150 hover:w-[27px] hover:border-[var(--primary)] hover:text-[var(--primary)]';

  if (!open) {
    /*
     * 收起态（2026-11-07）：不是整条隐藏，而是一列图标 —— 每个分类一颗，
     * 悬停弹出该分类的节点列表（还能直接拖到画布）。展开手柄挪到图标栏右侧。
     */
    return (
      <>
        <button
          type="button"
          title="展开组件库"
          aria-label="展开组件库"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          style={{ left: 'calc(var(--panel-inset) + 44px)' }}
          className={`absolute top-1/2 z-20 -translate-y-1/2 rounded-[50px] border border-[var(--panel-border)] ${handleClass}`}
        >
          ›
        </button>
        {/*
          2026-11-08 用户定稿：图标栏不再拉满高度，只包住自己的内容（下面不留空白），
          整体在窗口里上下居中 —— 用 top-1/2 + translate 而不是 top/bottom 双向拉伸。
        */}
        <aside className="glass absolute left-[var(--panel-inset)] top-1/2 z-40 flex w-11 -translate-y-1/2 flex-col items-center gap-0.5 py-1.5">
          {railGroups.map((group) => (
            <div key={group.key} className="group/rail relative flex w-full shrink-0 justify-center">
              <button
                type="button"
                title={`${group.label}（点击展开组件库）`}
                aria-label={group.label}
                onClick={() => setOpen(true)}
                className="grid h-8 w-8 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--primary)]"
              >
                <NodeIcon iconKey={group.icon} size={16} />
              </button>
              {/* 悬停弹出：分类名 + 该分类下的卡片（和展开态同一个组件，外观完全一致）。
                  用命名 group（group/rail）：否则卡片自己的 group-hover 会被这一行的 hover 连带触发，
                  图标底色会一直是橙色，看起来和展开态不一样（2026-11-07）。 */}
              <div className="invisible absolute left-full top-0 z-50 w-[236px] rounded-md border border-[var(--glass-line)] bg-[var(--panel-bg)] p-1.5 opacity-0 shadow-[0_10px_28px_rgba(26,26,24,0.14)] transition-opacity duration-150 group-hover/rail:visible group-hover/rail:opacity-100">
                <p className="mb-1 px-1 text-[11px] font-semibold text-[var(--text-secondary)]">{group.label}</p>
                <div className="max-h-[420px] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-1">
                    {group.groups.map((preset) => (
                      <StructureCard
                        key={preset.key}
                        iconKey={preset.iconKey}
                        label={preset.label}
                        title={`拖到画布创建「${preset.label}」分组`}
                        payload={preset.payload}
                        dashed={preset.dashed}
                      />
                    ))}
                    {group.nodes.map((item) => (
                      <ComponentCard key={item.key} item={item} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </aside>
      </>
    );
  }

  /*
   * 手柄放在面板外面（2026-11-06）：.floating-panel 有 overflow:hidden，
   * 以前手柄右移半颗压边框，会被裁掉 5px 变成半个。现在改成面板的兄弟节点，
   * 整颗贴在面板右边缘之外，面板继续裁自己的内容。
   */
  return (
    <>
    <button
      type="button"
      title="收起组件库"
      aria-label="收起组件库"
      aria-expanded
      onClick={() => setOpen(false)}
      style={{ left: 'calc(var(--panel-inset) + 240px)' }}
      className={`absolute top-1/2 z-50 -translate-y-1/2 rounded-[50px] border border-[var(--panel-border)] ${handleClass}`}
    >
      ‹
    </button>
    <aside className="glass anim-slide-left floating-panel left-[var(--panel-inset)] top-[var(--panel-inset)] bottom-[var(--panel-inset)] flex w-60 flex-col">
      {/* 搜索框去掉外框（用户 2026-11-05）：只留一条细分隔线，输入时文字本身给反馈 */}
      <div className="relative border-b border-[var(--panel-border)] px-2 py-1.5">
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            // Esc 也清空：手不用离开键盘（2026-11-07）
            if (e.key === 'Escape' && keyword) {
              e.stopPropagation();
              setKeyword('');
            }
          }}
          placeholder="搜索组件…"
          className="w-full border-0 bg-transparent px-1 py-1 pr-6 text-xs outline-none placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
        {/* 清空按钮（用户 2026-11-07）：有输入才出现，点一下清空并把焦点还给输入框 */}
        {keyword && (
          <button
            type="button"
            onClick={() => {
              setKeyword('');
              inputRef.current?.focus();
            }}
            title="清空搜索"
            aria-label="清空搜索"
            className="absolute right-1.5 top-1/2 grid h-4 w-4 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <ToolIcon name="close" size={11} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <section className="mb-3">
          <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
            结构
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {/* 搜索时不显示"分组"（它不是节点，留着会把每条搜索结果都弄脏） */}
            {!keyword.trim() && <GroupCard />}
            {/* 动态分组 / 动态组（2026-11-07）：入口紧跟在「分组」后面 */}
            {DYNAMIC_PRESETS.filter((preset) => !keyword.trim() || preset.label.includes(keyword.trim())).map(
              (preset) => (
                <StructureCard
                  key={preset.key}
                  iconKey={preset.iconKey}
                  label={preset.label}
                  title={
                    preset.dashed
                      ? `拖到画布创建「${preset.label}」（虚线框，名称在框外，点框里的＋批量加节点）`
                      : `拖到画布创建「${preset.label}」（点框里的＋批量加节点）`
                  }
                  payload={preset.key}
                  dashed={preset.dashed}
                />
              ),
            )}
            {presets.map((preset) => (
              <PresetCard key={preset.key} preset={preset} />
            ))}
            {/* 结构区的节点卡（单行元素 / 线条 / 自定义卡片）也要参与搜索：
                以前只在"没输入关键字"时渲染，改名后「自定义卡片」就搜不到了（2026-11-07） */}
            {structureNodes.map((item) => (
              <ComponentCard key={item.key} item={item} />
            ))}
          </div>
        </section>

        {categories.map((category) => (
          <section key={category.key} className="mb-3">
            <h3 className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              {category.label}
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {category.items.map((item) => (
                <ComponentCard key={item.nodeType} item={item} />
              ))}
            </div>
          </section>
        ))}
        {total === 0 && (
          <p className="px-1 py-4 text-center text-xs text-[var(--text-secondary)]">没有匹配的组件</p>
        )}
      </div>
    </aside>
    </>
  );
}
