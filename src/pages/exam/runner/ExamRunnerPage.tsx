import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  Bolt,
  Columns2,
  Globe,
  Home,
  Loader2,
  Maximize2,
  Mic,
  Monitor,
  Moon,
  Rows2,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useI18n, LangToggle } from '@/i18n';
import { examApi, proctorApi, type CertLevel, type ExamPart } from '@/services/api';
import { EXAM, ExamPageHeader, ExamExitConfirmModal } from '@/pages/exam/shared';
import { L3PracticalListView, type L3Spec } from './L3PracticalTaskView';
import { ResultModal, ResultModalButton } from '@/components/ResultModal';
import {
  useProctorMonitorLive,
  ProctorLivePipPreview,
  type ProctorLiveState,
} from '@/proctor/useProctorMonitorLive';
import { useScreenCaptureMonitor } from '@/proctor/useScreenCaptureMonitor';
import { registerViolationCapturers, captureViolationFrames } from '@/proctor/violationEvidence';
import { useMicMonitor, type ProctorMicEvent, type MicState } from '../proctor/hooks/useMicMonitor';
import { useFullscreenGuard } from '../proctor/hooks/useFullscreenGuard';
import { useDisplayMonitor } from '../proctor/hooks/useDisplayMonitor';
import { ExternalDisplayBlocker } from '../proctor/overlays/ExternalDisplayBlocker';
import { useDuplicateTabGuard } from '../proctor/hooks/useDuplicateTabGuard';
import { useExamSessionSocket } from '../proctor/hooks/useExamSessionSocket';
import { AdminProctorBanner } from '../proctor/overlays/AdminProctorBanner';

type Question = {
  questionId: string;
  orderIndex: number;
  stem: string;
  choices: { key: string; text: string }[];
  subjectName: string;
  points: number;
  selectedChoice: string | null;
  flagged: boolean;
  version: number;
};

type Task = {
  taskId: string;
  part: ExamPart;
  title: string;
  scenario: string;
  durationMin: number;
  points: number;
  orderIndex: number;
  sampleData?: string | null;
  requiredStructure?: string | null;
  forbiddenRules?: string | null;
  aiToolAllowed?: string | null;
  // L3 실습형 answer-free structured-answer spec (never includes answerKey values).
  l3?: L3Spec | null;
  contentText?: string;
  aiChatLog?: { role: 'user' | 'assistant'; text: string; ts: number }[] | null;
  version?: number;
};

type Paper = {
  session: {
    id: string;
    certType: string;
    level: CertLevel;
    status: string;
    startedAt: string | null;
    hardDeadline: string | null;
    timing: { totalMinutes: number; writtenMinutes: number; practicalMinutes: number };
    timerPaused?: boolean;
  };
  questions: Question[];
  tasks: Task[];
};

type Stage = 'WRITTEN' | 'PRACTICAL' | 'DELIVERABLE' | 'ESSAY';

/**
 * 화면 배치 모드 — 메인 영역에 보여줄 문제 카드 수/배치를 전환한다.
 * 답안 표기란은 모드와 무관하게 항상 우측에 고정된다.
 *   split-lr: 문제 2개를 좌우로
 *   single  : 문제 1개만 (기본값)
 *   split-tb: 문제 2개를 위아래로
 */
type ExamLayout = 'split-lr' | 'single' | 'split-tb';

/** 문제 영역 확대/축소 — 툴바 우측 확대/축소 버튼이 제어. 1 = 100%. */
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.1;
/** 부동소수 누적 오차 방지용 0.1 단위 반올림. */
const roundZoom = (z: number) => Math.round(z * 10) / 10;

/**
 * 화면 테마 — 설정 팝오버의 라이트/다크 토글 상태.
 * STEP(현재): 토글 UI + 상태만. 실제 색 적용(러너 페이지 한정)은 다음 단계.
 */
type ExamTheme = 'light' | 'dark';

const BRAND_BLUE = '#2563EB';
const CERT_COLORS: Record<string, string> = { AXIS: BRAND_BLUE, AXIS_C: '#16A34A', AXIS_H: '#7C3AED' };

/**
 * Whether the in-exam AI assistant is allowed for a task — driven by the
 * `aiToolAllowed` field as delivered in the paper. 시험 표준 v2.0: the server
 * masks this to "AI 사용 불가" for every task of L1/L3 sessions (내장 AI는
 * L2 전용 — L1은 AI 전면 금지, L3는 AI 도구 없음), so the chat pane only ever
 * appears for L2. Empty/unset → disallowed. Mirrors the backend gates
 * (`isSessionAiAllowed` + `isExamAiAllowed`), which are authoritative.
 */
const AI_DISALLOWED_RE = /불가|불허|없음|금지|미허용|none|not\s*allowed|n\/?a/i;
function isAiAllowed(aiToolAllowed?: string | null): boolean {
  const v = (aiToolAllowed ?? '').trim();
  return v.length > 0 && !AI_DISALLOWED_RE.test(v);
}

/** AI proctor MED strikes threshold — reaching this count terminates the exam. */
const AI_STRIKE_THRESHOLD = 3;
/**
 * Voice/noise strikes threshold. Each sustained voice burst detected by the
 * mic monitor (RMS over baseline × multiplier for `sustainMs`) increments the
 * counter; reaching this count terminates the exam. Matches DemoPage behavior
 * so the real exam enforces the same silence rule the candidate practiced
 * against. Evidence (10s clip + still frame) is uploaded server-side per
 * strike via the existing `/voice-clip` endpoint inside useMicMonitor.
 */
const VOICE_STRIKE_THRESHOLD = 3;
/** Show the on-strike overlay for this long before auto-dismissing (ms). */
const VOICE_STRIKE_HOLD_MS = 4_000;

