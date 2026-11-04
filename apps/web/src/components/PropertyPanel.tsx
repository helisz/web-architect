import { useMemo, useState } from 'react';
import {
  ALLOWED_ICON_KEYS,
  COMPONENT_INDEX,
  iconKeyFor,
  type DiagramEdge,
  type DiagramGroup,
  type DiagramNode,
} from '@arch/schema';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { NodeIcon } from '../icons/index.js';
import { IconPicker } from './IconPicker.js';
import { ColorField } from './ColorField.js';

/**
 * 右侧属性面板（规格 §3.4 / §5.4）。
 *
 * 一次只编辑一个选中对象：节点表单、连线表单。
 * 所有修改都直接改 Schema（单一事实来源），保存由自动保存链路负责。
 */
export function PropertyPanel() {
  const selectedId = useDiagramStore((s) => s.selectedId);
  const selectedIds = useDiagramStore((s) => s.selectedIds);
  const requestDelete = useDiagramStore((s) => s.requestDelete);
  const diagram = useDiagramStore((s) => s.diagram);

  const node = useMemo(
    () => diagram.nodes.find((n) => n.nodeId === selectedId) ?? null,
    [diagram.nodes, selectedId],
  );
  const edge = useMemo(
    () => diagram.edges.find((e) => e.edgeId === selectedId) ?? null,
    [diagram.edges, selectedId],
  );
  const group = useMemo(
    () => diagram.groups.find((g) => g.groupId === selectedId) ?? null,
    [diagram.groups, selectedId],
  );

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-[var(--panel-border)] bg-[var(--panel-bg)]">
      <div className="border-b border-[var(--panel-border)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
        {node ? '节点属性' : edge ? '连线属性' : group ? '分组属性' : '属性'}
      </div>
      <div className="flex-1 p-3">
        {node && <NodeForm node={node} />}
        {edge && <EdgeForm edge={edge} />}
        {group && <GroupForm group={group} />}
        {!node && !edge && !group && selectedIds.length > 1 && (
          <div>
            <p className="text-sm font-semibold">已选中 {selectedIds.length} 个元素</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              拖动即可整体移动（按 10px 吸附），也可以直接 Delete 删除。
            </p>
            <button
              type="button"
              onClick={() => requestDelete(selectedIds)}
              className="mt-3 w-full rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 hover:bg-red-100"
            >
              删除选中的 {selectedIds.length} 个元素
            </button>
          </div>
        )}
        {!node && !edge && !group && selectedIds.length <= 1 && (
          <p className="text-xs text-[var(--text-secondary)]">选中一个节点、连线或分组</p>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* 分组表单                                                            */
/* ------------------------------------------------------------------ */

/** 宽高一对输入框（分组与节点共用口径：下限来自 DB 的 check 约束） */
function SizeFields({
  width,
  height,
  minWidth,
  minHeight,
  onChange,
}: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  onChange: (size: { width: number; height: number }) => void;
}) {
  return (
    <div className="mb-3 flex gap-2">
      <Field label="宽">
        <input
          type="number"
          min={minWidth}
          className={inputClass}
          value={Math.round(width)}
          onChange={(e) => onChange({ width: Math.max(minWidth, Number(e.target.value) || minWidth), height })}
        />
      </Field>
      <Field label="高">
        <input
          type="number"
          min={minHeight}
          className={inputClass}
          value={Math.round(height)}
          onChange={(e) => onChange({ width, height: Math.max(minHeight, Number(e.target.value) || minHeight) })}
        />
      </Field>
    </div>
  );
}

function GroupForm({ group }: { group: DiagramGroup }) {
  const patchGroup = useDiagramStore((s) => s.patchGroup);
  const toggleGroupCollapsed = useDiagramStore((s) => s.toggleGroupCollapsed);
  const removeGroup = useDiagramStore((s) => s.removeGroup);
  const childCount = useDiagramStore(
    (s) => s.diagram.nodes.filter((n) => n.groupId === group.groupId).length,
  );

  return (
    <div>
      <Field label="名称">
        <input
          className={inputClass}
          value={group.label}
          onChange={(e) => patchGroup(group.groupId, { label: e.target.value })}
        />
      </Field>

      <SizeFields
        width={group.width}
        height={group.height}
        minWidth={120}
        minHeight={80}
        onChange={(size) => patchGroup(group.groupId, size)}
      />

      <ColorField
        targets={[
          { scope: 'font', value: group.titleColor, onChange: (value) => patchGroup(group.groupId, { titleColor: value }) },
          { scope: 'bg', value: group.bgColor, onChange: (value) => patchGroup(group.groupId, { bgColor: value }) },
          { scope: 'line', value: group.borderColor, onChange: (value) => patchGroup(group.groupId, { borderColor: value }) },
        ]}
        kind="group"
      />

      <label className="mb-3 flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={group.collapsed}
          onChange={() => toggleGroupCollapsed(group.groupId)}
        />
        折叠（子元素数据保留，展开即回来）
      </label>

      <p className="mb-3 text-[11px] text-[var(--text-secondary)]">
        组内直接包含 {childCount} 个节点；拖进/拖出会自动换算局部坐标，整体拖动不漂移。
      </p>

      <button
        type="button"
        className="w-full rounded border border-[#FCA5A5] px-2 py-1 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
        onClick={() => {
          if (window.confirm(`删除分组「${group.label}」？组里的节点会保留并移到上一层。`)) {
            removeGroup(group.groupId);
          }
        }}
      >
        删除分组
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 通用控件                                                            */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-[#D1D5DB] bg-white px-2 py-1 text-[13px] outline-none focus:border-[var(--primary)]';

/* ------------------------------------------------------------------ */
/* 节点表单                                                            */
/* ------------------------------------------------------------------ */

function NodeForm({ node }: { node: DiagramNode }) {
  const patch = useDiagramStore((s) => s.patchNode);
  const spec = COMPONENT_INDEX[node.nodeType];
  const iconKey = (node.extJson?.iconKey as string | undefined) ?? iconKeyFor(node.nodeType);
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div>
      <Field label="名称">
        <input
          className={inputClass}
          value={node.label}
          onChange={(e) => patch(node.nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="副文本">
        <textarea
          className={`${inputClass} mono h-14 resize-none`}
          value={node.subLabel}
          placeholder={spec?.defaultSubLabel ?? ''}
          onChange={(e) => patch(node.nodeId, { subLabel: e.target.value })}
        />
      </Field>

      <div className="mb-3 flex gap-2">
        <Field label="宽">
          <input
            type="number"
            min={64}
            className={inputClass}
            value={Math.round(node.width)}
            onChange={(e) => patch(node.nodeId, { width: Math.max(64, Number(e.target.value) || 64) })}
          />
        </Field>
        <Field label="高">
          <input
            type="number"
            min={40}
            className={inputClass}
            value={Math.round(node.height)}
            onChange={(e) => patch(node.nodeId, { height: Math.max(40, Number(e.target.value) || 40) })}
          />
        </Field>
      </div>

      <ColorField
        targets={[
          { scope: 'font', value: node.textColor, onChange: (textColor) => patch(node.nodeId, { textColor }) },
          { scope: 'bg', value: node.bgColor, onChange: (bgColor) => patch(node.nodeId, { bgColor }) },
          { scope: 'line', value: node.borderColor, onChange: (borderColor) => patch(node.nodeId, { borderColor }) },
        ]}
      />

      <Field label={`图标（${iconKey}）`}>
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-[var(--panel-border)]">
            <NodeIcon iconKey={iconKey} size={20} />
          </span>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex-1 rounded border border-[var(--panel-border)] px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            搜索图标库…
          </button>
        </div>
        <div className="mt-1 grid grid-cols-8 gap-1">
          {ALLOWED_ICON_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={key}
              onClick={() => patch(node.nodeId, { extJson: { ...(node.extJson ?? {}), iconKey: key } })}
              className={`grid h-7 place-items-center rounded border ${
                key === iconKey
                  ? 'border-[var(--primary)] bg-[#EFF6FF] text-[var(--primary)]'
                  : 'border-[var(--panel-border)] text-[var(--text-secondary)] hover:border-[var(--primary)]'
              }`}
            >
              <NodeIcon iconKey={key} size={16} />
            </button>
          ))}
        </div>
      </Field>

      {pickerOpen && (
        <IconPicker
          value={iconKey}
          onSelect={(key) => {
            patch(node.nodeId, { extJson: { ...(node.extJson ?? {}), iconKey: key } });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <div className="mt-3 flex gap-4 text-[13px]">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={node.locked}
            onChange={(e) => patch(node.nodeId, { locked: e.target.checked })}
          />
          锁定
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={node.visible}
            onChange={(e) => patch(node.nodeId, { visible: e.target.checked })}
          />
          显示
        </label>
      </div>

      <p className="mono mt-4 text-[11px] text-[var(--text-secondary)]">
        {node.nodeType} · {Math.round(node.x)},{Math.round(node.y)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 连线表单                                                            */
/* ------------------------------------------------------------------ */

const EDGE_TYPES = [
  { value: 'ortho', label: '正交折线' },
  { value: 'bezier', label: '贝塞尔曲线' },
  { value: 'straight', label: '直线' },
] as const;

const ARROWS = [
  { value: 'none', label: '无箭头' },
  { value: 'forward', label: '单向（指向目标）' },
  { value: 'backward', label: '反向（指向来源）' },
  { value: 'both', label: '双向' },
] as const;

function EdgeForm({ edge }: { edge: DiagramEdge }) {
  const patch = useDiagramStore((s) => s.patchEdge);

  return (
    <div>
      <Field label="标注">
        <input
          className={inputClass}
          value={edge.label ?? ''}
          placeholder="例如 443/TLS"
          onChange={(e) => patch(edge.edgeId, { label: e.target.value })}
        />
      </Field>

      <ColorField
        targets={[
          { scope: 'edge', value: edge.strokeColor, onChange: (strokeColor) => patch(edge.edgeId, { strokeColor }) },
        ]}
        kind="edge"
      />

      <div className="mb-3 flex gap-2">
        <Field label="线宽">
          <input
            type="number"
            step={0.5}
            min={0.5}
            max={8}
            className={inputClass}
            value={edge.strokeWidth}
            onChange={(e) =>
              patch(edge.edgeId, { strokeWidth: Math.min(8, Math.max(0.5, Number(e.target.value) || 1)) })
            }
          />
        </Field>
        <Field label="虚线">
          <select
            className={inputClass}
            value={edge.strokeDasharray ?? ''}
            onChange={(e) =>
              patch(edge.edgeId, { strokeDasharray: e.target.value === '' ? null : e.target.value })
            }
          >
            <option value="">实线</option>
            <option value="6 4">虚线 6 4</option>
            <option value="2 3">点线 2 3</option>
            <option value="12 4 2 4">点划线</option>
          </select>
        </Field>
      </div>

      <Field label="线型">
        <select
          className={inputClass}
          value={edge.edgeType}
          onChange={(e) => patch(edge.edgeId, { edgeType: e.target.value as DiagramEdge['edgeType'] })}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="箭头">
        <select
          className={inputClass}
          value={edge.arrow}
          onChange={(e) => patch(edge.edgeId, { arrow: e.target.value as DiagramEdge['arrow'] })}
        >
          {ARROWS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>

      <p className="mono mt-4 text-[11px] text-[var(--text-secondary)]">
        {edge.sourceAnchor ?? '自动'} → {edge.targetAnchor ?? '自动'}
      </p>
    </div>
  );
}







