import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Camera,
  Mic,
  Monitor,
  Globe,
  Check,
  AlertTriangle,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { examApi } from '@/services/api';
import { ResultModal, ResultModalButton } from '@/components/ResultModal';
import { Stepper, type StepperStep } from '@/components/Stepper';
import { EXAM, ExamPageHeader, InfoRow, StepperNav } from '@/pages/exam/shared';

type CheckStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail';
type CheckKey = 'device' | 'browser' | 'camera' | 'mic';

interface CheckItem {
  key: CheckKey;
  status: CheckStatus;
  detail: string;
  hint?: string;
}

interface BrowserInfo {
  name: string;
  version: number;
  ok: boolean;
}

interface ExamInfo {
  registrationId: string;
  certType: string;
  level: string;
  examDate?: string;
  examStartTime?: string;
  venue?: string;
  durationMinutes?: number;
}

interface ExamStructure {
  totalMinutes: number;
  writtenMinutes: number;
  writtenQuestions: number;
  practicalMinutes: number;
  practicalTasks: number;
  practicalType: 'tasks' | 'deliverable_essay' | 'none';
}

// Exam structure by level (matching backend exam-spec.ts, 시험 표준 v2.0).
// New L3 sessions run the v2.0 shape: 객관식 50분 + 실습 20분 = 70분. In-flight
// v1.1 sessions keep their server-issued timing (the runner reads
// session.timing / hardDeadline, never this table).
const EXAM_STRUCTURE: Record<string, ExamStructure> = {
  L3: {
    totalMinutes: 70,
    writtenMinutes: 50,
    writtenQuestions: 40,
    practicalMinutes: 20,
    practicalTasks: 4,
    practicalType: 'tasks',
  },
  L2: {
    totalMinutes: 90,
    writtenMinutes: 30,
    writtenQuestions: 30,
    practicalMinutes: 60,
    practicalTasks: 3,
    practicalType: 'tasks',
  },
  L1: {
    totalMinutes: 120,
    writtenMinutes: 30,
    writtenQuestions: 25,
    practicalMinutes: 90,
    practicalTasks: 3, // 1 exec-plan + 2 essays
    practicalType: 'deliverable_essay',
  },
};

// Per-series overrides (matching backend CERT_TIMING_OVERRIDES): AXIS-C L2 runs
// 120 min vs 90 for AXIS/AXIS-H.
function getExamStructure(certType: string | undefined, level: string | undefined): ExamStructure {
  const base = EXAM_STRUCTURE[level || 'L3'] || EXAM_STRUCTURE.L3;
  if (certType === 'AXIS_C' && level === 'L2') {
    return { ...base, totalMinutes: 120, practicalMinutes: 90 };
  }
  return base;
}

// STEPS is built inside the component so labels can go through t().

function detectBrowser(ua: string): BrowserInfo {
  const edge = ua.match(/Edg\/(\d+)/);
  if (edge) return { name: 'Edge', version: Number(edge[1]), ok: Number(edge[1]) >= 90 };
  const chrome = ua.match(/Chrome\/(\d+)/);
  if (chrome) return { name: 'Chrome', version: Number(chrome[1]), ok: Number(chrome[1]) >= 90 };
  const firefox = ua.match(/Firefox\/(\d+)/);
  if (firefox) return { name: 'Firefox', version: Number(firefox[1]), ok: Number(firefox[1]) >= 88 };
  const safari = ua.match(/Version\/(\d+).*Safari/);
  if (safari) return { name: 'Safari', version: Number(safari[1]), ok: Number(safari[1]) >= 14 };
  return { name: 'Unknown', version: 0, ok: false };
}

function isMobileUA(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(ua);
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === 'running') return <Loader2 className="w-4 h-4 animate-spin text-[#2563EB]" />;
  if (status === 'pass') return <Check className="w-4 h-4 text-blue-500" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-[#A16207]" />;
  if (status === 'fail') return <X className="w-4 h-4 text-red-600" />;
  return <span className="w-4 h-4 rounded-full border-[1.5px] border-[#E2E8F0] inline-block" />;
}

const ICONS: Record<CheckKey, typeof Camera> = {
  device: Monitor,
  browser: Globe,
  camera: Camera,
  mic: Mic,
};