export default function ExamRunnerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const demoBypassAutoSubmit = Boolean(
    (location.state as { demoBypassAutoSubmit?: boolean } | null)?.demoBypassAutoSubmit,
  );
  // testMode: ExamReadinessPage 의 "테스트용 버튼"으로 시작된 흐름. 시험 화면은
  // 정상적으로 표시하되 자동 종료(handleTerminated), 중복 탭 차단, 외부 디스플레이
  // 차단을 무력화해서 테스터가 끝까지 진행할 수 있게 한다.
  const testMode = Boolean(
    (location.state as { testMode?: boolean } | null)?.testMode,
  );
  const [paper, setPaper] = useState<Paper | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [practicalText, setPracticalText] = useState<Record<string, string>>({});
  const [practicalChat, setPracticalChat] = useState<Record<string, { role: 'user' | 'assistant'; text: string; ts: number }[]>>({});
  const [practicalVersion, setPracticalVersion] = useState<Record<string, number>>({});
  const [deliverableUploaded, setDeliverableUploaded] = useState<Record<string, string | null>>({}); // taskId → uploaded file name
  const [chatInput, setChatInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [stage, setStage] = useState<Stage>('WRITTEN');
  // 화면 배치 모드 (표시 전용 상태). 메인 영역에 보이는 문제 카드 수/배치를 제어한다.
  // 기본값 single = 한 문제씩.
  const [examLayout, setExamLayout] = useState<ExamLayout>('single');
  // 화면 테마 (라이트/다크). 루트 .exam-root 의 data-theme 으로 내려가 --exam-* 변수를 스왑.
  const [examTheme, setExamTheme] = useState<ExamTheme>('light');
  // 테마 전환 순간(이 프레임)만 모든 transition 을 꺼서, 풀스크린 DOM 수백 노드가
  // 동시에 color 트랜지션을 도는 페인트 폭풍(버벅임)을 막는다. 색은 한 번에 즉시 스왑되고,
  // 다음 프레임에 트랜지션을 복구하므로 hover 등 일반 트랜지션은 그대로 유지된다.
  const [themeSwitching, setThemeSwitching] = useState(false);
  const handleThemeChange = useCallback((next: ExamTheme) => {
    // 라이브 DOM 의 색은 항상 즉시(트랜지션 정지) 스왑한다 — 풀스크린 수백 노드가
    // 동시에 color 트랜지션을 도는 페인트 폭풍을 막기 위함.
    const commit = () => {
      setThemeSwitching(true);
      setExamTheme(next);
    };
    // View Transitions 지원 시: 전환 직전 화면을 스냅샷 떠 GPU 합성으로 크로스페이드한다.
    // 페이드는 ::view-transition-old/new 레이어가 담당하므로 DOM 크기와 무관하게 가볍고,
    // 라이브 색 스왑은 위처럼 즉시 일어난다(이중 애니메이션 없음).
    const startVT = (document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<unknown> };
    }).startViewTransition?.bind(document);
    if (!startVT) {
      // 미지원 브라우저: 기존처럼 즉시 전환(페이드 없음).
      commit();
      requestAnimationFrame(() => requestAnimationFrame(() => setThemeSwitching(false)));
      return;
    }
    // flushSync 로 상태 변경을 동기 커밋해야 스냅샷이 새 테마를 정확히 캡처한다.
    startVT(() => flushSync(commit)).finished.finally(() => setThemeSwitching(false));
  }, []);
  // 문제 영역 확대/축소 배율 (1 = 100%). 툴바 우측 +/- 버튼이 0.1 단위로 조절.
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(() => setZoom((z) => roundZoom(Math.min(ZOOM_MAX, z + ZOOM_STEP))), []);
  const zoomOut = useCallback(() => setZoom((z) => roundZoom(Math.max(ZOOM_MIN, z - ZOOM_STEP))), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 동의는 ProctorPage 의 STEP 6 (CONSENT) 에서 받고 examApi.consent +
  // examApi.start 까지 거기서 호출한다. 여기 도달했을 땐 세션이 이미
  // IN_PROGRESS 상태이므로 fetchPaper 가 그냥 paper 를 반환 → 별도 동의
  // 게이트 불필요. 만약 어떤 이유로 consent 가 빠진 채 진입했다면 (URL
  // 직접 진입 등) paper API 가 거부하고 setError 가 친절한 메시지를 띄움.
  const [aiStrikes, setAiStrikes] = useState(0);
  const [aiBanner, setAiBanner] = useState<{
    severity: 'LOW' | 'MED' | 'HIGH';
    captionKo: string | null;
    captionEn: string | null;
  } | null>(null);
  // Voice/noise strike state. `voiceStrikes` is the running count; the modal
  // shows whenever `voiceHoldUntil` is in the future. Reaching the threshold
  // calls `handleTerminated` synchronously inside the strike handler.
  const [voiceStrikes, setVoiceStrikes] = useState(0);
  const [voiceHoldUntil, setVoiceHoldUntil] = useState(0);
  const [demoDisplayBypassed] = useState(false);
  const saveTimers = useRef<Record<string, number>>({});
  const [proctorStream, setProctorStream] = useState<MediaStream | null>(null);
  const [adminWarning, setAdminWarning] = useState<string | null>(null);
  const [adminTimerPaused, setAdminTimerPaused] = useState(false);
  const [adminPauseReason, setAdminPauseReason] = useState('');
  const pauseAnchorRef = useRef<{ at: number; remainingMs: number } | null>(null);
  const [timeExtendedToast, setTimeExtendedToast] = useState<string | null>(null);
  // Pre-share environment alerts — shown BEFORE the screen-share gate so the
  // strike counter never runs while the candidate is still settling in. The
  // candidate must confirm both that the phone is silenced and that the room
  // is quiet before they ever click the screen-share button.
  const [preShareAcknowledged, setPreShareAcknowledged] = useState(false);
  const [preShareSilenced, setPreShareSilenced] = useState(false);
  const [preShareQuiet, setPreShareQuiet] = useState(false);
  const paperRef = useRef<Paper | null>(null);
  const paperFetchIdRef = useRef(0);

  const patchHardDeadline = useCallback((hardDeadline: string | null) => {
    setPaper((prev) =>
      prev
        ? { ...prev, session: { ...prev.session, hardDeadline } }
        : prev,
    );
  }, []);

  const handleTerminated = useCallback(() => {
    if (testMode) {
      // 테스트 모드에서는 mic/AI/fullscreen 위반에 의한 자동 종료를 무시한다.
      // eslint-disable-next-line no-console
      console.info('[exam] termination suppressed (testMode)');
      return;
    }
    exitFullscreenSafely();
    navigate(`/cbt/exam/${sessionId}/result`, { replace: true, state: { terminated: true } });
  }, [navigate, sessionId, testMode]);

  useExamSessionSocket(sessionId, !!sessionId && !testMode, {
    onWarning: (p) => setAdminWarning(p.message),
    onForceTerminate: () => handleTerminated(),
    onTimerPaused: (p) => {
      setAdminTimerPaused(true);
      setAdminPauseReason(p.reason);
      const pape = paperRef.current;
      pauseAnchorRef.current = {
        at: Date.now(),
        remainingMs: pape?.session.hardDeadline
          ? new Date(pape.session.hardDeadline).getTime() - Date.now()
          : 0,
      };
    },
    onTimerResumed: (p) => {
      setAdminTimerPaused(false);
      setAdminPauseReason('');
      pauseAnchorRef.current = null;
      patchHardDeadline(p.hardDeadline);
    },
    onTimeExtended: (p) => {
      patchHardDeadline(p.hardDeadline);
      const mins = Math.round(p.seconds / 60);
      setTimeExtendedToast(t('exam.timeExtended' as never, { minutes: mins }));
      window.setTimeout(() => setTimeExtendedToast(null), 5_000);
    },
  });

  // Mic monitor strike handler. Each fired ProctorMicEvent is a sustained
  // voice burst (already debounced by the analyser inside useMicMonitor).
  // We surface the strike via the on-strike overlay and the MicBanner badge,
  // then terminate the exam on the threshold strike. The voice clip itself
  // is uploaded server-side from inside useMicMonitor — we only handle the
  // client-visible enforcement here.
  const handleMicEvent = useCallback(
    (e: ProctorMicEvent) => {
      // 테스트 모드: 마이크 위반(연결끊김/음성스트라이크) 자체를 기록하지 않는다.
      // → VoiceStrikeModal 도 뜨지 않고 server POST 도 발생하지 않음.
      if (testMode) return;
      // Hard violation: candidate's mic has been unplugged or stopped
      // delivering audio for >5s. There is no legitimate reason for a mic to
      // disappear mid-exam (it's an Article 28 setup requirement), so this
      // bypasses the normal strike accumulation and terminates immediately.
      // We fire-and-forget the server termination — the result page renders
      // a TERMINATED state regardless of whether the round-trip succeeds, so
      // a flaky network on the way down can't keep an honest candidate stuck.
      if (e.type === 'MIC_DISCONNECTED') {
        // eslint-disable-next-line no-console
        console.warn('[exam] mic disconnected — terminating', {
          reason: e.reason,
          durationMs: e.durationMs,
          ts: e.ts,
        });
        if (sessionId) {
          void proctorApi
            .micDisconnected(sessionId, {
              reason: e.reason ?? 'ENDED',
              detail: { durationMs: e.durationMs, baselineRms: e.baselineRms },
            })
            .catch(() => {
              // Network error or already-terminated server-side — UI still
              // navigates to the result page below.
            });
        }
        handleTerminated();
        return;
      }
      // Helpful breadcrumb for diagnosing "I read aloud and nothing happened":
      // if you see this log in DevTools, the detector is firing and the only
      // remaining question is whether the UI/handler ran. If you DON'T see
      // this while reading aloud, the rms vs. trig values shown live in the
      // green MicBanner strip will tell you whether the signal is reaching
      // the trigger threshold at all.
      // eslint-disable-next-line no-console
      console.info(
        '[exam] voice strike fired',
        {
          rms: e.rms,
          baselineRms: e.baselineRms,
          durationMs: e.durationMs,
          ts: e.ts,
        },
      );
      setVoiceHoldUntil(Date.now() + VOICE_STRIKE_HOLD_MS);
      setVoiceStrikes((n) => {
        const next = n + 1;
        if (next >= VOICE_STRIKE_THRESHOLD) {
          // Tell the server to flip the session row from IN_PROGRESS to
          // TERMINATED. Without this call the client-side navigation below
          // would leave the DB stuck on IN_PROGRESS forever even though the
          // candidate has been kicked out — the bug was that voice strikes
          // were tracked entirely client-side. We fire-and-forget because the
          // result page renders a TERMINATED state regardless of whether the
          // round-trip succeeds, so a flaky network on the way down can't
          // keep an honest candidate stuck on a frozen exam screen.
          if (sessionId) {
            void proctorApi
              .voiceStrikeThreshold(sessionId, {
                strikes: next,
                detail: {
                  rms: e.rms,
                  baselineRms: e.baselineRms,
                  durationMs: e.durationMs,
                  ts: e.ts,
                  threshold: VOICE_STRIKE_THRESHOLD,
                },
              })
              .catch(() => {
                // Network error or already-terminated server-side — UI still
                // navigates to the result page below.
              });
          }
          handleTerminated();
        }
        return next;
      });
    },
    [handleTerminated, sessionId, testMode],
  );

  // Declared BEFORE the proctor hook so its `getLatestFrame` getter can be
  // bundled into every AI-review tick. The screen capture itself only starts
  // once the candidate clicks through the consent gate (user gesture
  // requirement of getDisplayMedia).
  const screenShare = useScreenCaptureMonitor({
    enabled: !!sessionId,
    sessionId,
  });

  const proctor = useProctorMonitorLive({
    enabled: !!sessionId,
    sessionId,
    serverConfirmMs: 30_000,
    /** Gemini tier-1 screen every 3s (was 10s) — faster phone/book/object detection. */
    aiReviewMs: 3_000,
    onAiVerdict: (severity, detail) => {
      // 테스트 모드: AI 감독 배너/스트라이크/종료 모두 무시.
      if (testMode) return;
      // LOW = log only (no strike), MED = +1 strike + banner, HIGH = terminate.
      setAiBanner({
        severity,
        captionKo: detail.captionKo,
        captionEn: detail.captionEn,
      });
      window.setTimeout(() => setAiBanner((b) => (b?.severity === severity ? null : b)), 8_000);
      if (severity === 'MED') {
        setAiStrikes((s) => {
          const newCount = s + 1;
          if (newCount >= AI_STRIKE_THRESHOLD) {
            handleTerminated();
          }
          return newCount;
        });
      } else if (severity === 'HIGH') {
        handleTerminated();
      }
    },
    onTerminated: handleTerminated,
    getLatestScreenFrame: screenShare.getLatestFrame,
    captureScreenEvidence: screenShare.captureEvidenceFrame,
  });
  const mic = useMicMonitor({
    enabled: !!sessionId,
    sessionId,
    videoStream: proctorStream,
    onEvent: handleMicEvent,
  });

  // Register capture-on-violation sources so every proctor event reporter
  // (fullscreen guard, display monitor, AI monitor, mic, duplicate-tab guard)
  // can attach the webcam + screen frame captured at the exact moment of the
  // offence — independent of whether an admin is live-monitoring.
  useEffect(() => {
    registerViolationCapturers({
      webcam: () => proctor.captureFrameBase64(),
      screen: async () => (await screenShare.captureEvidenceFrame())?.b64 ?? null,
    });
    return () => registerViolationCapturers({ webcam: null, screen: null });
  }, [proctor, screenShare]);

  // Share the proctor camera MediaStream with the mic monitor — never open
  // getUserMedia({video}) twice. The hook returns a stream getter; we poll it
  // briefly until the camera is up, then setProctorStream once.
  useEffect(() => {
    if (!sessionId) return;
    let id: number | null = window.setInterval(() => {
      const s = proctor.getMediaStream();
      if (s && s.getVideoTracks().length > 0) {
        setProctorStream(s);
        if (id != null) window.clearInterval(id);
        id = null;
      }
    }, 250);
    return () => {
      if (id != null) window.clearInterval(id);
    };
  }, [sessionId, proctor]);

  const fullscreen = useFullscreenGuard({
    sessionId,
    onTerminated: handleTerminated,
    testMode,
    // 실전 시험 전용 — Win+Tab/Alt+Tab 을 Keyboard Lock 으로 차단하고
    // 시도 자체를 TAB_SWITCH strike 로 카운트한다. 데모는 기존 동작 유지.
    keyboardLock: true,
  });

  // Screen share is requested earlier (from the consent button) so the
  // candidate has already granted/denied it by the time we reach the
  // fullscreen gate. If the share was denied, the exam header still shows
  // the "Resume screen share" affordance for recovery — but if it's already
  // ACTIVE, we deliberately do NOT re-prompt here (browsers would surface a
  // duplicate picker which is confusing and a usability anti-pattern).
  const handleEnterFullscreenAndShare = useCallback(() => {
    if (screenShare.state.status !== 'ACTIVE') {
      // 같은 사유로 (Chrome picker + 공유 툴바 노출) 15초 흡수.
      fullscreen.markExpectedExit(15_000);
      void screenShare.start();
    }
    void fullscreen.enterFullscreen();
  }, [fullscreen, screenShare]);

  // Chrome 의 "화면 공유 중" 툴바가 처음 그려질 때 추가로 한 번 blur/focus 가
  // 튄다. 또한 사용자가 그 툴바의 "숨기기" 버튼을 누르면 같은 패턴이 다시 발생.
  // 공유 status 가 ACTIVE 로 바뀌는 매 순간 짧은 흡수 창을 다시 깔아 첫 번째
  // 시나리오를 처리하고, 평소의 blur debounce 로 "숨기기" 클릭을 처리한다.
  useEffect(() => {
    if (screenShare.state.status === 'ACTIVE') {
      fullscreen.markExpectedExit(3_000);
    }
  }, [screenShare.state.status, fullscreen]);
  const display = useDisplayMonitor({
    enabled: !!sessionId,
    sessionId,
    intervalMs: 5_000,
  });
  const displayState = (demoDisplayBypassed || testMode)
    ? { ...display.state, blocked: false }
    : display.state;

  // Single-tab lock — detect if this exam is open in another tab and
  // terminate this one immediately to prevent side-by-side cheating.
  useDuplicateTabGuard({
    enabled: !!sessionId && !testMode,
    channel: `exam-session-${sessionId ?? ''}`,
    onDuplicateDetected: () => {
      if (sessionId) {
        // Persist the audit row before navigating away. Strike-counter
        // increment is moot — the candidate is being terminated regardless.
        void captureViolationFrames().then((frames) =>
          proctorApi
            .event(sessionId, {
              type: 'TAB_HIDDEN',
              detail: { reason: 'duplicate_tab_detected' },
              ...frames,
            })
            .catch(() => {}),
        );
      }
      exitFullscreenSafely();
      navigate(`/cbt/exam/${sessionId}/result`, {
        replace: true,
        state: { terminated: true, reason: 'duplicate_tab' },
      });
    },
  });

  const fetchPaper = useCallback(async () => {
    if (!sessionId) return;
    const fetchId = ++paperFetchIdRef.current;
    setPaper(null);
    paperRef.current = null;
    try {
      const res = await examApi.paper(sessionId);
      if (fetchId !== paperFetchIdRef.current) return;
      const p: Paper = res.data;
      if (p.session.id !== sessionId) return;
      setPaper(p);
      paperRef.current = p;
      setAdminTimerPaused(Boolean(p.session.timerPaused));
      setQuestions(p.questions);
      const txt: Record<string, string> = {};
      const ver: Record<string, number> = {};
      const chat: Record<string, { role: 'user' | 'assistant'; text: string; ts: number }[]> = {};
      for (const t of p.tasks) {
        // Hydrate any saved practical work so a reload restores the candidate's
        // answer + the server's optimistic-concurrency version (parity with MCQ).
        txt[t.taskId] = t.contentText ?? '';
        ver[t.taskId] = t.version ?? 0;
        if (t.aiChatLog && t.aiChatLog.length) chat[t.taskId] = t.aiChatLog;
      }
      setPracticalText(txt);
      setPracticalVersion(ver);
      setPracticalChat(chat);
    } catch (e) {
      if (fetchId !== paperFetchIdRef.current) return;
      const err = e as { response?: { data?: { message?: string }; status?: number } };
      const msg = err.response?.data?.message ?? '';
      // 동의 / 시작 이 누락된 경우 — 정상 흐름이라면 ProctorPage STEP 6 에서
      // 둘 다 끝났을 것이므로 여기 도달한다는 건 URL 직접 진입 등의 예외
      // 케이스. 처음부터 다시 진행하라고 안내한다.
      if (
        err.response?.status === 400 ||
        msg.includes('동의') ||
        msg.includes('consent') ||
        msg.includes('not started') ||
        msg.includes('본인확인') ||
        msg.includes('신원 확인')
      ) {
        setError(
          msg.includes('본인확인') || msg.includes('신원 확인')
            ? msg
            : '동의 또는 시험 시작 처리가 되어 있지 않습니다. 마이페이지에서 다시 본인인증부터 진행해 주세요.',
        );
      } else {
        setError(msg || 'Failed to load exam');
      }
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchPaper();
  }, [fetchPaper]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const remainingMs = useMemo(() => {
    if (!paper?.session.hardDeadline) return 0;
    if (adminTimerPaused && pauseAnchorRef.current) {
      return Math.max(0, pauseAnchorRef.current.remainingMs);
    }
    return new Date(paper.session.hardDeadline).getTime() - now;
  }, [paper?.session.hardDeadline, adminTimerPaused, now]);
  const remaining = formatRemaining(remainingMs);
  // 헤더 우측 첫 줄에 표시할 시험 제한시간(고정). 세션 timing 의 총 시간을 그대로 포맷.
  const limitTime = paper ? formatRemaining(paper.session.timing.totalMinutes * 60_000) : '';
  const color = paper ? CERT_COLORS[paper.session.certType] || BRAND_BLUE : BRAND_BLUE;
  // 헤더 우측 남은시간 색: 5분 미만 빨강, 10분 미만 amber, 그 외 흰색(파랑 배경 위 기본).
  const timerColor =
    remainingMs < 5 * 60_000 ? '#FFDE65' : remainingMs < 10 * 60_000 ? '#FCD34D' : undefined;
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [showBackBlockedModal, setShowBackBlockedModal] = useState(false);

  useEffect(() => {
    const SENTINEL_KEY = '__examRunnerBackGuard';
    const hasSentinel = () =>
      !!(window.history.state && (window.history.state as Record<string, unknown>)[SENTINEL_KEY]);

    if (!hasSentinel()) {
      window.history.pushState({ [SENTINEL_KEY]: true }, '', window.location.href);
    }

    const onPopState = () => {
      // If we are still on sentinel entry, this is not an actual leave attempt.
      if (hasSentinel()) return;
      // Browser back can fire blur/fullscreen-change signals; mark this as an
      // expected transition so proctor leave-strike logic does not terminate.
      fullscreen.markExpectedExit(1500);
      // Restore the sentinel entry so route/location stays on the exam page.
      window.history.pushState({ [SENTINEL_KEY]: true }, '', window.location.href);
      setShowBackBlockedModal(true);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [fullscreen.markExpectedExit]);

  // Auto-submit on time-over
  useEffect(() => {
    if (demoDisplayBypassed || demoBypassAutoSubmit || testMode || adminTimerPaused) return;
    if (paper && remainingMs <= 0 && !submitting && stage !== 'WRITTEN') {
      doSubmit();
    } else if (paper && remainingMs <= 0 && !submitting && paper.session.level === 'L3') {
      doSubmit();
    }
  }, [remainingMs, paper, submitting, stage, demoDisplayBypassed, demoBypassAutoSubmit, testMode, adminTimerPaused]);

  const writtenQs = questions;
  const tasks = paper?.tasks ?? [];
  const practicalTasks = tasks.filter((t) => t.part === 'PRACTICAL');
  const deliverableTask = tasks.find((t) => t.part === 'DELIVERABLE');
  const essayTasks = tasks.filter((t) => t.part === 'ESSAY');
  const stageSequence = useMemo<Stage[]>(() => {
    if (!paper) return ['WRITTEN'];
    // L3: MCQ only on the legacy path; when the frozen paper includes 실습형
    // tasks (L3_PRACTICALS_ENABLED at start) add the structured practical stage.
    if (paper.session.level === 'L3') {
      return practicalTasks.length > 0 ? ['WRITTEN', 'PRACTICAL'] : ['WRITTEN'];
    }
    if (paper.session.level === 'L2') return ['WRITTEN', 'PRACTICAL'];
    // L1: Part A (written) → Part B (exec-plan deliverable) → Part C (essays).
    const seq: Stage[] = ['WRITTEN'];
    if (deliverableTask) seq.push('DELIVERABLE');
    if (essayTasks.length > 0) seq.push('ESSAY');
    return seq;
  }, [paper, practicalTasks.length, essayTasks.length, deliverableTask]);
  const currentStageIndex = Math.max(0, stageSequence.indexOf(stage));
  /**
   * Stage navigation — freely bidirectional (Written ↔ Practical ↔ Essay /
   * Deliverable). Candidates can revisit any section during the exam; the
   * server-side per-task auto-save (questions + practical/essay text + AI
   * chat) preserves work across switches. The hard time cap is still
   * enforced by the global timer, not by stage order.
   */
  const safeSetStage = (target: Stage) => {
    const targetIndex = stageSequence.indexOf(target);
    if (targetIndex === -1) return;
    // Flush any pending saves for the stage we're leaving so a quick tab
    // switch never loses the most recent keystroke. updatePractical /
    // updateAnswer debounce to ~400–600ms; we force-fire here.
    const pending = Object.entries(saveTimers.current);
    if (pending.length > 0) {
      for (const [taskId, timerId] of pending) {
        window.clearTimeout(timerId);
        delete saveTimers.current[taskId];
        // Only flush practical/essay tasks (their saver writes contentText +
        // chat); MCQ saves are handled inline in updateAnswer and re-fire
        // safely on their own debounce timer.
        const t = tasks.find((x) => x.taskId === taskId);
        if (t && (t.part === 'PRACTICAL' || t.part === 'ESSAY' || t.part === 'DELIVERABLE')) {
          void savePracticalNow(taskId, practicalText[taskId] ?? '', practicalChat[taskId] ?? []);
        }
      }
    }
    setStage(target);
  };

  const unansweredCount = useMemo(() => writtenQs.filter((q) => !q.selectedChoice).length, [writtenQs]);

  const updateAnswer = (q: Question, choiceKey: string | null, flagged?: boolean) => {
    setQuestions((prev) => prev.map((x) => (x.questionId === q.questionId ? { ...x, selectedChoice: choiceKey, flagged: flagged ?? x.flagged } : x)));
    if (saveTimers.current[q.questionId]) window.clearTimeout(saveTimers.current[q.questionId]);
    saveTimers.current[q.questionId] = window.setTimeout(() => {
      examApi
        .saveAnswer(sessionId!, {
          questionId: q.questionId,
          selectedChoice: choiceKey,
          flagged: flagged ?? q.flagged,
          version: q.version,
        })
        .then((res) => {
          setQuestions((prev) => prev.map((x) => (x.questionId === q.questionId ? { ...x, version: res.data.version } : x)));
        })
        .catch(() => {});
    }, 400);
  };

  const savePracticalNow = async (taskId: string, contentText: string, chat: { role: 'user' | 'assistant'; text: string; ts: number }[]) => {
    try {
      const res = await examApi.savePractical(sessionId!, {
        taskId,
        contentText,
        aiChatLog: chat,
        version: practicalVersion[taskId] ?? 0,
      });
      setPracticalVersion((v) => ({ ...v, [taskId]: res.data.version }));
    } catch {
      // swallow — auto-save will retry
    }
  };

  const updatePractical = (taskId: string, text: string) => {
    setPracticalText((t) => ({ ...t, [taskId]: text }));
    if (saveTimers.current[taskId]) window.clearTimeout(saveTimers.current[taskId]);
    saveTimers.current[taskId] = window.setTimeout(() => {
      savePracticalNow(taskId, text, practicalChat[taskId] ?? []);
    }, 600);
  };

  const sendChat = async (taskId: string) => {
    if (!chatInput.trim() || aiBusy || !sessionId) return;
    // Defense in depth: AI is only usable where the task allows it (the server
    // enforces this too). Essays ("AI 사용 불가") never reach a chat pane.
    const chatTask = tasks.find((t) => t.taskId === taskId);
    if (!isAiAllowed(chatTask?.aiToolAllowed)) return;
    const prompt = chatInput.trim();
    const priorChat = practicalChat[taskId] ?? [];
    const userMsg = { role: 'user' as const, text: prompt, ts: Date.now() };
    const withUser = [...priorChat, userMsg];
    setPracticalChat((c) => ({ ...c, [taskId]: withUser }));
    setChatInput('');
    setAiBusy(true);
    try {
      const res = await examApi.askPracticalAi(sessionId, {
        taskId,
        prompt,
        history: priorChat.map((m) => ({ role: m.role, text: m.text })),
      });
      const reply = res.data?.text?.trim()
        ? res.data.text
        : 'AI 어시스턴트가 일시적으로 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.';
      const aiMsg = { role: 'assistant' as const, text: reply, ts: Date.now() };
      const newChat = [...withUser, aiMsg];
      setPracticalChat((c) => ({ ...c, [taskId]: newChat }));
      void savePracticalNow(taskId, practicalText[taskId] ?? '', newChat);
    } catch {
      const aiMsg = {
        role: 'assistant' as const,
        text: 'AI 어시스턴트 호출에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.',
        ts: Date.now(),
      };
      const newChat = [...withUser, aiMsg];
      setPracticalChat((c) => ({ ...c, [taskId]: newChat }));
      void savePracticalNow(taskId, practicalText[taskId] ?? '', newChat);
    } finally {
      setAiBusy(false);
    }
  };

  const doSubmit = async () => {
    if (!sessionId || submitting) return;
    setSubmitting(true);
    try {
      // Flush any pending saves
      for (const t of tasks) {
        await savePracticalNow(t.taskId, practicalText[t.taskId] ?? '', practicalChat[t.taskId] ?? []);
      }
      await examApi.submit(sessionId);
      exitFullscreenSafely();
      // replace: true — drop the runner from history so browser-back from the
      // result page cannot re-enter an already-submitted exam.
      navigate(`/cbt/exam/${sessionId}/result`, { replace: true });
    } catch (e: any) {
      // 401 here means the access token expired AND the refresh token is also
      // invalid (silent refresh in api.ts already failed). The candidate must
      // log back in — but we keep the answers safe (auto-save covers them) and
      // surface an actionable message instead of a bare "Unauthorized".
      const status = e?.response?.status;
      const serverMsg = e?.response?.data?.message;
      let msg: string;
      if (status === 401) {
        msg = t('runner.error.expired');
      } else if (status === 400 && typeof serverMsg === 'string' && serverMsg.toLowerCase().includes('deadline')) {
        // Treat deadline-expired as auto-finalized on the server side and route
        // the candidate to the result page instead of leaving them stuck here.
        exitFullscreenSafely();
        navigate(`/cbt/exam/${sessionId}/result`, { replace: true });
        return;
      } else {
        msg = serverMsg || 'Submit failed. Please try again.';
      }
      setError(msg);
      setSubmitting(false);
    }
  };

  const handleExitHome = useCallback(() => {
    setConfirmExitOpen(false);
    exitFullscreenSafely();
    navigate('/', { replace: true });
  }, [navigate]);

  // Auto-save every 30 seconds to satisfy exam durability requirements.
  useEffect(() => {
    if (!sessionId || !paper) return;
    const id = window.setInterval(() => {
      void (async () => {
        const activePractical = tasks[0];
        if (activePractical) {
          await savePracticalNow(
            activePractical.taskId,
            practicalText[activePractical.taskId] ?? '',
            practicalChat[activePractical.taskId] ?? [],
          );
        }
        const firstUnsent = writtenQs.find((q) => q.selectedChoice != null);
        if (firstUnsent) {
          await examApi.saveAnswer(sessionId, {
            questionId: firstUnsent.questionId,
            selectedChoice: firstUnsent.selectedChoice,
            flagged: firstUnsent.flagged,
            version: firstUnsent.version,
          }).catch(() => {});
        }
      })();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [sessionId, paper, tasks, practicalText, practicalChat, writtenQs]);

  /* ───────────────────────── Early returns ───────────────────────── */

  if (error)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className={`max-w-md w-full ${EXAM.surface.dangerBox} p-8 text-center`}>
          <div className="mx-auto w-12 h-12 rounded-full bg-[#FECACA] flex items-center justify-center mb-4">
            <AlertTriangle className={`w-6 h-6 ${EXAM.color.danger}`} />
          </div>
          <p className={`${EXAM.text.body} ${EXAM.color.danger} leading-relaxed`}>{error}</p>
        </div>
      </div>
    );

  // 동의 게이트는 삭제됨. ProctorPage STEP 6 (CONSENT) 에서 examApi.consent
  // + examApi.start 까지 끝낸 상태로 도달하므로 fetchPaper 가 곧장 성공한다.
  // 만약 누락된 채 진입했다면 fetchPaper 의 catch 가 error 상태를 띄움.

  if (!paper)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={`w-8 h-8 animate-spin ${EXAM.color.brand}`} />
          <span className={`${EXAM.text.helper} ${EXAM.color.muted}`}>Loading exam…</span>
        </div>
      </div>
    );

  /* ───── 환경 점검 게이트 (silence phone / quiet place) ─────
     이 게이트는 풀스크린/화면공유 게이트보다 먼저 나와야 한다.
     useFullscreenGuard 의 strike 리스너들은 fullscreen.state.active 가 true
     로 바뀌는 순간 attach 된다 — 즉 풀스크린 진입 후부터 blur/visibility/
     beforeunload 가 카운트되기 시작한다. 응시자가 안내문을 읽는 동안
     휴대폰을 만지거나 알림이 오면 그 사이에 1회 strike 가 잡혀 버린다.
     그래서 풀스크린 진입 *전* 에 이 게이트로 무음·환경 확인을 먼저 받아
     부정행위 카운트가 절대 백그라운드에서 굴러가지 않게 한다. */
  if (!preShareAcknowledged) {
    const canContinue = preShareSilenced && preShareQuiet;
    return (
      <>
        <ExternalDisplayBlocker
          state={displayState}
          onRecheck={display.recheck}
          onRequestPermission={display.requestPermission}
        />
        <div className="h-screen w-screen bg-[#F8FAFC] flex flex-col overflow-hidden">
          <ExamPageHeader title="시험 환경 점검" hideClock />

          <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden">
            <div className={`w-full ${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} h-full flex items-center`}>
              <section className="w-full h-full flex flex-col justify-center relative">
                <div className="absolute top-0 right-0 z-10">
                  <LangToggle />
                </div>

                <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} text-center max-w-[clamp(480px,40vw,820px)] mx-auto w-full`}>
                  <div className="mx-auto w-[clamp(56px,4.5vw,96px)] h-[clamp(56px,4.5vw,96px)] rounded-full bg-[#FFFBEB] flex items-center justify-center mb-[clamp(12px,1vw,24px)]">
                    <AlertTriangle className={`w-[clamp(26px,2.2vw,44px)] h-[clamp(26px,2.2vw,44px)] ${EXAM.color.warning}`} />
                  </div>
                  <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mb-[clamp(8px,0.7vw,16px)]`}>
                    시험을 시작하기 전 확인해 주세요
                  </h2>
                  <p className={`${EXAM.text.body} ${EXAM.color.body} mb-[clamp(8px,0.7vw,16px)] leading-relaxed`}>
                    아래 항목을 모두 확인하셔야 다음 단계 (화면 공유) 로 넘어갈 수 있습니다.
                    <br />
                    체크가 완료되기 전까지 부정행위 카운트는 시작되지 않습니다.
                  </p>
                  <p className={`${EXAM.text.body} ${EXAM.color.danger} font-semibold mb-[clamp(20px,1.6vw,40px)] leading-relaxed`}>
                    한 번 시작하면 시험 도중 휴대폰 사용·소음은 부정행위로 처리될 수 있습니다.
                  </p>

                  <div className="flex flex-col gap-[clamp(12px,1vw,20px)] text-left mb-[clamp(20px,1.6vw,40px)]">
                    <label className={`flex items-start gap-3 px-4 py-3 rounded-md border ${preShareSilenced ? 'border-[#3B82F6] bg-[#EFF6FF]' : 'border-[#E5E7EB] bg-white'} cursor-pointer`}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[#3B82F6]"
                        checked={preShareSilenced}
                        onChange={(e) => setPreShareSilenced(e.target.checked)}
                      />
                      <span className={`${EXAM.text.body} ${EXAM.color.ink}`}>
                        휴대폰을 <strong>무음 모드</strong> 로 설정했으며, 시험 중 알림이 울리지 않도록 조치했습니다.
                      </span>
                    </label>
                    <label className={`flex items-start gap-3 px-4 py-3 rounded-md border ${preShareQuiet ? 'border-[#3B82F6] bg-[#EFF6FF]' : 'border-[#E5E7EB] bg-white'} cursor-pointer`}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-[#3B82F6]"
                        checked={preShareQuiet}
                        onChange={(e) => setPreShareQuiet(e.target.checked)}
                      />
                      <span className={`${EXAM.text.body} ${EXAM.color.ink}`}>
                        주변에 다른 사람이 없는 <strong>조용한 장소</strong> 에서 혼자 시험에 응시합니다.
                      </span>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPreShareAcknowledged(true)}
                    disabled={!canContinue}
                    className={`${EXAM.button.primaryLg} ${EXAM.text.buttonLg} disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    확인하고 계속
                  </button>
                </div>
              </section>
            </div>
          </main>
        </div>
      </>
    );
  }

  if (!fullscreen.state.active) {
    return (
      <>
        <ExternalDisplayBlocker
          state={displayState}
          onRecheck={display.recheck}
          onRequestPermission={display.requestPermission}
        />
        <div className="h-screen w-screen bg-[#F8FAFC] flex flex-col overflow-hidden">
          <ExamPageHeader title={t('fsgate.title')} hideClock />

          <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden">
            <div className={`w-full ${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} h-full flex items-center`}>
              <section className="w-full h-full flex flex-col justify-center relative">
                <div className="absolute top-0 right-0 z-10">
                  <LangToggle />
                </div>

                <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} text-center max-w-[clamp(480px,40vw,820px)] mx-auto w-full`}>
                  <div className="mx-auto w-[clamp(56px,4.5vw,96px)] h-[clamp(56px,4.5vw,96px)] rounded-full bg-[#EFF6FF] flex items-center justify-center mb-[clamp(12px,1vw,24px)]">
                    <Maximize2 className={`w-[clamp(26px,2.2vw,44px)] h-[clamp(26px,2.2vw,44px)] ${EXAM.color.brand}`} />
                  </div>
                  <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mb-[clamp(8px,0.7vw,16px)]`}>
                    {t('fsgate.title')}
                  </h2>
                  <p className={`${EXAM.text.body} ${EXAM.color.body} mb-[clamp(8px,0.7vw,16px)] leading-relaxed`}>
                    {t('fsgate.body')}
                  </p>
                  <p className={`${EXAM.text.body} ${EXAM.color.danger} font-semibold mb-[clamp(20px,1.6vw,40px)] leading-relaxed`}>
                    {t('fsgate.body2')}
                  </p>

                  <button
                    type="button"
                    onClick={handleEnterFullscreenAndShare}
                    disabled={displayState.blocked}
                    className={`${EXAM.button.primaryLg} ${EXAM.text.buttonLg}`}
                  >
                    {t('fsgate.btn')}
                  </button>

                  <p className={`mt-[clamp(12px,1vw,24px)] ${EXAM.text.helper} ${EXAM.color.helper} leading-relaxed`}>
                    {t('fsgate.hint')}
                  </p>

                  {fullscreen.state.error && (
                    <div className={`mt-[clamp(12px,1vw,24px)] px-4 py-3 ${EXAM.surface.warningBox} ${EXAM.text.helper} ${EXAM.color.warning}`}>
                      {fullscreen.state.error}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </main>
        </div>
      </>
    );
  }

  /* ───── 화면 공유 게이트 ─────
     ProctorPage 의 CONSENT step 에서는 동의(checkbox)만 받고 실제 getDisplayMedia
     호출은 안 한다 (MediaStream 이 페이지 unmount 시 죽기 때문). 그래서 여기서
     활성 share 가 없으면 시험 UI 를 차단하고 사용자 제스처 기반의 "화면 공유 시작"
     버튼만 노출. 응시자가 시험 중 share 를 끄면 다시 이 게이트가 등장. */
  if (screenShare.state.status !== 'ACTIVE') {
    const status = screenShare.state.status;
    const isRequesting = status === 'REQUESTING';
    const isUnsupported = status === 'UNSUPPORTED';
    const isWrongSurface = status === 'WRONG_SURFACE';
    return (
      <>
        <ExternalDisplayBlocker
          state={displayState}
          onRecheck={display.recheck}
          onRequestPermission={display.requestPermission}
        />
        <div className="h-screen w-screen bg-[#F8FAFC] flex flex-col overflow-hidden">
          <ExamPageHeader title="화면 공유 필요" hideClock />

          <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden">
            <div className={`w-full ${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} h-full flex items-center`}>
              <section className="w-full h-full flex flex-col justify-center relative">
                <div className="absolute top-0 right-0 z-10">
                  <LangToggle />
                </div>

                <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} text-center max-w-[clamp(480px,40vw,820px)] mx-auto w-full`}>
                  <div className="mx-auto w-[clamp(56px,4.5vw,96px)] h-[clamp(56px,4.5vw,96px)] rounded-full bg-[#EFF6FF] flex items-center justify-center mb-[clamp(12px,1vw,24px)]">
                    <Monitor className={`w-[clamp(26px,2.2vw,44px)] h-[clamp(26px,2.2vw,44px)] ${EXAM.color.brand}`} />
                  </div>
                  <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mb-[clamp(8px,0.7vw,16px)]`}>
                    화면 공유 필요
                  </h2>
                  <p className={`${EXAM.text.body} ${EXAM.color.body} mb-[clamp(8px,0.7vw,16px)] leading-relaxed`}>
                    AI 감독을 위해 전체 모니터 공유가 필요합니다. <br/> 아래 버튼을 눌러 화면 공유를 시작해 주세요.
                  </p>
                  <p className={`${EXAM.text.body} ${EXAM.color.danger} font-semibold mb-[clamp(20px,1.6vw,40px)] leading-relaxed`}>
                    화면 공유 없이는 시험을 시작할 수 없습니다.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      // getDisplayMedia 의 picker 가 풀스크린을 강제로 종료시키고
                      // 화면 공유가 시작되면 Chrome 이 "공유 중" 툴바를 깔면서
                      // 추가로 blur/focus 가 한 번 더 튄다. 15초로 잡아두면
                      // picker 선택 + 툴바 노출까지 한 번에 흡수된다. 마킹은
                      // FULLSCREEN_EXIT + WINDOW_BLUR + TAB_HIDDEN 모두 억제.
                      fullscreen.markExpectedExit(15_000);
                      void screenShare.start().then((status) => {
                        // picker 의 "공유" 클릭은 Chrome 에서 fresh user gesture 로
                        // 인정될 가능성이 있어서 즉시 풀스크린 재진입을 시도한다.
                        // 실패하면 fullscreen.state.exited 가 true 인 상태로 남아
                        // FullscreenExitModal 이 뜨고 사용자가 Resume 클릭으로 복귀.
                        if (status === 'ACTIVE' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
                          void document.documentElement
                            .requestFullscreen({ navigationUI: 'hide' })
                            .catch(() => {
                              /* gesture 만료됨 — FullscreenExitModal 이 fallback */
                            });
                        }
                      });
                    }}
                    disabled={isRequesting || isUnsupported}
                    className={`${EXAM.button.primaryLg} ${EXAM.text.buttonLg} inline-flex items-center justify-center gap-2`}
                  >
                    {isRequesting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        요청 중...
                      </>
                    ) : (
                      '화면 공유 시작'
                    )}
                  </button>


                  {isWrongSurface && (
                    <div className={`mt-[clamp(12px,1vw,24px)] px-4 py-3 ${EXAM.surface.dangerBox} ${EXAM.text.helper} ${EXAM.color.danger}`}>
                      {screenShare.state.surface === 'browser'
                        ? '브라우저 탭이 선택됐습니다. "전체 화면" 옵션에서 모니터를 선택해 주세요.'
                        : '특정 창이 선택됐습니다. "전체 화면" 옵션에서 모니터를 선택해 주세요.'}
                    </div>
                  )}
                  {isUnsupported && (
                    <div className={`mt-[clamp(12px,1vw,24px)] px-4 py-3 ${EXAM.surface.dangerBox} ${EXAM.text.helper} ${EXAM.color.danger}`}>
                      이 브라우저는 화면 공유를 지원하지 않습니다. Chrome 최신 버전을 사용해 주세요.
                    </div>
                  )}
                  {screenShare.state.error && !isWrongSurface && !isUnsupported && (
                    <div className={`mt-[clamp(12px,1vw,24px)] px-4 py-3 ${EXAM.surface.warningBox} ${EXAM.text.helper} ${EXAM.color.warning}`}>
                      {screenShare.state.error}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </main>
        </div>
      </>
    );
  }

  /* ───────────────────────── Main exam UI ───────────────────────── */

  const handleSubmitClick = () => {
    setConfirmSubmit(true);
  };

  const certLabel = `${paper.session.certType.replace('_', '-')} · ${paper.session.level}`;

  return (
    // [&_svg]:[stroke-width:1.5] — 페이지 전체 lucide 아이콘을 얇게(기본 2 → 1.5)
    <div data-theme={examTheme} className={`exam-root ${themeSwitching ? 'theme-switching' : ''} h-screen overflow-hidden bg-[var(--exam-bg)] text-[var(--exam-text)] flex flex-col font-sans [&_svg]:[stroke-width:1.5]`}>
      {/* 감독/AI/마이크 상태는 상단 배너 대신 화면배치 툴바의 알림(벨) 팝오버로 노출.
          (ProctorLiveBanner/MicBanner/AiProctorBanner 배너는 더 이상 사용하지 않음) */}
      <ProctorLivePipPreview videoRef={proctor.videoRef} />
      <ExternalDisplayBlocker
        state={displayState}
        onRecheck={display.recheck}
        onRequestPermission={display.requestPermission}
      />
      <FullscreenExitModal
        open={fullscreen.state.exited && !fullscreen.state.terminated}
        warningCount={fullscreen.state.warningCount}
        threshold={fullscreen.state.threshold}
        onResume={fullscreen.resumeFullscreen}
      />
      <VoiceStrikeModal
        open={voiceHoldUntil > now && voiceStrikes > 0}
        warningCount={voiceStrikes}
        threshold={VOICE_STRIKE_THRESHOLD}
      />
      {adminWarning && (
        <AdminProctorBanner message={adminWarning} onDismiss={() => setAdminWarning(null)} />
      )}
      {adminTimerPaused && (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="mx-4 max-w-md rounded-xl bg-white p-8 text-center shadow-xl">
            <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-amber-500" />
            <h2 className="text-lg font-bold text-gray-900">{t('exam.adminPause.title' as never)}</h2>
            <p className="mt-2 text-sm text-gray-600">
              {adminPauseReason || t('exam.adminPause.body' as never)}
            </p>
            <p className="mt-4 text-xs text-gray-500">{t('warn.bannerSub' as never)}</p>
          </div>
        </div>
      )}
      {timeExtendedToast && (
        <div className="fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {timeExtendedToast}
        </div>
      )}

      {/* ─── 헤더: Readiness 와 동일한 ExamPageHeader. 타이머는 우측 시계 자리에. ─── */}
      <ExamPageHeader
        title={` ${certLabel}`}
        limitTimeLabel="제한시간"
        limitTime={limitTime}
        remainingTimeLabel="남은시간"
        remainingTime={remaining}
        remainingTimeColor={timerColor}
      />

      {/* ─── Body row: 좌측 컬럼(툴바 + 문제 영역) + 우측 답안표기란(전체 높이) ───
           답안표기란이 헤더 바로 아래 툴바와 같은 줄에서 시작하도록, 툴바를 좌측
           컬럼 안에 넣고 답안표기란은 이 행의 우측 전체 높이를 차지한다. */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      {/* ─── 화면배치 툴바(단일 줄): 배치 토글 + AI/VOICE 배지(좌) / 언어·설정·알림(우) ─── */}
      <ExamLayoutToolbar
        layout={examLayout}
        onLayoutChange={setExamLayout}
        aiStrikes={aiStrikes}
        voiceStrikes={voiceStrikes}
        proctorState={proctor.state}
        micState={mic.state}
        aiBanner={aiBanner}
        theme={examTheme}
        onThemeChange={handleThemeChange}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
      />

      {/* ─── Stage 탭 (L1/L2 only) — 흰 배경 / brand blue 액센트 ─── */}
      {paper.session.level !== 'L3' && (
        <div className="bg-[var(--exam-surface)] border-b border-[var(--exam-border)] px-[clamp(16px,2vw,48px)] flex items-stretch gap-1 shrink-0">
          {/* Prev / Next stage — bidirectional walk through the section sequence. */}
          <StageNavButton
            direction="prev"
            disabled={currentStageIndex <= 0}
            onClick={() => safeSetStage(stageSequence[currentStageIndex - 1])}
          />
          <StageTab label="Part 1 · Written" active={stage === 'WRITTEN'} onClick={() => safeSetStage('WRITTEN')} />
          {practicalTasks.length > 0 && (
            <StageTab label={`Part 2 · Practical (${practicalTasks.length})`} active={stage === 'PRACTICAL'} onClick={() => safeSetStage('PRACTICAL')} />
          )}
          {deliverableTask && <StageTab label="Part 2 · Execution Plan" active={stage === 'DELIVERABLE'} onClick={() => safeSetStage('DELIVERABLE')} />}
          {essayTasks.length > 0 && <StageTab label={`Part 3 · Essay (${essayTasks.length})`} active={stage === 'ESSAY'} onClick={() => safeSetStage('ESSAY')} />}
          <StageNavButton
            direction="next"
            disabled={currentStageIndex >= stageSequence.length - 1}
            onClick={() => safeSetStage(stageSequence[currentStageIndex + 1])}
          />
        </div>
      )}

      {/* ─── Body ─── */}
      <main className="flex-1 min-h-0 flex overflow-hidden bg-[var(--exam-bg)]" style={{ zoom }}>
        {stage === 'WRITTEN' && (
          <WrittenView
            questions={writtenQs}
            activeIdx={activeIdx}
            onChange={updateAnswer}
            color={color}
            layout={examLayout}
          />
        )}
        {stage === 'PRACTICAL' &&
          (paper.session.level === 'L3' ? (
            // L3 실습형 — structured answer-key inputs, no in-exam AI chat.
            <L3PracticalListView
              tasks={practicalTasks}
              text={practicalText}
              setText={updatePractical}
              color={color}
            />
          ) : (
            <PracticalListView
              tasks={practicalTasks}
              text={practicalText}
              setText={updatePractical}
              chat={practicalChat}
              chatInput={chatInput}
              setChatInput={setChatInput}
              onSendChat={sendChat}
              aiBusy={aiBusy}
              color={color}
              sessionId={sessionId ?? ''}
              uploadedFiles={deliverableUploaded}
              onFileUploaded={(taskId, fileName) =>
                setDeliverableUploaded((prev) => ({ ...prev, [taskId]: fileName }))
              }
            />
          ))}
        {stage === 'DELIVERABLE' && deliverableTask && (
          <DeliverableView
            task={deliverableTask}
            text={practicalText[deliverableTask.taskId] ?? ''}
            setText={(v) => updatePractical(deliverableTask.taskId, v)}
            chat={practicalChat[deliverableTask.taskId] ?? []}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSendChat={() => sendChat(deliverableTask.taskId)}
            aiBusy={aiBusy}
            color={color}
            sessionId={sessionId ?? ''}
            uploadedFileName={deliverableUploaded[deliverableTask.taskId] ?? null}
            onFileUploaded={(fileName) =>
              setDeliverableUploaded((prev) => ({ ...prev, [deliverableTask.taskId]: fileName }))
            }
          />
        )}
        {stage === 'ESSAY' && essayTasks.length > 0 && (
          <div className="flex-1 overflow-y-auto bg-[var(--exam-bg)]">
            {essayTasks.map((et) => (
              <div key={et.taskId} className="min-h-[70vh] flex flex-col border-b border-[var(--exam-border)] last:border-b-0">
                <EssayView
                  task={et}
                  text={practicalText[et.taskId] ?? ''}
                  setText={(v) => updatePractical(et.taskId, v)}
                  color={color}
                />
              </div>
            ))}
          </div>
        )}
          </main>
        </div>

        {/* 우측 답안표기란 — WRITTEN 단계에서만, 전체 높이 고정 컬럼 */}
        {stage === 'WRITTEN' && (
          <AnswerSheetAside
            questions={writtenQs}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            onChange={updateAnswer}
            color={color}
          />
        )}
      </div>

      {/* ─── Footer ─── 좌: 상태(자동저장·화면공유 모니터링) / 중앙: 이전·카운트·다음
           (WRITTEN 한정) / 우: 답안제출. 이동/제출 모두 기존 핸들러
           (setActiveIdx·handleSubmitClick) 그대로. */}
      <footer className="bg-[var(--exam-surface)] border-t text-[13px] border-[var(--exam-border)] flex items-center justify-between gap-4 px-[clamp(16px,2vw,20px)] py-[clamp(8px,0.4vw,8px)] shrink-0">
        {/* 좌측 — 상태 인디케이터 + 홈 나가기 */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className={`inline-flex items-center gap-1.5 ${EXAM.color.brand}`}>
              <span className="w-2 h-2 rounded-full bg-[var(--exam-accent)] shrink-0" />
              {t('runner.autoSaving')}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[#16A34A]`}>
              <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
              화면 공유중 · 감독관 실시간 모니터링
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmExitOpen(true)}
            title={t('runner.exitConfirm.exit' as never)}
            className={`inline-flex items-center gap-1.5 h-[clamp(28px,2vw,38px)] px-3 rounded-md border border-[var(--exam-border)] bg-[var(--exam-surface)] hover:bg-[var(--exam-surface-2)] transition-colors ${EXAM.text.pill} ${EXAM.color.body}`}
          >
            <Home className="w-3.5 h-3.5" />
            {t('common.home' as never)}
          </button>
        </div>

        {/* 중앙 — 이전 / 카운트 / 다음 (WRITTEN 단계 한정) */}
        {stage === 'WRITTEN' && (
          <div className="flex items-center gap-[clamp(8px,1vw,20px)] shrink-0">
            <button
              type="button"
              onClick={() => setActiveIdx(Math.max(0, activeIdx - 1))}
              disabled={activeIdx <= 0}
              className={`h-[clamp(34px,2.4vw,46px)] px-[clamp(14px,1.2vw,26px)] rounded-full border border-[var(--exam-border)] bg-[var(--exam-surface)] hover:bg-[var(--exam-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${EXAM.text.button} ${EXAM.color.body}`}
            >
              {t('common.prev')}
            </button>
            <span className={`${EXAM.text.button} tabular-nums`}>
              <span className={`${EXAM.color.ink} font-bold`}>{activeIdx + 1}</span>
              <span className={EXAM.color.muted}> / {writtenQs.length}</span>
            </span>
            <button
              type="button"
              onClick={() => setActiveIdx(Math.min(writtenQs.length - 1, activeIdx + 1))}
              disabled={activeIdx >= writtenQs.length - 1}
              className={`h-[clamp(34px,2.4vw,46px)] px-[clamp(14px,1.2vw,26px)] rounded-full border border-[var(--exam-border)] bg-[var(--exam-surface)] hover:bg-[var(--exam-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${EXAM.text.button} ${EXAM.color.body}`}
            >
              {t('common.next')}
            </button>
          </div>
        )}

        {/* 우측 — 답안제출 */}
        <div className="flex items-center gap-[clamp(8px,0.8vw,16px)] shrink-0">
          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={submitting}
            className={`h-[clamp(36px,3vw,70px)] px-[clamp(18px,5vw,150px)] rounded-md bg-[var(--exam-accent)] text-white hover:bg-[var(--exam-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${EXAM.text.button}`}
          >
            {submitting
              ? t('runner.submitting')
              : stage === 'WRITTEN'
                ? t('runner.submit')
                : t('runner.finalSubmit')}
          </button>
        </div>
      </footer>

      <SubmitConfirmModal
        open={confirmSubmit}
        unanswered={writtenQs.map((q, i) => ({ idx: i + 1, answered: !!q.selectedChoice })).filter((q) => !q.answered).map((q) => q.idx)}
        flagged={writtenQs.map((q, i) => ({ idx: i + 1, flagged: q.flagged })).filter((q) => q.flagged).map((q) => q.idx)}
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => {
          setConfirmSubmit(false);
          void doSubmit();
        }}
      />
      <ExamExitConfirmModal
        open={confirmExitOpen}
        variant="exam"
        onContinue={() => setConfirmExitOpen(false)}
        onExit={handleExitHome}
      />
      {showBackBlockedModal && (
        <ResultModal
          title="뒤로가기 불가"
          onClose={() => setShowBackBlockedModal(false)}
          footer={(
            <div className="flex w-full items-center justify-end gap-2">
              <ResultModalButton variant="primary" onClick={() => setShowBackBlockedModal(false)}>
                확인
              </ResultModalButton>
            </div>
          )}
        >
          <p className={`${EXAM.text.body} ${EXAM.color.body}`}>
            시험 진행 중에는 뒤로가기를 사용할 수 없습니다.
          </p>
          <p className={`${EXAM.text.helper} ${EXAM.color.helper} mt-1`}>
            답안을 제출해 시험을 종료한 뒤 이동해 주세요.
          </p>
        </ResultModal>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Sub-components — only JSX/styles changed; all props identical.
   ═══════════════════════════════════════════════════════════════════ */

/**
 * 화면배치 툴바 — 헤더 아래 흰색 바(시험 진행 중 단일 툴바 줄).
 *   좌측: 좌우/단일/상하 배치 토글 + AI/VOICE 스트라이크 배지(누적 시 표시)
 *   우측: 언어 토글 + 설정·알림 아이콘(설정/알림은 시각 placeholder, 추후 연결)
 * 배치 토글은 `layout` 상태만 바꾸고, 배지는 상위의 누적 스트라이크 수를 표시만 한다.
 */
function ExamLayoutToolbar({
  layout,
  onLayoutChange,
  aiStrikes,
  voiceStrikes,
  proctorState,
  micState,
  aiBanner,
  theme,
  onThemeChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: {
  layout: ExamLayout;
  onLayoutChange: (l: ExamLayout) => void;
  aiStrikes: number;
  voiceStrikes: number;
  proctorState: ProctorLiveState;
  micState: MicState;
  aiBanner: { severity: 'LOW' | 'MED' | 'HIGH'; captionKo: string | null; captionEn: string | null } | null;
  theme: ExamTheme;
  onThemeChange: (t: ExamTheme) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}) {
  const options: { key: ExamLayout; Icon: typeof Columns2; label: string }[] = [
    { key: 'split-lr', Icon: Columns2, label: '좌우 분할' },
    { key: 'single', Icon: Square, label: '단일 화면' },
    { key: 'split-tb', Icon: Rows2, label: '상하 분할' },
  ];

  // 알림(벨) 팝오버 — 실시간 모니터링 상태. 클릭 토글 + 바깥 클릭/ESC 닫기.
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!notifOpen) return;
    const onDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [notifOpen]);

  // 설정(기어) 팝오버 — 클릭 토글 + 바깥 클릭/ESC 닫기.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);

  // 감독/AI/마이크 중 하나라도 비정상이면 벨에 빨간 점을 깜빡여 표시.
  const proctorAlert = proctorState.verdict !== 'OK' && proctorState.verdict !== 'PENDING';
  const aiAlert = aiBanner != null || aiStrikes > 0;
  const micAlert =
    micState.status === 'DISCONNECTED' ||
    micState.status === 'ERROR' ||
    micState.status === 'VOICE_DETECTED';
  const hasAlert = proctorAlert || aiAlert || micAlert;
  return (
    <div className="bg-[var(--exam-surface)] border-b border-[var(--exam-border)] px-[clamp(16px,2vw,48px)] py-[clamp(6px,0.6vw,12px)] flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-[clamp(10px,1vw,10px)]">
        <span className={`${EXAM.text.pill} ${EXAM.color.muted} font-medium leading-tight mr-2`}>
          화면 <br/> 배치
        </span>
        <div className="flex items-center">
          {options.map(({ key, Icon, label }) => {
            const active = layout === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onLayoutChange(key)}
                aria-pressed={active}
                aria-label={label}
                title={label}
                className={`w-[clamp(34px,2.6vw,48px)] h-[clamp(30px,2.3vw,42px)] rounded-md flex items-center justify-center transition-colors ${
                  active
                    ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)] border-[var(--exam-accent)]'
                    : 'bg-[var(--exam-surface)] text-[var(--exam-text-muted)] border-[var(--exam-border)] hover:bg-[var(--exam-surface-2)] hover:text-[var(--exam-text)]'
                }`}
              >
                <Icon className="w-[clamp(16px,1.5vw,30px)] h-[clamp(16px,1.5vw,30px)]" />
              </button>
            );
          })}
        </div>

        {/* 구분선 */}
        <span className="self-stretch w-px my-1 bg-[var(--exam-border)]" aria-hidden />

        {/* ─── 확대/축소 — 문제 영역(zoom) 조절. 화면배치 우측에 위치 ─── */}
        <div className="flex items-center" role="group" aria-label="화면 확대/축소">
          <span className="text-[clamp(12px,0.85vw,18px)] font-medium text-[var(--exam-text-muted,#64748B)] font-medium leading-tight mx-2">화면 <br/> 비율</span>
          <button
            type="button"
            onClick={onZoomOut}
            disabled={zoom <= ZOOM_MIN}
            aria-label="축소"
            title="축소"
            className="w-[clamp(34px,2.6vw,48px)] h-[clamp(30px,2.3vw,42px)] rounded-md flex items-center justify-center transition-colors bg-[var(--exam-surface)] text-[var(--exam-text-muted)] hover:bg-[var(--exam-surface-2)] hover:text-[var(--exam-text)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--exam-surface)]"
          >
            <ZoomOut className="w-[clamp(16px,1.5vw,30px)] h-[clamp(16px,1.5vw,30px)]" />
          </button>
          <button
            type="button"
            onClick={onZoomReset}
            aria-label="배율 100%로 초기화"
            title="배율 초기화 (100%)"
            className={`min-w-[clamp(44px,3.4vw,64px)] h-[clamp(30px,2.3vw,42px)] px-1 rounded-md tabular-nums transition-colors hover:bg-[var(--exam-surface-2)] ${EXAM.text.button} ${
              zoom === 1 ? 'text-[var(--exam-text-muted)]' : 'text-[var(--exam-accent-text)]'
            }`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={zoom >= ZOOM_MAX}
            aria-label="확대"
            title="확대"
            className="w-[clamp(34px,2.6vw,48px)] h-[clamp(30px,2.3vw,42px)] rounded-md flex items-center justify-center transition-colors bg-[var(--exam-surface)] text-[var(--exam-text-muted)] hover:bg-[var(--exam-surface-2)] hover:text-[var(--exam-text)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--exam-surface)]"
          >
            <ZoomIn className="w-[clamp(16px,1.5vw,30px)] h-[clamp(16px,1.5vw,30px)]" />
          </button>
        </div>

        {/* AI/VOICE 스트라이크 배지 — 누적 시에만 표시 */}
        {aiStrikes > 0 && (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FFFBEB] border border-[#FDE68A] ${EXAM.text.pill} ${EXAM.color.warning}`}>
            <AlertTriangle className="w-3.5 h-3.5" />
            AI {aiStrikes}/{AI_STRIKE_THRESHOLD}
          </span>
        )}
        {voiceStrikes > 0 && (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FFFBEB] border border-[#FDE68A] ${EXAM.text.pill} ${EXAM.color.warning}`}>
            <Mic className="w-3.5 h-3.5" />
            VOICE {voiceStrikes}/{VOICE_STRIKE_THRESHOLD}
          </span>
        )}
      </div>

      {/* 우측 — 설정(언어 등) · 알림 팝오버 */}
      <div className="flex items-center">
        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            aria-label="설정"
            title="설정"
            aria-expanded={settingsOpen}
            onClick={() => {
              setNotifOpen(false);
              setSettingsOpen((o) => !o);
            }}
            className={`w-[clamp(34px,2.6vw,48px)] h-[clamp(30px,2.3vw,42px)] rounded-md flex items-center justify-center transition-colors ${
              settingsOpen
                ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                : 'text-[var(--exam-text-muted)] hover:text-[var(--exam-text)] hover:bg-[var(--exam-surface-2)]'
            }`}
          >
            <Bolt className="w-[clamp(18px,1.3vw,24px)] h-[clamp(18px,1.3vw,24px)]" />
          </button>
          {settingsOpen && <SettingsPopover theme={theme} onThemeChange={onThemeChange} />}
        </div>
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            aria-label="알림"
            title="알림"
            aria-expanded={notifOpen}
            onClick={() => {
              setSettingsOpen(false);
              setNotifOpen((o) => !o);
            }}
            className={`relative w-[clamp(34px,2.6vw,48px)] h-[clamp(30px,2.3vw,42px)] rounded-md flex items-center justify-center transition-colors ${
              notifOpen
                ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                : 'text-[var(--exam-text-muted)] hover:text-[var(--exam-text)] hover:bg-[var(--exam-surface-2)]'
            }`}
          >
            <Bell className="w-[clamp(18px,1.3vw,24px)] h-[clamp(18px,1.3vw,24px)]" />
            {hasAlert && (
              <span className="absolute top-[clamp(3px,0.35vw,7px)] right-[clamp(6px,0.55vw,10px)] flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-danger opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-status-danger" />
              </span>
            )}
          </button>
          {notifOpen && (
            <ProctorStatusPopover
              proctorState={proctorState}
              micState={micState}
              aiBanner={aiBanner}
              aiStrikes={aiStrikes}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 설정(기어) 팝오버 — 벨 팝오버와 동일한 라이트 톤 카드/행 구조.
 * 언어(한/영) + 테마(라이트/다크) 토글. 언어는 i18n setLang 을 그대로 호출하고,
 * 테마는 examTheme 상태를 바꾼다 → 루트 .exam-root 의 data-theme 속성이 갱신되어
 * --exam-* 시맨틱 변수가 다크 팔레트로 스왑된다(index.css 참고).
 */
function SettingsPopover({
  theme,
  onThemeChange,
}: {
  theme: ExamTheme;
  onThemeChange: (t: ExamTheme) => void;
}) {
  const { t, lang, setLang } = useI18n();
  return (
    <div
      role="dialog"
      aria-label={t('settingsPop.title')}
      className="absolute right-0 top-[calc(100%+10px)] z-[80] w-[clamp(300px,24vw,420px)] bg-[var(--exam-surface)] rounded-xl border border-[var(--exam-border)] shadow-[0_12px_32px_rgba(15,23,42,0.16)] overflow-hidden"
    >
      {/* 말풍선 꼬리 */}
      <div className="absolute -top-1.5 right-[18px] w-3 h-3 bg-[var(--exam-surface-2)] border-l border-t border-[var(--exam-border)] rotate-45" />
      <div className="px-[clamp(14px,1.1vw,20px)] py-[clamp(10px,0.8vw,14px)] border-b border-[var(--exam-border)] bg-[var(--exam-surface-2)] flex items-center gap-2">
        <span className={`${EXAM.text.button} ${EXAM.color.ink} font-bold`}>{t('settingsPop.title')}</span>
      </div>
      {/* 설정 항목 — 아이콘 칩 + 라벨(좌) + on/off 스위치(우).
          영문 모드 on=영어, 다크 모드 on=다크. */}
      <div className="divide-y divide-[var(--exam-border)]">
        <SettingsSwitchRow
          Icon={Globe}
          label={t('settingsPop.englishMode')}
          checked={lang === 'en'}
          onChange={(on) => setLang(on ? 'en' : 'ko')}
        />
        <SettingsSwitchRow
          Icon={Moon}
          label={t('settingsPop.darkMode')}
          checked={theme === 'dark'}
          onChange={(on) => onThemeChange(on ? 'dark' : 'light')}
        />
      </div>
    </div>
  );
}

/** 설정 팝오버의 한 행 — 아이콘 칩 + 라벨(좌) + on/off 스위치(우). */
function SettingsSwitchRow({
  Icon,
  label,
  checked,
  onChange,
}: {
  Icon: typeof Monitor;
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="px-[clamp(14px,1.1vw,20px)] py-[clamp(10px,0.9vw,16px)] flex items-center gap-[clamp(10px,0.8vw,14px)]">
      <span className="w-[clamp(30px,2.2vw,40px)] h-[clamp(30px,2.2vw,40px)] rounded-lg flex items-center justify-center shrink-0 bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]">
        <Icon className="w-[52%] h-[52%]" />
      </span>
      <span className={`flex-1 min-w-0 ${EXAM.text.button} ${EXAM.color.ink} font-semibold`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--exam-accent)]' : 'bg-[#CBD5E1]'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/**
 * 알림(벨) 팝오버 — 실시간 감독/마이크 모니터링 상태를 라이트 톤 카드로 표시.
 * 상단 배너(ProctorLiveBanner/MicBanner)와 동일한 state·문구(pb / mic 키)를 읽어
 * 디자인 컨셉(흰 카드 + EXAM 토큰)에 맞게 보여준다. 표시 전용 — 로직 없음.
 */
function ProctorStatusPopover({
  proctorState,
  micState,
  aiBanner,
  aiStrikes,
}: {
  proctorState: ProctorLiveState;
  micState: MicState;
  aiBanner: { severity: 'LOW' | 'MED' | 'HIGH'; captionKo: string | null; captionEn: string | null } | null;
  aiStrikes: number;
}) {
  const { t, lang } = useI18n();

  // 감독(얼굴) — proctor.state.verdict 기반
  const pOk = proctorState.verdict === 'OK' || proctorState.verdict === 'PENDING';
  const pDanger =
    proctorState.verdict === 'ERROR' ||
    proctorState.verdict === 'NO_FACE' ||
    proctorState.verdict === 'MULTIPLE_FACES' ||
    proctorState.verdict === 'IDENTITY_MISMATCH' ||
    proctorState.verdict === 'AI_HIGH';
  const proctorTone: StatusTone = pOk ? 'ok' : pDanger ? 'danger' : 'warn';
  const proctorMsg = pOk ? t('monitorPop.proctorOk') : t(`pb.${proctorState.verdict}` as never);

  // AI 감독 — 서버 AI 판정 배너(aiBanner) + 누적 스트라이크
  const aiTone: StatusTone = aiBanner
    ? aiBanner.severity === 'HIGH'
      ? 'danger'
      : aiBanner.severity === 'MED'
        ? 'warn'
        : 'info'
    : aiStrikes > 0
      ? 'warn'
      : 'ok';
  const aiMsg = aiBanner
    ? lang === 'ko'
      ? aiBanner.captionKo ?? aiBanner.captionEn ?? ''
      : aiBanner.captionEn ?? aiBanner.captionKo ?? ''
    : t('monitorPop.aiOk');

  // 마이크 — mic.state.status 기반
  const m = micState.status;
  const micTone: StatusTone =
    m === 'DISCONNECTED' || m === 'ERROR'
      ? 'danger'
      : m === 'VOICE_DETECTED'
        ? 'warn'
        : m === 'LISTENING'
          ? 'ok'
          : 'info';
  const micMsg =
    m === 'LISTENING'
      ? t('monitorPop.micListening')
      : m === 'CALIBRATING'
        ? t('monitorPop.micCalibrating')
        : m === 'PENDING'
          ? t('monitorPop.micPending')
          : m === 'DISCONNECTED'
            ? t('mic.disconnected')
            : m === 'ERROR'
              ? t('mic.error')
              : t('mic.voice');

  return (
    <div
      role="dialog"
      aria-label={t('monitorPop.title')}
      className="absolute right-0 top-[calc(100%+10px)] z-[80] w-[clamp(300px,24vw,420px)] bg-[var(--exam-surface)] rounded-xl border border-[var(--exam-border)] shadow-[0_12px_32px_rgba(15,23,42,0.16)] overflow-hidden"
    >
      {/* 말풍선 꼬리 */}
      <div className="absolute -top-1.5 right-[18px] w-3 h-3 bg-[var(--exam-surface-2)] border-l border-t border-[var(--exam-border)] rotate-45" />
      <div className="px-[clamp(14px,1.1vw,20px)] py-[clamp(10px,0.8vw,14px)] border-b border-[var(--exam-border)] bg-[var(--exam-surface-2)] flex items-center gap-2">
        <span className={`${EXAM.text.button} ${EXAM.color.ink} font-bold`}>{t('monitorPop.title')}</span>
      </div>
      <div className="divide-y divide-[var(--exam-border)]">
        <StatusRow Icon={Monitor} tone={proctorTone} message={proctorMsg} />
        <StatusRow Icon={AlertTriangle} tone={aiTone} message={aiMsg} />
        <StatusRow Icon={Mic} tone={micTone} message={micMsg} />
      </div>
    </div>
  );
}

type StatusTone = 'ok' | 'warn' | 'danger' | 'info';

function StatusRow({
  Icon,
  tone,
  message,
}: {
  Icon: typeof Monitor;
  tone: StatusTone;
  message: string;
}) {
  const toneCls: Record<StatusTone, string> = {
    ok: 'bg-[#F0FDF4] text-[#16A34A]',
    warn: 'bg-[#FFFBEB] text-[#A16207]',
    danger: 'bg-[#FEE2E2] text-[#DC2626]',
    info: 'bg-[#EFF6FF] text-[#1D4ED8]',
  };
  return (
    <div className="px-[clamp(14px,1.1vw,20px)] py-[clamp(10px,0.9vw,16px)] flex items-center gap-[clamp(10px,0.8vw,14px)]">
      <span className={`w-[clamp(30px,2.2vw,40px)] h-[clamp(30px,2.2vw,40px)] rounded-lg flex items-center justify-center shrink-0 ${toneCls[tone]}`}>
        <Icon className="w-[52%] h-[52%]" />
      </span>
      <p className={`min-w-0 flex-1 ${EXAM.text.helper} ${EXAM.color.body} leading-relaxed`}>{message}</p>
    </div>
  );
}

function StageTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-[clamp(14px,1.2vw,28px)] py-[clamp(10px,0.9vw,18px)] transition-colors ${EXAM.text.button} ${
        active ? EXAM.color.brand : 'text-[var(--exam-text-muted)] hover:text-[var(--exam-text)]'
      }`}
    >
      {label}
      {active && (
        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[var(--exam-accent)] rounded-full" />
      )}
    </button>
  );
}

/**
 * Prev/Next stage chevron — sits alongside the StageTabs and walks the
 * candidate through the section sequence bidirectionally. The actual gating
 * (which stages exist) is decided in `stageSequence`, so a disabled state
 * means "no further section in that direction" rather than "blocked by
 * policy".
 */
function StageNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: 'prev' | 'next';
  disabled: boolean;
  onClick: () => void;
}) {
  const isPrev = direction === 'prev';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPrev ? 'Previous section' : 'Next section'}
      title={isPrev ? 'Previous section' : 'Next section'}
      className={`flex items-center justify-center px-[clamp(10px,0.9vw,18px)] my-[clamp(6px,0.5vw,10px)] mx-1 rounded-md transition-colors ${EXAM.text.button} ${
        disabled
          ? 'text-[var(--exam-text-muted)] opacity-40 cursor-not-allowed'
          : 'text-[var(--exam-text-muted)] hover:text-[var(--exam-text)] hover:bg-[var(--exam-hover-bg,rgba(0,0,0,0.04))]'
      }`}
    >
      {isPrev ? '‹' : '›'}
    </button>
  );
}

function SubmitConfirmModal({
  open,
  unanswered,
  flagged,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  unanswered: number[];
  flagged: number[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
      role="alertdialog"
      aria-modal="true"
    >
      <div className="max-w-md w-full bg-[var(--exam-surface,#fff)] rounded-xl overflow-hidden shadow-2xl">
        <div className="bg-[var(--exam-accent,#2563EB)] px-6 py-4">
          <h2 className="text-[19px] sm:text-[22px] font-semibold tracking-tight text-white">{t('runner.confirmTitle')}</h2>
        </div>
        <div className="p-6">
          <p className={`${EXAM.text.body} ${EXAM.color.body} mb-5 leading-relaxed`}>
            {t('runner.confirmDesc')}
          </p>
          {unanswered.length > 0 && (
            <div className={`mb-3 ${EXAM.surface.warningBox} p-3.5`}>
              <div className={`${EXAM.text.button} ${EXAM.color.warning} mb-1.5`}>{t('runner.unanswered', { n: unanswered.length })}</div>
              <div className={`${EXAM.text.helper} text-[#A16207] tabular-nums`}>
                Q.{unanswered.slice(0, 12).join(', Q.')}
                {unanswered.length > 12 ? t('runner.others', { n: unanswered.length - 12 }) : ''}
              </div>
            </div>
          )}
          {flagged.length > 0 && (
            <div className={`mb-5 ${EXAM.surface.warningBox} p-3.5`}>
              <div className={`${EXAM.text.button} ${EXAM.color.warning} mb-1.5`}>{t('runner.flagged', { n: flagged.length })}</div>
              <div className={`${EXAM.text.helper} text-[#A16207] tabular-nums`}>
                Q.{flagged.slice(0, 12).join(', Q.')}
                {flagged.length > 12 ? t('runner.others', { n: flagged.length - 12 }) : ''}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2.5 px-6 py-4 border-t border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface-2,#F8FAFC)]">
          <button
            type="button"
            onClick={onCancel}
            className={`flex-1 h-11 rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.text.button} ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors`}
          >
            {t('runner.continueSolve')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 h-11 rounded-md bg-status-danger text-white hover:bg-[#B91C1C] transition-colors ${EXAM.text.button}`}
          >
            {t('runner.finalSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
}

function WrittenView({
  questions,
  activeIdx,
  onChange,
  color,
  layout,
}: {
  questions: Question[];
  activeIdx: number;
  onChange: (q: Question, choice: string | null, flagged?: boolean) => void;
  color: string;
  layout: ExamLayout;
}) {
  const mainScrollRef = useRef<HTMLElement | null>(null);
  // Jump the question pane to the top when the candidate selects a new
  // question — otherwise after navigating to Q40 they'd land on a pane still
  // scrolled mid-Q39.
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [activeIdx]);
  const active = questions[activeIdx];
  if (!active) return <div className={`p-8 ${EXAM.color.muted}`}>No questions in paper.</div>;

  // 화면배치 모드 — 메인 영역에 보여줄 문제 카드 구성.
  //   single  : 현재 문항 1개 (기본)
  //   split-lr: 현재 + 다음 문항을 좌우 2개로
  //   split-tb: 현재 + 다음 문항을 위아래 2개로
  // 답안 표기란은 모드와 무관하게 항상 우측 고정.
  const visibleIdx =
    layout === 'single'
      ? [activeIdx]
      : [activeIdx, activeIdx + 1].filter((i) => i >= 0 && i < questions.length);
  // 카드 배치. single=가운데 정렬 컨테이너, split-lr=좌우 2분할, split-tb=상하 2분할.
  // fillHeight=true(single·split-lr)면 카드가 메인 높이를 꽉 채우고(필요 시 카드 내부
  // 스크롤), split-tb 는 카드를 자연 높이로 두고 메인 영역 전체를 한 번에 스크롤한다
  // → 카드마다 내부 스크롤바가 생기는 문제 방지.
  const fillHeight = layout !== 'split-tb';
  const cardsWrapCls =
    layout === 'split-lr'
      ? 'flex flex-row gap-[clamp(12px,1.2vw,28px)]'
      : layout === 'split-tb'
        ? 'flex flex-col gap-[clamp(12px,1.2vw,28px)]'
        : `flex ${EXAM.layout.container}`;

  // 문제 카드 1개 렌더 — single/split-lr/split-tb 에서 공통 사용.
  // qIdx 는 전역 문항 인덱스(번호/라디오 name 에 사용). 선택은 기존 onChange 그대로.
  const renderCard = (q: Question, qIdx: number) => (
    <div key={q.questionId} className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} ${fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : ''}`}>
      <div className="flex items-center gap-3 mb-[clamp(12px,1vw,24px)] flex-wrap">
        <span className={`${EXAM.text.cardHeading} ${EXAM.color.brand} font-bold tabular-nums`}>
          Q.{qIdx + 1}
        </span>
        <span className={`${EXAM.text.helper} ${EXAM.color.muted} tabular-nums`}>
          / {questions.length}
        </span>
        <span className={`ml-1 inline-flex items-center px-2.5 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]`}>
          {q.subjectName}
        </span>
        <span className={`inline-flex items-center px-2 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-surface-2)] ${EXAM.color.body}`}>
          {q.points}pt
        </span>
      </div>

      <h2 className={`${EXAM.text.value} ${EXAM.color.ink} leading-[1.75] mb-[clamp(20px,1.6vw,40px)]`}>
        {q.stem}
      </h2>

      <div className="space-y-[clamp(8px,0.7vw,16px)]">
        {q.choices.map((c, i) => {
          const selected = q.selectedChoice === c.key;
          const numeral = ['1', '2', '3', '4', '5', '6', '7', '8'][i] ?? `${i + 1}`;
          return (
            <label
              key={c.key}
              className={`flex items-start gap-[clamp(12px,1vw,28px)] rounded-xl cursor-pointer transition-colors  ${
                selected
                  ? 'bg-[var(--exam-accent-bg)] border-[var(--exam-accent)]'
                  : 'bg-[var(--exam-surface)] border-[var(--exam-border)] hover:border-[var(--exam-text-muted)] hover:bg-[var(--exam-surface-2)]'
              }`}
              style={selected ? { borderColor: color, backgroundColor: `${color}1A` } : undefined}
            >
              <input
                type="radio"
                name={q.questionId}
                checked={selected}
                onChange={() => onChange(q, c.key)}
                className="sr-only"
              />
              <span
                className={`shrink-0 w-[clamp(28px,1.7vw,35px)] mt-0.5 h-[clamp(28px,1.7vw,35px)] border  rounded-full flex items-center justify-center font-bold transition-colors ${EXAM.text.button}`}
                style={{
                  background: selected ? color : 'var(--exam-surface)',
                  color: selected ? '#FFFFFF' : 'var(--exam-text-muted)',
                  borderColor: 'var(--exam-border)',
                }}
              >
                {numeral}
              </span>
              <span
                className={`${EXAM.text.body} leading-relaxed  ${
                  selected ? EXAM.color.ink : EXAM.color.body
                }`}
              >
                {c.text}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    /* ─── 메인 문제 영역 — single=1개 / split-lr=좌우 2개 / split-tb=상하 2개 ───
       답안 표기란은 페이지 레벨의 우측 고정 컬럼(AnswerSheetAside)으로 분리됨. */
    <section
      ref={mainScrollRef}
      className={`flex-1 min-h-0 min-w-0 px-[clamp(16px,2vw,48px)] py-[clamp(16px,1.4vw,40px)] ${
        fillHeight ? 'overflow-hidden flex flex-col' : 'overflow-y-auto overscroll-contain'
      }`}
    >
      <div className={`w-full ${fillHeight ? 'flex-1 min-h-0' : ''} ${cardsWrapCls}`}>
        {visibleIdx.map((i) => {
          const q = questions[i];
          return q ? renderCard(q, i) : null;
        })}
      </div>
    </section>
  );
}

/**
 * 답안 표기란 — 헤더 아래부터 푸터 위까지 전체 높이를 차지하는 우측 고정 컬럼.
 * (화면배치 툴바와 같은 줄에서 시작) 과목 헤더 분리 + 번호 + 숫자 보기 버블.
 * 번호 클릭 = 해당 문항으로 이동(setActiveIdx), 보기 버블 클릭 = 답 선택(onChange).
 * 둘 다 기존 핸들러를 그대로 호출 — 신규 로직 없음.
 */
function AnswerSheetAside({
  questions,
  activeIdx,
  setActiveIdx,
  onChange,
  color,
}: {
  questions: Question[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  onChange: (q: Question, choice: string | null, flagged?: boolean) => void;
  color: string;
}) {
  const groups: { name: string; from: number; to: number }[] = [];
  let prevSubject: string | null = null;
  let groupStart = 0;
  questions.forEach((q, i) => {
    if (q.subjectName !== prevSubject) {
      if (prevSubject !== null) {
        groups.push({ name: prevSubject, from: groupStart + 1, to: i });
      }
      prevSubject = q.subjectName;
      groupStart = i;
    }
  });
  if (prevSubject !== null) {
    groups.push({ name: prevSubject, from: groupStart + 1, to: questions.length });
  }

  return (
    <aside className="w-[clamp(240px,17vw,280px)] bg-[var(--exam-surface)] border-l border-[var(--exam-border)] overflow-y-auto overscroll-contain flex flex-col shrink-0">
      {/* 헤더 — 중앙 정렬, 옅은 회색 바 (툴바와 같은 줄에서 시작) */}
      <div className="px-[clamp(12px,1vw,20px)] py-[clamp(10px,1vw,10px)] border-b border-[var(--exam-border)] bg-[var(--exam-surface-2)] text-center shrink-0">
        <div className={`${EXAM.text.cardHeading} ${EXAM.color.ink} font-bold`}>답안 표기란</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={`${g.name}-${g.from}`}>
            {/* 과목명 — 분리된 행 */}
            <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,8px)] border-b border-[var(--exam-border)] font-semibold ${EXAM.color.ink} `}>
              {g.name}
            </div>
            {Array.from({ length: g.to - g.from + 1 }).map((_, i) => {
              const idx = g.from - 1 + i;
              const q = questions[idx];
              if (!q) return null;
              const isActive = idx === activeIdx;
              return (
                <div key={q.questionId} className="flex items-stretch border-b border-[var(--exam-border)]">
                  {/* 번호 셀 — 좌측 회색 컬럼, 클릭 시 해당 문항으로 이동 */}
                  <button
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    title={`${idx + 1}번 문항으로 이동`}
                    className={`w-[clamp(40px,3vw,56px)] shrink-0 flex items-center justify-center tabular-nums font-semibold transition-colors ${EXAM.text.helper} ${
                      isActive
                        ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                        : q.flagged
                          ? 'bg-[#FFFBEB] text-[#A16207]'
                          : 'bg-[var(--exam-surface-2)] text-[var(--exam-text-muted)] hover:bg-[var(--exam-surface)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                  {/* 보기 버블 — 숫자 */}
                  <div className="flex-1 flex items-center gap-[clamp(6px,0.7vw,14px)] px-[clamp(10px,1vw,20px)] py-[clamp(6px,0.6vw,12px)]">
                    {q.choices.map((c, ci) => {
                      const selected = q.selectedChoice === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => onChange(q, c.key)}
                          aria-pressed={selected}
                          title={`${idx + 1}번 ${ci + 1}`}
                          className={`w-[clamp(22px,1.7vw,32px)] h-[clamp(22px,1.7vw,32px)] rounded-full border-[1.5px] flex items-center justify-center font-semibold leading-none transition-colors text-[clamp(11px,0.8vw,15px)] ${
                            selected
                              ? 'border-transparent text-white'
                              : 'bg-[var(--exam-surface)] text-[var(--exam-text-muted)] border-[var(--exam-border)] hover:border-[var(--exam-text-muted)] hover:text-[var(--exam-text)]'
                          }`}
                          style={selected ? { background: color, borderColor: color } : undefined}
                        >
                          {ci + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

function PracticalListView({
  tasks,
  text,
  setText,
  chat,
  chatInput,
  setChatInput,
  onSendChat,
  aiBusy,
  color,
  sessionId,
  uploadedFiles,
  onFileUploaded,
}: {
  tasks: Task[];
  text: Record<string, string>;
  setText: (taskId: string, v: string) => void;
  chat: Record<string, { role: 'user' | 'assistant'; text: string; ts: number }[]>;
  chatInput: string;
  setChatInput: (v: string) => void;
  onSendChat: (taskId: string) => void;
  aiBusy: boolean;
  color: string;
  sessionId: string;
  uploadedFiles: Record<string, string | null>;
  onFileUploaded: (taskId: string, fileName: string) => void;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const current = tasks[active];
  if (!current) return <div className={`p-8 ${EXAM.color.muted}`}>No practical tasks.</div>;
  return (
    <div className="flex w-full bg-[var(--exam-bg)]">
      <aside className="w-[clamp(200px,14vw,280px)] bg-[var(--exam-surface)] border-r border-[var(--exam-border)] p-[clamp(10px,0.8vw,16px)] shrink-0">
        <div className={`${EXAM.text.pill} ${EXAM.color.muted} mb-3 uppercase tracking-wider font-semibold px-1`}>
          {t('runner.tasksList')}
        </div>
        {tasks.map((tk, i) => (
          <button
            key={tk.taskId}
            onClick={() => setActive(i)}
            className={`w-full text-left p-[clamp(10px,0.8vw,16px)] mb-1 rounded-lg transition-colors border-l-[3px] ${
              i === active
                ? 'bg-[var(--exam-accent-bg)]'
                : 'border-transparent hover:bg-[var(--exam-surface-2)]'
            }`}
            style={i === active ? { borderLeftColor: color } : undefined}
          >
            <div className={`${EXAM.text.button} ${i === active ? EXAM.color.ink : EXAM.color.body}`}>
              {t('runner.taskN', { n: i + 1 })}
            </div>
            <div className={`${EXAM.text.helper} ${EXAM.color.muted} truncate mt-0.5`}>{tk.title}</div>
          </button>
        ))}
      </aside>
      <DeliverableView
        task={current}
        text={text[current.taskId] ?? ''}
        setText={(v) => setText(current.taskId, v)}
        chat={chat[current.taskId] ?? []}
        chatInput={chatInput}
        setChatInput={setChatInput}
        onSendChat={() => onSendChat(current.taskId)}
        aiBusy={aiBusy}
        color={color}
        sessionId={sessionId}
        uploadedFileName={uploadedFiles[current.taskId] ?? null}
        onFileUploaded={(fileName) => onFileUploaded(current.taskId, fileName)}
      />
    </div>
  );
}

function DeliverableView({
  task,
  text,
  setText,
  chat,
  chatInput,
  setChatInput,
  onSendChat,
  aiBusy,
  color,
  sessionId,
  uploadedFileName,
  onFileUploaded,
}: {
  task: Task;
  text: string;
  setText: (v: string) => void;
  chat: { role: 'user' | 'assistant'; text: string; ts: number }[];
  chatInput: string;
  setChatInput: (v: string) => void;
  onSendChat: () => void;
  aiBusy: boolean;
  color: string;
  sessionId: string;
  uploadedFileName: string | null;
  onFileUploaded: (fileName: string) => void;
}) {
  const { t } = useI18n();
  const aiAllowed = isAiAllowed(task.aiToolAllowed);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await examApi.uploadDeliverable(sessionId, task.taskId, file);
      onFileUploaded(file.name);
    } catch {
      setUploadError('파일 업로드에 실패했습니다. 파일 형식과 크기(최대 10MB)를 확인하세요.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  return (
    <section className="flex-1 grid grid-cols-2 gap-[clamp(10px,0.8vw,18px)] p-[clamp(10px,0.8vw,18px)] overflow-hidden bg-[var(--exam-bg)]">
      <div className={`${EXAM.surface.card} p-[clamp(16px,1.4vw,32px)] overflow-y-auto`}>
        <div className={`${EXAM.text.pill} text-[#A16207] mb-2 uppercase tracking-wider font-semibold`}>
          {t('runner.scenarioInfo', { n: task.points, min: task.durationMin })}
        </div>
        <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mb-3`}>{task.title}</h3>
        <p className={`${EXAM.text.body} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>{task.scenario}</p>
        {!aiAllowed && (
          <div className={`mt-5 ${EXAM.surface.warningBox} px-4 py-3 ${EXAM.text.helper} ${EXAM.color.warning} leading-relaxed`}>
            이 문항은 AI 어시스턴트 사용이 허용되지 않습니다. 본인이 직접 작성하세요.
          </div>
        )}
      </div>
      <div className={`grid ${aiAllowed ? 'grid-rows-2' : 'grid-rows-1'} gap-[clamp(10px,0.8vw,18px)] overflow-hidden`}>
        {aiAllowed && (
        <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
          <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)] ${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wider font-semibold`}>
            {t('runner.aiHelper')}
          </div>
          <div className="flex-1 overflow-y-auto p-[clamp(10px,0.9vw,18px)] space-y-2">
            {chat.length === 0 && (
              <div className={`${EXAM.text.helper} ${EXAM.color.muted} italic`}>{t('runner.aiNote')}</div>
            )}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`${EXAM.text.helper} leading-relaxed rounded-lg px-3 py-2 ${
                  m.role === 'user'
                    ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)] ml-6'
                    : 'bg-[#F0FDF4] text-[#15803D] mr-6'
                }`}
              >
                <span className={`font-semibold uppercase mr-1.5 ${EXAM.text.pill}`}>{m.role === 'user' ? t('runner.aiMe') : 'AI'}:</span>
                {m.text}
              </div>
            ))}
            {aiBusy && (
              <div className={`${EXAM.text.helper} leading-relaxed rounded-lg px-3 py-2 bg-[#F0FDF4] text-[#15803D] mr-6 animate-pulse`}>
                <span className={`font-semibold uppercase mr-1.5 ${EXAM.text.pill}`}>AI:</span>
                {t('runner.aiThinking')}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--exam-border)] p-[clamp(8px,0.7vw,14px)] flex gap-2">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !aiBusy && onSendChat()}
              disabled={aiBusy}
              placeholder={t('runner.aiAsk')}
              className={`flex-1 bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg px-3 py-2 ${EXAM.text.helper} ${EXAM.color.ink} placeholder:text-[var(--exam-text-muted)] focus:border-[var(--exam-accent)] focus:outline-none transition-colors disabled:opacity-60`}
            />
            <button
              onClick={onSendChat}
              disabled={aiBusy}
              className={`px-[clamp(12px,1vw,22px)] py-2 rounded-lg text-white transition-colors hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed ${EXAM.text.button}`}
              style={{ background: color }}
            >
              {aiBusy ? t('runner.aiSending') : t('runner.aiSend')}
            </button>
          </div>
        </div>
        )}
        <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
          <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)] ${EXAM.text.pill} uppercase tracking-wider font-semibold flex justify-between items-center`}>
            <span className={EXAM.color.muted}>{t('runner.answerAuto')}</span>
            <span className={`${EXAM.color.brand} tabular-nums`}>{t('runner.charCount', { n: text.length })}</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('runner.answerPh')}
            className={`flex-[2] bg-[var(--exam-surface)] p-[clamp(12px,1vw,22px)] ${EXAM.text.body} ${EXAM.color.ink} outline-none resize-none placeholder:text-[var(--exam-text-muted)] leading-relaxed`}
          />
          {/* File upload section for DELIVERABLE part */}
          <div className="border-t border-[var(--exam-border)] px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)]">
            <div className={`${EXAM.text.pill} uppercase tracking-wider font-semibold ${EXAM.color.muted} mb-2`}>
              파일 첨부 (선택) — PDF, DOCX, ZIP, PNG, JPEG · 최대 10MB
            </div>
            {uploadedFileName ? (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-[#16A34A] font-medium">✓ {uploadedFileName} 업로드 완료</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${EXAM.text.helper} ${EXAM.color.muted} underline`}
                >
                  교체
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={`px-[clamp(10px,0.9vw,18px)] py-[clamp(6px,0.5vw,10px)] rounded-lg border border-[var(--exam-border)] ${EXAM.text.helper} ${EXAM.color.muted} hover:bg-[var(--exam-bg)] transition-colors disabled:opacity-60`}
              >
                {uploading ? '업로드 중…' : '파일 선택'}
              </button>
            )}
            {uploadError && (
              <p className={`mt-1.5 ${EXAM.text.helper} ${EXAM.color.danger}`}>{uploadError}</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.zip,.png,.jpg,.jpeg"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function EssayView({ task, text, setText, color }: { task: Task; text: string; setText: (v: string) => void; color: string }) {
  const { t } = useI18n();
  return (
    <section className="flex-1 grid grid-cols-2 gap-[clamp(10px,0.8vw,18px)] p-[clamp(10px,0.8vw,18px)] overflow-hidden bg-[var(--exam-bg)]">
      <div className={`${EXAM.surface.card} p-[clamp(16px,1.4vw,32px)] overflow-y-auto`}>
        <div className={`${EXAM.text.pill} ${EXAM.color.brand} mb-2 uppercase tracking-wider font-semibold`}>
          {t('runner.essayInstruction', { n: task.points, min: task.durationMin })}
        </div>
        <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mb-3`}>{task.title}</h3>
        <p className={`${EXAM.text.body} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>{task.scenario}</p>
        <div className={`mt-5 ${EXAM.surface.warningBox} px-4 py-3 ${EXAM.text.helper} ${EXAM.color.warning} leading-relaxed`}>
          {t('runner.plagiarismNote')}
        </div>
      </div>
      <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
        <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)] ${EXAM.text.pill} uppercase tracking-wider font-semibold flex justify-between items-center`}>
          <span className={EXAM.color.muted}>{t('runner.answer')}</span>
          <span style={{ color }} className="tabular-nums">{t('runner.wordCount', { n: text.trim().split(/\s+/).filter(Boolean).length })}</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('runner.essayPh')}
          className={`flex-1 bg-[var(--exam-surface)] p-[clamp(12px,1vw,22px)] ${EXAM.text.body} ${EXAM.color.ink} outline-none resize-none placeholder:text-[var(--exam-text-muted)] leading-relaxed`}
        />
      </div>
    </section>
  );
}

function FullscreenExitModal({
  open,
  warningCount,
  threshold,
  onResume,
}: {
  open: boolean;
  warningCount: number;
  threshold: number;
  onResume: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  // Keyboard-Lock 이 Win+Tab/Alt+Tab 을 차단한 경우 풀스크린은 유지된 채로
  // TAB_SWITCH strike 만 찍힌다. 그때 "전체화면을 벗어났습니다"는 오해를
  // 부르므로, 열리는 시점에 아직 풀스크린이면 화면-전환-시도 문구로 바꾼다.
  const stillFullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
  const k = stillFullscreen ? 'fs.switch' : 'fs.exit';
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fs-exit-title"
    >
      <div className="max-w-md w-full bg-[var(--exam-surface,#fff)] rounded-xl overflow-hidden shadow-2xl border border-[#FECACA]">
        <div className="bg-status-danger px-6 py-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-white" />
          <h2 id="fs-exit-title" className="text-[19px] sm:text-[22px] font-semibold tracking-tight text-white">
            {t(`${k}.title`)}
          </h2>
        </div>
        <div className="p-6 text-center">
          <p className={`${EXAM.text.body} ${EXAM.color.body} mb-2 leading-relaxed`}>{t(`${k}.body`)}</p>
          <p className={`${EXAM.text.value} ${EXAM.color.danger} font-bold mb-6 tabular-nums`}>
            {t('fs.exit.warnCount', { n: warningCount, limit: threshold })}
          </p>
          <button
            onClick={onResume}
            autoFocus
            className={`w-full h-12 rounded-md bg-status-danger hover:bg-[#B91C1C] text-white transition-colors ${EXAM.text.button}`}
          >
            {t(`${k}.resume`)}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Voice strike modal — pops up briefly each time the mic monitor detects a
 * sustained voice burst. Click-through (`pointer-events-none`) so the candidate
 * isn't blocked from continuing to answer; auto-dismisses when the host page's
 * `voiceHoldUntil` timestamp passes (controlled by `open`). The threshold-strike
 * call to `handleTerminated` happens inside the strike handler, not here, so
 * this component is purely informational.
 */
function VoiceStrikeModal({
  open,
  warningCount,
  threshold,
}: {
  open: boolean;
  warningCount: number;
  threshold: number;
}) {
  const { t, lang } = useI18n();
  if (!open) return null;
  const isFinalWarning = warningCount >= threshold - 1;
  const headerBg = isFinalWarning ? 'bg-status-danger' : 'bg-[#A16207]';
  const borderColor = isFinalWarning ? 'border-[#FECACA]' : 'border-[#FDE68A]';
  const strikeColor = isFinalWarning ? EXAM.color.danger : EXAM.color.warning;
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 pointer-events-none"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="voice-strike-title"
    >
      <div className={`max-w-md w-full bg-[var(--exam-surface,#fff)] rounded-xl overflow-hidden shadow-2xl border ${borderColor}`}>
        <div className={`${headerBg} px-6 py-4 flex items-center gap-3`}>
          <Mic className="w-6 h-6 text-white" />
          <h2 id="voice-strike-title" className="text-[19px] sm:text-[22px] font-semibold tracking-tight text-white">
            {t('runner.voice.title' as never)}
          </h2>
        </div>
        <div className="p-6 text-center">
          {lang === 'ko' && (
            <p className={`${EXAM.text.helper} ${EXAM.color.muted} italic mb-2`}>
              Voice or noise was detected
            </p>
          )}
          <p className={`${EXAM.text.body} ${EXAM.color.body} mb-3 leading-relaxed`}>
            {t('runner.voice.sub' as never)}
            {lang === 'ko' && (
              <>
                <br />
                <span className={`italic ${EXAM.color.muted}`}>
                  Stay silent for the rest of the exam.
                </span>
              </>
            )}
          </p>
          <p className={`${EXAM.text.value} font-bold tabular-nums ${strikeColor}`}>
            STRIKE {warningCount}/{threshold}
          </p>
          {isFinalWarning && (
            <p className={`${EXAM.text.helper} ${EXAM.color.danger} mt-3 font-semibold leading-relaxed`}>
              {t('runner.voice.lastWarning' as never)}
              {lang === 'ko' && (
                <>
                  <br />
                  <span className="italic font-normal opacity-70">
                    One more detection will terminate the exam.
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 시험을 실제로 떠나는 시점에서 명시적으로 호출. lifecycle 클린업에 묶으면
 * Strict Mode 의 mount → unmount → mount 사이클에서 우발적으로 발동하므로
 * doSubmit 성공, handleTerminated, 중복탭 감지 등 "결과 페이지로 navigate
 * 직전"에서만 호출한다.
 */
function exitFullscreenSafely(): void {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {
        /* non-fatal: 다음 페이지에서 풀스크린이 남아도 사용자가 ESC 로 빠질 수 있다 */
      });
    }
  } catch {
    /* non-fatal */
  }
}

function formatRemaining(ms: number) {
  if (ms <= 0) return '0분 0초';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}분 ${s}초`;
}

