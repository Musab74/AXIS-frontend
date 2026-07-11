import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { PDFViewer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { CertificatePdfDocument } from '@/components/CertificatePdfDocument';
import { CertificateVerifyQr, buildCertificateVerifyQrUrl } from '@/components/CertificateVerifyQr';
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
import { demoApi, proctorApi, aiProctorApi, type CertType, type CertLevel } from '@/services/api';
import { useI18n, LangToggle } from '@/i18n';
import { EXAM, ExamPageHeader, ExamExitConfirmModal, InfoRow, StepperNav } from '@/pages/exam/shared';
import { Stepper, type StepperStep } from '@/components/Stepper';
import {
  useProctorMonitorLive,
  ProctorLivePipPreview,
  type LiveVerdict,
  type AiSeverity,
  type AiVerdictDetail,
  type ProctorLiveState,
} from '@/proctor/useProctorMonitorLive';
import { useMicMonitor, type ProctorMicEvent, type MicState } from '../proctor/hooks/useMicMonitor';
import { useFullscreenGuard } from '../proctor/hooks/useFullscreenGuard';
import { useDisplayMonitor } from '../proctor/hooks/useDisplayMonitor';
import type { DisplayState } from '../proctor/hooks/useDisplayMonitor';
import { useDuplicateTabGuard } from '../proctor/hooks/useDuplicateTabGuard';
import {
  LiveWarningOverlay,
  computeActiveWarning,
  type WarningEntry,
  type WarningKind,
} from '../proctor/overlays/LiveWarningOverlay';

// Display limits shown in the UI cards (cosmetic — gives the feel of the real exam)
const DISPLAY_LIMITS = {
  voice: 3,
  gaze: 3,
  pageLeave: 3,
} as const;

// Demo always runs for 15 minutes regardless of what the backend paper says.
// The real exam respects paper.durationMin; the demo is a fixed taster.
const DEMO_DURATION_MIN = 15;

// Total accumulated violations that auto-terminate the demo and bounce the
// user back home. Real exam terminates on 3 strikes per category; the demo
// is intentionally far more forgiving (it's a sandbox, not a courtroom).
const DEMO_VIOLATION_HOME_LIMIT = 20;

/**
 * Demo-only non-blocking reminder banner. The real exam BLOCKS on multi-
 * display (ExternalDisplayBlocker); the demo is a taster, so we just nag
 * the user with a small warning chip and let them practice anyway. Real
 * exam = one monitor only — message hammered home in copy.
 */
function DemoMultiDisplayNotice({ state, lang }: { state: DisplayState; lang: 'ko' | 'en' }) {
  if (!state.blocked) return null;
  return (
    <div className="bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-2 flex items-start gap-2 text-[#92400E]">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div className="text-[12px] leading-snug">
        <span className="font-semibold">
          {lang === 'ko'
            ? `외부 디스플레이 감지됨 (${state.displayCount}대) — 데모에서는 허용됩니다.`
            : `External display detected (${state.displayCount}). Allowed for the demo only.`}
        </span>{' '}
        {lang === 'ko'
          ? '실제 시험은 반드시 단일 모니터에서만 응시할 수 있습니다.'
          : 'The real exam can only be taken on a single monitor.'}
      </div>
    </div>
  );
}

/** Best-effort exit from fullscreen. Mirrors ExamRunnerPage.exitFullscreenSafely. */
function demoExitFullscreenSafely(): void {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {
        /* non-fatal — the next page can ask the user to press Esc */
      });
    }
  } catch {
    /* non-fatal */
  }
}

interface DemoChoice {
  key: string;
  text: string;
}
interface DemoQuestion {
  id: string;
  stem: string;
  choices: DemoChoice[];
  subjectName: string;
  points: number;
}
interface DemoPracticalTask {
  id: string;
  title: string;
  scenario: string;
  durationMin: number;
  points: number;
  /**
   * 운영기획서 v1.1 canonical L3 practice types: 현업적용형 / 지시설계형 /
   * 분석검증형 / 리스크판단형. May be null for legacy L1/L2 task templates
   * that predate the taxonomy.
   */
  taskType?: string | null;
}
interface DemoPaper {
  certType: CertType;
  level: CertLevel;
  durationMin: number;
  questions: DemoQuestion[];
  /** All levels ship a single representative practical sample (display-only). */
  practicalTasks: DemoPracticalTask[];
  /**
   * @deprecated The server still emits this for one release so older shipped
   * frontends keep rendering the first practical slot. New code should read
   * `practicalTasks` instead — `normalizePracticalTasks()` hydrates the array
   * from this field when the server response only carries the legacy alias.
   */
  practicalTask?: DemoPracticalTask | null;
}

/**
 * Backwards-compat helper. The server now returns `practicalTasks: []`, but
 * older shipped clients only saw `practicalTask: T | null`. Hydrate one from
 * the other so the component code only ever deals with `practicalTasks`.
 */
function normalizePracticalTasks(raw: unknown): DemoPracticalTask[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { practicalTasks?: DemoPracticalTask[] | null; practicalTask?: DemoPracticalTask | null };
  if (Array.isArray(r.practicalTasks)) return r.practicalTasks;
  if (r.practicalTask) return [r.practicalTask];
  return [];
}

/** Maps CSV slug task types (e.g. l3_verify) to human-readable labels. */
function formatPracticalTaskType(
  task: Pick<DemoPracticalTask, 'taskType' | 'title'>,
  lang: 'ko' | 'en',
): string | null {
  const raw = task.taskType?.trim();
  if (!raw) return null;

  const canonical: Record<string, string> = {
    현업적용형: 'Work application',
    지시설계형: 'Instruction design',
    분석검증형: 'Analysis & verification',
    리스크판단형: 'Risk assessment',
  };
  if (canonical[raw]) return lang === 'ko' ? raw : canonical[raw];

  const slug = raw.toLowerCase();
  const bySlug: Record<string, { ko: string; en: string }> = {
    l3_apply: { ko: '현업적용형', en: 'Work application' },
    l3_prompt: { ko: '지시설계형', en: 'Instruction design' },
    l3_verify: { ko: '분석검증형', en: 'Analysis & verification' },
    l3_risk: { ko: '리스크판단형', en: 'Risk assessment' },
  };
  const mapped = bySlug[slug];
  if (mapped) return mapped[lang === 'ko' ? 'ko' : 'en'];

  const compact = (task.title ?? '').replace(/[·\s]/g, '');
  if (compact.includes('현업적용')) return lang === 'ko' ? '현업적용형' : 'Work application';
  if (compact.includes('지시설계')) return lang === 'ko' ? '지시설계형' : 'Instruction design';
  if (compact.includes('분석') || compact.includes('검증')) return lang === 'ko' ? '분석검증형' : 'Analysis & verification';
  if (compact.includes('리스크')) return lang === 'ko' ? '리스크판단형' : 'Risk assessment';

  return raw;
}

interface GradedQuestion {
  questionId: string;
  stem: string;
  subjectName: string;
  selectedChoice: string | null;
  correctAnswer: string | null;
  isCorrect: boolean;
  earned: number;
  points: number;
  choices: DemoChoice[];
}
interface GradeResult {
  certType: CertType;
  level: CertLevel;
  totalEarned: number;
  totalPossible: number;
  totalPct: number;
  subjectBreakdown: { subjectName: string; earned: number; total: number; percentage: number }[];
  breakdown: GradedQuestion[];
}

export interface ViolationRecord {
  id: string;
  kind:
    | WarningKind
    | 'MULTIPLE_FACES'
    | 'IDENTITY_MISMATCH'
    | 'DUPLICATE_TAB'
    | 'AI_FLAG_SUSPICIOUS'
    | 'PHONE_DETECTED';
  ts: number;
  screenshot: string | null;
}

const BRAND_BLUE = '#2563EB';
const CERT_LABEL: Record<CertType, string> = {
  AXIS: 'AXIS',
  AXIS_C: 'AXIS-C',
  AXIS_H: 'AXIS-H',
};
// Runner 와 동일한 인증 종류별 액센트 색.
const CERT_COLORS: Record<CertType, string> = {
  AXIS: BRAND_BLUE,
  AXIS_C: '#16A34A',
  AXIS_H: '#7C3AED',
};

const DEMO_CERT_OPTIONS: {
  id: CertType;
  nameKey: 'cbt.entry.AXIS.name' | 'cbt.entry.AXIS_C.name' | 'cbt.entry.AXIS_H.name';
}[] = [
  { id: 'AXIS', nameKey: 'cbt.entry.AXIS.name' },
  { id: 'AXIS_C', nameKey: 'cbt.entry.AXIS_C.name' },
  { id: 'AXIS_H', nameKey: 'cbt.entry.AXIS_H.name' },
];

const DEMO_LEVEL_OPTIONS: {
  id: CertLevel;
  labelKey: 'cbt.entry.L3.label' | 'cbt.entry.L2.label' | 'cbt.entry.L1.label';
  subKey: 'cbt.entry.L3.sub' | 'cbt.entry.L2.sub' | 'cbt.entry.L1.sub';
}[] = [
  { id: 'L3', labelKey: 'cbt.entry.L3.label', subKey: 'cbt.entry.L3.sub' },
  { id: 'L2', labelKey: 'cbt.entry.L2.label', subKey: 'cbt.entry.L2.sub' },
  { id: 'L1', labelKey: 'cbt.entry.L1.label', subKey: 'cbt.entry.L1.sub' },
];

const GAZE_WARNING_KINDS: ReadonlySet<WarningKind> = new Set(['LOOK_AWAY', 'NO_FACE', 'EYES_CLOSED']);
/** Demo: after Continue, suppress gaze overlays briefly so practice isn't blocked. */
const DEMO_GAZE_DISMISS_MS = 8_000;

const PHONE_CLASS_FLAGS = new Set([
  'PHONE_IN_FRAME',
  'OTHER_DEVICE_IN_FRAME',
  'TABLET_IN_FRAME',
  'LAPTOP_IN_FRAME',
]);

function stripDataUrlPrefix(b64: string): string {
  return b64.replace(/^data:image\/\w+;base64,/, '');
}

/** `<img src>` needs a data URL; uploads want raw base64. */
function toViolationDataUrl(b64: string | null): string | null {
  if (!b64) return null;
  if (b64.startsWith('data:')) return b64;
  return `data:image/jpeg;base64,${b64}`;
}

function normalizeAiViolationKind(flag: string): ViolationRecord['kind'] {
  if (PHONE_CLASS_FLAGS.has(flag)) return 'PHONE_DETECTED';
  if (flag === 'LOOKING_OFF_SCREEN') return 'LOOK_AWAY';
  if (flag === 'SECOND_PERSON_IN_FRAME') return 'MULTIPLE_FACES';
  if (
    flag === 'HEADPHONES_OR_EARBUDS' ||
    flag === 'EARPIECE' ||
    flag === 'SMART_GLASSES' ||
    flag === 'HAT_OR_HOOD' ||
    flag === 'MASK_COVERING_FACE' ||
    flag === 'PAPER_OR_BOOK' ||
    flag === 'WRITING_ON_HAND' ||
    flag === 'HANDS_NEAR_EARS' ||
    flag === 'OTHER_SUSPICIOUS'
  ) {
    return 'AI_FLAG_SUSPICIOUS';
  }
  return 'AI_FLAG_SUSPICIOUS';
}

/** 화면 배치 모드 — Runner 와 동일. single=한 문제, split-lr/tb=두 문제. */
type ExamLayout = 'split-lr' | 'single' | 'split-tb';
/** 화면 테마 — 설정 팝오버의 라이트/다크 토글. */
type ExamTheme = 'light' | 'dark';
/** 문제 영역 확대/축소 — 툴바 우측 +/- 버튼이 제어. 1 = 100%. */
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.1;
const roundZoom = (z: number) => Math.round(z * 10) / 10;

const VIOLATION_ICONS: Record<string, string> = {
  LOOK_AWAY: '👁',
  NO_FACE: '👤',
  EYES_CLOSED: '😴',
  VOICE: '🎙',
  PAGE_LEAVE: '🪟',
  MULTIPLE_FACES: '👥',
  IDENTITY_MISMATCH: '🚫',
  DUPLICATE_TAB: '📑',
  GAZE_AWAY: '👁',
  FULLSCREEN_EXIT: '🪟',
  TAB_SWITCH: '🪟',
  TAB_HIDDEN: '🪟',
  WINDOW_BLUR: '🪟',
  BEFORE_UNLOAD: '🪟',
  PHONE_DETECTED: '📱',
  AI_FLAG_SUSPICIOUS: '🤖',
  AI_FLAG_CONFIRMED: '🤖',
  AUDIO_HIGH: '🎙',
  MIC_DISCONNECTED: '🎙',
  FACE_NOT_DETECTED: '👤',
};

