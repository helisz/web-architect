/**
 * AI 解析上传 + 执行（用户 2026-11-05）。
 *
 * 三条上传通道都做：点击选文件、拖进窗口、直接粘贴。解析过程给出阶段文案 + 秒表 +
 * 取消；失败保留图片和一键重试（重试不重新压缩、也不重新选图）。
 *
 * 结果不预览、直接落图（用户定），所以成功后立刻建一张图、把结果放中转站、跳过去；
 * 画布那边作为一步写入，Ctrl+Z 可整体撤销。
 */

import { useEffect, useRef, useState } from 'react';
import { createEmptyDiagram } from '@arch/schema';
import { saveDiagram } from '../data/diagramRepo.js';
import { rememberSavedPayload } from '../data/usePersistence.js';
import { navigateToDiagram } from '../lib/route.js';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { useAiStore } from '../store/useAiStore.js';
import { activeAiProfile, profileProblem } from '../ai/types.js';
import {
  MAX_IMAGE_SIDE,
  formatBytes,
  imageFromClipboard,
  imageFromDataTransfer,
  prepareImage,
  type PreparedImage,
} from '../ai/image.js';
import { AiParseError, parseArchitectureImage, type ParseStage } from '../ai/parse.js';
import { buildLanding, landingSummary } from '../ai/landing.js';
import { stageAiImport } from '../ai/staging.js';

type Phase = 'idle' | 'preparing' | 'ready' | 'running' | 'error' | 'creating';

const STAGE_LABEL: Record<ParseStage, string> = {
  request: '正在把图发给模型…',
  validate: '正在检查识别结果…',
  retry: '格式没对上，让模型再答一次…',
};

