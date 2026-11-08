import { ToolIcon } from './ToolIcons.js';
import { navigateToFlows, navigateToGallery } from '../lib/route.js';

/**
 * 产品选择页（用户 2026-11-08）。
 *
 * 登录后不再直接进图库，而是先选「架构图」还是「流程」。
 * 两个入口做成两张等高的直角卡片，沿用全站的网格语言与强调色。
 */

interface CardProps {
  title: string;
  subtitle: string;
  points: string[];
  onOpen: () => void;
  icon: 'layers' | 'flow';
  code: string;
}

function ProductCard({ title, subtitle, points, onOpen, icon, code }: CardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex h-full flex-col items-start border border-[var(--hair-strong)] bg-white p-6 text-left transition-colors hover:border-[var(--primary)]"
    >
      <span className="mono absolute right-4 top-4 text-[10px] tracking-[0.12em] text-[var(--text-tertiary)]">
        {code}
      </span>

      <span className="mb-4 grid h-10 w-10 place-items-center border border-[var(--hair)] text-[var(--text-secondary)] transition-colors group-hover:border-[var(--primary)] group-hover:text-[var(--primary)]">
        <ToolIcon name={icon} size={20} />
      </span>

      <span className="text-[17px] font-semibold text-[var(--text-primary)]">{title}</span>
      <span className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{subtitle}</span>

      <ul className="mt-4 flex flex-col gap-1.5">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-[11px] leading-4 text-[var(--text-secondary)]">
            <span className="mt-[6px] h-[3px] w-[3px] shrink-0 bg-[var(--text-tertiary)]" />
            {point}
          </li>
        ))}
      </ul>

      <span className="mono mt-auto pt-6 text-[11px] tracking-[0.08em] text-[var(--primary-text)]">
        进入 →
      </span>
    </button>
  );
}

export function HomePage() {
  return (
    <div className="h-full overflow-y-auto bg-[var(--canvas-bg)]">
      <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col justify-center px-6 py-10">
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            选择要做什么
          </h1>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            两条产品线共用同一套画布操作，区别在于节点是什么。
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ProductCard
            code="01 / DIAGRAM"
            icon="layers"
            title="架构图"
            subtitle="画拓扑：节点、连线、分组泳道、版本快照"
            points={[
              '组件库直接拖，40+ 预置节点',
              '分组 / 动态分组 / 纯组，跨组拖动坐标自动换算',
              '导出 PNG / SVG / PDF / CSV',
            ]}
            onOpen={navigateToGallery}
          />
          <ProductCard
            code="02 / FLOW"
            icon="flow"
            title="流程"
            subtitle="串系统：每个节点是一次接口调用，实时看状态"
            points={[
              '节点来自「模板」，模板定义了请求与展示规则',
              '打开流程自动请求一次，高亮字段直接显示',
              '状态点绿 / 红 / 灰，可一键跳转到对应系统',
            ]}
            onOpen={navigateToFlows}
          />
        </div>

        <p className="mt-6 text-[11px] leading-5 text-[var(--text-tertiary)]">
          流程节点来自「模板」，模板库在流程列表里进入。
        </p>
      </div>
    </div>
  );
}