/** Intro screen — pick cert series + level before starting the demo. */
function DemoExamPicker({
  certType,
  level,
  onChange,
}: {
  certType: CertType;
  level: CertLevel;
  onChange: (cert: CertType, lvl: CertLevel) => void;
}) {
  const { t } = useI18n();

  // exam-ready 의 InfoRow 와 동일한 카드 양식(라벨 열 + 값)으로 선택 UI를 구성.
  const rowWrap = `flex items-center ${EXAM.surface.card} ${EXAM.layout.cardPaddingX} ${EXAM.layout.cardPaddingY}`;
  const labelCls = `${EXAM.text.label} ${EXAM.color.muted} shrink-0 w-[clamp(110px,9vw,220px)]`;
  const optBtn = (selected: boolean) =>
    `text-left rounded-xl border px-[clamp(14px,1.1vw,26px)] py-[clamp(10px,0.9vw,18px)] transition-colors ${
      selected
        ? 'shadow-sm'
        : 'border-[var(--exam-border,#E2E8F0)] bg-white hover:border-[var(--exam-text-muted,#94A3B8)]'
    }`;

  return (
    <>
      {/* 시리즈 선택 — InfoRow 와 동일한 카드 양식 */}
      <div className={rowWrap}>
        <span className={labelCls}>{t('demo.picker.cert' as never)}</span>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-[clamp(8px,0.7vw,16px)]">
          {DEMO_CERT_OPTIONS.map((c) => {
            const selected = certType === c.id;
            const accent = CERT_COLORS[c.id];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c.id, level)}
                className={optBtn(selected)}
                style={selected ? { borderColor: accent, backgroundColor: `${accent}14` } : undefined}
              >
                <div
                  className={`${EXAM.text.value} font-bold leading-snug`}
                  style={{ color: selected ? accent : undefined }}
                >
                  {CERT_LABEL[c.id]}
                </div>
                <div className={`${EXAM.text.helper} ${EXAM.color.muted} mt-0.5 line-clamp-2`}>
                  {t(c.nameKey)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 등급 선택 */}
      <div className={rowWrap}>
        <span className={labelCls}>{t('demo.picker.level' as never)}</span>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-[clamp(8px,0.7vw,16px)]">
          {DEMO_LEVEL_OPTIONS.map((l) => {
            const selected = level === l.id;
            const accent = CERT_COLORS[certType];
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onChange(certType, l.id)}
                className={optBtn(selected)}
                style={selected ? { borderColor: accent, backgroundColor: `${accent}14` } : undefined}
              >
                <div
                  className={`${EXAM.text.value} font-bold leading-snug`}
                  style={{ color: selected ? accent : undefined }}
                >
                  {t(l.labelKey)}
                </div>
                <div className={`${EXAM.text.helper} ${EXAM.color.muted} mt-0.5 line-clamp-2`}>
                  {t(l.subKey)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <p className={`${EXAM.text.helper} ${EXAM.color.muted} leading-relaxed`}>
        {t('demo.picker.note' as never)}
      </p>
    </>
  );
}

/**
 * 데모 전용 전체화면 진입 게이트. 데모는 진입~종료까지 브라우저 전체화면으로
 * 진행되므로, 전체화면이 아닌 모든 시점(최초 진입/Esc 로 빠져나온 뒤)에서 이
 * 화면을 띄워 다시 전체화면으로 들어오게 한다. (시험 진행 구간은 자체 exit 처리)
 */
function DemoFullscreenGate({
  onEnter,
  error,
  displayState,
  lang,
}: {
  onEnter: () => void;
  error: string | null;
  displayState: DisplayState;
  lang: 'ko' | 'en';
}) {
  const { t } = useI18n();
  return (
    <div className="h-screen w-screen bg-[#F8FAFC] flex flex-col overflow-hidden">
      <DemoMultiDisplayNotice state={displayState} lang={lang} />
      <ExamPageHeader title={t('demo.gate.title' as never)} hideClock />
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
                {t('demo.gate.title' as never)}
              </h2>
              <p className={`${EXAM.text.body} ${EXAM.color.body} mb-[clamp(20px,1.6vw,40px)] leading-relaxed`}>
                {t('demo.gate.body1' as never)}{' '}
                <span className={`font-semibold ${EXAM.color.ink}`}>{t('demo.gate.bodyFs' as never)}</span>
                {t('demo.gate.body2' as never)}
              </p>
              <button
                type="button"
                onClick={onEnter}
                className={`${EXAM.button.primaryLg} ${EXAM.text.buttonLg}`}
              >
                {t('demo.gate.btn' as never)}
              </button>
              {error && (
                <div className={`mt-[clamp(12px,1vw,24px)] px-4 py-3 ${EXAM.surface.warningBox} ${EXAM.text.helper} ${EXAM.color.warning}`}>
                  {error}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function DemoPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { certType, level } = useParams<{ certType: CertType; level: CertLevel }>();
  const [paper, setPaper] = useState<DemoPaper | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [activeIdx, setActiveIdx] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // 인트로 안내를 exam-ready 처럼 단계별 페이지로 나누기 위한 스텝 인덱스.
  const [introStep, setIntroStep] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradeResult | null>(null);
  /** 결과(⑥) 이후 단계 — 'report' → 'certificate'(⑦) → 'verify'(⑧). */
  const [postStage, setPostStage] = useState<'report' | 'certificate' | 'verify'>('report');
  const [demoCert, setDemoCert] = useState<{
    certNumber: string;
    holderName: string;
    issuedAt: string;
    validUntil: string;
  } | null>(null);
  const [demoCertLoading, setDemoCertLoading] = useState(false);
  const [demoCertError, setDemoCertError] = useState<string | null>(null);

  // 화면 배치 / 테마 / 확대 — Runner 와 동일한 표시 상태.
  const [examLayout, setExamLayout] = useState<ExamLayout>('single');
  const [examTheme, setExamTheme] = useState<ExamTheme>('light');
  const [themeSwitching, setThemeSwitching] = useState(false);
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(() => setZoom((z) => roundZoom(Math.min(ZOOM_MAX, z + ZOOM_STEP))), []);
  const zoomOut = useCallback(() => setZoom((z) => roundZoom(Math.max(ZOOM_MIN, z - ZOOM_STEP))), []);
  const zoomReset = useCallback(() => setZoom(1), []);
  const handleThemeChange = useCallback((next: ExamTheme) => {
    const commit = () => {
      setThemeSwitching(true);
      setExamTheme(next);
    };
    const startVT = (document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<unknown> };
    }).startViewTransition?.bind(document);
    if (!startVT) {
      commit();
      requestAnimationFrame(() => requestAnimationFrame(() => setThemeSwitching(false)));
      return;
    }
    startVT(() => flushSync(commit)).finished.finally(() => setThemeSwitching(false));
  }, []);

  // Strike counters — tracked for display purposes, never cause termination
  const [voiceStrikes, setVoiceStrikes] = useState(0);
  const [gazeStrikes, setGazeStrikes] = useState(0);
  const [pageLeaveStrikes, setPageLeaveStrikes] = useState(0);

  // AI proctoring banner
  const [aiBanner, setAiBanner] = useState<{
    severity: AiSeverity;
    captionKo: string | null;
    captionEn: string | null;
  } | null>(null);

  // Violation log with screenshots — the core of the demo feedback system
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const captureRef = useRef<(() => string | null) | null>(null);
  /** Guards against out-of-order demo paper fetches when cert/level changes quickly. */
  const paperFetchIdRef = useRef(0);

  const [confirmExitOpen, setConfirmExitOpen] = useState(false);

  const recordViolation = useCallback(
    (kind: ViolationRecord['kind'], preCapturedB64?: string | null) => {
      const tryCapture = (): string | null => {
        if (preCapturedB64) return toViolationDataUrl(preCapturedB64);
        const raw = captureRef.current?.() ?? null;
        return raw ? toViolationDataUrl(raw) : null;
      };
      const screenshot = tryCapture();
      const ts = Date.now();
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const commit = (shot: string | null) => {
        setViolations((prev) => [...prev, { id, kind, ts, screenshot: shot }]);
        if (shot) {
          void aiProctorApi
            .demoUploadEvidence(ts, kind, stripDataUrlPrefix(shot))
            .catch(() => { /* ignore — demo evidence is best-effort */ });
        }
      };
      if (screenshot) {
        commit(screenshot);
        return;
      }
      // Retry a few frames — camera may not have painted yet at demo start.
      let attempts = 0;
      const retry = () => {
        attempts += 1;
        const shot = tryCapture();
        if (shot || attempts >= 8) {
          commit(shot);
          return;
        }
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    },
    [],
  );

  // Pause-aware timer
  const [pausedMs, setPausedMs] = useState(0);
  const pauseStartedAtRef = useRef<number | null>(null);

  // Warning UI state
  const [warningLog, setWarningLog] = useState<WarningEntry[]>([]);
  const [pageLeaveHoldUntil, setPageLeaveHoldUntil] = useState(0);
  const [voiceHoldUntil, setVoiceHoldUntil] = useState(0);
  const [gazeDismissUntil, setGazeDismissUntil] = useState(0);

  const pushWarning = useCallback((kind: WarningKind) => {
    setWarningLog((log) =>
      [
        {
          id:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          kind,
          ts: Date.now(),
        },
        ...log,
      ].slice(0, 10),
    );
  }, []);

  const handleWarningContinue = useCallback(() => {
    setVoiceHoldUntil(0);
    setPageLeaveHoldUntil(0);
    setGazeDismissUntil(Date.now() + DEMO_GAZE_DISMISS_MS);
  }, []);

  // Same proctoring stack as the real exam — active only while the demo is "live".
  const live = startedAt != null && !result;

  const handleProctorVerdict = useCallback(
    (verdict: LiveVerdict) => {
      // In demo mode we never terminate — just record the violation and warn
      if (verdict === 'MULTIPLE_FACES') {
        recordViolation('MULTIPLE_FACES');
        pushWarning('NO_FACE');
        return;
      }
      if (verdict === 'IDENTITY_MISMATCH') {
        recordViolation('IDENTITY_MISMATCH');
        pushWarning('NO_FACE');
        return;
      }
      if (verdict === 'LOOK_AWAY') {
        pushWarning('LOOK_AWAY');
        recordViolation('LOOK_AWAY');
        setGazeStrikes((n) => n + 1);
      } else if (verdict === 'NO_FACE') {
        pushWarning('NO_FACE');
        recordViolation('NO_FACE');
      } else if (verdict === 'EYES_CLOSED') {
        pushWarning('EYES_CLOSED');
        recordViolation('EYES_CLOSED');
      }
    },
    [recordViolation, pushWarning],
  );

  const handleMicEvent = useCallback(
    (_e: ProctorMicEvent) => {
      pushWarning('VOICE');
      setVoiceHoldUntil(Date.now() + 3_000);
      recordViolation('VOICE');
      setVoiceStrikes((n) => n + 1);
    },
    [recordViolation, pushWarning],
  );

  const handlePageLeave = useCallback(() => {
    pushWarning('PAGE_LEAVE');
    setPageLeaveHoldUntil(Date.now() + 3_000);
    recordViolation('PAGE_LEAVE');
    setPageLeaveStrikes((n) => n + 1);
  }, [recordViolation, pushWarning]);

  const handleAiVerdict = useCallback(
    (severity: AiSeverity, detail: AiVerdictDetail) => {
      setAiBanner({
        severity,
        captionKo: detail.captionKo,
        captionEn: detail.captionEn,
      });
      window.setTimeout(
        () => setAiBanner((b) => (b?.severity === severity ? null : b)),
        8_000,
      );
      const frame = detail.frameBase64 ?? null;
      if (detail.ruleBroken) {
        const flags = detail.ruleBroken.split(', ').filter(Boolean);
        const kinds = new Set<ViolationRecord['kind']>();
        for (const flag of flags) {
          kinds.add(normalizeAiViolationKind(flag));
        }
        for (const kind of kinds) {
          recordViolation(kind, frame);
        }
      } else {
        recordViolation('AI_FLAG_SUSPICIOUS', frame);
      }
    },
    [recordViolation],
  );

  const demoAiReviewFn = useCallback(
    (ts: number, b64: string) => aiProctorApi.demoReview(ts, b64),
    [],
  );

  const proctor = useProctorMonitorLive({
    enabled: live,
    purpose: 'DEMO',
    serverConfirmMs: 30_000,
    aiReviewMs: 5_000,
    onVerdictFired: handleProctorVerdict,
    onAiVerdict: handleAiVerdict,
    demoAiReviewFn,
  });

  // Expose capture function for violation screenshots
  useEffect(() => {
    captureRef.current = proctor.captureFrameBase64;
  }, [proctor.captureFrameBase64]);

  // Mirror ExamRunnerPage: share the proctor camera stream with the mic
  // monitor so the rolling-5s recorder has video+audio to ship to the demo
  // voice-clip endpoint. Never open getUserMedia({video}) twice — we poll
  // proctor.getMediaStream() until it latches.
  const [proctorStream, setProctorStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!live) {
      setProctorStream(null);
      return;
    }
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
  }, [live, proctor]);

  const mic = useMicMonitor({
    enabled: live,
    onEvent: handleMicEvent,
    thresholdMultiplier: 2.5,
    sustainMs: 800,
    baselineMs: 2000,
    // Route voice-clip uploads to /cbt/demo/proctor/voice-clip so demo
    // audio evidence is persisted alongside the screenshot evidence.
    demoMode: true,
    videoStream: proctorStream,
  });
  const fullscreen = useFullscreenGuard({
    sessionId: undefined,
    onLocalEvent: handlePageLeave,
  });

  const fsExitActive = live && startedAt != null && !result && fullscreen.state.exited;

  const display = useDisplayMonitor({
    enabled: !result,
    intervalMs: 5_000,
  });
  const displayState = display.state;

  useDuplicateTabGuard({
    enabled: live,
    channel: 'axis-exam-demo-lock',
    onDuplicateDetected: () => recordViolation('DUPLICATE_TAB'),
  });

  // Reference-face capture
  const referenceCapturedRef = useRef(false);
  const proctorRef = useRef(proctor);
  useEffect(() => {
    proctorRef.current = proctor;
  }, [proctor]);

  useEffect(() => {
    if (!live) {
      referenceCapturedRef.current = false;
      return;
    }
    if (referenceCapturedRef.current) return;
    let cancelled = false;
    let attempts = 0;
    const tryCapture = () => {
      if (cancelled || referenceCapturedRef.current) return;
      attempts += 1;
      const p = proctorRef.current;
      const ready =
        p.state.faceCount === 1 &&
        (p.state.verdict === 'OK' || p.state.verdict === 'PENDING');
      if (ready) {
        const b64 = p.captureFrameBase64();
        if (b64) {
          referenceCapturedRef.current = true;
          proctorApi
            .setDemoReference(b64)
            .catch((err) => console.warn('[demo] setDemoReference failed', err));
          return;
        }
      }
      if (attempts < 75) window.setTimeout(tryCapture, 200);
      else console.warn('[demo] gave up seeding reference face after 15s');
    };
    window.setTimeout(tryCapture, 800);
    return () => {
      cancelled = true;
    };
  }, [live]);

  const rawActiveWarning = live
    ? computeActiveWarning({
        proctorVerdict: proctor.state.verdict,
        micStatus: mic.state.status,
        pageLeaveHoldUntil,
        voiceHoldUntil,
        now,
        strikes: { gaze: gazeStrikes, voice: voiceStrikes, pageLeave: pageLeaveStrikes },
        limits: {
          gaze: DISPLAY_LIMITS.gaze,
          voice: DISPLAY_LIMITS.voice,
          pageLeave: DISPLAY_LIMITS.pageLeave,
        },
      })
    : null;
  const activeWarning =
    rawActiveWarning &&
    gazeDismissUntil > now &&
    GAZE_WARNING_KINDS.has(rawActiveWarning.kind)
      ? null
      : rawActiveWarning;
  const anyWarningActive = activeWarning !== null;

  useEffect(() => {
    if (anyWarningActive) {
      if (pauseStartedAtRef.current == null) {
        pauseStartedAtRef.current = Date.now();
      }
    } else if (pauseStartedAtRef.current != null) {
      const delta = Date.now() - pauseStartedAtRef.current;
      pauseStartedAtRef.current = null;
      setPausedMs((p) => p + delta);
    }
  }, [anyWarningActive]);

  const handleDemoSelection = useCallback(
    (nextCert: CertType, nextLevel: CertLevel) => {
      if (nextCert === certType && nextLevel === level) return;
      navigate(`/demo/${nextCert}/${nextLevel}`, { replace: true });
    },
    [certType, level, navigate],
  );

  useEffect(() => {
    if (!certType || !level) return;
    // Drop stale paper immediately so we never flash the previous cert/level's
    // questions or practical tasks while the new fetch is in flight.
    setPaper(null);
    setLoading(true);
    setError('');
    setAnswers({});
    setActiveIdx(0);
    setStartedAt(null);
    setResult(null);
    setSubmitting(false);
    setViolations([]);
    setGazeStrikes(0);
    setVoiceStrikes(0);
    setPageLeaveStrikes(0);
    setWarningLog([]);
    setGazeDismissUntil(0);
    setPageLeaveHoldUntil(0);
    setVoiceHoldUntil(0);
    setPausedMs(0);
    setPostStage('report');
    setDemoCert(null);
    setDemoCertError(null);

    const fetchId = ++paperFetchIdRef.current;
    demoApi
      .paper(certType, level)
      .then((res) => {
        if (fetchId !== paperFetchIdRef.current) return;
        const data = res.data as DemoPaper;
        // Ignore responses that don't match the route we asked for (stale CDN/cache edge case).
        if (data.certType !== certType || data.level !== level) return;
        setPaper({ ...data, practicalTasks: normalizePracticalTasks(data) });
        setError('');
      })
      .catch((e: any) => {
        if (fetchId !== paperFetchIdRef.current) return;
        setError(e.response?.data?.message || 'Failed to load demo');
      })
      .finally(() => {
        if (fetchId !== paperFetchIdRef.current) return;
        setLoading(false);
      });
  }, [certType, level]);

  // 카메라/마이크 권한을 전체화면 진입 "전"(창 모드)에서 미리 확보한다.
  // 전체화면 상태에서 getUserMedia 프롬프트가 뜨면 브라우저가 프롬프트를 주소창에
  // 표시하려고 전체화면을 강제로 빠져나간다. 따라서 권한 프롬프트는 반드시 창
  // 모드에서 끝내둬야 '데모 시작' 클릭 시 전체화면이 유지된다. 중복 호출/동시
  // 호출을 막기 위해 진행 중 promise 를 캐시한다.
  const mediaProbeRef = useRef<Promise<void> | null>(null);
  const ensureMediaPermission = useCallback((): Promise<void> => {
    if (!mediaProbeRef.current) {
      // navigator.mediaDevices 는 비보안 컨텍스트(HTTP·비 localhost)나 임베드
      // 프리뷰(iframe)에서 undefined 일 수 있다. 그 경우 조용히 skip 해야
      // getUserMedia 접근이 동기적으로 throw 되어 데모 시작이 끊기는 걸 막는다.
      const getUM = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (!getUM) {
        mediaProbeRef.current = Promise.resolve();
      } else {
        mediaProbeRef.current = getUM({ video: true, audio: true })
          .then((probe) => {
            probe.getTracks().forEach((tr) => tr.stop());
          })
          .catch(() => {
            // 거부 시: 프록터 훅이 이후 ERROR verdict 를 노출. 재시도 가능하도록 캐시 해제.
            mediaProbeRef.current = null;
          });
      }
    }
    return mediaProbeRef.current;
  }, []);

  const handleStart = useCallback(async () => {
    // 전체화면은 클릭 제스처 안에서 즉시 요청(best-effort). 권한은 앞 단계에서
    // 미리 확보돼 있으면 프롬프트 없이 즉시 resolve → 전체화면 유지. 권한/전체화면이
    // 실패하거나 미지원이어도 절대 throw 하지 않고 데모는 반드시 시작한다.
    // (전체화면 실패 시엔 이후 전체화면 게이트가 폴백으로 안내한다.)
    const fsPromise = fullscreen.enterFullscreen();
    try {
      await ensureMediaPermission();
    } catch {
      /* 권한 미지원/거부 — 무시 */
    }
    try {
      await fsPromise;
    } catch {
      /* 전체화면 실패 — 게이트가 폴백 */
    }
    setStartedAt(Date.now());
  }, [ensureMediaPermission, fullscreen]);

  // 데모 전체화면 진입(최초/재진입 게이트에서 호출). 카메라·마이크 권한 프롬프트가
  // 전체화면을 깨지 않도록 권한을 창 모드에서 먼저 확보한 뒤 전체화면에 들어간다.
  const handleEnterDemoFullscreen = useCallback(async () => {
    try {
      await ensureMediaPermission();
    } catch {
      /* 권한 미지원/거부 — 무시 */
    }
    await fullscreen.enterFullscreen();
  }, [ensureMediaPermission, fullscreen]);

  // 데모를 떠날 때(마이페이지/홈/접수 이동, 브라우저 뒤로가기 등) 브라우저 전체화면을
  // 확실히 해제한다. document.fullscreenElement 가 있을 때만 동작하므로 StrictMode
  // 이중 마운트에서도 안전(초기엔 전체화면이 아니라 no-op).
  useEffect(() => () => demoExitFullscreenSafely(), []);

  useEffect(() => {
    if (!startedAt || result) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [startedAt, result]);

  const remainingMs = useMemo(() => {
    if (!paper || !startedAt) return paper ? DEMO_DURATION_MIN * 60_000 : 0;
    const livePauseMs =
      pauseStartedAtRef.current != null ? now - pauseStartedAtRef.current : 0;
    return DEMO_DURATION_MIN * 60_000 - (now - startedAt - pausedMs - livePauseMs);
  }, [paper, startedAt, now, pausedMs]);

  useEffect(() => {
    if (paper && startedAt && remainingMs <= 0 && !submitting && !result) {
      doSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs]);

  const color = certType ? CERT_COLORS[certType] : BRAND_BLUE;

  const setAnswer = (qid: string, choice: string | null) => {
    setAnswers((a) => ({ ...a, [qid]: choice }));
  };

  const doSubmit = async () => {
    if (!paper || !certType || !level || submitting) return;
    if (paper.certType !== certType || paper.level !== level) return;
    setSubmitting(true);
    try {
      const payload = paper.questions.map((q) => ({
        questionId: q.id,
        selectedChoice: answers[q.id] ?? null,
      }));
      const res = await demoApi.grade(certType, level, payload);
      setResult(res.data);
      // 데모는 결과·증명서·검증 화면까지 브라우저 전체화면을 유지한다. 전체화면
      // 해제는 데모를 완전히 떠날 때(언마운트 클린업)만 수행한다.
    } catch (e: any) {
      setError(e.response?.data?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  // "Home" exit during the live demo — exits fullscreen first, then routes
  // to the landing page. Used by the in-exam toolbar Home button AND by the
  // 20-violation auto-eject below.
  const handleDemoExitHome = useCallback(() => {
    setConfirmExitOpen(false);
    demoExitFullscreenSafely();
    navigate('/');
  }, [navigate]);

  // Auto-eject: if the candidate racks up DEMO_VIOLATION_HOME_LIMIT
  // violations the demo ends and we send them home. The real exam terminates
  // on 3 strikes per category — this is the demo's own escape hatch so a
  // misbehaving environment can't trap someone forever.
  useEffect(() => {
    if (!live) return;
    if (violations.length < DEMO_VIOLATION_HOME_LIMIT) return;
    handleDemoExitHome();
  }, [violations.length, live, handleDemoExitHome]);

  /* ── Error state — Runner 와 동일한 라이트 danger 카드 ── */
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6">
        <div className={`max-w-md w-full ${EXAM.surface.dangerBox} p-8 text-center`}>
          <div className="mx-auto w-12 h-12 rounded-full bg-[#FECACA] flex items-center justify-center mb-4">
            <AlertTriangle className={`w-6 h-6 ${EXAM.color.danger}`} />
          </div>
          <p className={`${EXAM.text.body} ${EXAM.color.danger} leading-relaxed mb-5`}>{error}</p>
          <button
            type="button"
            onClick={() => navigate('/mypage')}
            className={`${EXAM.button.outlineLg} ${EXAM.text.button} w-auto! px-6`}
          >
            {lang === 'ko' ? '마이페이지로' : 'Back to My Page'}
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading state — Runner 와 동일 ── */
  const paperMatchesRoute =
    paper != null && certType != null && level != null && paper.certType === certType && paper.level === level;
  if (loading || !paperMatchesRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className={`w-8 h-8 animate-spin ${EXAM.color.brand}`} />
          <span className={`${EXAM.text.helper} ${EXAM.color.muted}`}>
            {lang === 'ko' ? '데모 불러오는 중…' : 'Loading demo…'}
          </span>
        </div>
      </div>
    );
  }

  // ── 데모 전체화면 게이트 (진입~종료 전 구간) ──────────────────────────
  // 데모는 인트로·시험·결과·증명서·검증까지 브라우저 전체화면으로 진행된다.
  // 시험 진행(live) 구간은 자체 exit 처리(FullscreenExitModal + strike)가 있으므로
  // 여기서 제외하고, 그 외 모든 화면에서 전체화면이 아니면(최초 진입/Esc 이탈)
  // 진입 게이트를 띄워 다시 전체화면으로 들어오게 한다.
  if (!fullscreen.state.active && !live) {
    return (
      <DemoFullscreenGate
        onEnter={() => void handleEnterDemoFullscreen()}
        error={fullscreen.state.error}
        displayState={displayState}
        lang={lang}
      />
    );
  }

  // ── ⑥/⑦/⑧ Post-result screens ──────────────────────────────────────
  // 결과 리포트 → 체험용 자격증 → 검증 데모 + 접수 CTA. 각 단계는 같은
  // result/violations 데이터를 공유하므로 postStage 만 전환합니다.
  if (result) {
    const handleRetry = () => {
      setResult(null);
      setAnswers({});
      setActiveIdx(0);
      setStartedAt(null);
      setViolations([]);
      setGazeStrikes(0);
      setVoiceStrikes(0);
      setPageLeaveStrikes(0);
      setWarningLog([]);
      setGazeDismissUntil(0);
      setPageLeaveHoldUntil(0);
      setVoiceHoldUntil(0);
      setPausedMs(0);
      setPostStage('report');
      setDemoCert(null);
      setDemoCertError(null);
      if (certType && level) {
        setPaper(null);
        setLoading(true);
        const fetchId = ++paperFetchIdRef.current;
        demoApi
          .paper(certType, level)
          .then((res) => {
            if (fetchId !== paperFetchIdRef.current) return;
            const data = res.data as DemoPaper;
            if (data.certType !== certType || data.level !== level) return;
            setPaper({ ...data, practicalTasks: normalizePracticalTasks(data) });
          })
          .finally(() => {
            if (fetchId !== paperFetchIdRef.current) return;
            setLoading(false);
          });
      }
    };

    if (postStage === 'certificate') {
      return (
        <>
          <DemoCertificateView
            result={result}
            color={color}
            lang={lang}
            loading={demoCertLoading}
            error={demoCertError}
            cert={demoCert}
            onIssue={async () => {
              if (!certType || !level) return;
              setDemoCertLoading(true);
              setDemoCertError(null);
              try {
                const { data } = await demoApi.issueCertificate(certType, level);
                setDemoCert({
                  certNumber: data.certNumber,
                  holderName: data.holderName,
                  issuedAt: data.issuedAt,
                  validUntil: data.validUntil,
                });
              } catch (e: any) {
                setDemoCertError(e?.response?.data?.message || 'Failed to issue demo certificate');
              } finally {
                setDemoCertLoading(false);
              }
            }}
            onContinue={() => setPostStage('verify')}
            onBack={() => setPostStage('report')}
            onHome={() => navigate('/')}
          />
        </>
      );
    }

    if (postStage === 'verify') {
      return (
        <>
          <DemoVerifyView
            result={result}
            cert={demoCert}
            color={color}
            lang={lang}
            onApply={() => navigate('/apply')}
            onMyPage={() => navigate('/mypage')}
            onBack={() => setPostStage('certificate')}
            onHome={() => navigate('/')}
          />
        </>
      );
    }

    return (
      <>
        <DemoResultView
          result={result}
          violations={violations}
          gazeStrikes={gazeStrikes}
          voiceStrikes={voiceStrikes}
          pageLeaveStrikes={pageLeaveStrikes}
          color={color}
          lang={lang}
          onRetry={handleRetry}
          onIssueCert={() => setPostStage('certificate')}
          onHome={() => navigate('/')}
        />
      </>
    );
  }

  // ── Intro screen (before user clicks Start) — exam-ready 스텝 방식 ───
  if (!startedAt) {
    if (!certType || !level) return null;
    const certLabel = `${CERT_LABEL[certType]} · ${level}`;
    const venueLabel = lang === 'ko' ? '온라인 CBT (감독)' : 'Online CBT (proctored)';

    const INTRO_STEPS: StepperStep[] = [
      { label: lang === 'ko' ? '시험 선택' : 'Select' },
      { label: lang === 'ko' ? '시험 정보' : 'Exam Info' },
      { label: lang === 'ko' ? '본인인증 생략' : 'Identity' },
      { label: lang === 'ko' ? '데모 안내' : 'Demo Notes' },
      { label: lang === 'ko' ? '감시 규칙' : 'Proctoring' },
    ];
    const lastIntroStep = INTRO_STEPS.length - 1;
    const goIntroPrev = () => {
      if (introStep === 0) navigate('/mypage');
      else setIntroStep((s) => s - 1);
    };
    const goIntroNext = () => {
      if (introStep < lastIntroStep) {
        // 마지막(감시 규칙) 단계로 들어갈 때 카메라/마이크 권한을 창 모드에서 미리
        // 확보한다. 그래야 '데모 시작' 클릭 시 프롬프트 없이 전체화면이 유지된다.
        if (introStep === lastIntroStep - 1) void ensureMediaPermission();
        setIntroStep((s) => s + 1);
        return;
      }
      void handleStart();
    };

    const bulletList = 'list-disc list-outside pl-8 sm:pl-10 space-y-[clamp(10px,0.9vw,18px)]';
    const bulletItem = `${EXAM.text.value} ${EXAM.color.ink} font-medium`;

    return (
      <div className="h-screen w-full bg-[#F8FAFC] flex flex-col overflow-hidden font-sans [&_svg]:stroke-[1.5]">
        <DemoMultiDisplayNotice state={displayState} lang={lang} />
        <ExamPageHeader title={lang === 'ko' ? '무료 데모 시험' : 'Free Demo Exam'} hideClock />

        {/* Stepper — exam-ready 와 동일한 상단 스텝 인디케이터 */}
        <div className={`bg-white border-b border-[#E5E7EB] ${EXAM.layout.containerPx} pt-[clamp(10px,1.2vw,25px)] pb-[clamp(10px,1.1vw,10px)] shrink-0`}>
          <Stepper steps={INTRO_STEPS} currentIndex={introStep} className={EXAM.layout.container} />
        </div>

        <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden">
          <div className={`w-full ${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} h-full flex items-center`}>
            <section className="w-full h-full flex flex-col justify-center">
              <div className="flex items-center justify-between gap-4 mb-[clamp(16px,1.4vw,40px)] shrink-0">
                <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink}`}>{INTRO_STEPS[introStep].label}</h2>
                <div
                  className="inline-flex items-center px-2.5 py-1 rounded-md text-[clamp(12px,0.85vw,18px)] font-semibold shrink-0"
                  style={{ background: `${color}1A`, color }}
                >
                  {certLabel}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* Step 0 — 시험 선택 */}
                {introStep === 0 && (
                  <div className="space-y-[clamp(12px,1vw,28px)]">
                    <DemoExamPicker certType={certType} level={level} onChange={handleDemoSelection} />
                  </div>
                )}

                {/* Step 1 — 시험 정보 */}
                {introStep === 1 && (
                  <div className="space-y-[clamp(12px,1vw,28px)]">
                    <InfoRow label={lang === 'ko' ? '시험명' : 'Exam'} value={certLabel} />
                    <InfoRow
                      label={lang === 'ko' ? '문항 수' : 'Questions'}
                      value={`${paper.questions.length}${lang === 'ko' ? '문항' : ' MCQs'}`}
                    />
                    <InfoRow
                      label={lang === 'ko' ? '시험 시간' : 'Duration'}
                      value={`${DEMO_DURATION_MIN}${lang === 'ko' ? '분' : ' min'}`}
                    />
                    <InfoRow label={lang === 'ko' ? '응시 방식' : 'Mode'} value={venueLabel} />
                  </div>
                )}

                {/* Step 2 — 본인인증 생략 */}
                {introStep === 2 && (
                  <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} min-h-[clamp(360px,48vh,560px)] flex items-center`}>
                    <ul className={bulletList}>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '데모에서는 본인인증(신분증 OCR · 얼굴 대조)을 생략합니다.'
                          : 'For this demo, identity verification (ID OCR + face match) is skipped.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '실제 시험에서는 신분증과 카메라가 반드시 필요합니다.'
                          : 'A government ID and a working camera are required in the real exam.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '얼굴 대조에 실패하면 입장이 거부됩니다.'
                          : 'Failing the face match blocks your entry.'}
                      </li>
                    </ul>
                  </div>
                )}

                {/* Step 3 — 데모 안내 */}
                {introStep === 3 && (
                  <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} min-h-[clamp(360px,48vh,560px)] flex items-center`}>
                    <ul className={bulletList}>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '다음 단계에서 데모를 시작하면 타이머가 시작됩니다.'
                          : 'The timer starts once you begin the demo on the next step.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '문제 간 자유롭게 이동하고 답변을 변경할 수 있습니다.'
                          : 'You can navigate freely between questions and change answers before submitting.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '데모 답안은 저장되지 않으며, 점수는 즉시 계산됩니다.'
                          : 'Demo answers are not stored — your score is computed and shown immediately.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '실제 시험과 동일한 감시 시스템이 작동하지만, 데모에서는 절대 강제 종료되지 않습니다.'
                          : 'The full proctoring system runs, but you will NEVER be terminated in demo mode.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '모든 위반 사항은 스크린샷과 함께 기록되며, 종료 후 AI 분석 리포트를 제공합니다.'
                          : 'All violations are recorded with screenshots; an AI report is shown afterwards.'}
                      </li>
                      <li className={`${bulletItem} ${EXAM.color.muted}`}>
                        {lang === 'ko'
                          ? '이 데모는 자격 인증에 반영되지 않습니다.'
                          : 'This demo is not scored toward certification.'}
                      </li>
                    </ul>
                  </div>
                )}

                {/* Step 4 — 감시 규칙 */}
                {introStep === 4 && (
                  <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} min-h-[clamp(360px,48vh,560px)] flex items-center`}>
                    <ul className={bulletList}>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '데모는 전체화면에서 진행됩니다. 전체화면을 벗어나면 경고가 발생합니다.'
                          : 'The demo runs in fullscreen. Leaving fullscreen triggers a warning.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '카메라가 켜진 상태 — 얼굴 인식과 시선이 모니터링됩니다.'
                          : 'Your camera stays on — face presence and gaze are monitored.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko'
                          ? '마이크가 켜진 상태 — 시험 중 정숙을 유지하세요.'
                          : 'Your microphone stays on — remain silent for the full duration.'}
                      </li>
                      <li className={bulletItem}>
                        {lang === 'ko' ? '하나의 디스플레이만 허용됩니다.' : 'Only one display is allowed.'}
                      </li>
                      <li className={`${bulletItem} ${EXAM.color.danger}`}>
                        {lang === 'ko'
                          ? '실제 시험에서는 규칙을 반복 위반하면 시험이 강제로 종료됩니다.'
                          : 'In the real exam, repeated violations force-terminate the session.'}
                      </li>
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-4">
                {fullscreen.state.error && (
                  <div className={`mb-3 ${EXAM.text.helper} ${EXAM.color.warning}`}>{fullscreen.state.error}</div>
                )}
                <StepperNav
                  onPrev={goIntroPrev}
                  onNext={goIntroNext}
                  prevLabel={
                    introStep === 0 ? (lang === 'ko' ? '마이페이지' : 'My Page') : lang === 'ko' ? '이전' : 'Back'
                  }
                  nextLabel={
                    introStep < lastIntroStep
                      ? lang === 'ko'
                        ? '다음'
                        : 'Next'
                      : lang === 'ko'
                        ? '데모 시작'
                        : 'Start Demo'
                  }
                />
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  // ── Live exam ────────────────────────────────────────────
  const certLabel = `${CERT_LABEL[certType!]} · ${level!}`;
  const remaining = formatRemaining(remainingMs);
  const limitTime = formatRemaining(DEMO_DURATION_MIN * 60_000);
  const timerColor =
    remainingMs < 5 * 60_000 ? '#FFDE65' : remainingMs < 10 * 60_000 ? '#FCD34D' : undefined;

  /* ── 전체화면 게이트 — 시험 도중 Esc 등으로 전체화면을 벗어난 경우 재진입 ── */
  if (!fullscreen.state.active) {
    return (
      <DemoFullscreenGate
        onEnter={() => void handleEnterDemoFullscreen()}
        error={fullscreen.state.error}
        displayState={displayState}
        lang={lang}
      />
    );
  }

  return (
    <div
      data-theme={examTheme}
      className={`exam-root ${themeSwitching ? 'theme-switching' : ''} h-screen overflow-hidden bg-[var(--exam-bg)] text-[var(--exam-text)] flex flex-col font-sans [&_svg]:[stroke-width:1.5]`}
    >
      {/* 감독/AI/마이크 상태는 화면배치 툴바의 알림(벨) 팝오버로 노출 — Runner 와 동일. */}
      <ProctorLivePipPreview videoRef={proctor.videoRef} />
      <DemoMultiDisplayNotice state={displayState} lang={lang} />
      <FullscreenExitModal
        open={fullscreen.state.exited && live}
        warningCount={pageLeaveStrikes}
        threshold={DISPLAY_LIMITS.pageLeave}
        onResume={fullscreen.resumeFullscreen}
      />
      <LiveWarningOverlay
        active={activeWarning}
        log={warningLog}
        strikes={{ gaze: gazeStrikes, voice: voiceStrikes, pageLeave: pageLeaveStrikes }}
        limits={{
          gaze: DISPLAY_LIMITS.gaze,
          voice: DISPLAY_LIMITS.voice,
          pageLeave: DISPLAY_LIMITS.pageLeave,
        }}
        onContinue={handleWarningContinue}
        allowSustainedDismiss
      />

      {/* ─── 헤더: Runner 와 동일한 ExamPageHeader. 제한시간/남은시간 우측. ─── */}
      <div>
        <ExamPageHeader
          title={` ${certLabel}`}
          limitTimeLabel="제한시간"
          limitTime={limitTime}
          remainingTimeLabel="남은시간"
          remainingTime={remaining}
          remainingTimeColor={timerColor}
        />
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* ─── 화면배치 툴바 ─── */}
          <div>
            <DemoLayoutToolbar
              layout={examLayout}
              onLayoutChange={setExamLayout}
              gazeStrikes={gazeStrikes}
              voiceStrikes={voiceStrikes}
              pageLeaveStrikes={pageLeaveStrikes}
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
          </div>

          {/* ─── Body — 문제 카드 영역 ─── */}
          <main className="flex-1 min-h-0 flex overflow-hidden bg-[var(--exam-bg)]" style={{ zoom }}>
            <DemoWrittenView
              questions={paper.questions}
              practicalTasks={paper.practicalTasks}
              activeIdx={activeIdx}
              answers={answers}
              onSelect={setAnswer}
              color={color}
              layout={examLayout}
            />
          </main>
        </div>

        {/* 우측 답안표기란 — 전체 높이 고정 컬럼 */}
        <div className="flex">
          <DemoAnswerSheetAside
            questions={paper.questions}
            practicalTasks={paper.practicalTasks}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            answers={answers}
            onSelect={setAnswer}
            color={color}
          />
        </div>
      </div>

      {/* ─── Footer ─── */}
      <footer className="bg-[var(--exam-surface)] border-t text-[13px] border-[var(--exam-border)] flex items-center justify-between gap-4 px-[clamp(16px,2vw,20px)] py-[clamp(8px,0.4vw,8px)] shrink-0">
        {/* 좌측 — 상태 인디케이터 + 홈 (데모 종료 확인 후 이동) */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className={`inline-flex items-center gap-1.5 ${EXAM.color.brand}`}>
              <span className="w-2 h-2 rounded-full bg-[var(--exam-accent)] shrink-0" />
              {lang === 'ko' ? '자동 저장 중' : 'Auto-saving'}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#16A34A]">
              <span className="w-2 h-2 rounded-full bg-[#16A34A] shrink-0" />
              {lang === 'ko' ? '데모 — 강제 종료 없음' : 'Demo — No termination'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setConfirmExitOpen(true)}
            title={lang === 'ko' ? '홈으로 (데모 종료)' : 'Go home (end demo)'}
            className={`inline-flex items-center gap-1.5 h-[clamp(28px,2vw,38px)] px-3 rounded-md border border-[var(--exam-border)] bg-[var(--exam-surface)] hover:bg-[var(--exam-surface-2)] transition-colors ${EXAM.text.pill} ${EXAM.color.body}`}
          >
            <Home className="w-3.5 h-3.5" />
            {lang === 'ko' ? '홈' : 'Home'}
          </button>
        </div>

        {/* 중앙 — 이전 / 카운트 / 다음 */}
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
            <span className={EXAM.color.muted}> / {paper.questions.length + paper.practicalTasks.length}</span>
          </span>
          <button
            type="button"
            onClick={() =>
              setActiveIdx(
                Math.min(
                  paper.questions.length + paper.practicalTasks.length - 1,
                  activeIdx + 1,
                ),
              )
            }
            disabled={activeIdx >= paper.questions.length + paper.practicalTasks.length - 1}
            className={`h-[clamp(34px,2.4vw,46px)] px-[clamp(14px,1.2vw,26px)] rounded-full border border-[var(--exam-border)] bg-[var(--exam-surface)] hover:bg-[var(--exam-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${EXAM.text.button} ${EXAM.color.body}`}
          >
            {t('common.next')}
          </button>
        </div>

        {/* 우측 — 답안제출 */}
        <div className="flex items-center gap-[clamp(8px,0.8vw,16px)] shrink-0">
          <button
            type="button"
            onClick={doSubmit}
            disabled={submitting}
            className={`h-[clamp(36px,3vw,70px)] px-[clamp(18px,5vw,150px)] rounded-md bg-[var(--exam-accent)] text-white hover:bg-[var(--exam-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${EXAM.text.button}`}
          >
            {submitting ? t('runner.submitting') : t('runner.submit')}
          </button>
        </div>
      </footer>

      <ExamExitConfirmModal
        open={confirmExitOpen}
        variant="demo"
        onContinue={() => setConfirmExitOpen(false)}
        onExit={handleDemoExitHome}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Sub-components — Runner 디자인을 데모 데이터에 맞춰 재사용.
   ═══════════════════════════════════════════════════════════════════ */

/** 화면배치 툴바 — Runner 의 ExamLayoutToolbar 와 동일한 구조(데모 스트라이크 표시). */
function DemoLayoutToolbar({
  layout,
  onLayoutChange,
  gazeStrikes,
  voiceStrikes,
  pageLeaveStrikes,
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
  gazeStrikes: number;
  voiceStrikes: number;
  pageLeaveStrikes: number;
  proctorState: ProctorLiveState;
  micState: MicState;
  aiBanner: { severity: AiSeverity; captionKo: string | null; captionEn: string | null } | null;
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

  const proctorAlert = proctorState.verdict !== 'OK' && proctorState.verdict !== 'PENDING';
  const aiAlert = aiBanner != null;
  const micAlert =
    micState.status === 'DISCONNECTED' ||
    micState.status === 'ERROR' ||
    micState.status === 'VOICE_DETECTED';
  const hasAlert = proctorAlert || aiAlert || micAlert;

  const badges: { Icon: typeof Mic; label: string; n: number; limit: number }[] = [
    { Icon: Monitor, label: 'GAZE', n: gazeStrikes, limit: DISPLAY_LIMITS.gaze },
    { Icon: Mic, label: 'VOICE', n: voiceStrikes, limit: DISPLAY_LIMITS.voice },
    { Icon: Maximize2, label: 'LEAVE', n: pageLeaveStrikes, limit: DISPLAY_LIMITS.pageLeave },
  ];

  return (
    <div className="bg-[var(--exam-surface)] border-b border-[var(--exam-border)] px-[clamp(16px,2vw,48px)] py-[clamp(6px,0.6vw,12px)] flex items-center justify-between gap-3 shrink-0">
      <div className="flex items-center gap-[clamp(10px,1vw,10px)]">
        <span className={`${EXAM.text.pill} ${EXAM.color.muted} font-medium leading-tight mr-2`}>
          화면 <br /> 배치
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

        <span className="self-stretch w-px my-1 bg-[var(--exam-border)]" aria-hidden />

        {/* 확대/축소 */}
        <div className="flex items-center" role="group" aria-label="화면 확대/축소">
          <span className="text-[clamp(12px,0.85vw,18px)] font-medium text-[var(--exam-text-muted,#64748B)] leading-tight mx-2">
            화면 <br /> 비율
          </span>
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

        {/* 데모 스트라이크 배지 — 누적 시에만 표시 (데모는 강제 종료 없음) */}
        {badges
          .filter((b) => b.n > 0)
          .map(({ Icon, label, n, limit }) => (
            <span
              key={label}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FFFBEB] border border-[#FDE68A] ${EXAM.text.pill} ${EXAM.color.warning}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label} {n}/{limit}
            </span>
          ))}
      </div>

      {/* 우측 — 설정 · 알림 팝오버 */}
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
            <ProctorStatusPopover proctorState={proctorState} micState={micState} aiBanner={aiBanner} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 설정 팝오버 — 언어/테마 토글 (Runner 와 동일). */
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
      <div className="absolute -top-1.5 right-[18px] w-3 h-3 bg-[var(--exam-surface-2)] border-l border-t border-[var(--exam-border)] rotate-45" />
      <div className="px-[clamp(14px,1.1vw,20px)] py-[clamp(10px,0.8vw,14px)] border-b border-[var(--exam-border)] bg-[var(--exam-surface-2)] flex items-center gap-2">
        <span className={`${EXAM.text.button} ${EXAM.color.ink} font-bold`}>{t('settingsPop.title')}</span>
      </div>
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

/** 알림(벨) 팝오버 — 감독/AI/마이크 상태 (Runner 와 동일 톤). */
function ProctorStatusPopover({
  proctorState,
  micState,
  aiBanner,
}: {
  proctorState: ProctorLiveState;
  micState: MicState;
  aiBanner: { severity: AiSeverity; captionKo: string | null; captionEn: string | null } | null;
}) {
  const { t, lang } = useI18n();

  const pOk = proctorState.verdict === 'OK' || proctorState.verdict === 'PENDING';
  const pDanger =
    proctorState.verdict === 'ERROR' ||
    proctorState.verdict === 'NO_FACE' ||
    proctorState.verdict === 'MULTIPLE_FACES' ||
    proctorState.verdict === 'IDENTITY_MISMATCH' ||
    proctorState.verdict === 'AI_HIGH';
  const proctorTone: StatusTone = pOk ? 'ok' : pDanger ? 'danger' : 'warn';
  const proctorMsg = pOk ? t('monitorPop.proctorOk') : t(`pb.${proctorState.verdict}` as never);

  const aiTone: StatusTone = aiBanner
    ? aiBanner.severity === 'HIGH'
      ? 'danger'
      : aiBanner.severity === 'MED'
        ? 'warn'
        : 'info'
    : 'ok';
  const aiMsg = aiBanner
    ? lang === 'ko'
      ? aiBanner.captionKo ?? aiBanner.captionEn ?? ''
      : aiBanner.captionEn ?? aiBanner.captionKo ?? ''
    : t('monitorPop.aiOk');

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

function StatusRow({ Icon, tone, message }: { Icon: typeof Monitor; tone: StatusTone; message: string }) {
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

/** 문제 카드 영역 — Runner 의 WrittenView 를 데모 데이터에 맞춰 재사용. */
function DemoWrittenView({
  questions,
  practicalTasks,
  activeIdx,
  answers,
  onSelect,
  color,
  layout,
}: {
  questions: DemoQuestion[];
  practicalTasks: DemoPracticalTask[];
  activeIdx: number;
  answers: Record<string, string | null>;
  onSelect: (qid: string, choice: string | null) => void;
  color: string;
  layout: ExamLayout;
}) {
  const { lang } = useI18n();
  const mainScrollRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0 });
  }, [activeIdx]);

  // 실습 슬롯: MCQ 다음 1자리 (모든 레벨 공통). 답안은 저장하지 않음(채점 X).
  const practicalIdx = activeIdx - questions.length;
  const practicalTask =
    practicalIdx >= 0 && practicalIdx < practicalTasks.length ? practicalTasks[practicalIdx] : null;
  if (practicalTask) {
    return (
      <section
        ref={mainScrollRef}
        className="flex-1 min-h-0 min-w-0 px-[clamp(16px,2vw,48px)] py-[clamp(16px,1.4vw,40px)] overflow-y-auto overscroll-contain"
      >
        <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding}`}>
          <div className="flex items-center gap-3 mb-[clamp(12px,1vw,24px)] flex-wrap">
            <span className={`${EXAM.text.cardHeading} ${EXAM.color.brand} font-bold tabular-nums`}>
              {lang === 'ko' ? '실습' : 'Practical'} {practicalIdx + 1}/{practicalTasks.length}
            </span>
            <span className={`ml-1 inline-flex items-center px-2.5 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]`}>
              {formatPracticalTaskType(practicalTask, lang) ?? (lang === 'ko' ? '실습 (참고)' : 'Practice (preview)')}
            </span>
            <span className={`inline-flex items-center px-2 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-surface-2)] ${EXAM.color.body}`}>
              {practicalTask.points}pt
            </span>
            <span className={`inline-flex items-center px-2 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[#FFFBEB] text-[#A16207] border border-[#FDE68A]`}>
              {lang === 'ko' ? '데모 — 답안 미저장' : 'Demo — answers not saved'}
            </span>
          </div>
          <h2 className={`${EXAM.text.value} ${EXAM.color.ink} leading-[1.6] mb-3`}>{practicalTask.title}</h2>
          <p className={`${EXAM.text.body} ${EXAM.color.body} leading-[1.8] whitespace-pre-line mb-[clamp(16px,1.4vw,32px)]`}>
            {practicalTask.scenario}
          </p>
          <label className={`${EXAM.text.helper} ${EXAM.color.muted} font-semibold mb-2 block`}>
            {lang === 'ko' ? '연습용 작성란 (제출 시 저장되지 않음)' : 'Practice area (not saved on submit)'}
          </label>
          <textarea
            placeholder={
              lang === 'ko'
                ? '실제 시험에서는 여기에 작성한 답안이 채점에 사용됩니다. 데모에서는 저장되지 않습니다.'
                : 'In the real exam, what you write here is used for grading. In the demo it is not saved.'
            }
            className="w-full min-h-[200px] rounded-md border border-[var(--exam-border)] bg-[var(--exam-surface)] text-[var(--exam-text)] p-3 leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--exam-accent)]"
          />
        </div>
      </section>
    );
  }

  const active = questions[activeIdx];
  if (!active) return <div className={`p-8 ${EXAM.color.muted}`}>No questions in paper.</div>;

  const visibleIdx =
    layout === 'single'
      ? [activeIdx]
      : [activeIdx, activeIdx + 1].filter((i) => i >= 0 && i < questions.length);
  const fillHeight = layout !== 'split-tb';
  const cardsWrapCls =
    layout === 'split-lr'
      ? 'flex flex-row gap-[clamp(12px,1.2vw,28px)]'
      : layout === 'split-tb'
        ? 'flex flex-col gap-[clamp(12px,1.2vw,28px)]'
        : `flex ${EXAM.layout.container}`;

  const renderCard = (q: DemoQuestion, qIdx: number) => (
    <div key={q.id} className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} ${fillHeight ? 'flex-1 min-h-0 overflow-y-auto' : ''}`}>
      <div className="flex items-center gap-3 mb-[clamp(12px,1vw,24px)] flex-wrap">
        <span className={`${EXAM.text.cardHeading} ${EXAM.color.brand} font-bold tabular-nums`}>Q.{qIdx + 1}</span>
        <span className={`${EXAM.text.helper} ${EXAM.color.muted} tabular-nums`}>/ {questions.length}</span>
        <span className={`ml-1 inline-flex items-center px-2.5 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]`}>
          {q.subjectName}
        </span>
        <span className={`inline-flex items-center px-2 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[var(--exam-surface-2)] ${EXAM.color.body}`}>
          {q.points}pt
        </span>
      </div>

      <h2 className={`${EXAM.text.value} ${EXAM.color.ink} leading-[1.75] mb-[clamp(20px,1.6vw,40px)]`}>{q.stem}</h2>

      <div className="space-y-[clamp(8px,0.7vw,16px)]">
        {q.choices.map((c, i) => {
          const selected = answers[q.id] === c.key;
          const numeral = ['1', '2', '3', '4', '5', '6', '7', '8'][i] ?? `${i + 1}`;
          return (
            <label
              key={c.key}
              className={`flex items-start gap-[clamp(12px,1vw,28px)] rounded-xl cursor-pointer transition-colors ${
                selected
                  ? 'bg-[var(--exam-accent-bg)] border-[var(--exam-accent)]'
                  : 'bg-[var(--exam-surface)] border-[var(--exam-border)] hover:border-[var(--exam-text-muted)] hover:bg-[var(--exam-surface-2)]'
              }`}
              style={selected ? { borderColor: color, backgroundColor: `${color}1A` } : undefined}
            >
              <input
                type="radio"
                name={q.id}
                checked={selected}
                onChange={() => onSelect(q.id, c.key)}
                className="sr-only"
              />
              <span
                className={`shrink-0 w-[clamp(28px,1.7vw,35px)] mt-0.5 h-[clamp(28px,1.7vw,35px)] border rounded-full flex items-center justify-center font-bold transition-colors ${EXAM.text.button}`}
                style={{
                  background: selected ? color : 'var(--exam-surface)',
                  color: selected ? '#FFFFFF' : 'var(--exam-text-muted)',
                  borderColor: 'var(--exam-border)',
                }}
              >
                {numeral}
              </span>
              <span className={`${EXAM.text.body} leading-relaxed ${selected ? EXAM.color.ink : EXAM.color.body}`}>
                {c.text}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
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

/** 답안 표기란 — Runner 의 AnswerSheetAside 를 데모 데이터에 맞춰 재사용. */
function DemoAnswerSheetAside({
  questions,
  practicalTasks,
  activeIdx,
  setActiveIdx,
  answers,
  onSelect,
  color,
}: {
  questions: DemoQuestion[];
  practicalTasks: DemoPracticalTask[];
  activeIdx: number;
  setActiveIdx: (i: number) => void;
  answers: Record<string, string | null>;
  onSelect: (qid: string, choice: string | null) => void;
  color: string;
}) {
  const { lang } = useI18n();
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
      <div className="px-[clamp(12px,1vw,20px)] py-[clamp(10px,1vw,10px)] border-b border-[var(--exam-border)] bg-[var(--exam-surface-2)] text-center shrink-0">
        <div className={`${EXAM.text.cardHeading} ${EXAM.color.ink} font-bold`}>답안 표기란</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={`${g.name}-${g.from}`}>
            <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,8px)] border-b border-[var(--exam-border)] font-semibold ${EXAM.color.ink}`}>
              {g.name}
            </div>
            {Array.from({ length: g.to - g.from + 1 }).map((_, i) => {
              const idx = g.from - 1 + i;
              const q = questions[idx];
              if (!q) return null;
              const isActive = idx === activeIdx;
              return (
                <div key={q.id} className="flex items-stretch border-b border-[var(--exam-border)]">
                  <button
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    title={`${idx + 1}번 문항으로 이동`}
                    className={`w-[clamp(40px,3vw,56px)] shrink-0 flex items-center justify-center tabular-nums font-semibold transition-colors ${EXAM.text.helper} ${
                      isActive
                        ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                        : 'bg-[var(--exam-surface-2)] text-[var(--exam-text-muted)] hover:bg-[var(--exam-surface)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                  <div className="flex-1 flex items-center gap-[clamp(6px,0.7vw,14px)] px-[clamp(10px,1vw,20px)] py-[clamp(6px,0.6vw,12px)]">
                    {q.choices.map((c, ci) => {
                      const selected = answers[q.id] === c.key;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => onSelect(q.id, c.key)}
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
        {practicalTasks.length > 0 && (
          <div>
            <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,8px)] border-b border-[var(--exam-border)] font-semibold ${EXAM.color.ink}`}>
              실습
            </div>
            {practicalTasks.map((task, i) => {
              const idx = questions.length + i;
              const isActive = activeIdx === idx;
              const typeLabel = formatPracticalTaskType(task, lang) ?? (lang === 'ko' ? '연습용' : 'Practice');
              return (
                <div key={task.id} className="flex items-stretch border-b border-[var(--exam-border)]">
                  <button
                    type="button"
                    onClick={() => setActiveIdx(idx)}
                    title={`실습 ${i + 1}번 문항으로 이동`}
                    className={`w-[clamp(40px,3vw,56px)] shrink-0 flex items-center justify-center tabular-nums font-semibold transition-colors ${EXAM.text.helper} ${
                      isActive
                        ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                        : 'bg-[var(--exam-surface-2)] text-[var(--exam-text-muted)] hover:bg-[var(--exam-surface)]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                  <div className={`flex-1 flex items-center gap-2 px-[clamp(10px,1vw,20px)] py-[clamp(6px,0.6vw,12px)] ${EXAM.text.helper} ${EXAM.color.muted}`}>
                    <span className="truncate" title={typeLabel}>
                      {typeLabel}
                    </span>
                    <span className="text-[10px] opacity-60">
                      · {lang === 'ko' ? '미채점' : 'Not graded'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

// ─── Result View with AI Analysis — 라이트 EXAM 테마 ───────────────────────

function DemoResultView({
  result,
  violations,
  gazeStrikes,
  voiceStrikes,
  pageLeaveStrikes,
  color,
  lang,
  onRetry,
  onIssueCert,
  onHome,
}: {
  result: GradeResult;
  violations: ViolationRecord[];
  gazeStrikes: number;
  voiceStrikes: number;
  pageLeaveStrikes: number;
  color: string;
  lang: 'ko' | 'en';
  onRetry: () => void;
  onIssueCert: () => void;
  onHome: () => void;
}) {
  const { t } = useI18n();
  const passed = result.totalPct >= 60;
  const totalViolations = violations.length;
  const wouldHaveBeenTerminated = gazeStrikes >= 3 || voiceStrikes >= 3 || pageLeaveStrikes >= 3;

  const tType = (type: string): string => {
    const key = `evidence.type.${type}`;
    const res = t(key as never);
    return res === key ? type : res;
  };
  const tSev = (sev: string): string => {
    const key = `severity.${sev}`;
    const res = t(key as never);
    return res === key ? sev : res;
  };

  const violationSummary = violations.reduce<Record<string, number>>((acc, v) => {
    acc[v.kind] = (acc[v.kind] || 0) + 1;
    return acc;
  }, {});

  const aiAnalysis = generateAiAnalysis({
    result,
    violations,
    gazeStrikes,
    voiceStrikes,
    pageLeaveStrikes,
    lang,
    wouldHaveBeenTerminated,
  });

  const [expandedViolation, setExpandedViolation] = useState<string | null>(null);
  // 브리프의 3블록(감독 요약 / 실전 코칭 / 점수 참고용)을 탭으로 표현. 기본 = 감독 요약.
  const [activeTab, setActiveTab] = useState<'summary' | 'coaching' | 'score'>('summary');

  const certLabel = `${CERT_LABEL[result.certType]} · ${result.level}`;

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex flex-col overflow-hidden font-sans [&_svg]:stroke-[1.5]">
      <ExamPageHeader title={lang === 'ko' ? '데모 결과 리포트' : 'Demo Exam Report'} hideClock />
      {/* 액션 바 — 배지 + 이 페이지 전용 컨트롤 */}
      <div className="bg-[var(--exam-surface,#fff)] border-b border-[var(--exam-border,#E5E7EB)] shrink-0">
        <div className="max-w-[clamp(720px,65vw,2200px)] mx-auto px-[clamp(16px,2vw,48px)] py-[clamp(10px,0.9vw,18px)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-[clamp(12px,0.85vw,18px)] font-semibold"
            style={{ background: `${color}1A`, color }}
          >
            {certLabel}
          </span>
          <div data-tour="result-actions" className="flex items-center gap-2.5">
            <button
              onClick={onHome}
              className={`inline-flex items-center gap-1.5 h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.button}`}
            >
              <Home className="w-4 h-4" />
              {lang === 'ko' ? '홈으로' : 'Home'}
            </button>
            <button
              onClick={onRetry}
              className={`h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.button}`}
            >
              {lang === 'ko' ? '다시 응시하기' : 'Try Another Demo'}
            </button>
            <button
              data-tour="result-cert-btn"
              onClick={onIssueCert}
              className={`h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md text-white font-semibold transition-colors ${EXAM.text.button}`}
              style={{ background: color }}
            >
              {lang === 'ko' ? '체험용 자격증 받기 →' : 'Get demo certificate →'}
            </button>
          </div>
          </div>
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[clamp(720px,65vw,2200px)] mx-auto px-[clamp(16px,2vw,48px)] py-[clamp(16px,1.4vw,40px)]">
          {/* Score summary cards */}
          <div data-tour="result-score" className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {/* Score card */}
            <div className={`${EXAM.layout.cardPadding} rounded-xl border ${passed ? EXAM.surface.successBox : EXAM.surface.warningBox}`}>
              <div className={`${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wide mb-2`}>
                {lang === 'ko' ? '총점' : 'Total Score'}
              </div>
              <div className={`text-[clamp(34px,3vw,64px)] font-extrabold ${passed ? EXAM.color.success : EXAM.color.warning}`}>
                {result.totalPct}%
              </div>
              <div className={`${EXAM.text.bodySm} ${EXAM.color.muted} mt-1`}>
                {result.totalEarned} / {result.totalPossible}
              </div>
              <div className={`${EXAM.text.button} font-semibold mt-2 ${passed ? EXAM.color.success : EXAM.color.warning}`}>
                {passed ? (lang === 'ko' ? '합격 기준 충족' : 'PASS') : lang === 'ko' ? '불합격' : 'FAIL'}
              </div>
            </div>

            {/* Violations card */}
            <div className={`${EXAM.layout.cardPadding} rounded-xl border ${totalViolations > 0 ? EXAM.surface.dangerBox : EXAM.surface.card}`}>
              <div className={`${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wide mb-2`}>
                {lang === 'ko' ? '위반 사항' : 'Violations'}
              </div>
              <div className={`text-[clamp(34px,3vw,64px)] font-extrabold ${totalViolations > 0 ? EXAM.color.danger : EXAM.color.muted}`}>
                {totalViolations}
              </div>
              <div className={`${EXAM.text.bodySm} ${EXAM.color.muted} mt-1`}>
                {lang === 'ko' ? '스크린샷 포함 기록' : 'with screenshot evidence'}
              </div>
              {totalViolations > 0 && (
                <div className={`${EXAM.text.helper} ${EXAM.color.danger} mt-2`}>
                  {lang === 'ko' ? '⚠ 실제 시험에서는 문제 됩니다' : '⚠ Would flag in real exam'}
                </div>
              )}
            </div>

            {/* Termination verdict */}
            <div className={`${EXAM.layout.cardPadding} rounded-xl border ${wouldHaveBeenTerminated ? EXAM.surface.dangerBox : EXAM.surface.successBox}`}>
              <div className={`${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wide mb-2`}>
                {lang === 'ko' ? '실제 시험 결과 예측' : 'Real Exam Verdict'}
              </div>
              <div className={`text-[clamp(22px,1.8vw,40px)] font-extrabold ${wouldHaveBeenTerminated ? EXAM.color.danger : EXAM.color.success}`}>
                {wouldHaveBeenTerminated
                  ? lang === 'ko'
                    ? '강제 종료'
                    : 'TERMINATED'
                  : lang === 'ko'
                    ? '정상 진행'
                    : 'NO ISSUE'}
              </div>
              <div className={`${EXAM.text.helper} ${EXAM.color.muted} mt-2`}>
                {lang === 'ko'
                  ? `시선 ${gazeStrikes}/3 · 음성 ${voiceStrikes}/3 · 이탈 ${pageLeaveStrikes}/3`
                  : `Gaze ${gazeStrikes}/3 · Voice ${voiceStrikes}/3 · Leave ${pageLeaveStrikes}/3`}
              </div>
            </div>
          </div>

          {/* Tab navigation — 브리프의 3블록 (① 감독 요약 / ② 실전 코칭 / ③ 점수 참고용). */}
          <div data-tour="result-tabs" className="flex gap-1 mb-6 border-b border-[var(--exam-border,#E5E7EB)]">
            {(
              [
                { key: 'summary' as const, label: lang === 'ko' ? `① 감독 요약 (${totalViolations})` : `① Proctor Summary (${totalViolations})` },
                { key: 'coaching' as const, label: lang === 'ko' ? '② 실전 코칭' : '② Real-Exam Coaching' },
                { key: 'score' as const, label: lang === 'ko' ? '③ 점수 (참고용)' : '③ Score (reference only)' },
              ]
            ).map((tab) => (
              <button
                key={tab.key}
                data-tour={tab.key === 'coaching' ? 'result-coaching-tab' : undefined}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 ${EXAM.text.button} font-semibold border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? `${EXAM.color.brand} border-[var(--exam-accent,#2563EB)]`
                    : `${EXAM.color.muted} border-transparent hover:text-[var(--exam-text,#0F172A)]`
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ② 실전 코칭 — rule-based 코칭(기존 AI 분석 콘텐츠 그대로). */}
          {activeTab === 'coaching' && (
            <div className="space-y-6">
              <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding}`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-[#EFF6FF] flex items-center justify-center text-xl">🤖</div>
                  <div>
                    <div className={`${EXAM.text.button} font-bold ${EXAM.color.ink}`}>
                      {lang === 'ko' ? 'AI 감독관 분석 리포트' : 'AI Proctor Analysis Report'}
                    </div>
                    <div className={`${EXAM.text.helper} ${EXAM.color.muted}`}>
                      {lang === 'ko' ? '데모 시험 행동 분석 결과' : 'Behavioral analysis of your demo exam'}
                    </div>
                  </div>
                </div>

                {aiAnalysis.map((section, i) => (
                  <div key={i} className="mb-5 last:mb-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{section.icon}</span>
                      <span className={`${EXAM.text.button} font-semibold ${EXAM.color.ink}`}>{section.title}</span>
                      {section.severity && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            section.severity === 'HIGH'
                              ? 'bg-[#FEE2E2] text-[#DC2626]'
                              : section.severity === 'MED'
                                ? 'bg-[#FFFBEB] text-[#A16207]'
                                : 'bg-[#F0FDF4] text-[#16A34A]'
                          }`}
                        >
                          {tSev(section.severity)}
                        </span>
                      )}
                    </div>
                    <div className={`${EXAM.text.helper} ${EXAM.color.body} leading-relaxed pl-8 whitespace-pre-line`}>
                      {section.body}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick violation summary with thumbnails */}
              {violations.length > 0 && (
                <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding}`}>
                  <h3 className={`${EXAM.text.button} font-bold ${EXAM.color.ink} mb-4`}>
                    {lang === 'ko' ? '주요 위반 증거 (스크린샷)' : 'Key Violation Evidence (Screenshots)'}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {violations
                      .filter((v) => v.screenshot)
                      .slice(0, 8)
                      .map((v) => {
                        const icon = VIOLATION_ICONS[v.kind] || '⚠';
                        return (
                          <div
                            key={v.id}
                            className="rounded-lg border border-[var(--exam-border,#E5E7EB)] overflow-hidden cursor-pointer hover:border-[#FCA5A5] transition-colors"
                            onClick={() => setExpandedViolation(expandedViolation === v.id ? null : v.id)}
                          >
                            <img
                              src={v.screenshot!}
                              alt={`Violation: ${tType(v.kind)}`}
                              className="w-full aspect-video object-cover"
                            />
                            <div className="p-2 bg-[var(--exam-surface-2,#F8FAFC)]">
                              <div className={`text-[10px] ${EXAM.color.muted}`}>
                                {new Date(v.ts).toLocaleTimeString()}
                              </div>
                              <div className={`${EXAM.text.pill} font-semibold ${EXAM.color.danger} flex items-center gap-1`}>
                                <span>{icon}</span>
                                <span>{tType(v.kind)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  {violations.filter((v) => v.screenshot).length === 0 && (
                    <div className={`${EXAM.text.helper} ${EXAM.color.muted} text-center py-4`}>
                      {lang === 'ko'
                        ? '카메라가 활성화되지 않아 스크린샷이 없습니다.'
                        : 'No screenshots captured — camera may not have been active.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ① 감독 요약 — strike counts, 위반 카테고리/타임라인. */}
          {activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {Object.entries(violationSummary).map(([kind, count]) => {
                  const icon = VIOLATION_ICONS[kind] || '⚠';
                  return (
                    <div key={kind} className={`${EXAM.surface.card} p-4`}>
                      <div className="text-2xl mb-1">{icon}</div>
                      <div className={`${EXAM.text.helper} ${EXAM.color.muted}`}>{tType(kind)}</div>
                      <div className={`text-2xl font-extrabold ${EXAM.color.danger}`}>{count}</div>
                    </div>
                  );
                })}
              </div>

              {violations.length === 0 ? (
                <div className={`${EXAM.surface.successBox} ${EXAM.layout.cardPadding} text-center`}>
                  <div className="text-4xl mb-3">✅</div>
                  <div className={`${EXAM.text.cardHeading} font-bold ${EXAM.color.success}`}>
                    {lang === 'ko' ? '위반 없음!' : 'No violations!'}
                  </div>
                  <div className={`${EXAM.text.bodySm} ${EXAM.color.body} mt-1`}>
                    {lang === 'ko'
                      ? '실제 시험에서도 동일하게 행동하면 문제 없습니다.'
                      : 'Great job! You would pass the proctoring in the real exam.'}
                  </div>
                </div>
              ) : (
                <div className={`${EXAM.surface.card} overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface-2,#F8FAFC)] flex items-center gap-2">
                    <span className={`${EXAM.text.button} font-semibold ${EXAM.color.ink}`}>
                      {lang === 'ko' ? '위반 타임라인' : 'Violation Timeline'}
                    </span>
                    <span className={`${EXAM.text.helper} ${EXAM.color.muted}`}>({violations.length})</span>
                  </div>
                  <div className="divide-y divide-[var(--exam-border,#E5E7EB)]">
                    {violations.map((v) => {
                      const icon = VIOLATION_ICONS[v.kind] || '⚠';
                      const isExpanded = expandedViolation === v.id;
                      return (
                        <div key={v.id}>
                          <button
                            onClick={() => setExpandedViolation(isExpanded ? null : v.id)}
                            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-[var(--exam-surface-2,#F8FAFC)] transition-colors text-left"
                          >
                            <span className="text-lg">{icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className={`${EXAM.text.button} font-medium ${EXAM.color.ink}`}>{tType(v.kind)}</div>
                              <div className={`${EXAM.text.helper} ${EXAM.color.muted}`}>
                                {new Date(v.ts).toLocaleTimeString()}
                              </div>
                            </div>
                            {v.screenshot && (
                              <span className={`text-[10px] ${EXAM.color.brand} px-2 py-0.5 rounded bg-[#EFF6FF]`}>
                                {lang === 'ko' ? '증거 사진' : 'Screenshot'}
                              </span>
                            )}
                            <span className={`${EXAM.color.muted} text-xs`}>{isExpanded ? '▲' : '▼'}</span>
                          </button>
                          {isExpanded && v.screenshot && (
                            <div className="px-4 pb-4">
                              <img
                                src={v.screenshot}
                                alt={`Evidence for ${tType(v.kind)}`}
                                className="w-full max-w-md rounded-lg border border-[var(--exam-border,#E5E7EB)]"
                              />
                              <div className={`text-[10px] ${EXAM.color.muted} mt-1`}>
                                {lang === 'ko' ? '위반 시점의 웹캠 캡처입니다.' : 'Webcam capture at the moment of violation.'}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ③ 점수 (참고용) — 자격 인증에 반영되지 않음을 명시. */}
          {activeTab === 'score' && (
            <div className="space-y-4">
              <div className={`${EXAM.surface.warningBox} px-[clamp(16px,1.4vw,28px)] py-[clamp(10px,1vw,16px)]`}>
                <span className={`${EXAM.text.helper} ${EXAM.color.warning} font-semibold`}>
                  {lang === 'ko'
                    ? '※ 이 점수는 자격 인증에 반영되지 않습니다. 데모 학습용 참고 자료입니다.'
                    : '※ This score is NOT counted toward any certification — reference only.'}
                </span>
              </div>
              <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} mb-4`}>
                <h3 className={`${EXAM.text.button} font-bold ${EXAM.color.ink} mb-3`}>
                  {lang === 'ko' ? '과목별 성적' : 'Subject Breakdown'}
                </h3>
                <div className="space-y-3">
                  {result.subjectBreakdown.map((s) => (
                    <div key={s.subjectName} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className={`${EXAM.text.bodySm} font-medium ${EXAM.color.ink}`}>{s.subjectName}</div>
                        <div className="h-2 bg-[#E2E8F0] rounded mt-1.5 overflow-hidden">
                          <div
                            className="h-full rounded transition-all duration-500"
                            style={{
                              width: `${s.percentage}%`,
                              background:
                                s.percentage >= 60
                                  ? 'linear-gradient(90deg, #10B981, #34D399)'
                                  : s.percentage >= 40
                                    ? 'linear-gradient(90deg, #F59E0B, #FBBF24)'
                                    : 'linear-gradient(90deg, #EF4444, #F87171)',
                            }}
                          />
                        </div>
                      </div>
                      <div className={`${EXAM.text.bodySm} font-mono ${EXAM.color.body} w-14 text-right`}>
                        {s.earned}/{s.total}
                      </div>
                      <div
                        className={`${EXAM.text.bodySm} font-bold w-12 text-right ${
                          s.percentage >= 60 ? EXAM.color.success : s.percentage >= 40 ? EXAM.color.warning : EXAM.color.danger
                        }`}
                      >
                        {s.percentage}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {result.breakdown.map((q, i) => (
                  <div key={q.questionId} className={`${EXAM.surface.card} p-4`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`${EXAM.text.helper} ${EXAM.color.muted}`}>
                        Q{i + 1} · {q.subjectName} · {q.points} pts
                      </span>
                      <span
                        className={`${EXAM.text.pill} font-semibold px-2 py-0.5 rounded ${
                          q.isCorrect ? 'bg-[#F0FDF4] text-[#16A34A]' : 'bg-[#FEE2E2] text-[#DC2626]'
                        }`}
                      >
                        {q.isCorrect ? '✓ Correct' : '✗ Incorrect'}
                      </span>
                    </div>
                    <div className={`${EXAM.text.bodySm} font-medium ${EXAM.color.ink} mb-3`}>{q.stem}</div>
                    <div className="space-y-1.5">
                      {q.choices.map((c) => {
                        const isAnswer = c.key === q.correctAnswer;
                        const isPicked = c.key === q.selectedChoice;
                        let cls = `border-[var(--exam-border,#E5E7EB)] ${EXAM.color.body}`;
                        if (isAnswer) cls = 'border-[#86EFAC] bg-[#F0FDF4] text-[#15803D]';
                        else if (isPicked) cls = 'border-[#FCA5A5] bg-[#FEE2E2] text-[#B91C1C]';
                        return (
                          <div key={c.key} className={`${EXAM.text.bodySm} border rounded-lg px-3 py-2 flex items-center gap-2 ${cls}`}>
                            <span className="font-mono text-xs w-5">{c.key}.</span>
                            <span>{c.text}</span>
                            {isPicked && !isAnswer && (
                              <span className="ml-auto text-[10px] uppercase text-[#DC2626]">Your answer</span>
                            )}
                            {isAnswer && <span className="ml-auto text-[10px] uppercase text-[#16A34A]">Correct</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className={`mt-8 text-center ${EXAM.text.helper} ${EXAM.color.muted} pb-8`}>
            {lang === 'ko'
              ? '이 데모는 자격 인증에 반영되지 않습니다. 실제 시험과 동일한 환경에서 연습할 수 있는 무료 체험입니다.'
              : 'This demo is not scored toward certification. It is a free practice run in an environment identical to the real exam.'}
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── AI Analysis Generator ────────────────────────────────────────────────

interface AnalysisSection {
  icon: string;
  title: string;
  body: string;
  severity?: 'HIGH' | 'MED' | 'LOW';
}

function generateAiAnalysis(input: {
  result: GradeResult;
  violations: ViolationRecord[];
  gazeStrikes: number;
  voiceStrikes: number;
  pageLeaveStrikes: number;
  lang: 'ko' | 'en';
  wouldHaveBeenTerminated: boolean;
}): AnalysisSection[] {
  const { result, violations, gazeStrikes, voiceStrikes, pageLeaveStrikes, lang, wouldHaveBeenTerminated } = input;
  const sections: AnalysisSection[] = [];
  const isKo = lang === 'ko';

  // Overall score analysis
  const passed = result.totalPct >= 60;
  sections.push({
    icon: passed ? '✅' : '❌',
    title: isKo ? '시험 성적 분석' : 'Exam Score Analysis',
    severity: passed ? 'LOW' : 'HIGH',
    body: isKo
      ? `총점 ${result.totalPct}%로 ${passed ? '합격 기준(60%)을 충족했습니다' : '합격 기준(60%)에 미달했습니다'}.\n\n${
          result.subjectBreakdown
            .filter((s) => s.percentage < 60)
            .map((s) => `• ${s.subjectName}: ${s.percentage}% — 추가 학습이 필요합니다.`)
            .join('\n') || '• 모든 과목에서 합격 기준을 충족했습니다.'
        }\n\n${
          result.breakdown.filter((q) => !q.isCorrect).length
        }개 문항을 틀렸습니다. "문제별 결과" 탭에서 오답을 확인하세요.`
      : `You scored ${result.totalPct}%, which ${passed ? 'meets' : 'falls below'} the passing threshold of 60%.\n\n${
          result.subjectBreakdown
            .filter((s) => s.percentage < 60)
            .map((s) => `• ${s.subjectName}: ${s.percentage}% — needs improvement.`)
            .join('\n') || '• All subjects meet the passing threshold.'
        }\n\nYou got ${
          result.breakdown.filter((q) => !q.isCorrect).length
        } question(s) wrong. Check the "Question Results" tab for details.`,
  });

  // Proctoring verdict
  if (wouldHaveBeenTerminated) {
    const reasons: string[] = [];
    if (gazeStrikes >= 3) reasons.push(isKo ? `시선 이탈 ${gazeStrikes}회 (한도: 3회)` : `Gaze violations: ${gazeStrikes} (limit: 3)`);
    if (voiceStrikes >= 3) reasons.push(isKo ? `음성/소음 ${voiceStrikes}회 (한도: 3회)` : `Voice violations: ${voiceStrikes} (limit: 3)`);
    if (pageLeaveStrikes >= 3) reasons.push(isKo ? `화면 이탈 ${pageLeaveStrikes}회 (한도: 3회)` : `Page leave violations: ${pageLeaveStrikes} (limit: 3)`);

    sections.push({
      icon: '⛔',
      title: isKo ? '강제 종료 경고' : 'Termination Warning',
      severity: 'HIGH',
      body: isKo
        ? `실제 시험이었다면 시험이 강제 종료되었을 것입니다!\n\n${reasons.join('\n')}\n\n실제 시험에서는 각 카테고리별 3회 위반 시 즉시 시험이 종료되고, 답안이 제출되지 않으며 불합격 처리됩니다. 다음 시험 전에 시험 환경을 점검하세요.`
        : `In the real exam, your test would have been TERMINATED!\n\n${reasons.join('\n')}\n\nIn the real exam, reaching 3 violations in any category causes immediate termination. Your answers would NOT be submitted and you would receive a failing grade. Please prepare your exam environment before taking the real test.`,
    });
  } else if (violations.length > 0) {
    sections.push({
      icon: '⚠️',
      title: isKo ? '감시 경고' : 'Proctoring Warnings',
      severity: 'MED',
      body: isKo
        ? `총 ${violations.length}건의 위반이 감지되었습니다. 강제 종료 기준에는 도달하지 않았지만, 실제 시험에서는 이 기록이 검토될 수 있습니다.\n\n시선 ${gazeStrikes}/3 · 음성 ${voiceStrikes}/3 · 이탈 ${pageLeaveStrikes}/3\n\n위반 횟수를 줄이기 위해 시험 환경을 개선하세요.`
        : `${violations.length} total violation(s) were detected. While you were not terminated, these events would be reviewed by proctors in the real exam.\n\nGaze ${gazeStrikes}/3 · Voice ${voiceStrikes}/3 · Leave ${pageLeaveStrikes}/3\n\nConsider improving your exam environment to reduce violations.`,
    });
  } else {
    sections.push({
      icon: '🛡️',
      title: isKo ? '감시 결과: 깨끗' : 'Proctoring: Clean',
      severity: 'LOW',
      body: isKo
        ? '축하합니다! 위반 사항이 하나도 없었습니다. 실제 시험에서도 동일하게 행동하면 감시 관련 문제 없이 시험을 완료할 수 있습니다.'
        : 'Congratulations! You had zero violations during the demo. If you maintain this behavior in the real exam, you will have no proctoring issues.',
    });
  }

  // Specific violation analysis
  if (gazeStrikes > 0) {
    sections.push({
      icon: '👁',
      title: isKo ? '시선 이탈 분석' : 'Gaze Deviation Analysis',
      severity: gazeStrikes >= 3 ? 'HIGH' : gazeStrikes >= 2 ? 'MED' : 'LOW',
      body: isKo
        ? `${gazeStrikes}회의 시선 이탈이 감지되었습니다.\n\n💡 개선 팁:\n• 모니터 정면을 바라보세요.\n• 화면 밖의 참고 자료를 보지 마세요.\n• 카메라 위치를 화면 상단 중앙에 맞추세요.\n• 자연스러운 눈 깜빡임은 괜찮지만, 시선이 오래 벗어나면 경고가 발생합니다.`
        : `${gazeStrikes} gaze deviation(s) were detected.\n\n💡 Tips to improve:\n• Keep your eyes on the monitor at all times.\n• Do not look at reference materials outside the screen.\n• Position your camera at the top center of your screen.\n• Natural blinking is fine, but prolonged looking away triggers warnings.`,
    });
  }

  if (voiceStrikes > 0) {
    sections.push({
      icon: '🎙',
      title: isKo ? '음성/소음 분석' : 'Voice/Noise Analysis',
      severity: voiceStrikes >= 3 ? 'HIGH' : voiceStrikes >= 2 ? 'MED' : 'LOW',
      body: isKo
        ? `${voiceStrikes}회의 음성/소음이 감지되었습니다.\n\n💡 개선 팁:\n• 조용한 환경에서 시험을 응시하세요.\n• 문을 닫고 외부 소음을 차단하세요.\n• 혼잣말이나 문제를 소리내어 읽지 마세요.\n• 이어폰/헤드셋 사용 시 마이크 감도를 확인하세요.`
        : `${voiceStrikes} voice/noise event(s) were detected.\n\n💡 Tips to improve:\n• Take the exam in a quiet environment.\n• Close doors and windows to block external noise.\n• Do not read questions aloud or talk to yourself.\n• If using earphones/headset, check microphone sensitivity.`,
    });
  }

  if (pageLeaveStrikes > 0) {
    sections.push({
      icon: '🪟',
      title: isKo ? '화면 이탈 분석' : 'Page Leave Analysis',
      severity: pageLeaveStrikes >= 3 ? 'HIGH' : pageLeaveStrikes >= 2 ? 'MED' : 'LOW',
      body: isKo
        ? `${pageLeaveStrikes}회의 화면 이탈이 감지되었습니다.\n\n💡 개선 팁:\n• 시험 중 Alt+Tab, Cmd+Tab 등 창 전환을 하지 마세요.\n• 전체화면 모드를 유지하세요 (Esc 키 누르지 마세요).\n• 알림 팝업이 뜨지 않도록 "방해 금지" 모드를 켜세요.\n• 다른 앱이나 브라우저 탭을 미리 닫아주세요.`
        : `${pageLeaveStrikes} page leave event(s) were detected.\n\n💡 Tips to improve:\n• Do not Alt+Tab or switch windows during the exam.\n• Stay in fullscreen mode (do not press Esc).\n• Enable "Do Not Disturb" mode to prevent notification popups.\n• Close all other apps and browser tabs before starting.`,
    });
  }

  const phoneViolations = violations.filter((v) => v.kind === 'PHONE_DETECTED').length;
  if (phoneViolations > 0) {
    sections.push({
      icon: '📱',
      title: isKo ? '휴대폰 감지 분석' : 'Phone Detection Analysis',
      severity: phoneViolations >= 2 ? 'HIGH' : 'MED',
      body: isKo
        ? `AI 감독이 ${phoneViolations}회 휴대폰(또는 금지 기기) 사용이 감지되었습니다.\n\n💡 개선 팁:\n• 시험 중 휴대폰을 카메라에 비추지 마세요.\n• 책상 위·무릎 위에 두지 말고 시야 밖에 두세요.\n• 실제 시험에서는 휴대폰 감지 시 경고·종료 대상이 됩니다.`
        : `${phoneViolations} phone or prohibited-device detection(s) were logged by the AI proctor.\n\n💡 Tips:\n• Do not hold your phone in view of the webcam during the exam.\n• Keep it off the desk and out of the camera frame.\n• In the real exam, phone use triggers warnings and can lead to termination.`,
    });
  }

  // Final recommendation
  sections.push({
    icon: '📋',
    title: isKo ? '최종 권장 사항' : 'Final Recommendations',
    body: isKo
      ? `${
          passed && !wouldHaveBeenTerminated
            ? '성적과 감시 결과 모두 양호합니다. 실제 시험에 자신있게 응시하세요!'
            : !passed && wouldHaveBeenTerminated
              ? '성적과 감시 모두 개선이 필요합니다. 학습과 환경 준비를 철저히 해주세요.'
              : !passed
                ? '학습을 더 진행한 후 다시 응시하세요. 감시 환경은 양호합니다.'
                : '감시 환경을 개선하세요. 시험 실력은 충분하지만 위반으로 인해 종료될 수 있습니다.'
        }\n\n실제 시험 전 체크리스트:\n✅ 조용하고 밝은 환경\n✅ 안정적인 인터넷 연결\n✅ 웹캠과 마이크 정상 작동\n✅ 단일 모니터 사용\n✅ 전체화면 유지 가능한 환경\n✅ 다른 앱/탭 모두 종료`
      : `${
          passed && !wouldHaveBeenTerminated
            ? 'Both your score and proctoring behavior look great. You are ready for the real exam!'
            : !passed && wouldHaveBeenTerminated
              ? 'Both your score and proctoring need improvement. Study more and prepare your environment.'
              : !passed
                ? 'Focus on studying — your proctoring behavior is good but you need to improve your score.'
                : 'Your knowledge is solid, but fix your exam environment — violations could terminate your real exam.'
        }\n\nPre-exam checklist:\n✅ Quiet, well-lit environment\n✅ Stable internet connection\n✅ Working webcam and microphone\n✅ Single monitor only\n✅ Fullscreen-capable environment\n✅ All other apps/tabs closed`,
  });

  return sections;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatRemaining(ms: number) {
  if (ms <= 0) return '0분 0초';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}분 ${s}초`;
}

/** 전체화면 이탈 모달 — Runner 의 FullscreenExitModal 과 동일한 라이트 톤(데모는 종료 없음 안내). */
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
  const { t, lang } = useI18n();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fs-exit-title-demo"
    >
      <div className="max-w-md w-full bg-[var(--exam-surface,#fff)] rounded-xl overflow-hidden shadow-2xl border border-[#FECACA]">
        <div className="bg-status-danger px-6 py-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-white" />
          <h2 id="fs-exit-title-demo" className="text-[19px] sm:text-[22px] font-semibold tracking-tight text-white">
            {t('demo.fs.exitTitle' as never)}
          </h2>
        </div>
        <div className="p-6 text-center">
          <p className={`${EXAM.text.body} ${EXAM.color.body} mb-2 leading-relaxed`}>{t('demo.fs.exitBody' as never)}</p>
          <p
            data-tour="fs-exit-warn"
            className={`${EXAM.text.value} ${EXAM.color.danger} font-bold mb-2 tabular-nums`}
          >
            {t('demo.fs.exitWarn' as never, { n: warningCount, limit: threshold })}
          </p>
          <p
            data-tour="fs-exit-demo"
            className={`${EXAM.text.helper} ${EXAM.color.success} mb-6`}
          >
            {lang === 'ko' ? '데모 모드 — 강제 종료되지 않습니다' : 'Demo mode — you will NOT be terminated'}
          </p>
          <button
            data-tour="fs-exit-resume"
            onClick={onResume}
            autoFocus
            className={`w-full h-12 rounded-md bg-status-danger hover:bg-[#B91C1C] text-white transition-colors ${EXAM.text.button}`}
          >
            {lang === 'ko' ? '전체화면 복귀' : 'Resume fullscreen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── ⑦ Trial certificate view ────────────────────────────────────────────
   체험용 자격증을 백엔드(stateless 발급 엔드포인트)에서 받아 PDF 로 미리 보여줍니다.
   "체험용/DEMO/효력 없음" 워터마크는 CertificatePdfDocument 의 demo prop 으로 처리. */
function DemoCertificateView({
  result,
  color,
  lang,
  loading,
  error,
  cert,
  onIssue,
  onContinue,
  onBack,
  onHome,
}: {
  result: GradeResult;
  color: string;
  lang: 'ko' | 'en';
  loading: boolean;
  error: string | null;
  cert: { certNumber: string; holderName: string; issuedAt: string; validUntil: string } | null;
  onIssue: () => void;
  onContinue: () => void;
  onBack: () => void;
  onHome: () => void;
}) {
  // 화면 진입 시 자동으로 1회 발급 시도 (이미 발급되어 있으면 재호출 안 함).
  const triedRef = useRef(false);
  useEffect(() => {
    if (triedRef.current || cert || loading || error) return;
    triedRef.current = true;
    onIssue();
  }, [cert, loading, error, onIssue]);

  // PDF 본문에 박을 QR data URL — verify-cert 페이지로 이동.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cert) return;
    const verifyUrl = `${window.location.origin}/verify-cert`;
    const payload = buildCertificateVerifyQrUrl(verifyUrl, cert.certNumber, cert.holderName);
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#002060', light: '#FFFFFF' },
    }).then((d) => {
      if (!cancelled) setQrDataUrl(d);
    });
    return () => {
      cancelled = true;
    };
  }, [cert]);

  const certLabel = `${CERT_LABEL[result.certType]} · ${result.level}`;
  const pdfDoc = cert ? (
    <CertificatePdfDocument
      certType={result.certType}
      level={result.level}
      holderName={cert.holderName}
      birthDateIso={null}
      certNumber={cert.certNumber}
      issuedAtIso={cert.issuedAt}
      validUntilIso={cert.validUntil}
      qrDataUrl={qrDataUrl}
      demo
    />
  ) : null;

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex flex-col overflow-hidden font-sans [&_svg]:stroke-[1.5]">
      <ExamPageHeader title={lang === 'ko' ? '체험용 자격증' : 'Demo Certificate'} hideClock />
      <div className="bg-[var(--exam-surface,#fff)] border-b border-[var(--exam-border,#E5E7EB)] shrink-0">
        <div className="max-w-[clamp(720px,65vw,2200px)] mx-auto px-[clamp(16px,2vw,48px)] py-[clamp(10px,0.9vw,18px)]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[clamp(12px,0.85vw,18px)] font-semibold"
              style={{ background: `${color}1A`, color }}
            >
              {certLabel}
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[#FEE2E2] text-[#DC2626]`}>
              체험용 · 효력 없음
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onHome}
              className={`inline-flex items-center gap-1.5 h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.button}`}
            >
              <Home className="w-4 h-4" />
              {lang === 'ko' ? '홈으로' : 'Home'}
            </button>
            <button
              onClick={onBack}
              className={`h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.button}`}
            >
              ← {lang === 'ko' ? '리포트로' : 'Back to report'}
            </button>
            <button
              data-tour="cert-continue"
              onClick={onContinue}
              disabled={!cert}
              className={`h-[clamp(40px,2.8vw,56px)] px-[clamp(16px,1.4vw,32px)] rounded-md text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${EXAM.text.button}`}
              style={{ background: color }}
            >
              {lang === 'ko' ? '자격 검증해보기 →' : 'Try verification →'}
            </button>
          </div>
          </div>
        </div>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[clamp(720px,65vw,2200px)] mx-auto px-[clamp(16px,2vw,48px)] py-[clamp(16px,1.4vw,40px)]">
          <div data-tour="cert-info" className={`${EXAM.surface.infoBox} px-[clamp(16px,1.4vw,28px)] py-[clamp(12px,1vw,20px)] mb-6`}>
            <div className={`${EXAM.text.pill} ${EXAM.color.brand} uppercase tracking-wide font-bold mb-1.5`}>
              {lang === 'ko' ? '체험용 자격증 안내' : 'About this demo certificate'}
            </div>
            <ul className={`${EXAM.text.helper} ${EXAM.color.body} space-y-1 list-disc pl-4`}>
              <li>
                {lang === 'ko'
                  ? '실제 자격증과 동일한 양식·QR 검증 흐름을 미리 체험합니다.'
                  : 'Identical layout and QR verify flow as the real certificate — minus the legal weight.'}
              </li>
              <li>
                {lang === 'ko'
                  ? '자격증 번호 앞에 "DEMO-" 가 붙어 있으며, 인증 효력이 없습니다.'
                  : 'The certificate number starts with "DEMO-" and carries no certification authority.'}
              </li>
              <li>
                {lang === 'ko'
                  ? '서버에 저장되지 않으며, 새로고침 시 동일한 번호로 재현되지 않습니다.'
                  : 'Not persisted server-side — refreshing this page issues a new demo number.'}
              </li>
            </ul>
          </div>

          {error ? (
            <div className={`${EXAM.surface.dangerBox} ${EXAM.layout.cardPadding} text-center mb-6`}>
              <p className={`${EXAM.text.body} ${EXAM.color.danger} mb-3`}>{error}</p>
              <button
                onClick={() => {
                  triedRef.current = false;
                  onIssue();
                }}
                className={`${EXAM.button.outlineLg} ${EXAM.text.button} px-6`}
              >
                {lang === 'ko' ? '다시 시도' : 'Retry'}
              </button>
            </div>
          ) : null}

          {loading || !cert ? (
            <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} flex items-center justify-center gap-3 min-h-[300px]`}>
              <Loader2 className={`w-6 h-6 animate-spin ${EXAM.color.brand}`} />
              <span className={`${EXAM.text.body} ${EXAM.color.body}`}>
                {lang === 'ko' ? '체험용 자격증 발급 중…' : 'Issuing demo certificate…'}
              </span>
            </div>
          ) : (
            <>
              <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} mb-4`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <div className={`${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wide mb-1`}>
                      {lang === 'ko' ? '자격증 번호' : 'Certificate No.'}
                    </div>
                    <div className={`${EXAM.text.value} ${EXAM.color.ink} font-bold font-mono break-all`}>
                      {cert.certNumber}
                    </div>
                  </div>
                  <div>
                    <div className={`${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wide mb-1`}>
                      {lang === 'ko' ? '소지자' : 'Holder'}
                    </div>
                    <div className={`${EXAM.text.value} ${EXAM.color.ink} font-bold`}>{cert.holderName}</div>
                  </div>
                </div>
              </div>
              <div
                data-tour="cert-preview"
                className={`${EXAM.surface.card} overflow-hidden`}
                style={{ height: 'min(80vh, 900px)' }}
              >
                {pdfDoc ? (
                  <PDFViewer style={{ width: '100%', height: '100%', border: 'none' }} showToolbar>
                    {pdfDoc}
                  </PDFViewer>
                ) : null}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ─── ⑧ Verification + 접수 CTA view ──────────────────────────────────────
   QR + 검증 미리보기 → 실제 시험 접수 / 마이페이지 분기. */
function DemoVerifyView({
  result,
  cert,
  color,
  lang,
  onApply,
  onMyPage,
  onBack,
  onHome,
}: {
  result: GradeResult;
  cert: { certNumber: string; holderName: string; issuedAt: string; validUntil: string } | null;
  color: string;
  lang: 'ko' | 'en';
  onApply: () => void;
  onMyPage: () => void;
  onBack: () => void;
  onHome: () => void;
}) {
  const certLabel = `${CERT_LABEL[result.certType]} · ${result.level}`;
  const verifyUrl =
    cert
      ? buildCertificateVerifyQrUrl(`${window.location.origin}/verify-cert`, cert.certNumber, cert.holderName)
      : '';

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex flex-col overflow-hidden font-sans [&_svg]:stroke-[1.5]">
      <ExamPageHeader title={lang === 'ko' ? '자격 검증 체험' : 'Verify Demo'} hideClock />
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[clamp(720px,65vw,2200px)] mx-auto px-[clamp(16px,2vw,48px)] py-[clamp(16px,1.4vw,40px)]">
          <div className="flex items-center gap-2.5 mb-6">
            <span
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[clamp(12px,0.85vw,18px)] font-semibold"
              style={{ background: `${color}1A`, color }}
            >
              {certLabel}
            </span>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-md ${EXAM.text.pill} font-semibold bg-[#FEE2E2] text-[#DC2626]`}>
              체험용 · 효력 없음
            </span>
          </div>

          <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mb-3`}>
            {lang === 'ko'
              ? 'QR 코드로 자격 검증을 직접 해보세요'
              : 'Scan the QR to verify the demo certificate'}
          </h2>
          <p className={`${EXAM.text.body} ${EXAM.color.body} leading-relaxed mb-[clamp(20px,1.6vw,40px)]`}>
            {lang === 'ko'
              ? '실제 자격증과 동일하게 QR 을 스캔하면 검증 페이지로 이동합니다. 데모 자격증은 "체험용 자격증입니다 (실제 자격 아님)" 으로 표시됩니다.'
              : 'Scanning the QR opens the public verify page. Demo certificates resolve to "Demo certificate — not a real qualification".'}
          </p>

          <div data-tour="verify-qr" className="grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-6 mb-[clamp(20px,1.6vw,40px)]">
            <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} flex flex-col items-center gap-3`}>
              {cert && verifyUrl ? <CertificateVerifyQr payloadUrl={verifyUrl} size={200} /> : null}
              <div className={`${EXAM.text.helper} ${EXAM.color.muted} text-center`}>
                {lang === 'ko' ? 'QR 스캔 → 검증 페이지' : 'Scan → verify page'}
              </div>
            </div>

            <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding}`}>
              <div className={`${EXAM.text.button} font-bold ${EXAM.color.ink} mb-3`}>
                {lang === 'ko' ? '검증 결과 미리보기' : 'Preview of verification result'}
              </div>
              <div className="space-y-2">
                <ResultPreviewRow label={lang === 'ko' ? '상태' : 'Status'}>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[#FEE2E2] text-[#DC2626]">
                    {lang === 'ko' ? '체험용 · 효력 없음' : 'Demo · No legal force'}
                  </span>
                </ResultPreviewRow>
                <ResultPreviewRow label={lang === 'ko' ? '자격증 번호' : 'Certificate No.'}>
                  <span className="font-mono font-semibold break-all">{cert?.certNumber ?? '—'}</span>
                </ResultPreviewRow>
                <ResultPreviewRow label={lang === 'ko' ? '소지자' : 'Holder'}>
                  <span className="font-semibold">{cert?.holderName ?? '—'}</span>
                </ResultPreviewRow>
                <ResultPreviewRow label={lang === 'ko' ? '자격 종류' : 'Track'}>
                  {certLabel}
                </ResultPreviewRow>
              </div>
              {verifyUrl ? (
                <a
                  href={verifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-4 inline-flex items-center gap-1 ${EXAM.text.helper} ${EXAM.color.brand} hover:underline`}
                >
                  {lang === 'ko' ? '검증 페이지 새 창에서 열기 →' : 'Open verify page in new tab →'}
                </a>
              ) : null}
            </div>
          </div>

          <div className={`${EXAM.surface.infoBox} px-[clamp(16px,1.4vw,28px)] py-[clamp(12px,1vw,20px)] mb-[clamp(20px,1.6vw,40px)]`}>
            <p className={`${EXAM.text.body} ${EXAM.color.body} leading-relaxed`}>
              {lang === 'ko'
                ? '여기까지가 데모 체험입니다. 실제 시험을 응시하시면 효력 있는 자격증을 발급받을 수 있습니다.'
                : 'This is the end of the demo. The real exam issues a legally-recognized certificate.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch gap-3">
            <button
              data-tour="verify-apply"
              onClick={onApply}
              className={`flex-1 h-[clamp(48px,3.6vw,76px)] rounded-md text-white font-semibold transition-colors ${EXAM.text.buttonLg}`}
              style={{ background: color }}
            >
              {lang === 'ko' ? '실제 시험 접수하기' : 'Register for the real exam'}
            </button>
            <button
              data-tour="verify-mypage"
              onClick={onMyPage}
              className={`flex-1 h-[clamp(48px,3.6vw,76px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.buttonLg}`}
            >
              {lang === 'ko' ? '마이페이지로' : 'Go to My Page'}
            </button>
            <button
              onClick={onHome}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 h-[clamp(48px,3.6vw,76px)] rounded-md border border-[var(--exam-border,#E5E7EB)] bg-[var(--exam-surface,#fff)] ${EXAM.color.ink} hover:bg-[var(--exam-surface-2,#F1F5F9)] transition-colors ${EXAM.text.buttonLg}`}
            >
              <Home className="w-4 h-4" />
              {lang === 'ko' ? '홈으로' : 'Home'}
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={onBack}
              className={`${EXAM.text.helper} ${EXAM.color.muted} hover:text-[var(--exam-text,#0F172A)]`}
            >
              ← {lang === 'ko' ? '체험용 자격증 다시 보기' : 'Back to demo certificate'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function ResultPreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b last:border-b-0 border-[var(--exam-border,#E5E7EB)]">
      <span className={`w-28 shrink-0 ${EXAM.text.helper} ${EXAM.color.muted}`}>{label}</span>
      <span className={`flex-1 min-w-0 ${EXAM.text.body} ${EXAM.color.ink}`}>{children}</span>
    </div>
  );
}
