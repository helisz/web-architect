/**
 * AI 模型配置对话框（用户 2026-11-05）。
 *
 * 三种状态，一个弹窗搞定：
 * 1. 还没设过口令 → 先设口令（本地加密的钥匙），再填模型；
 * 2. 有密文没解锁 → 输口令解锁（忘了就只能清除重配，本机没有找回途径）；
 * 3. 已解锁 → 档案列表 + 编辑表单 + 测试连接。
 *
 * 界面上必须说清楚的三件事：配置只存在本机、口令忘了没法恢复、解析需要多模态模型。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AI_LIMITS,
  PROVIDER_META,
  activeAiProfile,
  createAiProfile,
  maskApiKey,
  profileProblem,
  type AiProfile,
  type AiProvider,
} from '../ai/types.js';
import { testProfile } from '../ai/providers.js';
import { readVault } from '../ai/vault.js';
import { useAiStore } from '../store/useAiStore.js';

const inputClass =
  'w-full rounded border border-[var(--hair-strong)] bg-white px-2 py-1 text-[13px] outline-none focus:border-[var(--primary)] disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-secondary)]';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-secondary)]">{hint}</span>}
    </label>
  );
}

export function AiConfigDialog() {
  const open = useAiStore((s) => s.dialogOpen);
  const setOpen = useAiStore((s) => s.setDialogOpen);
  const locked = useAiStore((s) => s.locked);
  const config = useAiStore((s) => s.config);
  const busy = useAiStore((s) => s.busy);
  const error = useAiStore((s) => s.error);
  const createVault = useAiStore((s) => s.createVault);
  const unlock = useAiStore((s) => s.unlock);
  const lock = useAiStore((s) => s.lock);
  const saveProfile = useAiStore((s) => s.saveProfile);
  const removeProfile = useAiStore((s) => s.removeProfile);
  const setActive = useAiStore((s) => s.setActive);
  const clearAll = useAiStore((s) => s.clearAll);

  const [vaultPresent, setVaultPresent] = useState(() => readVault() !== null);
  const [passphrase, setPassphrase] = useState('');
  const [passphrase2, setPassphrase2] = useState('');
  const [wipeArmed, setWipeArmed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiProfile | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const active = useMemo(() => activeAiProfile(config), [config]);
  const profiles = config?.profiles ?? [];

  useEffect(() => {
    if (!open) return;
    setVaultPresent(readVault() !== null);
    setPassphrase('');
    setPassphrase2('');
    setWipeArmed(false);
    setTest(null);
    setToast(null);
  }, [open]);

  // 解锁后自动把「当前生效」的档案装进表单
  useEffect(() => {
    if (!open || !config) return;
    const target = active ?? profiles[0] ?? null;
    setSelectedId(target?.profileId ?? null);
    setDraft(target ? { ...target } : null);
    setTest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config?.activeProfileId, profiles.length]);

  if (!open) return null;

  const close = (): void => setOpen(false);

  const setPass = (value: string): void => setPassphrase(value);
  const notice = (message: string): void => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const doCreate = async (): Promise<void> => {
    if (passphrase.length < AI_LIMITS.passphraseMin) {
      notice(`口令至少 ${AI_LIMITS.passphraseMin} 位`);
      return;
    }
    if (passphrase !== passphrase2) {
      notice('两次输入的口令不一样');
      return;
    }
    if (await createVault(passphrase)) {
      setVaultPresent(true);
      setPassphrase('');
      setPassphrase2('');
      notice('口令已设好：配置会加密保存在这台机器上');
    }
  };

  const doUnlock = async (): Promise<void> => {
    if (await unlock(passphrase)) {
      setPassphrase('');
      notice('已解锁');
    }
  };

  const newProfile = (): void => {
    const fresh = createAiProfile();
    setSelectedId(null);
    setDraft(fresh);
    setTest(null);
  };

  const selectProfile = (profile: AiProfile): void => {
    if (draft && draft.profileId === profile.profileId) return;
    setSelectedId(profile.profileId);
    setDraft({ ...profile });
    setTest(null);
  };

  const update = (patch: Partial<AiProfile>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const changeProvider = (provider: AiProvider): void => {
    if (!draft) return;
    setDraft({
      ...draft,
      provider,
      // 换提供方时把地址带回该家的默认值，避免拿 A 家的地址去请求 B 家
      baseUrl: PROVIDER_META[provider].defaultBaseUrl,
      apiKey: draft.apiKey,
    });
    setTest(null);
  };

  const doSave = async (): Promise<void> => {
    if (!draft) return;
    const problem = profileProblem(draft);
    if (problem) {
      notice(problem);
      return;
    }
    if (await saveProfile({ ...draft, name: draft.name.trim() || '未命名模型' })) {
      notice('已加密保存到本机');
    }
  };

  const doTest = async (): Promise<void> => {
    if (!draft) return;
    const problem = profileProblem(draft);
    if (problem) {
      setTest({ ok: false, message: problem });
      return;
    }
    setTest({ ok: true, message: '正在连接…' });
    const result = await testProfile(draft);
    setTest(result);
  };

  const doRemove = async (): Promise<void> => {
    if (!draft) return;
    const saved = profiles.some((p) => p.profileId === draft.profileId);
    if (!saved) {
      setDraft(null);
      setSelectedId(null);
      return;
    }
    await removeProfile(draft.profileId);
    setDraft(null);
    setSelectedId(null);
    notice('已删除该档案');
  };

  return (
    <div
      className="anim-backdrop fixed inset-0 z-50 grid place-items-center bg-black/30"
      role="dialog"
      aria-modal
      aria-label="AI 模型设置"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="anim-window flex max-h-[86vh] w-[560px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold">AI 模型设置</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              配置加密后只存在这台机器上，不会上传到我们的服务器，也不进 Supabase
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            onClick={close}
            className="grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* ① 还没设口令 */}
          {!vaultPresent && (
            <div>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                先给配置设一个本机口令。模型地址和 API Key 会用这个口令加密后存进浏览器的
                localStorage；<b className="text-[var(--text-primary)]">口令只存在你的脑子里</b>，
                忘了就只能清除重配。
              </p>
              <div className="mt-3">
                <Field label="口令" hint={`至少 ${AI_LIMITS.passphraseMin} 位`}>
                  <input
                    type="password"
                    aria-label="新口令"
                    className={inputClass}
                    value={passphrase}
                    onChange={(e) => setPass(e.target.value)}
                  />
                </Field>
                <Field label="再输一次">
                  <input
                    type="password"
                    aria-label="确认口令"
                    className={inputClass}
                    value={passphrase2}
                    onChange={(e) => setPassphrase2(e.target.value)}
                  />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => void doCreate()}
                disabled={busy}
                className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-60"
              >
                {busy ? '处理中…' : '设好口令，开始配置'}
              </button>
            </div>
          )}

          {/* ② 有密文但没解锁 */}
          {vaultPresent && locked && (
            <div>
              <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                这台机器上已经保存过模型配置，输入口令解锁。
              </p>
              <div className="mt-3">
                <Field label="口令">
                  <input
                    type="password"
                    autoFocus
                    aria-label="口令"
                    className={inputClass}
                    value={passphrase}
                    onChange={(e) => setPass(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doUnlock();
                    }}
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void doUnlock()}
                  disabled={busy}
                  className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-60"
                >
                  {busy ? '解锁中…' : '解锁'}
                </button>
                {wipeArmed ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearAll();
                      setVaultPresent(false);
                      setWipeArmed(false);
                      setPassphrase('');
                      notice('已清除本机的模型配置');
                    }}
                    className="rounded border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-1.5 text-xs text-[#B91C1C]"
                  >
                    确认清除（不可恢复）
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setWipeArmed(true)}
                    className="rounded border border-[var(--panel-border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  >
                    忘记口令了
                  </button>
                )}
              </div>
              {wipeArmed && (
                <p className="mt-2 text-[11px] text-[#B91C1C]">
                  忘口令没有找回办法（本机加密，没有托管方）。清除后需要重新填模型地址和 Key。
                </p>
              )}
            </div>
          )}

          {/* ③ 已解锁：档案 + 表单 */}
          {vaultPresent && !locked && config && (
            <div className="flex gap-3">
              <div className="w-[150px] shrink-0">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--text-secondary)]">模型档案</span>
                  <button
                    type="button"
                    onClick={newProfile}
                    title="新建档案"
                    aria-label="新建模型档案"
                    className="rounded border border-[var(--panel-border)] px-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    + 新建
                  </button>
                </div>
                <div className="space-y-1">
                  {profiles.map((profile) => {
                    const isActive = active?.profileId === profile.profileId;
                    const isEditing = draft?.profileId === profile.profileId;
                    return (
                      <button
                        key={profile.profileId}
                        type="button"
                        onClick={() => selectProfile(profile)}
                        className={`block w-full rounded border px-2 py-1.5 text-left text-[11px] ${
                          isEditing
                            ? 'border-[var(--primary)] bg-[var(--accent-50)]'
                            : 'border-[var(--panel-border)] hover:border-[var(--primary)]'
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          <span className={isActive ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]'}>
                            {isActive ? '●' : '○'}
                          </span>
                          <span className="truncate">{profile.name}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-secondary)]">
                          {profile.model || '未填模型'}
                        </span>
                      </button>
                    );
                  })}
                  {profiles.length === 0 && (
                    <p className="rounded border border-dashed border-[var(--panel-border)] px-2 py-3 text-center text-[10px] text-[var(--text-secondary)]">
                      还没有档案
                      <br />
                      点「+ 新建」填一个
                    </p>
                  )}
                </div>
                {profiles.length > 0 && active && (
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = selectedId ?? active.profileId;
                      void setActive(targetId).then((ok) => {
                        if (ok) notice('已设为默认档案');
                      });
                    }}
                    className="mt-2 w-full rounded border border-[var(--panel-border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
                  >
                    把当前档案设为默认
                  </button>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {!draft && (
                  <p className="rounded border border-dashed border-[var(--panel-border)] px-3 py-8 text-center text-[11px] text-[var(--text-secondary)]">
                    左边选一个档案，或点「+ 新建」
                  </p>
                )}

                {draft && (
                  <div>
                    <Field label="档案名">
                      <input
                        className={inputClass}
                        aria-label="档案名"
                        value={draft.name}
                        maxLength={AI_LIMITS.nameMax}
                        onChange={(e) => update({ name: e.target.value })}
                      />
                    </Field>
                    <Field label="提供方">
                      <select
                        className={inputClass}
                        aria-label="提供方"
                        value={draft.provider}
                        onChange={(e) => changeProvider(e.target.value as AiProvider)}
                      >
                        {(Object.keys(PROVIDER_META) as AiProvider[]).map((provider) => (
                          <option key={provider} value={provider}>
                            {PROVIDER_META[provider].label}
                          </option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[10px] leading-relaxed text-[var(--text-secondary)]">
                        {PROVIDER_META[draft.provider].note}
                      </span>
                    </Field>
                    <Field label="Base URL">
                      <input
                        className={inputClass}
                        aria-label="Base URL"
                        value={draft.baseUrl}
                        maxLength={AI_LIMITS.baseUrlMax}
                        onChange={(e) => update({ baseUrl: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="模型名"
                      hint="解析架构图必须用支持图片输入的模型，例如 gpt-4o、gemini-2.5-flash、claude-sonnet-4-5"
                    >
                      <input
                        className={inputClass}
                        aria-label="模型名"
                        value={draft.model}
                        maxLength={AI_LIMITS.modelMax}
                        placeholder="gpt-4o"
                        onChange={(e) => update({ model: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="API Key"
                      hint={`只加密保存在本机。已保存的显示为 ${maskApiKey(draft.apiKey)}；要改就整串重填`}
                    >
                      <input
                        type="password"
                        className={inputClass}
                        aria-label="API Key"
                        value={draft.apiKey}
                        maxLength={AI_LIMITS.apiKeyMax}
                        placeholder={PROVIDER_META[draft.provider].keyPlaceholder}
                        onChange={(e) => update({ apiKey: e.target.value })}
                      />
                    </Field>
                    <Field label={`温度（${draft.temperature.toFixed(1)}）`} hint="解析任务建议 0，越低温越按格式来">
                      <input
                        type="range"
                        aria-label="温度"
                        min={AI_LIMITS.temperatureMin}
                        max={AI_LIMITS.temperatureMax}
                        step={0.1}
                        value={draft.temperature}
                        onChange={(e) => update({ temperature: Number(e.target.value) })}
                        className="w-full"
                      />
                    </Field>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void doSave()}
                        disabled={busy}
                        className="rounded bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-60"
                      >
                        {busy ? '保存中…' : '保存到本机'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void doTest()}
                        disabled={busy}
                        className="rounded border border-[var(--panel-border)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-60"
                      >
                        测试连接
                      </button>
                      <button
                        type="button"
                        onClick={() => void doRemove()}
                        className="rounded border border-[#FCA5A5] px-3 py-1.5 text-xs text-[#B91C1C] hover:bg-[#FEF2F2]"
                      >
                        删除
                      </button>
                    </div>

                    {test && (
                      <p
                        role="status"
                        className={`mt-2 rounded border px-2 py-1.5 text-[11px] leading-relaxed ${
                          test.ok
                            ? 'border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]'
                            : 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]'
                        }`}
                      >
                        {test.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1.5 text-[11px] text-[#B91C1C]">
              {error}
            </p>
          )}
          {toast && (
            <p role="status" className="mt-3 rounded border border-[var(--panel-border)] bg-[var(--bg-hover)] px-2 py-1.5 text-[11px]">
              {toast}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--panel-border)] px-4 py-2">
          <div className="flex items-center gap-2">
            {vaultPresent && !locked && (
              <>
                <button
                  type="button"
                  onClick={() => lock()}
                  className="rounded border border-[var(--panel-border)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  锁定
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (wipeArmed) {
                      clearAll();
                      setVaultPresent(false);
                      setWipeArmed(false);
                      notice('已清除本机的模型配置');
                    } else {
                      setWipeArmed(true);
                      notice('再点一次就清除全部配置');
                    }
                  }}
                  className="rounded border border-[var(--panel-border)] px-2 py-1 text-[11px] text-[#B91C1C] hover:bg-[#FEF2F2]"
                >
                  {wipeArmed ? '确认清除' : '清除所有配置'}
                </button>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