export function AiParseDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useDiagramStore((s) => s.pushToast);
  const setDiagram = useDiagramStore((s) => s.setDiagram);
  const config = useAiStore((s) => s.config);
  const locked = useAiStore((s) => s.locked);
  const setConfigOpen = useAiStore((s) => s.setDialogOpen);

  const [phase, setPhase] = useState<Phase>('idle');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [stage, setStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const profile = activeAiProfile(config);
  const problem = locked ? '还没解锁模型配置' : profileProblem(profile);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        abortRef.current?.abort();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 粘贴：只要弹窗开着，Ctrl+V 一张图就能进来
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const file = imageFromClipboard(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      void acceptFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 运行中的秒表：让"卡住了"和"在跑"能区分开
  useEffect(() => {
    if (phase !== 'running') return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const acceptFile = async (file: File): Promise<void> => {
    setError(null);
    setPhase('preparing');
    try {
      const prepared = await prepareImage(file, file.name || 'architecture.png');
      setImage(prepared);
      setPhase('ready');
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  const run = async (): Promise<void> => {
    if (!image) return;
    if (!profile) {
      setError('还没有配置模型，点上面的「去配置」');
      setPhase('error');
      return;
    }
    if (problem) {
      setError(problem);
      setPhase('error');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setPhase('running');
    setStage(STAGE_LABEL.request);
    try {
      const result = await parseArchitectureImage({
        profile,
        image,
        signal: controller.signal,
        onStage: (next) => setStage(STAGE_LABEL[next]),
      });
      const spec = buildLanding(result.draft, {
        aspect: image.height / Math.max(1, image.width),
        fallbackName: image.fileName.replace(/\.[^.]+$/, '') || 'AI 解析的架构图',
      });
      setPhase('creating');
      setStage('正在新建一张图…');

      const fresh = createEmptyDiagram({ name: spec.name.slice(0, 100) });
      const saved = await saveDiagram(fresh, null);
      if (!saved.ok) {
        setError(saved.message);
        setPhase('error');
        return;
      }
      setDiagram({ ...fresh, version: saved.version }, { persisted: true });
      rememberSavedPayload(fresh);
      stageAiImport(spec, fresh.diagramId);

      const summary = landingSummary(spec);
      pushToast(
        `已识别 ${summary.nodes} 个节点 / ${summary.edges} 条连线${summary.groups ? ` / ${summary.groups} 个分组` : ''}，按 Ctrl+Z 可整体撤销`,
        'success',
      );
      navigateToDiagram(fresh.diagramId);
      onClose();
    } catch (err) {
      const message = err instanceof AiParseError ? err.message : (err as Error).message;
      if (err instanceof AiParseError && err.code === 'cancelled') {
        setPhase('ready');
        setStage('');
        return;
      }
      setError(message);
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = (): void => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const busy = phase === 'running' || phase === 'creating' || phase === 'preparing';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30"
      role="dialog"
      aria-modal
      aria-label="AI 解析架构图"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (busy) return;
        const file = imageFromDataTransfer(e.dataTransfer);
        if (file) void acceptFile(file);
      }}
    >
      <div className="w-[560px] rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold">AI 解析架构图</p>
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
              上传一张架构图，识别成可编辑的节点和连线；图片只在这次请求里用，不保存
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            disabled={busy}
            className="grid h-7 w-7 place-items-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* 模型状态 */}
        <div className="mt-3 flex items-center justify-between rounded border border-[var(--panel-border)] bg-[var(--bg-hover)] px-2 py-1.5">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {problem ? (
              <span className="text-[#B45309]">{problem}</span>
            ) : (
              <>
                模型：<b className="text-[var(--text-primary)]">{profile?.name}</b>
                <span className="ml-1 text-[var(--text-secondary)]">（{profile?.model}）</span>
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setConfigOpen(true)}
            className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            {problem ? '去配置' : '换模型'}
          </button>
        </div>

        {/* 上传区 / 预览 */}
        {!image && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={`mt-3 flex h-[190px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-center ${
              dragging ? 'border-[var(--primary)] bg-[var(--accent-50)]' : 'border-[var(--hair-strong)] hover:border-[var(--primary)] hover:bg-[var(--accent-50)]'
            }`}
          >
            <span className="text-[13px] font-medium">点这里选图，或把图片拖进这个窗口</span>
            <span className="text-[11px] text-[var(--text-secondary)]">也可以直接 Ctrl+V 粘贴截图</span>
            <span className="text-[10px] text-[var(--text-secondary)]">
              PNG / JPG / WebP，长边超过 {MAX_IMAGE_SIDE}px 会自动压缩
            </span>
          </button>
        )}

        {image && (
          <div className="mt-3">
            <div className="flex items-start gap-3">
              <img
                src={image.dataUrl}
                alt="待解析的架构图"
                className="max-h-[190px] max-w-[260px] rounded border border-[var(--panel-border)] object-contain"
              />
              <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                <p className="truncate text-[12px] text-[var(--text-primary)]">{image.fileName}</p>
                <p className="mt-1">
                  原图 {image.originalWidth}×{image.originalHeight} · {formatBytes(image.originalBytes)}
                </p>
                <p>
                  发送 {image.width}×{image.height} · {formatBytes(image.bytes)}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="rounded border border-[var(--panel-border)] px-2 py-0.5 text-[11px] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  >
                    重新选图
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          className="hidden"
          aria-label="选择架构图文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void acceptFile(file);
          }}
        />

        {/* 进度 */}
        {phase === 'running' && (
          <div className="mt-3 rounded border border-[var(--accent-200)] bg-[var(--accent-50)] px-2 py-1.5 text-[11px] text-[var(--accent-700)]">
            <span>{stage}</span>
            <span className="ml-2 tabular-nums text-[var(--text-secondary)]">{elapsed}s</span>
            <span className="ml-2 text-[var(--text-secondary)]">（超过 90 秒会失败，可取消）</span>
          </div>
        )}
        {phase === 'creating' && (
          <div className="mt-3 rounded border border-[var(--panel-border)] bg-[var(--bg-hover)] px-2 py-1.5 text-[11px]">
            {stage}
          </div>
        )}
        {phase === 'preparing' && (
          <div className="mt-3 text-[11px] text-[var(--text-secondary)]">正在处理图片…</div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-3 rounded border border-[#FCA5A5] bg-[#FEF2F2] px-2 py-1.5 text-[11px] leading-relaxed text-[#B91C1C]"
          >
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] leading-relaxed text-[var(--text-secondary)]">
            识别结果直接落到新图里，不先预览；不满意可以按 Ctrl+Z 整体撤销，再手工微调
          </span>
          <div className="flex gap-2">
            {phase === 'running' ? (
              <button
                type="button"
                onClick={cancel}
                className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)]"
              >
                取消
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded border border-[var(--panel-border)] px-3 py-1 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                取消
              </button>
            )}
            <button
              type="button"
              onClick={() => void run()}
              disabled={!image || busy || Boolean(problem)}
              title={problem ?? undefined}
              className="rounded bg-[var(--primary)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--primary-hover,#1D4ED8)] disabled:opacity-50"
            >
              {phase === 'running' || phase === 'creating' ? '解析中…' : error ? '重试' : '开始解析'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
