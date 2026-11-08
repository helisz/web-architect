import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  displayValue,
  emptyTemplateConfig,
  normalizeTemplateConfig,
  readPath,
  type FlowFieldSpec,
  type FlowPair,
  type FlowParamSpec,
  type FlowTemplateConfig,
} from '@arch/schema';
import { loadTemplate, saveTemplate } from '../data/flowRepo.js';
import { missingParams, resolveParams, runNodeRequest, type RunResult } from '../flow/runner.js';
import { navigateToTemplates } from '../lib/route.js';
import { ToolIcon } from './ToolIcons.js';

/**
 * 模板编辑器（用户 2026-11-08）。
 *
 * 左边是配置（数据 / 参数 / 展示 / 状态 / 系统 五段），右边是**单节点调试**：
 * 填参数 → 发请求 → 看到原始返回 + 映射后的字段 + 状态判定。
 * 这样建模板的人不用先建一张流程才知道配得对不对。
 */

const inputClass =
  'w-full border border-[var(--hair-strong)] bg-white px-2 py-1.5 text-[12px] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--primary)]';

const monoClass = `${inputClass} mono`;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--hair)] px-4 py-3 first:border-t-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="h-[10px] w-[2px] translate-y-[1px] bg-[var(--primary)]" />
        <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">{title}</h3>
        {hint && <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/** 通用「key / value」行编辑（headers、body 用） */
function PairRows({
  rows,
  onChange,
  keyLabel = '键',
  valueLabel = '值',
}: {
  rows: FlowPair[];
  onChange: (rows: FlowPair[]) => void;
  keyLabel?: string;
  valueLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1">
          <input
            className={`${monoClass} flex-1`}
            placeholder={keyLabel}
            value={row.key}
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...row, key: e.target.value };
              onChange(next);
            }}
          />
          <input
            className={`${monoClass} flex-[1.4]`}
            placeholder={valueLabel}
            value={row.value}
            onChange={(e) => {
              const next = [...rows];
              next[index] = { ...row, value: e.target.value };
              onChange(next);
            }}
          />
          <button
            type="button"
            aria-label="删除这一行"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="grid h-6 w-6 shrink-0 place-items-center text-[var(--text-tertiary)] hover:text-[var(--err)]"
          >
            <ToolIcon name="trash" size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: '', value: '' }])}
        className="mt-0.5 flex w-fit items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--primary-text)]"
      >
        <ToolIcon name="plus" size={11} /> 添加一行
      </button>
    </div>
  );
}

