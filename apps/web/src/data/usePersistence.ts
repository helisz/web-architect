import { useEffect, useRef } from 'react';
import type { ArchitectureDiagram } from '@arch/schema';
import { parseDiagram } from '@arch/schema';
import { loadDiagram, patchDiagram, saveDiagram, toSavePayload, type SaveResult } from './diagramRepo.js';
import { diffPayload, isEmpty, type SavePayload } from './payloadDiff.js';
import { clearDraft, readDraft, saveDraft } from './draft.js';
import { nextDelay, structuralKey } from './saveScheduler.js';
import { isWriterTab, takeOverWriter } from './tabLock.js';
import { shouldWarnOnUnload } from './unloadGuard.js';
import { readLocalViewport } from './viewportPrefs.js';
import { navigateToGallery, type Route } from '../lib/route.js';
import { isGuestMode } from './guestSession.js';
import { useDiagramStore } from '../store/useDiagramStore.js';

/** 上次打开的图：只用于图库里高亮，不再自动跳转（用户 2026-11-04 定稿） */
const LAST_OPEN_KEY = 'arch:last-open';

/** 图库页想知道"上次开的是哪张" */
export function lastOpenDiagramId(): string | null {
  try {
    return localStorage.getItem(LAST_OPEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 按路由载入：`#/d/<id>` → 打开那张图；`#/` → 图库，不载入任何图。
 *
 * 为什么不"打开最近编辑的一张"了：主页是图库，点哪张开哪张，
 * URL 里带着图的 id，刷新 / 分享链接 / 前进后退都对得上。
 */
export function useRouteDiagram(route: Route, enabled = true): void {
  const routeKey = route.kind === 'diagram' ? route.diagramId : 'gallery';

  useEffect(() => {
    // 未登录时一个请求都不发（见 canLoadData 的注释）：登录页渲染期间这个 hook 也会跑，
    // 让它空转，登录成功后 enabled 翻转，effect 依赖变化，自然会重新载入。
    if (!enabled) return;
    let cancelled = false;

    if (route.kind === 'gallery') {
      // 回图库：把图从内存里卸掉，自动保存自然停手
      const store = useDiagramStore.getState();
      if (store.persisted && store.diagram.diagramId) {
        try {
          localStorage.setItem(LAST_OPEN_KEY, store.diagram.diagramId);
        } catch {
          // 隐私模式写不了 localStorage：不影响使用
        }
      }
      store.closeDiagram();
      store.setBooted(true);
      store.setBootError(null);
      return;
    }

    const targetId = route.diagramId;
    const current = useDiagramStore.getState();
    // 新建 / 刚从图库载入过同一张图：不要重复拉一遍（会闪一下，还会盖掉草稿提示）
    if (current.persisted && current.diagram.diagramId === targetId) {
      current.setBooted(true);
      current.setBootError(null);
      return;
    }

    current.setBooted(false);
    current.setBootError(null);

    void (async () => {
      try {
        const loaded = await loadDiagram(targetId);
        if (cancelled) return;
        if (loaded.issues.length > 0) {
          console.warn('[arch] 载入时修复了若干问题：', loaded.issues.slice(0, 10));
        }

        // 视口优先用本地的：平移/缩放不进库，就不该被库里的旧位置拽回去
        const localViewport = readLocalViewport(loaded.diagram.diagramId);
        let nextDiagram = localViewport ? { ...loaded.diagram, viewport: localViewport } : loaded.diagram;

        /**
         * 本地草稿恢复：上次崩了 / 误关页面，草稿里会多出最后那几秒的编辑。
         * 只在版本号一致（说明没在别处存过）且内容确实不同的时候恢复，
         * 否则宁可相信库里的。
         */
        let restoredDraft: { at: number } | null = null;
        const draft = readDraft(loaded.diagram.diagramId);
        // 草稿必须先过 schema：脏草稿（比如历史 bug 留下的 undefined id）一旦恢复，
        // 就会让之后每次保存都被 Zod 拦下 —— 表现成"节点白改了、刷新就没了"。
        // 宁可丢掉这份草稿，也不能让它污染当前这张图。
        const draftValid = draft ? parseDiagram(draft.diagram) : null;
        if (draft && draftValid && !draftValid.success) {
          console.warn('[arch] 本地草稿不合法，已丢弃：', draftValid.errors.slice(0, 3));
          clearDraft(loaded.diagram.diagramId);
        }
        if (draft && draftValid?.success && draft.version === loaded.diagram.version) {
          const differences = diffPayload(toSavePayload(loaded.diagram), toSavePayload(draft.diagram));
          if (!isEmpty(differences)) {
            restoredDraft = { at: draft.at };
            nextDiagram = { ...draft.diagram, version: loaded.diagram.version, viewport: nextDiagram.viewport };
          } else {
            clearDraft(loaded.diagram.diagramId);
          }
        }

        const live = useDiagramStore.getState();
        live.setDiagram(nextDiagram, { persisted: true });
        // 基线永远是"库里的内容"：草稿差异才会被算成待保存的改动
        rememberSavedPayload(loaded.diagram);
        try {
          localStorage.setItem(LAST_OPEN_KEY, loaded.diagram.diagramId);
        } catch {
          // 同上
        }

        if (restoredDraft) {
          const after = useDiagramStore.getState();
          after.markDirty();
          after.pushToast(
            `已恢复上次未保存的改动（本地草稿 ${new Date(restoredDraft.at).toLocaleString('zh-CN')}）。不需要就按 Ctrl+Z 撤销。`,
            'info',
          );
        }
        if (!cancelled) {
          const done = useDiagramStore.getState();
          done.setBooted(true);
          done.setBootError(null);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        // 图不存在 / 被删了：别把人卡在错误页，回图库并说一声
        if (/PGRST116|no rows|not found|0 rows|图不存在|已删除/i.test(message)) {
          const live = useDiagramStore.getState();
          live.setBooted(true);
          live.pushToast('这张图不存在或已被删除，已返回图库', 'error');
          navigateToGallery();
          return;
        }
        useDiagramStore.getState().setBootError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeKey, enabled]);
}

/* ------------------------------------------------------------------ */
/* 自动保存                                                            */
/* ------------------------------------------------------------------ */

/** 编辑停顿多久后存盘（详细规则见 saveScheduler.ts） */
const DRAFT_MS = 1500;

/**
 * 上次成功落库的整图 payload —— 增量保存的"基线"。
 *
 * 首次载入 / 整图保存成功后更新；每张图各自一份（本项目单图，做单例够用）。
 */
let lastPayload: SavePayload | null = null;
/** 库里没有 arch_patch_diagram 时置位，本会话内直接走整图保存 */
let patchUnavailable = false;

/* —— 节流用的三个时间戳（模块级，跨渲染保持） —— */
/** 本轮"第一次变脏"的时间：用来兜住"连续编辑 30 秒也没停手" */
let dirtySince: number | null = null;
/** 上次真正发起写库的时间：两次写库之间至少隔 MIN_INTERVAL_MS */
let lastWriteAt = 0;
/** 上一次的结构指纹：只增删节点/连线/分组才算"结构性改动" */
let lastStructural: string | null = null;
/** 一次保存过程中只允许重定基一次，避免冲突时来回打转 */
let rebaseTried = false;

/** 载入完成后记住基线，这样第一次编辑就能走增量 */
export function rememberSavedPayload(diagram: ArchitectureDiagram): void {
  lastPayload = toSavePayload(diagram);
}

/**
 * 串行队列：同一时刻只允许一个保存请求在途（C14）。
 *
 * 只保留"最新一次"待存内容 —— 中间态没有意义，存最新的就行。
 */
let chain: Promise<void> = Promise.resolve();
let pending: ArchitectureDiagram | null = null;

/** 保存入口（内部）：连续改动只跑最后一次 */
function enqueue(diagram: ArchitectureDiagram): void {
  // 兜底守卫：没落过库的图一律不自动保存，避免把临时图/空图插成新文档
  if (!useDiagramStore.getState().persisted) return;
  pending = diagram;
  /**
   * 链条必须自带 try/catch。
   *
   * `chain = chain.then(...)` 一旦某次 runSave 抛异常，chain 就变成 **永久 rejected**，
   * 之后每次 enqueue 的 .then 都被跳过 —— 表现为"改动一直 dirty、永远存不进去"，
   * 而且没有任何报错。这里把异常接住并显示到状态栏，链条继续往下走。
   */
  chain = chain.then(async () => {
    const next = pending;
    pending = null;
    if (!next) return;
    try {
      await runSave(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[arch] 保存失败：', error);
      const store = useDiagramStore.getState();
      store.setSaveError(`保存失败：${message}`);
      store.markDirty();
    }
  });
}

async function runSave(diagram: ArchitectureDiagram): Promise<void> {
  const store = useDiagramStore.getState();
  store.markSaving();
  // 记下这次写库的时刻：后面 10 秒内的小改动会被合并，不再单独写
  lastWriteAt = Date.now();
  dirtySince = null;
  lastStructural = structuralKey(diagram);

  const payload = toSavePayload(diagram);

  /**
   * 游客模式（用户 2026-11-05）：整图写 localStorage。
   * 不走增量/版本冲突/重定基 —— 本机没有"别人也在改"这回事，快照也不做。
   */
  if (isGuestMode()) {
    const result = await saveDiagram(diagram, null);
    const after = useDiagramStore.getState();
    if (after.diagram.diagramId !== diagram.diagramId) return;
    if (result.ok) {
      lastPayload = payload;
      const dirtyAgain = after.saveState === 'dirty';
      after.applySaved(result.version, result.savedAt);
      if (dirtyAgain) after.markDirty();
      return;
    }
    after.setSaveError(result.message);
    after.markDirty();
    return;
  }

  // 首次保存（服务端还没有这张图）必须不带基线，否则会插出一条重复的图；
  // 没有基线 payload 时也只能整图保存（增量需要"上次存的是什么"）
  const canPatch = store.persisted && lastPayload !== null && !patchUnavailable;

  let result: SaveResult;
  if (canPatch) {
    const patch = diffPayload(lastPayload, payload);
    if (isEmpty(patch)) {
      // 没有任何需要写库的变化（比如只改了视口以外的临时态）→ 直接算已保存
      const after = useDiagramStore.getState();
      after.applySaved(diagram.version, new Date().toISOString());
      return;
    }
    result = await patchDiagram(diagram, diagram.version, patch);
    /**
     * 增量保存失败就退回整图保存。
     *
     * 两种失败都要兜：函数还没建（missing_patch），以及函数本身报 SQL 错
     * （例如 42804 CASE 类型不匹配 —— 库里的列类型和脚本不一致时就会这样）。
     * 用户的改动绝不能因为"增量这条路坏了"就丢掉。
     */
    if (!result.ok && (result.reason === 'missing_patch' || result.reason === 'failed')) {
      patchUnavailable = true;
      result = await saveDiagram(diagram, diagram.version);
    }
  } else {
    result = await saveDiagram(diagram, store.persisted ? diagram.version : null);
  }

  const after = useDiagramStore.getState();
  // 保存期间用户又改了 → 不要把状态改成"已保存"
  const stillCurrent = after.diagram.diagramId === diagram.diagramId;

  if (result.ok) {
    if (!stillCurrent) return;
    const dirtyAgain = after.saveState === 'dirty';
    // 基线只在"这次提交真的落库了"之后前移，否则下次会拿错误基线算差异
    lastPayload = payload;
    rebaseTried = false;
    after.applySaved(result.version, result.savedAt);
    // 落库成功 → 本地草稿没用了
    clearDraft(diagram.diagramId);
    // 保存期间用户又改了 → 不要把状态改成"已保存"，让队列继续
    if (dirtyAgain) after.markDirty();
    return;
  }

  if (result.reason === 'version_conflict') {
    /**
     * 先别急着报冲突：如果库里的内容跟我们上次成功保存的基线**一模一样**，
     * 说明只是版本号被推高了（另一个标签页存了同样的内容、或者本页重复提交），
     * 不是真的内容冲突。把基线换成服务端那份、版本号跟着走，重试一次即可。
     *
     * 这才是"减少冲突"最实用的一步：绝大多数 409 都不是真的打架。
     */
    if (!rebaseTried && lastPayload !== null) {
      rebaseTried = true;
      try {
        const server = await loadDiagram(diagram.diagramId);
        const serverPayload = toSavePayload(server.diagram);
        if (isEmpty(diffPayload(lastPayload, serverPayload))) {
          lastPayload = serverPayload;
          const fresh = useDiagramStore.getState().diagram;
          const rebased = { ...fresh, version: server.diagram.version };
          useDiagramStore.getState().setDiagram(rebased, { persisted: true });
          // setDiagram 会把状态置成"已保存"，这里要改回脏，让队列继续把改动写进去
          useDiagramStore.getState().markDirty();
          enqueue(rebased);
          return;
        }
      } catch (error) {
        console.warn('[arch] 冲突后重定基失败，退回人工处理：', error);
      }
    }
    rebaseTried = false;
    after.setConflict({ currentVersion: result.currentVersion, message: result.message });
    after.markDirty();
    return;
  }

  if (result.reason === 'missing_function') {
    after.setSaveDisabled(true);
    after.setSaveError(result.message);
    after.markDirty();
    return;
  }

  if (result.reason === 'invalid') {
    // 数据不合法：不进网络、不丢状态，只把"哪个字段不对"摆到界面上
    after.setSaveError(result.message);
    after.markDirty();
    return;
  }

  after.setSaveError(result.message);
  after.markDirty();
}

/**
 * 立刻写一次（绕过节流）：结构性操作、Ctrl+S、"用我的版本覆盖"这类
 * 不能等、也不该被合并的场合用。
 */
export function flushNow(): void {
  const state = useDiagramStore.getState();
  if (!state.persisted || state.conflict || state.saveDisabled) return;
  if (!isWriterTab()) return;
  dirtySince = null;
  enqueue(state.diagram);
}

/**
 * 自动保存：空闲 3 秒就存，连续改最多攒 30 秒，两次写库至少隔 10 秒
 * （规则本体在 saveScheduler.ts，纯函数好单测）。
 *
 * 三条额外的刹车：
 * - 冲突未解决 / 保存被禁用 / 图还没落过库 → 不存（原逻辑）；
 * - 本标签页是"跟随者"（另一个标签页在写）→ 不存，避免两边抢版本号；
 * - 视口变化不算内容变化，不单独写库（viewportPrefs 存本地）。
 */
export function useAutosave(): void {
  const diagram = useDiagramStore((s) => s.diagram);
  const saveState = useDiagramStore((s) => s.saveState);
  const booted = useDiagramStore((s) => s.booted);
  const persisted = useDiagramStore((s) => s.persisted);
  const conflict = useDiagramStore((s) => s.conflict);
  const saveDisabled = useDiagramStore((s) => s.saveDisabled);
  const writerRole = useDiagramStore((s) => s.writerRole);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!booted || conflict || saveDisabled || saveState !== 'dirty') return;

    /**
     * 还没落过库的图不自动保存。
     *
     * 否则 store 初始那张空图（或任何"换图"中间态）被标脏后就会作为一张
     * **新图**插进 arch_diagram —— 用户下次打开看到的是空白画布。
     * 新建图有两条显式路径（bootstrap 的 else 分支、图库的"新建架构图"），
     * 它们自己调 saveDiagram，不需要自动保存兜底。
     */
    if (!persisted) return;

    /**
     * 跟随者不自动保存 —— 但如果用户在**本页**真的动手改了，就说明他在这边编辑，
     * 直接把写权抢过来（另一边下一个心跳就会知道自己该退位），
     * 否则用户会以为改动存上了，其实一直被"另一个标签页在写"挡着。
     */
    if (writerRole === 'follower') {
      takeOverWriter(diagram.diagramId);
      return;
    }

    const now = Date.now();
    if (dirtySince === null) dirtySince = now;
    // 只增删了节点/连线/分组 → 结构性改动，1 秒就存；改颜色/文字/位置等到空闲 3 秒
    const key = structuralKey(diagram);
    const structural = lastStructural !== null && lastStructural !== key;
    const delay = nextDelay({ now, dirtySince, lastWriteAt, structural });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      enqueue(useDiagramStore.getState().diagram);
    }, delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [diagram, saveState, booted, persisted, conflict, saveDisabled, writerRole]);

  /**
   * 本地草稿：写库间隔变长之后，断电最坏会丢 30 秒的编辑。
   * 每 1.5 秒把当前图覆盖进 localStorage（同步、不联网），下次打开自动比对恢复。
   */
  useEffect(() => {
    if (!booted || !persisted) return;
    // 游客模式不写草稿：整张图本来就在 localStorage 里，再存一份只浪费配额
    if (isGuestMode()) return;
    const handle = setTimeout(() => saveDraft(diagram), DRAFT_MS);
    return () => clearTimeout(handle);
  }, [diagram, booted, persisted]);

  // 关页面前尽量把未存的改动刷出去
  useEffect(() => {
    const flush = (): void => {
      const state = useDiagramStore.getState();
      // 没落过库的图不刷 —— 否则关页面/刷新时会把临时图当新图插进 arch_diagram，
      // 下次打开就落在一张空白或压测图上。
      if (!state.persisted || state.saveState !== 'dirty' || state.conflict || state.saveDisabled) return;
      // 跟随者不刷：另一个标签页才是写者，刷了就是一次冲突
      if (state.writerRole === 'follower') return;
      enqueue(state.diagram);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  /**
   * 关窗口/刷新前的未保存提示（用户 2026-11-04 选择方案 b）。
   *
   * 浏览器只允许 `beforeunload` 弹**原生**确认框，文案改不了，也不等待异步保存；
   * 所以策略是：只有"脏" **且** 距上次成功写库超过 3 秒时才拦一下 ——
   * 刚改完随手按 Ctrl+S 或刚好赶上自动保存的话，不会每次都弹。
   * 判定条件本身在 unloadGuard.ts 里，有单测兜着。
   */
  useEffect(() => {
    if (!booted || !persisted) return;
    const guard = (event: BeforeUnloadEvent): void => {
      const state = useDiagramStore.getState();
      if (!shouldWarnOnUnload(state, Date.now(), lastWriteAt)) return;
      event.preventDefault();
      // 老浏览器（以及部分内嵌 WebView）只认 returnValue
      event.returnValue = '有未保存的改动';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [booted, persisted]);
}

/** 冲突时"重新载入"：丢掉本地改动，以库内为准 */
export async function reloadFromServer(): Promise<void> {
  const store = useDiagramStore.getState();
  const loaded = await loadDiagram(store.diagram.diagramId);
  store.setDiagram(loaded.diagram, { persisted: true });
}

/** 冲突时"覆盖保存"：跳过版本校验，把自己的版本压上去 */
export function forceSave(): void {
  const store = useDiagramStore.getState();
  store.setConflict(null);
  chain = chain.then(async () => {
    const current = useDiagramStore.getState();
    current.markSaving();
    const result = await saveDiagram(current.diagram, null);
    const after = useDiagramStore.getState();
    if (result.ok) {
      lastPayload = toSavePayload(current.diagram);
      after.applySaved(result.version, result.savedAt);
    }
    else {
      after.setSaveError(result.message);
      after.markDirty();
    }
  });
}

/**
 * 离开当前图（回图库 / 换成另一张图）之前，把还没落库的改动刷一次。
 *
 * 用户 2026-11-04 选"推荐"：先存再走，不要靠本地草稿兜底 ——
 * 草稿只在同一张图重新打开时才恢复，换图就等于丢掉。
 * 冲突中 / 保存不可用 / 跟随者不刷：这三种情况刷了也是错。
 */
export async function flushPendingSave(): Promise<void> {
  const state = useDiagramStore.getState();
  if (!state.persisted || state.saveState !== 'dirty') return;
  if (state.conflict || state.saveDisabled || state.writerRole === 'follower') return;
  try {
    await runSave(state.diagram);
  } catch (error) {
    // 存不进去也别拦着导航：草稿还在，下次打开这张图会提示恢复
    console.error('[arch] 离开前保存失败：', error);
  }
}





