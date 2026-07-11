import { useCallback, useEffect, useRef, useState } from 'react';
import { proctorApi, type ProctorEventKind, type ProctorEventResult } from '@/services/api';
import { captureViolationFrames } from '@/proctor/violationEvidence';

export interface FullscreenGuardState {
  /** True once the candidate has clicked the gate and the page is in fullscreen. */
  active: boolean;
  /** True whenever fullscreen has been exited and the modal should be shown. */
  exited: boolean;
  /** Last warningCount reported by the server (counts FULLSCREEN_EXIT only). */
  warningCount: number;
  /** Hard cap from the server — show "(N/3)". */
  threshold: number;
  /** Final state — server has terminated the session (3rd strike). */
  terminated: boolean;
  /** Latest server message, if any (e.g. for surfacing 4xx/5xx fallbacks). */
  error: string | null;
}

interface Options {
  sessionId: string | undefined;
  /** Called by the modal "Resume fullscreen" button. */
  onResumeRequested?: () => void;
  /** Fired exactly once when the server reports `terminated: true`. */
  onTerminated?: () => void;
  /**
   * Fires for every local page-leave event regardless of `sessionId`. The demo
   * (which has no backend session) uses this to drive a client-side strike
   * counter for fullscreen-exit / blur / tab-hide / beforeunload combined.
   */
  onLocalEvent?: (kind: ProctorEventKind, detail?: Record<string, unknown>) => void;
  /**
   * Real-exam only — capture OS-level window-switch shortcuts.
   *
   * Win+Tab / Win / Alt+Tab never reach the page as blockable keydowns on
   * their own: Windows handles them before the browser, so the only trace is
   * a `blur` — and a quick Task-View peek that returns focus inside
   * BLUR_STRIKE_DEBOUNCE_MS was never counted at all. With this flag:
   *   • `navigator.keyboard.lock()` (Chrome/Edge, fullscreen-only) reroutes
   *     Meta/Alt/Tab to the page so Win+Tab and Alt+Tab are BLOCKED outright
   *     (Task View never opens) and we can preventDefault + strike.
   *   • The keydown handler posts a TAB_SWITCH strike (1 point, backend
   *     STRIKE_WEIGHT_BY_TYPE) for any Meta press or Alt+Tab, routed through
   *     reportLeaveStrike so its cooldown absorbs the follow-up WINDOW_BLUR
   *     on browsers without Keyboard Lock (Firefox/Safari) — otherwise a
   *     single Win+Tab would burn 1 + 2 = 3 strikes and instantly terminate.
   * Left OFF for the demo, which keeps the blur/visibility-only behaviour.
   */
  keyboardLock?: boolean;
}

/**
 * §12 #10 — exam pages must run in fullscreen with tab/window leave detection.
 * This hook owns:
 *   • requesting fullscreen from a user-gesture (`enterFullscreen`)
 *   • listening to fullscreenchange / visibilitychange / blur / beforeunload
 *   • blocking F11 (best-effort — browsers swallow Esc)
 *   • POSTing the event to /cbt/sessions/:id/proctor/event
 *   • surfacing the warning count + terminated flag from the server response
 *
 * Strike weighting is now owned by the BACKEND (`STRIKE_WEIGHT_BY_TYPE` in
 * `cbt-sessions.service.ts`). The frontend posts the semantic event kind and
 * the server applies the per-type weight:
 *   • FULLSCREEN_EXIT  → 1 strike (terminates on the 3rd offence)
 *   • WINDOW_BLUR      → 2 strikes (terminates on the 2nd offence) —
 *                        covers Cmd+Tab to a non-fullscreen app and
 *                        macOS 3-finger swipe between fullscreen Spaces.
 *   • TAB_HIDDEN       → 2 strikes (same — covers minimise / in-app tab switch)
 *   • BEFORE_UNLOAD    → 2 strikes (deliberate navigation away mid-exam)
 *
 * Requires the additive Prisma enum migration to be applied first
 * (see `axis-backend/prisma/migrations/manual-add-proctor-event-types.sql`).
 * Until that ships, the new event kinds will be 400-rejected by the DTO.
 */