export function TemplateEditor({ templateId }: { templateId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [config, setConfig] = useState<FlowTemplateConfig>(emptyTemplateConfig());

  // 调试：参数值 + 结果
  const [debugParams, setDebugParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await loadTemplate(templateId);
        if (cancelled) return;
        if (!row) {
          setError('这个模板不存在，可能已被删除');
          return;
        }
        setName(row.name);
        setDescription(row.description);
        setVisibility(row.visibility);
        setConfig(normalizeTemplateConfig(row.config));
        setDebugParams(resolveParams(normalizeTemplateConfig(row.config), {}));
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const patch = useCallback((next: Partial<FlowTemplateConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));
  }, []);

  const patchData = useCallback((next: Partial<FlowTemplateConfig['data']>) => {
    setConfig((prev) => ({ ...prev, data: { ...prev.data, ...next } }));
  }, []);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await saveTemplate({ templateId, name, description, visibility, config });
      setNotice('已保存');
      window.setTimeout(() => setNotice(null), 1600);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const run = async (): Promise<void> => {
    const missing = missingParams(config, debugParams);
    if (missing.length > 0) {
      setError(`这些参数还没填：${missing.join('、')}`);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      setResult(await runNodeRequest(config, debugParams));
    } finally {
      setRunning(false);
    }
  };

  const rawPretty = useMemo(() => {
    if (!result) return '';
    if (result.payload != null && typeof result.payload === 'object') {
      return JSON.stringify(result.payload, null, 2);
    }
    return result.rawText;
  }, [result]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center bg-[var(--canvas-bg)] text-[13px] text-[var(--text-secondary)]">
        正在读取模板…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--canvas-bg)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--hair)] bg-white px-3">
        <button
          type="button"
          onClick={navigateToTemplates}
          aria-label="回模板库"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-ctl)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <ToolIcon name="chevronLeft" size={16} />
        </button>
        <input
          className="min-w-0 max-w-[320px] flex-1 border-none bg-transparent text-[14px] font-semibold text-[var(--text-primary)] outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="模板名称"
        />
        <span className="mono shrink-0 border border-[var(--hair-strong)] px-1 text-[9px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {visibility === 'public' ? '公共' : '私有'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {notice && <span className="mono text-[10px] text-[var(--text-tertiary)]">{notice}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-[var(--radius-ctl)] bg-[var(--primary-solid)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-solid-hover)] disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </header>

      {error && (
        <p className="shrink-0 border-b border-[#E8B4A6] bg-[#FDF1EE] px-3 py-2 text-[12px] leading-5 text-[var(--err)]">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── 左：配置 ── */}
        <div className="min-h-0 w-[52%] min-w-[420px] overflow-y-auto border-r border-[var(--hair)] bg-white">
          <Section title="基本信息">
            <div className="flex flex-col gap-2">
              <input
                className={inputClass}
                placeholder="模板说明（可选）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                <span>可见性</span>
                <select
                  className={inputClass}
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value === 'public' ? 'public' : 'private')}
                >
                  <option value="private">私有（只有自己能用）</option>
                  <option value="public">公共（所有人能用；只有管理员能建）</option>
                </select>
              </label>
            </div>
          </Section>

          <Section title="① 数据" hint="节点取数用这个接口；URL 里可用 {{参数名}}">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select
                  className={`${inputClass} w-[92px] shrink-0`}
                  value={config.data.method}
                  onChange={(e) => patchData({ method: e.target.value === 'POST' ? 'POST' : 'GET' })}
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <input
                  className={`${monoClass} flex-1`}
                  placeholder="https://api.example.com/status/{{app}}"
                  value={config.data.url}
                  onChange={(e) => patchData({ url: e.target.value })}
                />
              </div>

              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  请求头
                </p>
                <PairRows
                  rows={config.data.headers}
                  onChange={(headers) => patchData({ headers })}
                  keyLabel="Header"
                  valueLabel="值（可用 {{参数}}）"
                />
              </div>

              <div>
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  {config.data.method === 'POST' ? '请求体（JSON）' : '查询参数'}
                </p>
                <PairRows
                  rows={config.data.body}
                  onChange={(body) => patchData({ body })}
                  keyLabel="键"
                  valueLabel="值（可用 {{参数}}）"
                />
              </div>

              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                超时
                <input
                  type="number"
                  min={1000}
                  max={60000}
                  step={1000}
                  className={`${monoClass} w-[100px]`}
                  value={config.data.timeoutMs}
                  onChange={(e) => patchData({ timeoutMs: Number(e.target.value) })}
                />
                毫秒
              </label>
            </div>
          </Section>

          <Section title="② 参数" hint="建节点时填写；名字对应 URL / 请求头里的 {{占位符}}">
            <div className="flex flex-col gap-1.5">
              {config.params.map((spec, index) => (
                <div key={index} className="flex items-center gap-1">
                  <input
                    className={`${monoClass} w-[110px] shrink-0`}
                    placeholder="name"
                    value={spec.name}
                    onChange={(e) => {
                      const next = [...config.params];
                      next[index] = { ...spec, name: e.target.value };
                      patch({ params: next });
                    }}
                  />
                  <input
                    className={`${inputClass} flex-1`}
                    placeholder="显示名（如 应用名）"
                    value={spec.label}
                    onChange={(e) => {
                      const next = [...config.params];
                      next[index] = { ...spec, label: e.target.value };
                      patch({ params: next });
                    }}
                  />
                  <input
                    className={`${monoClass} flex-1`}
                    placeholder="默认值"
                    value={spec.default ?? ''}
                    onChange={(e) => {
                      const next = [...config.params];
                      next[index] = { ...spec, default: e.target.value };
                      patch({ params: next });
                    }}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={spec.required === true}
                      onChange={(e) => {
                        const next = [...config.params];
                        next[index] = { ...spec, required: e.target.checked };
                        patch({ params: next });
                      }}
                    />
                    必填
                  </label>
                  <label className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={spec.secret === true}
                      onChange={(e) => {
                        const next = [...config.params];
                        next[index] = { ...spec, secret: e.target.checked };
                        patch({ params: next });
                      }}
                    />
                    密钥
                  </label>
                  <button
                    type="button"
                    aria-label="删除参数"
                    onClick={() => patch({ params: config.params.filter((_, i) => i !== index) })}
                    className="grid h-6 w-6 shrink-0 place-items-center text-[var(--text-tertiary)] hover:text-[var(--err)]"
                  >
                    <ToolIcon name="trash" size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch({
                    params: [
                      ...config.params,
                      { name: `p${config.params.length + 1}`, label: '', default: '', required: false, secret: false },
                    ],
                  })
                }
                className="mt-0.5 flex w-fit items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--primary-text)]"
              >
                <ToolIcon name="plus" size={11} /> 添加参数
              </button>
            </div>
          </Section>

          <Section title="③ 展示字段" hint="从返回数据里取 key；高亮的默认展开，其余默认折叠">
            <div className="flex flex-col gap-1.5">
              {config.display.map((field, index) => (
                <div key={index} className="flex items-center gap-1">
                  <input
                    className={`${monoClass} flex-1`}
                    placeholder="data.status"
                    value={field.path}
                    onChange={(e) => {
                      const next = [...config.display];
                      next[index] = { ...field, path: e.target.value };
                      patch({ display: next });
                    }}
                  />
                  <input
                    className={`${inputClass} flex-1`}
                    placeholder="显示名（可留空）"
                    value={field.label}
                    onChange={(e) => {
                      const next = [...config.display];
                      next[index] = { ...field, label: e.target.value };
                      patch({ display: next });
                    }}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={field.highlight === true}
                      onChange={(e) => {
                        const next = [...config.display];
                        next[index] = { ...field, highlight: e.target.checked };
                        patch({ display: next });
                      }}
                    />
                    高亮
                  </label>
                  <button
                    type="button"
                    aria-label="删除字段"
                    onClick={() => patch({ display: config.display.filter((_, i) => i !== index) })}
                    className="grid h-6 w-6 shrink-0 place-items-center text-[var(--text-tertiary)] hover:text-[var(--err)]"
                  >
                    <ToolIcon name="trash" size={12} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  patch({ display: [...config.display, { path: '', label: '', highlight: true } as FlowFieldSpec] })
                }
                className="mt-0.5 flex w-fit items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--primary-text)]"
              >
                <ToolIcon name="plus" size={11} /> 添加字段
              </button>
            </div>
          </Section>

          <Section title="④ 状态判定" hint="取一个 key，命中成功 / 失败值列表；都不命中显示灰色">
            <div className="flex flex-col gap-2">
              <input
                className={monoClass}
                placeholder="data.health"
                value={config.status.path}
                onChange={(e) => patch({ status: { ...config.status, path: e.target.value } })}
              />
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                成功值
                <input
                  className={monoClass}
                  placeholder="ok, up, healthy（逗号分隔）"
                  value={config.status.success.join(', ')}
                  onChange={(e) =>
                    patch({ status: { ...config.status, success: e.target.value.split(',') } })
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                失败值
                <input
                  className={monoClass}
                  placeholder="down, error（逗号分隔）"
                  value={config.status.failure.join(', ')}
                  onChange={(e) =>
                    patch({ status: { ...config.status, failure: e.target.value.split(',') } })
                  }
                />
              </label>
            </div>
          </Section>

          <Section title="⑤ 系统跳转" hint="节点上会多一个按钮，跳到对应系统">
            <div className="flex flex-col gap-2">
              <input
                className={inputClass}
                placeholder="按钮文案，如 跳转到运维平台"
                value={config.system.label}
                onChange={(e) => patch({ system: { ...config.system, label: e.target.value } })}
              />
              <input
                className={monoClass}
                placeholder="https://ops.example.com/app/{{app}}"
                value={config.system.url}
                onChange={(e) => patch({ system: { ...config.system, url: e.target.value } })}
              />
            </div>
          </Section>
        </div>

        {/* ── 右：单节点调试 ── */}
        <div className="flex min-h-0 flex-1 flex-col bg-[var(--canvas-bg)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hair)] px-4 py-2">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">调试这个节点</span>
            <span className="mono text-[10px] text-[var(--text-tertiary)]">
              填参数 → 发请求 → 看映射结果
            </span>
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className="ml-auto rounded-[var(--radius-ctl)] border border-[var(--primary)] px-2.5 py-1 text-[11px] text-[var(--primary-text)] hover:bg-[var(--accent-50)] disabled:opacity-60"
            >
              {running ? '请求中…' : '发送请求'}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {/* 参数 */}
            {config.params.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                  参数
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {config.params.map((spec: FlowParamSpec) => (
                    <label key={spec.name} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {spec.label || spec.name}
                        {spec.required && <span className="ml-1 text-[var(--primary-text)]">*</span>}
                      </span>
                      <input
                        type={spec.secret ? 'password' : 'text'}
                        className={monoClass}
                        placeholder={spec.default || spec.name}
                        value={debugParams[spec.name] ?? ''}
                        onChange={(e) =>
                          setDebugParams((prev) => ({ ...prev, [spec.name]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 结果 */}
            {!result && (
              <div className="mt-8 text-center">
                <p className="text-[12px] text-[var(--text-secondary)]">还没有请求结果</p>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                  填好参数后点「发送请求」。目标系统需要放开 CORS，否则浏览器会拦掉。
                </p>
              </div>
            )}

            {result && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span
                    className={`mono border px-1 ${
                      result.error
                        ? 'border-[var(--err)] text-[var(--err)]'
                        : 'border-[var(--hair-strong)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {result.httpStatus ?? '—'}
                  </span>
                  <span className="mono text-[var(--text-tertiary)]">{result.elapsedMs}ms</span>
                  <span className="mono text-[var(--text-tertiary)]">状态：{result.status}</span>
                </div>

                {result.error && (
                  <p className="border border-[#E8B4A6] bg-[#FDF1EE] px-2.5 py-2 text-[11px] leading-5 text-[var(--err)]">
                    {result.error}
                  </p>
                )}

                {result.fields.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      映射后的字段
                    </p>
                    <div className="flex flex-col divide-y divide-[var(--hair)] border border-[var(--hair)] bg-white">
                      {result.fields.map((field) => (
                        <div key={field.path} className="flex items-baseline gap-2 px-2 py-1.5">
                          <span className="w-[110px] shrink-0 truncate text-[11px] text-[var(--text-secondary)]">
                            {field.label}
                          </span>
                          <span
                            className={`mono min-w-0 flex-1 truncate text-[11px] ${
                              field.highlight
                                ? 'font-semibold text-[var(--text-primary)]'
                                : 'text-[var(--text-secondary)]'
                            }`}
                            title={field.value}
                          >
                            {field.value || '—'}
                          </span>
                          {field.highlight && (
                            <span className="mono shrink-0 text-[9px] text-[var(--primary-text)]">高亮</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                    原始返回
                  </p>
                  <pre className="mono max-h-[320px] overflow-auto border border-[var(--hair)] bg-white p-2 text-[10.5px] leading-4 text-[var(--text-secondary)]">
                    {rawPretty || '（空）'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 调试面板里显示"取到的值"（模板编辑时预览用；保持和节点显示一致） */
export function previewFieldValue(payload: unknown, path: string): string {
  return displayValue(readPath(payload, path));
}