function certLabel(certType: string, level: string): string {
  const certNames: Record<string, string> = {
    AXIS: 'AXIS',
    AXIS_C: 'AXIS-C',
    AXIS_H: 'AXIS-H',
  };
  const levelNames: Record<string, string> = {
    L3: 'L3 Starter',
    L2: 'L2 Practitioner',
    L1: 'L1 Leader',
  };
  return `${certNames[certType] || certType} ${levelNames[level] || level}`;
}

export default function ExamReadinessPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();

  const STEPS: StepperStep[] = [
    { label: t('examReady.stepper.info' as never) },
    { label: t('examReady.stepper.notes' as never) },
    { label: t('examReady.stepper.envcheck' as never) },
    { label: t('examReady.stepper.done' as never) },
  ];

  const examInfo = (location.state as { examInfo?: ExamInfo })?.examInfo;
  const isMobile = useMemo(() => isMobileUA(navigator.userAgent), []);

  const [currentStep, setCurrentStep] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const tickRef = useRef<number | null>(null);

  const [items, setItems] = useState<Record<CheckKey, CheckItem>>({
    device: { key: 'device', status: 'pending', detail: '' },
    browser: { key: 'browser', status: 'pending', detail: '' },
    camera: { key: 'camera', status: 'pending', detail: '' },
    mic: { key: 'mic', status: 'pending', detail: '' },
  });
  const [micLevel, setMicLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const setItem = (key: CheckKey, patch: Partial<CheckItem>) =>
    setItems((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const stopStreams = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    // Detach the stream from the <video> preview so Chromium releases the
    // OS-level camera indicator immediately. track.stop() alone is not
    // enough while srcObject still references the (now-ended) stream.
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
        v.srcObject = null;
        v.removeAttribute('src');
        v.load();
      } catch {
        /* non-fatal */
      }
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => stopStreams();
  }, [stopStreams]);

  const runChecks = useCallback(async () => {
    setRunning(true);
    stopStreams();
    setMicLevel(0);
    setItems((p) => ({
      ...p,
      device: { ...p.device, status: 'running' },
      browser: { ...p.browser, status: 'running' },
      camera: { ...p.camera, status: 'running' },
      mic: { ...p.mic, status: 'running' },
    }));

    // 1. Device
    const ua = navigator.userAgent;
    const mobile = isMobileUA(ua);
    const cores = navigator.hardwareConcurrency || 0;
    if (mobile) {
      setItem('device', {
        status: 'fail',
        detail: 'Mobile device detected',
        hint: 'AXIS exams require a PC or laptop. Mobile and tablet devices are not supported.',
      });
    } else {
      setItem('device', {
        status: 'pass',
        detail: cores ? `Desktop · ${cores} CPU cores` : 'Desktop / laptop',
      });
    }

    // 2. Browser
    const browser = detectBrowser(ua);
    if (browser.name === 'Unknown') {
      setItem('browser', {
        status: 'fail',
        detail: 'Unrecognized browser',
        hint: 'Please use the latest version of Chrome.',
      });
    } else if (!browser.ok) {
      setItem('browser', {
        status: 'fail',
        detail: `${browser.name} ${browser.version} (too old)`,
        hint: 'Update to Chrome 90 or newer.',
      });
    } else if (browser.name !== 'Chrome') {
      setItem('browser', {
        status: 'warn',
        detail: `${browser.name} ${browser.version}`,
        hint: 'Chrome is recommended for the best proctoring experience.',
      });
    } else {
      setItem('browser', { status: 'pass', detail: `Chrome ${browser.version}` });
    }

    // 3. Camera
    let videoStream: MediaStream | null = null;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      const track = videoStream.getVideoTracks()[0];
      const settings = track.getSettings();
      setItem('camera', {
        status: 'pass',
        detail: `${track.label || 'Camera'} · ${settings.width ?? '?'}×${settings.height ?? '?'}`,
      });
      if (videoRef.current) videoRef.current.srcObject = videoStream;
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const denied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError';
      const missing = e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError';
      setItem('camera', {
        status: 'fail',
        detail: denied ? 'Permission denied' : missing ? 'No camera detected' : e.message || 'Camera access failed',
        hint: denied
          ? 'Click the camera icon in your browser address bar to allow access, then re-run the check.'
          : missing
          ? 'Connect a webcam and try again.'
          : 'Close other apps that may be using the camera and re-run the check.',
      });
    }

    // 4. Microphone
    let audioStream: MediaStream | null = null;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      const track = audioStream.getAudioTracks()[0];
      setItem('mic', {
        status: 'pass',
        detail: track.label || 'Microphone',
        hint: 'Speak to verify the level meter responds.',
      });

      const Ctx: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch { /* ignore */ }
      }
      const source = ctx.createMediaStreamSource(audioStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      tickRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
        const rms = Math.sqrt(sumSq / buf.length);
        setMicLevel(Math.min(100, Math.round(rms * 400)));
      }, 100);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const denied = e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError';
      const missing = e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError';
      setItem('mic', {
        status: 'fail',
        detail: denied ? 'Permission denied' : missing ? 'No microphone detected' : e.message || 'Microphone access failed',
        hint: denied
          ? 'Allow microphone access in your browser settings, then re-run the check.'
          : missing
          ? 'Connect a microphone and try again.'
          : 'Close other apps that may be using the microphone and re-run the check.',
      });
    }

    // Combine streams so stopStreams() releases everything cleanly later.
    if (videoStream || audioStream) {
      const combined = new MediaStream();
      videoStream?.getTracks().forEach((tr) => combined.addTrack(tr));
      audioStream?.getTracks().forEach((tr) => combined.addTrack(tr));
      streamRef.current = combined;
    }

    setRunning(false);
  }, [stopStreams]);

  useEffect(() => {
    if (currentStep === 2) {
      void runChecks();
    } else {
      stopStreams();
    }
  }, [currentStep, runChecks, stopStreams]);

  const list = useMemo<CheckItem[]>(
    () => [items.device, items.browser, items.camera, items.mic],
    [items],
  );

  const envReady = useMemo(
    () => list.every((i) => i.status === 'pass' || i.status === 'warn'),
    [list],
  );

  const examStructure = getExamStructure(examInfo?.certType, examInfo?.level);
  const totalMinutes = examStructure.totalMinutes;

  const statusPill = (status: CheckStatus) => {
    const map: Record<CheckStatus, { cls: string; labelKey: string }> = {
      pending: { cls: 'text-[#64748B]', labelKey: 'ready.check.status.waiting' },
      running: { cls: 'text-[#1D4ED8]', labelKey: 'ready.check.status.checking' },
      pass: { cls: 'text-[#1D6FE5]', labelKey: 'ready.check.status.pass' },
      warn: { cls: 'text-[#A16207]', labelKey: 'ready.check.status.warn' },
      fail: { cls: 'text-[#DC2626]', labelKey: 'ready.check.status.fail' },
    };
    return { ...map[status], label: t(map[status].labelKey as never) };
  };

  const handleStartExam = async () => {
    if (!examInfo?.registrationId) {
      setError('Registration information missing. Please go back and try again.');
      return;
    }

    setStarting(true);
    setError('');
    stopStreams();

    try {
      const res = await examApi.createFromRegistration(examInfo.registrationId);
      const label = `${certLabel(examInfo.certType, examInfo.level)} — Real Exam`;
      navigate('/proctor', {
        state: {
          next: `/cbt/exam/${res.data.id}`,
          label,
        },
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      const msg = e.response?.data?.message;
      // Backend messages are Korean — map the known identity-verification
      // rejections to a localized string so EN mode isn't mixed-language.
      const isIdentity = !!msg && (msg.includes('신원 확인') || msg.includes('본인확인'));
      setError(isIdentity ? t('examReady.err.identity' as never) : msg ?? 'Failed to start exam. Please try again.');
      setStarting(false);
    }
  };

  // 다음/이전 게이팅. 각 스텝마다 진행 조건을 다르게 적용.
  const canAdvance = (() => {
    if (starting) return false;
    if (currentStep === 2) return envReady && !isMobile;
    if (currentStep === 3) return !isMobile;
    return true;
  })();

  const goPrev = () => {
    if (starting) return;
    if (currentStep === 0) {
      setShowExitConfirm(true);
    } else {
      setCurrentStep((s) => s - 1);
    }
  };

  const handleConfirmExit = async () => {
    setShowExitConfirm(false);
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
    navigate('/mypage');
  };

  const goNext = () => {
    if (!canAdvance) return;
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      // User gesture 안에서 먼저 fullscreen을 요청해 즉시 진입 체감을 만든다.
      // 실패해도 이후 proctor/exam fullscreen guard가 다시 안내한다.
      if (document.documentElement.requestFullscreen) {
        void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
          /* ignore */
        });
      }
      void handleStartExam();
    }
  };

  // 시험 정보가 없으면 마이페이지로 안내
  if (!examInfo) {
    return (
      <div className="min-h-screen w-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className={`w-12 h-12 ${EXAM.color.danger} mx-auto mb-3`} />
          <h2 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mb-2`}>{t('ready.missingInfo' as never)}</h2>
          <p className={`${EXAM.text.body} ${EXAM.color.body} mb-4`}>{t('ready.missingInfoDesc' as never)}</p>
          <button
            onClick={() => navigate('/mypage')}
            className={`px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#1D4ED8] transition-colors ${EXAM.text.button}`}
          >
            {t('ready.goMyPage' as never)}
          </button>
        </div>
      </div>
    );
  }

  return (
    // CBT 전체화면 — 가로/세로 스크롤 없이 모든 컨텐츠가 한 화면에 들어가야 함.
    // h-screen + overflow-hidden으로 뷰포트에 락, main을 flex로 채워서 컨텐츠가
    // 헤더+스텝퍼 제외한 영역에 vertical center로 배치되도록 함.
    <div className="h-screen w-screen bg-[#F8FAFC] flex flex-col overflow-hidden">
      <ExamPageHeader title={t('examReady.title' as never)} />

      {/* Stepper */}
      <div className={`bg-white border-b border-[#E5E7EB] ${EXAM.layout.containerPx} pt-[clamp(10px,1.2vw,25px)] pb-[clamp(10px,1.1vw,10px)] shrink-0`}>
        <Stepper steps={STEPS} currentIndex={currentStep} className={EXAM.layout.container} />
      </div>

      {/* Body — 고정 높이 콘텐츠 프레임으로 제목 위치를 스텝 간 동일하게 유지 */}
      <main className="flex-1 min-h-0 w-full flex flex-col items-center justify-center overflow-hidden">
        <div className={`w-full ${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} h-full flex items-center`}>
          <section className="w-full h-full flex flex-col justify-center">
            <div className="flex items-center justify-between gap-4 mb-[clamp(16px,1.4vw,40px)] shrink-0">
              <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink}`}>
                {STEPS[currentStep].label}
              </h2>
              {currentStep === 2 && (
                <button
                  type="button"
                  onClick={() => void runChecks()}
                  disabled={running}
                  className={`px-3.5 py-2 rounded border cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed bg-white border-[#93C5FD] hover:bg-[#EFF6FF] inline-flex items-center gap-1.5 shrink-0 ${EXAM.text.button} ${EXAM.color.brand}`}
                >
                  <RefreshCw className={`w-4 h-4 ${running ? 'animate-spin' : ''}`} />
                  {running ? t('ready.check.checking' as never) : t('ready.check.recheck' as never)}
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {currentStep === 0 && (
                <StepExamInfo
                  examInfo={examInfo}
                  totalMinutes={totalMinutes}
                  writtenQuestions={examStructure.writtenQuestions}
                  t={t}
                />
              )}

              {currentStep === 1 && <StepWarnings totalMinutes={totalMinutes} t={t} />}

              {currentStep === 2 && (
                <StepEnvCheck
                  list={list}
                  isMobile={isMobile}
                  micLevel={micLevel}
                  videoRef={videoRef}
                  statusPill={statusPill}
                  t={t}
                />
              )}

              {currentStep === 3 && (
                <StepConfirm
                  isMobile={isMobile}
                  totalMinutes={totalMinutes}
                  t={t}
                />
              )}

              {error && (
                <div className={`mt-6 px-4 py-3 ${EXAM.surface.dangerBox} ${EXAM.text.helper} ${EXAM.color.danger}`}>
                  {error}
                </div>
              )}
              {!starting && (
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className={`${EXAM.text.helper} ${EXAM.color.danger}`}>
                    {!canAdvance && isMobile
                      ? t('ready.mobile.desc' as never)
                      : !canAdvance && currentStep === 2 && !envReady
                      ? t('ready.hint.resolve' as never)
                      : !canAdvance && currentStep === 3
                      ? t('examReady.hint.pcOnly' as never)
                      : ''}
                  </p>
                </div>
              )}
            </div>

            <div>
              <StepperNav
                onPrev={goPrev}
                onNext={goNext}
                prevDisabled={starting}
                nextDisabled={!canAdvance}
                nextLabel={currentStep < STEPS.length - 1 ? t('examReady.act.next' as never) : t('examReady.act.identify' as never)}
                isLoading={starting}
                loadingLabel={t('examReady.act.navigating' as never)}
              />

            </div>
          </section>
        </div>
      </main>

      {showExitConfirm && (
        <ResultModal
          title={t('examReady.exit.title' as never)}
          onClose={() => setShowExitConfirm(false)}
          footer={(
            <div className="flex w-full items-center justify-end gap-2">
              <ResultModalButton variant="primary" onClick={() => void handleConfirmExit()}>
                {t('examReady.exit.cta' as never)}
              </ResultModalButton>
            </div>
          )}
        >
          <p className={`${EXAM.text.body} ${EXAM.color.body}`}>
            {t('examReady.exit.prompt' as never)}
          </p>
          <p className={`${EXAM.text.helper} ${EXAM.color.helper} mt-1`}>
            {t('examReady.exit.helper' as never)}
          </p>
        </ResultModal>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 0 — 시험정보
   카드 4개로 시험명/시간/문항수/응시방식 표시
   ───────────────────────────────────────────────────────────── */
function StepExamInfo({
  examInfo,
  totalMinutes,
  writtenQuestions,
  t,
}: {
  examInfo: ExamInfo;
  totalMinutes: number;
  writtenQuestions: number;
  t: (k: never, p?: Record<string, string | number>) => string;
}) {
  const examName = certLabel(examInfo.certType, examInfo.level);
  const onlineLabel = t('examReady.venueOnline' as never);
  const venueLabel = examInfo.venue === 'ONLINE_CBT' ? onlineLabel : examInfo.venue || onlineLabel;

  return (
    <div className="space-y-[clamp(12px,1vw,28px)]">
      <InfoRow label={t('examReady.info.exam' as never)} value={examName} />
      <InfoRow label={t('examReady.info.time' as never)} value={t('examReady.info.minutes' as never, { n: totalMinutes })} />
      <InfoRow label={t('examReady.info.count' as never)} value={t('examReady.info.questions' as never, { n: writtenQuestions })} />
      <InfoRow label={t('examReady.info.mode' as never)} value={venueLabel} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 1 — 시험유의사항
   ───────────────────────────────────────────────────────────── */
function StepWarnings({ totalMinutes, t }: { totalMinutes: number; t: (k: never, p?: Record<string, string | number>) => string }) {
  return (
    <div className="w-full">
      <div className={`${EXAM.surface.card} ${EXAM.layout.cardPadding} min-h-[clamp(360px,48vh,560px)] flex items-center`}>
        <ul className={`list-disc list-outside pl-8 sm:pl-10 ${EXAM.text.value} ${EXAM.color.ink} font-medium space-y-[clamp(10px,0.9vw,18px)]`}>
          <li>{t('ready.warning.noPause' as never)}</li>
          <li>{t('ready.warning.ensureTime' as never, { minutes: totalMinutes + 15 })}</li>
          <li>{t('ready.warning.closeApps' as never)}</li>
          <li>{t('ready.warning.quietPlace' as never)}</li>
          <li>{t('ready.warning.cameraActive' as never)}</li>
          <li className={EXAM.color.danger}>3회 이상 규칙 위반 시 시험이 강제로 종료됩니다.</li>
        </ul>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 2 — 사용환경 점검
   기존 환경 점검 UI를 그대로 옮김
   ───────────────────────────────────────────────────────────── */
interface StepEnvCheckProps {
  list: CheckItem[];
  isMobile: boolean;
  micLevel: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  statusPill: (s: CheckStatus) => { cls: string; label: string };
  t: (k: never, p?: Record<string, string | number>) => string;
}

function StepEnvCheck({
  list,
  isMobile,
  micLevel,
  videoRef,
  statusPill,
  t,
}: StepEnvCheckProps) {
  const titleMap: Record<CheckKey, string> = {
    device: '디바이스',
    browser: '브라우저',
    camera: '카메라',
    mic: '마이크',
  };

  const reqTextMap: Record<CheckKey, string> = {
    device: 'PC 또는 노트북 환경',
    browser: 'Chrome 90 이상 권장',
    camera: '웹캠 연결 및 권한 허용',
    mic: '마이크 연결 및 권한 허용',
  };

  return (
    <div className="space-y-[clamp(8px,0.7vw,14px)]">
      <div className="space-y-[clamp(8px,0.7vw,12px)]">
        {list.map((item) => {
          const Icon = ICONS[item.key];
          const pill = statusPill(item.status);
          return (
            <div
              key={item.key}
              className="rounded-2xl border border-[#E5E7EB] bg-white px-[clamp(20px,1.7vw,30px)] py-[clamp(10px,0.8vw,14px)] min-h-[clamp(76px,8vh,112px)]"
            >
              <div className="flex items-center gap-[clamp(10px,0.8vw,14px)]">
                <div className="w-[clamp(42px,3vw,60px)] h-[clamp(42px,3vw,60px)] rounded-xl bg-[#F8FAFC] flex items-center justify-center shrink-0">
                  <Icon className={`w-[52%] h-[52%] ${EXAM.color.brand}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap align-baseline">
                    <span className={`${EXAM.text.cardHeading} ${EXAM.color.ink}`}>{titleMap[item.key]}</span>
                    <span className={`${EXAM.text.helper} ${EXAM.color.helper} `}>{reqTextMap[item.key]}</span>
                  </div>
                  {item.status === 'running' && (
                    <div className="mt-0.5 inline-flex items-center gap-1.5 text-[#1D4ED8]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className={EXAM.text.helper}>점검 중...</span>
                    </div>
                  )}
                  {item.status !== 'running' && item.detail && (
                    <div className={`${EXAM.text.helper} text-blue-400`}>{item.detail}</div>
                  )}
                  {item.key === 'camera' && item.status === 'pass' && (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="mt-1 w-[clamp(96px,6vw,140px)] h-auto rounded border border-[#E5E7EB] bg-black"
                    />
                  )}
                  {item.key === 'mic' && item.status === 'pass' && (
                    <div className="mt-1">
                      <div className="h-2 w-[clamp(120px,8vw,180px)] bg-[#F8FAFC] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#16A34A] rounded-full transition-[width] duration-100"
                          style={{ width: `${micLevel}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div
                  className={`inline-flex items-center gap-1 bg-transparent px-0 py-0 rounded-none ${EXAM.text.cardHeading} ${pill.cls} shrink-0`}
                >
                  <span className="[&>svg]:w-8 [&>svg]:h-8">
                    <StatusIcon status={item.status} />
                  </span>
                  {pill.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 모바일 차단 안내 */}
      {isMobile && (
        <div className={`${EXAM.surface.dangerBox} p-4`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#FECACA] flex items-center justify-center shrink-0">
              <Monitor className={`w-5 h-5 ${EXAM.color.danger}`} />
            </div>
            <div>
              <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.danger} mb-1`}>
                {t('ready.mobile.title' as never)}
              </h3>
              <p className={`${EXAM.text.body} ${EXAM.color.danger} mb-2`}>{t('ready.mobile.desc' as never)}</p>
              <p className={`${EXAM.text.helper} ${EXAM.color.helper}`}>💡 {t('ready.mobile.hint' as never)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Step 3 — 시험준비 완료
   ───────────────────────────────────────────────────────────── */
function StepConfirm({
  isMobile,
  totalMinutes,
  t,
}: {
  isMobile: boolean;
  totalMinutes: number;
  t: (k: never, p?: Record<string, string | number>) => string;
}) {
  return (
    <div className="space-y-[clamp(8px,0.7vw,14px)]">

      <div className={`rounded-2xl border border-[#E5E7EB] bg-white px-[clamp(20px,1.7vw,30px)] py-[clamp(14px,1vw,20px)] min-h-[clamp(360px,48vh,560px)] flex items-start ${isMobile ? 'opacity-50' : ''}`}>
        <ul className={`list-disc list-outside p-10 ${EXAM.text.value} ${EXAM.color.ink} font-medium space-y-[clamp(10px,0.9vw,18px)]`}>
          <li>{t('examReady.confirm.l1' as never)}</li>
          <li>
            {t('examReady.confirm.l2pre' as never)}
            <span className="text-blue-500">{t('examReady.confirm.l2hl' as never)}</span>
            {t('examReady.confirm.l2post' as never)}
          </li>
          <li>{t('examReady.confirm.l3' as never)}</li>
          <li>{t('examReady.confirm.l4' as never)}</li>
          <li>{t('examReady.confirm.l5' as never)}</li>
          <li className="text-red-500">{t('examReady.confirm.l6' as never)}</li>
        </ul>
      </div>
    </div>
  );
}