export function useFullscreenGuard({
  sessionId,
  onResumeRequested,
  onTerminated,
  onLocalEvent,
  keyboardLock = false,
}: Options) {
  // preflight (ExamReadinessPage)에서 이미 풀스크린에 진입한 상태로 런너가
  // 마운트되는 정상 경로에서는 document.fullscreenElement가 이미 세팅돼 있다.
  // 하드코딩으로 false 를 쓰면 fallback gate 가 매번 떠서 의미 없는 클릭을
  // 한 번 더 받게 되므로 초기값을 DOM 에서 읽어 동기화한다.
  const [state, setState] = useState<FullscreenGuardState>(() => ({
    active: typeof document !== 'undefined' && !!document.fullscreenElement,
    exited: false,
    warningCount: 0,
    threshold: 3,
    terminated: false,
    error: null,
  }));
  const terminatedRef = useRef(false);
  const inflightRef = useRef<Set<ProctorEventKind>>(new Set());
  // Suppress blur/hidden after a real fullscreenchange exit — macOS Esc/F11
  // fires both fullscreenchange AND blur within ~50 ms. Without this, a single
  // user action would burn 1 (FULLSCREEN_EXIT) + 2 (WINDOW_BLUR) = 3 strikes
  // and instantly terminate. Cooldown is on the *frontend send* side; the
  // backend just receives whatever the cooldown lets through.
  const POST_FS_EXIT_COOLDOWN_MS = 2500;
  // Throttle leave-class strikes so a single user action firing both blur AND
  // visibilitychange only counts once. Without this, Cmd+Tab fires both within
  // a few ms and the candidate would be hit with two weighted strikes (= 4
  // points) for a single leave attempt.
  const LEAVE_STRIKE_COOLDOWN_MS = 1500;
  const lastFsExitAtRef = useRef(0);
  const lastLeaveStrikeAtRef = useRef(0);
  // Window can briefly blur when Chrome surfaces its own UI (the "you are
  // sharing your screen" toolbar, permission re-prompts, the screen-share
  // picker, the Hide/Stop button on that toolbar). Focus snaps back in
  // ~50–200 ms in those cases. Real Cmd+Tab to another app keeps the page
  // blurred for seconds. We defer the WINDOW_BLUR strike by this many ms and
  // cancel it if focus returns first.
  const BLUR_STRIKE_DEBOUNCE_MS = 1000;
  const pendingBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 의도된 풀스크린 exit (예: getDisplayMedia 가 picker 다이얼로그를 띄우면서
  // 강제로 exit 시키는 경우)을 표시해두는 deadline. 이 시각 이전에 발생하는
  // fullscreenchange(false) 는 server 로 FULLSCREEN_EXIT strike 를 보내지
  // 않는다. 단 FullscreenExitModal 은 그대로 띄워서 사용자가 Resume 으로
  // 즉시 돌아갈 수 있게 한다. 호출처는 picker 가 열리기 직전에 마킹.
  const expectedExitUntilRef = useRef(0);
  const onLocalEventRef = useRef(onLocalEvent);
  useEffect(() => {
    onLocalEventRef.current = onLocalEvent;
  }, [onLocalEvent]);

  const isFullscreen = useCallback(() => !!document.fullscreenElement, []);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen() && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      setState((s) => ({ ...s, active: true, exited: false, error: null }));
    } catch (e: any) {
      setState((s) => ({ ...s, error: e?.message || 'Fullscreen request denied' }));
    }
  }, [isFullscreen]);

  const reportEvent = useCallback(
    async (type: ProctorEventKind, detail?: Record<string, unknown>) => {
      if (terminatedRef.current) return;
      // Always notify the local consumer (drives demo strike counter).
      try {
        onLocalEventRef.current?.(type, detail);
      } catch (err) {
        console.warn('[fullscreenGuard] onLocalEvent threw', err);
      }
      if (!sessionId) return;
      // De-dupe rapid duplicates (e.g. blur + visibilitychange firing together).
      if (inflightRef.current.has(type)) return;
      inflightRef.current.add(type);
      try {
        const frames = await captureViolationFrames();
        const res = await proctorApi.event(sessionId, { type, detail, ...frames });
        const data = res.data as ProctorEventResult;
        setState((s) => ({
          ...s,
          warningCount: data.warningCount,
          threshold: data.threshold,
          terminated: data.terminated,
          error: null,
        }));
        if (data.terminated && !terminatedRef.current) {
          terminatedRef.current = true;
          onTerminated?.();
        }
      } catch (e: any) {
        setState((s) => ({ ...s, error: e?.response?.data?.message || 'Failed to report event' }));
      } finally {
        inflightRef.current.delete(type);
      }
    },
    [sessionId, onTerminated],
  );

  // Reports a "leave-class" strike (blur / hidden / beforeunload). Backend
  // applies the 2-strike weight via STRIKE_WEIGHT_BY_TYPE in
  // cbt-sessions.service.ts — the frontend just posts the semantic kind once.
  // Cooldowns prevent double-fire when blur + visibilitychange land in the
  // same tick (macOS Cmd+Tab) or when fullscreenchange already sent a strike.
  const reportLeaveStrike = useCallback(
    async (
      source: Extract<ProctorEventKind, 'WINDOW_BLUR' | 'TAB_HIDDEN' | 'BEFORE_UNLOAD' | 'TAB_SWITCH'>,
      extra?: Record<string, unknown>,
    ) => {
      if (terminatedRef.current) return;
      const now = Date.now();
      // Honour expected-exit windows the same way fullscreenchange does, so
      // that getDisplayMedia picker / Chrome share-toolbar interactions don't
      // burn a 2-point WINDOW_BLUR right after we've marked them.
      if (now < expectedExitUntilRef.current) return;
      if (now - lastFsExitAtRef.current < POST_FS_EXIT_COOLDOWN_MS) return;
      if (now - lastLeaveStrikeAtRef.current < LEAVE_STRIKE_COOLDOWN_MS) return;
      lastLeaveStrikeAtRef.current = now;
      setState((s) => ({ ...s, exited: true }));
      await reportEvent(source, extra);
    },
    [reportEvent],
  );

  useEffect(() => {
    if (!state.active) return;

    const onFullscreenChange = () => {
      const inFs = isFullscreen();
      if (!inFs) {
        // Mark cooldown BEFORE the await so the blur listener that fires in
        // the same tick (macOS Esc/F11 fires both) sees it and bails out.
        lastFsExitAtRef.current = Date.now();
        const isExpected = Date.now() < expectedExitUntilRef.current;
        setState((s) => ({ ...s, exited: true }));
        if (!isExpected) {
          void reportEvent('FULLSCREEN_EXIT');
        }
      } else {
        setState((s) => ({ ...s, exited: false }));
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void reportLeaveStrike('TAB_HIDDEN');
      }
    };

    const onBlur = () => {
      // Window blur covers Cmd+Tab to a non-fullscreen app and macOS
      // 3-finger-swipe between fullscreen Spaces — neither of which trips
      // fullscreenchange. Weighted to terminate on the 2nd offence.
      //
      // Defer the strike: Chrome's screen-share toolbar (Hide/Stop button),
      // permission re-prompts, and the share-picker all blur the window for
      // ~50–200 ms and immediately return focus. We only want to count blurs
      // that actually represent the user leaving — focus stays gone past the
      // debounce window. onFocus clears the pending timer.
      if (pendingBlurTimerRef.current) {
        clearTimeout(pendingBlurTimerRef.current);
      }
      pendingBlurTimerRef.current = setTimeout(() => {
        pendingBlurTimerRef.current = null;
        void reportLeaveStrike('WINDOW_BLUR');
      }, BLUR_STRIKE_DEBOUNCE_MS);
    };

    const onFocus = () => {
      // Focus came back inside the debounce window → not a real leave.
      // Common cause: clicking Chrome's screen-share toolbar buttons.
      if (pendingBlurTimerRef.current) {
        clearTimeout(pendingBlurTimerRef.current);
        pendingBlurTimerRef.current = null;
      }
    };

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Best-effort: report and prompt. If the user clicks "Stay" the awaits
      // complete normally; if they leave, the in-flight POSTs may be cut off
      // mid-second-strike — acceptable since they're abandoning the exam.
      void reportLeaveStrike('BEFORE_UNLOAD');
      e.preventDefault();
      e.returnValue = '시험이 진행 중입니다. 정말 페이지를 떠나시겠습니까?';
      return e.returnValue;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Exam-only (keyboardLock): Win / Win+Tab / Alt+Tab are attempts to
      // reach another window. With Keyboard Lock active the keydown reaches
      // us instead of the OS, so preventDefault genuinely blocks Task View —
      // and the attempt itself is a TAB_SWITCH strike (1 point). Without lock
      // support the bare Meta keydown still fires before Windows takes over,
      // so we can't block but we still count; reportLeaveStrike's cooldown
      // then swallows the WINDOW_BLUR that follows, keeping it 1 strike total.
      if (keyboardLock && !e.repeat) {
        const metaCombo = e.key === 'Meta' || (e.metaKey && e.key === 'Tab');
        const altTab = e.altKey && e.key === 'Tab';
        if (metaCombo || altTab) {
          e.preventDefault();
          void reportLeaveStrike('TAB_SWITCH', {
            key: altTab ? 'Alt+Tab' : e.key === 'Tab' ? 'Meta+Tab' : 'Meta',
          });
          return;
        }
      }
      // Block F11 (toggles native fullscreen out from under us). Esc is
      // browser-controlled — we can't reliably preventDefault on it. KEY_BLOCKED
      // is logged for audit only — it does NOT count toward the strike counter
      // (intentionally not in STRIKE_WEIGHT_BY_TYPE on the backend).
      if (e.key === 'F11') {
        e.preventDefault();
        void reportEvent('KEY_BLOCKED', { key: 'F11' });
      } else if (e.key === 'Escape' && isFullscreen()) {
        void reportEvent('KEY_BLOCKED', { key: 'Escape' });
      }
    };

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('keydown', onKeyDown, { capture: true });

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
      if (pendingBlurTimerRef.current) {
        clearTimeout(pendingBlurTimerRef.current);
        pendingBlurTimerRef.current = null;
      }
    };
  }, [state.active, isFullscreen, reportEvent, reportLeaveStrike, keyboardLock]);

  // Keyboard Lock — Chrome/Edge desktop only, and only effective while the
  // document is fullscreen (the request persists across fullscreen re-entry,
  // so one lock() call covers Resume-after-exit too). Reroutes the listed
  // system keys to the page: Win+Tab / Alt+Tab stop opening Task View and
  // instead hit the onKeyDown handler above. Escape is deliberately NOT
  // locked — locking it changes Chrome's exit UX to press-and-hold and we
  // want the existing FULLSCREEN_EXIT strike path for Esc to stay as-is.
  // On browsers without the API this is a silent no-op and detection falls
  // back to Meta-keydown + blur.
  useEffect(() => {
    if (!state.active || !keyboardLock) return;
    const kb = (navigator as { keyboard?: { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
    if (!kb?.lock) return;
    kb.lock(['MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'Tab', 'F11']).catch(() => {
      /* unsupported / denied — fall back to detection-only */
    });
    return () => {
      try {
        kb.unlock?.();
      } catch {
        /* noop */
      }
    };
  }, [state.active, keyboardLock]);

  const resumeFullscreen = useCallback(async () => {
    onResumeRequested?.();
    await enterFullscreen();
  }, [enterFullscreen, onResumeRequested]);

  /**
   * 곧 발생할 의도된 풀스크린 exit 을 사전 마킹한다. `durationMs` 동안의
   * fullscreenchange(false) 이벤트는 server strike 로 카운트되지 않는다.
   *
   * 대표 케이스: getDisplayMedia 호출. Chrome 은 picker 다이얼로그를 띄우면서
   * 자동으로 풀스크린에서 빠져나오는데, 이를 미리 알리지 않으면 화면 공유를
   * 시도한 것만으로 FULLSCREEN_EXIT 1회 strike 가 잡혀 부정행위 카운터가
   * 올라간다.
   */
  const markExpectedExit = useCallback((durationMs = 10000) => {
    expectedExitUntilRef.current = Date.now() + durationMs;
  }, []);

  // NOTE: 풀스크린 해제는 의도적으로 lifecycle 클린업에 묶지 않는다.
  // React Strict Mode (개발 모드)가 모든 컴포넌트를 mount → unmount → mount
  // 두 번 시키는데, 클린업에서 exitFullscreen()을 호출하면 preflight 에서
  // 진입한 풀스크린이 첫 unmount 때 강제로 빠져나가 버린다. 시험을 실제로
  // 떠나는 시점(doSubmit 성공, handleTerminated, 중복탭 감지)에서
  // exitFullscreenSafely()를 명시적으로 호출하도록 호출처로 옮김.

  return {
    state,
    enterFullscreen,
    resumeFullscreen,
    markExpectedExit,
  };
}
