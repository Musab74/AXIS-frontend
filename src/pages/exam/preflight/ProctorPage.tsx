import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Camera, Check, AlertTriangle, X, Loader2, RectangleHorizontal, ScanSearch, Sun, UserCircle2 } from 'lucide-react';
import { examApi, proctorApi } from '@/services/api';
import { useI18n } from '@/i18n';
import { ProgressBar } from '@/components/verify/ProgressBar';
import idCardGuideImage from '@/assets/idcard.png';
import idFaceGuideImage from '@/assets/face.png';

/**
 * Pre-exam proctoring gate — Toss-style live capture flow.
 *
 *   1. Camera/mic permission + live preview
 *   2. ID card live capture (REAR camera, manual): rectangular guide
 *      → on capture, brief success state, auto-advance
 *   3. Live selfie (FRONT camera): oval face guide → countdown → snap
 *      → auto-submit, no manual confirmation
 *   4. POST /identity-verification/verify
 *        - CLOVA OCR for name + DOB
 *        - AWS Rekognition CompareFaces (ID photo vs selfie)
 *   5. PASS → navigate to next route (state.next)
 */
type Step =
  | 'PERMISSION'
  | 'ID_CAPTURE'
  | 'ID_DONE'
  | 'FACE_GUIDE'
  | 'FACE_CAPTURE'
  | 'FACE_DONE'
  | 'VERIFYING'
  | 'RESULT'
  | 'CONSENT';
type CamRole = 'id' | 'face';
type CamFacing = 'environment' | 'user';
interface VerifyResult {
  verdict: 'PASS' | 'REVIEW' | 'FAIL';
  reasons: string[];
  idCard: {
    idType: string;
    name: string | null;
    birthDate: string | null;
    rrnMasked: string | null;
    rawConfidence: number;
  };
  nameMatch: { expected: string; actual: string | null; matched: boolean };
  birthDateMatch: { expected: string; actual: string | null; matched: boolean } | null;
  faceMatch: {
    decision: 'MATCH' | 'REVIEW' | 'NO_MATCH' | 'SKIPPED';
    similarity: number;
    sourceFaceCount: number;
    targetFaceCount: number;
    matched: boolean;
    skippedReason?: string;
  };
  liveness: { selfieReceived: boolean; selfieByteSize: number };
}

interface NavState {
  next: string;
  label?: string;
}

interface CameraDevice {
  deviceId: string;
  label: string;
  facing: CamFacing | 'unknown';
}

const ROLE_FACING: Record<CamRole, CamFacing> = { id: 'environment', face: 'user' };
const TOTAL_STEPS = 6;

// Map each Step to a 1-6 progress index for the ProgressBar
const STEP_PROGRESS: Record<Step, number> = {
  PERMISSION: 1,
  ID_CAPTURE: 2,
  ID_DONE: 2,
  FACE_GUIDE: 3,
  FACE_CAPTURE: 4,
  FACE_DONE: 4,
  VERIFYING: 5,
  RESULT: 5,
  CONSENT: 6,
};


const STEP_TITLE_KEY: Partial<Record<Step, string>> = {
  PERMISSION: 'proctor.permission.title',
  ID_CAPTURE: 'proctor.id.title',
  ID_DONE: 'proctor.id.title',
  FACE_GUIDE: 'proctor.face.title',
  FACE_CAPTURE: 'proctor.face.title',
  FACE_DONE: 'proctor.face.title',
  VERIFYING: 'proctor.verifying.title',
  RESULT: 'proctor.verifying.title',
  CONSENT: 'consent.title',
};

function getStepDescription(step: Step, t: (k: any, v?: any) => string): string {
  if (step === 'FACE_CAPTURE') return t('proctor.face.hint');
  if (step === 'ID_DONE' || step === 'FACE_DONE') return t('proctor.advancing');
  if (step === 'VERIFYING') return t('proctor.verifying.detail');
  return '';
}

function getStepHeaderDescription(step: Step, t: (k: any, v?: any) => string): ReactNode {
  if (step === 'PERMISSION') {
    return (
      <>
        <span className="text-blue-500">주민등록증 또는 운전면허증 등의 신분증 촬영</span>하여
        <br />
        본인 확인을 진행합니다.
      </>
    );
  }
  if (step === 'ID_CAPTURE') {
    return (
      <>
        <span className="text-blue-500">신분증을 사각형 안에 맞춰주세요.</span>
        <br />
        정보가 선명하게 보이도록 촬영해 주세요.
      </>
    );
  }
  if (step === 'ID_DONE') return t('proctor.captureDone.id');
  if (step === 'FACE_GUIDE') {
    return (
      <>
        <span className="text-blue-500">얼굴이 화면 가운데에 오도록 촬영</span>하여
        <br />
        본인 확인을 진행합니다.
      </>
    );
  }
  if (step === 'FACE_CAPTURE') return t('proctor.face.hint');
  if (step === 'FACE_DONE') return t('proctor.captureDone.face');
  if (step === 'VERIFYING') return t('proctor.verifying.detail');
  if (step === 'RESULT') return t('proctor.result.pass');
  return '';
}

export default function ProctorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const state = (location.state as NavState | null) ?? null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [step, setStep] = useState<Step>('PERMISSION');
  const [error, setError] = useState('');
  const [idBlob, setIdBlob] = useState<Blob | null>(null);
  const [faceBlob, setFaceBlob] = useState<Blob | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [permissionRequested, setPermissionRequested] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [capturing, setCapturing] = useState(false);

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [activeFacing, setActiveFacing] = useState<CamFacing>('user');
  const [cameraSwitching, setCameraSwitching] = useState(false);

  // ── 동의 (PASS 단계에서 시험 시작 전 마지막 동의) ────────────
  // 기존엔 ExamRunnerPage 진입 후 별도 화면에서 받았지만, 신원 인증 통과
  // 직후 받는 게 UX·법적 근거 모두 더 강해서 이쪽으로 옮김.
  const [agreeRules, setAgreeRules] = useState(false);
  const [agreeAi, setAgreeAi] = useState(false);
  const [agreeScreenShare, setAgreeScreenShare] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [consentError, setConsentError] = useState('');

  // state.next 가 "/cbt/exam/{sessionId}" 형태이므로 그대로 파싱.
  // ExamReadinessPage 의 handleStartExam 에서 createFromRegistration 한 뒤
  // 만들어 넘긴 sessionId 다.
  const sessionId = useMemo(
    () => (state?.next ?? '').match(/\/cbt\/exam\/([^/?#]+)/)?.[1] ?? '',
    [state],
  );

  const capturingRef = useRef(false);

  useEffect(() => { capturingRef.current = capturing; }, [capturing]);

  // ── camera helpers ─────────────────────────────────────────
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  }, []);

  const cameraErrorMessage = useCallback(
    (e: any): string => {
      const name = e?.name ?? '';
      const detail = e?.message ?? String(e ?? '');
      switch (name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return t('proctor.error.permissionDenied');
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return t('proctor.error.noCamera');
        case 'NotReadableError':
        case 'TrackStartError':
          return t('proctor.error.cameraInUse');
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
          return t('proctor.error.constraintsFailed');
        case 'SecurityError':
          return t('proctor.error.insecureContext');
        case 'AbortError':
          return t('proctor.error.aborted');
        case 'TypeError':
          return t('proctor.error.unsupported');
        default:
          return t('proctor.error.unknown', { name: name || 'Error', detail });
      }
    },
    [t],
  );

  const labelLooksLikeRear = (lbl: string) =>
    /\b(back|rear|environment)\b/i.test(lbl) || /후면|뒷면|뒤/.test(lbl);
  const labelLooksLikeFront = (lbl: string) =>
    /\b(front|user|face|selfie|integrated|webcam)\b/i.test(lbl) || /전면|앞|셀카/.test(lbl);

  const enumerateCameras = useCallback(async (): Promise<CameraDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'videoinput')
      .map<CameraDevice>((d, i) => {
        const label = d.label || `Camera ${i + 1}`;
        const facing: CameraDevice['facing'] = labelLooksLikeRear(label)
          ? 'environment'
          : labelLooksLikeFront(label)
          ? 'user'
          : 'unknown';
        return { deviceId: d.deviceId, label, facing };
      });
  }, []);

  const pickDeviceFor = useCallback(
    (role: CamRole, list: CameraDevice[]): CameraDevice | null => {
      if (!list.length) return null;
      const want = ROLE_FACING[role];
      const matched = list.find((c) => c.facing === want);
      if (matched) return matched;
      if (list.length === 1) return list[0];
      return role === 'id' ? list[list.length - 1] : list[0];
    },
    [],
  );

  const startCameraFor = useCallback(
    async (role: CamRole, deviceId?: string): Promise<boolean> => {
      setCameraSwitching(true);
      setError('');
      try {
        stopStream();
        const baseVideo: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        };
        const videoConstraints: MediaTrackConstraints = deviceId
          ? { ...baseVideo, deviceId: { exact: deviceId } }
          : { ...baseVideo, facingMode: { ideal: ROLE_FACING[role] } };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: false,
          });
        } catch (firstErr: any) {
          if (firstErr?.name === 'OverconstrainedError' && deviceId) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: deviceId } },
              audio: false,
            });
          } else if (firstErr?.name === 'OverconstrainedError') {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          } else {
            throw firstErr;
          }
        }

        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
        const facing: CamFacing =
          (settings.facingMode as CamFacing | undefined) ??
          (deviceId
            ? cameras.find((c) => c.deviceId === deviceId)?.facing === 'environment'
              ? 'environment'
              : cameras.find((c) => c.deviceId === deviceId)?.facing === 'user'
              ? 'user'
              : ROLE_FACING[role]
            : ROLE_FACING[role]);
        setActiveFacing(facing);
        setActiveDeviceId(settings.deviceId ?? deviceId ?? null);
        return true;
      } catch (e: any) {
        setError(cameraErrorMessage(e));
        return false;
      } finally {
        setCameraSwitching(false);
      }
    },
    [cameraErrorMessage, cameras, stopStream],
  );

  const requestPermissionAndStart = useCallback(async () => {
    setPermissionRequested(true);
    setError('');
    try {
      // Request both camera AND microphone here so the single consent prompt
      // covers exam-time silence monitoring (useMicMonitor reacquires audio later).
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      probe.getTracks().forEach((tr) => tr.stop());
    } catch (e: any) {
      setError(cameraErrorMessage(e));
      return;
    }

    let list: CameraDevice[] = [];
    try { list = await enumerateCameras(); } catch { /* fall through */ }
    setCameras(list);

    const initial = pickDeviceFor('id', list);
    const ok = await startCameraFor('id', initial?.deviceId);
    if (ok) setStep('ID_CAPTURE');
  }, [cameraErrorMessage, enumerateCameras, pickDeviceFor, startCameraFor]);

  const handlePickDevice = useCallback(
    async (deviceId: string) => {
      const role: CamRole = step === 'FACE_CAPTURE' ? 'face' : 'id';
      await startCameraFor(role, deviceId);
    },
    [step, startCameraFor],
  );

  useEffect(() => {
    let role: CamRole | null = null;
    if (step === 'ID_CAPTURE' || step === 'ID_DONE') role = 'id';
    else if (step === 'FACE_CAPTURE') role = 'face';
    if (!role) return;
    const want = ROLE_FACING[role];
    if (activeFacing === want) return;
    const target = pickDeviceFor(role, cameras);
    void startCameraFor(role, target?.deviceId);
  }, [step, activeFacing, cameras, pickDeviceFor, startCameraFor]);

  useEffect(() => () => stopStream(), [stopStream]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [step]);

  // ── live capture with countdown ────────────────────────────
  const captureBlob = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return resolve(null);
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
    });
  }, []);

  const captureWithCountdown = useCallback(
    async (mode: 'ID' | 'FACE', steps = 3) => {
      if (capturingRef.current) return;
      setCapturing(true);
      setError('');
      for (let i = steps; i >= 1; i--) {
        setCountdown(i);
        await wait(700);
      }
      setCountdown(null);
      const blob = await captureBlob();
      setCapturing(false);
      if (!blob) {
        setError(t('proctor.captureFailed'));
        return;
      }
      if (mode === 'ID') {
        setIdBlob(blob);
        setStep('ID_DONE');
      } else {
        setFaceBlob(blob);
        setStep('FACE_DONE');
      }
    },
    [captureBlob, t],
  );

  // ── Submit ─────────────────────────────────────────────────
  const submit = useCallback(
    async (idImg: Blob, faceImg: Blob) => {
      setStep('VERIFYING');
      setError('');
      try {
        const idFile = new File([idImg], 'id.jpg', { type: 'image/jpeg' });
        const faceFile = new File([faceImg], 'selfie.jpg', { type: 'image/jpeg' });
        const res = await proctorApi.verify(idFile, faceFile);
        setResult(res.data);
        setStep('RESULT');
      } catch (e: any) {
        setError(verificationErrorMessage(e, t));
        setStep('FACE_CAPTURE');
      }
    },
    [t],
  );

  useEffect(() => {
    if (step !== 'ID_DONE') return;
    const id = setTimeout(() => setStep('FACE_GUIDE'), 900);
    return () => clearTimeout(id);
  }, [step]);

  useEffect(() => {
    if (step !== 'FACE_DONE') return;
    if (!idBlob || !faceBlob) return;
    const id = setTimeout(() => void submit(idBlob, faceBlob), 700);
    return () => clearTimeout(id);
  }, [step, idBlob, faceBlob, submit]);

  const proceed = () => {
    stopStream();
    if (!state?.next) { navigate('/mypage'); return; }
    navigate(state.next);
  };

  /**
   * RESULT 화면의 메인 버튼이 호출. PASS 면 6번째 STEP(CONSENT)으로 진입,
   * REVIEW/그 외는 기존처럼 즉시 navigate. REVIEW 도 동의를 받게 하려면
   * 여기서 같이 CONSENT 로 보내면 됨.
   */
  const handleResultProceed = () => {
    if (result?.verdict === 'PASS') {
      setStep('CONSENT');
      return;
    }
    proceed();
  };

  /**
   * PASS 단계의 "동의하고 시험 시작" 버튼이 호출한다.
   * 같은 클릭 제스처로 풀스크린까지 요청해서 ExamRunnerPage 에서 별도
   * 풀스크린 게이트를 거치지 않게 한다. consent API 호출이 끝나면 proceed()
   * 가 navigate 하고, 이후 runner 의 fetchPaper 가 paper 로딩 성공으로
   * 동의 게이트도 자동 스킵.
   *
   * 실패 시 setConsentError 만 띄우고 화면은 그대로 유지 — 사용자가 재시도
   * 가능.
   */
  const submitConsentAndProceed = async () => {
    if (consenting) return;
    setConsentError('');
    if (!agreeRules || !agreeAi || !agreeScreenShare) {
      setConsentError(t('consent.error.allRequired' as any) || '모든 항목에 동의해주세요.');
      return;
    }
    if (!sessionId) {
      setConsentError('세션 정보를 찾을 수 없습니다. 처음부터 다시 진행해 주세요.');
      return;
    }
    // 같은 사용자 제스처로 풀스크린 요청. await 하지 않음 — 실패해도 runner
    // 의 fullscreen gate 가 fallback.
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        /* fallback: runner gate */
      });
    }
    setConsenting(true);
    try {
      // consent 기록 후 즉시 start 호출. start 가 세션을 CREATED → IN_PROGRESS
      // 로 전환하지 않으면 ExamRunnerPage 의 paper API 가 거부한다. 이전에는
      // runner 의 동의 게이트가 둘 다 호출했지만 이젠 게이트가 사라졌으므로
      // 여기서 끝내야 함.
      //
      // 단, createFromRegistration 이 기존 IN_PROGRESS 세션을 재사용하는 경우가
      // 있다 (테스트 환경에서 이전 세션이 종료되지 않았을 때). 그러면 backend
      // 의 recordConsent 가 409 ConflictException("Cannot consent on a session
      // in status IN_PROGRESS") 을 던지는데, 이는 곧 "이미 이전에 동의 + start
      // 까지 끝난 세션을 다시 쓰고 있다"는 뜻이므로 swallow 하고 그냥 진행한다.
      try {
        await examApi.consent(sessionId, {
          consentRules: true,
          consentAiReview: true,
          consentVersion: '2026-04-30',
        });
      } catch (e: any) {
        const status = e?.response?.status;
        const msg: string = e?.response?.data?.message ?? '';
        const alreadyStarted = status === 409 && /IN_PROGRESS/i.test(msg);
        if (!alreadyStarted) throw e;
      }
      // start 는 backend 가 IN_PROGRESS 면 그냥 세션을 반환하도록 만들어져 있어
      // (cbt-sessions.service.ts L330-332) idempotent. 그대로 호출.
      await examApi.start(sessionId);
      proceed();
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? t('consent.error.submitFailed' as any) ?? '동의 전송에 실패했습니다. 다시 시도해 주세요.';
      setConsentError(msg);
      setConsenting(false);
    }
  };

  const retry = () => {
    setIdBlob(null);
    setFaceBlob(null);
    setResult(null);
    setError('');
    setStep('ID_CAPTURE');
  };

  const mirrorVideo = activeFacing === 'user';
  const videoCls = `w-full h-full object-cover${mirrorVideo ? ' scale-x-[-1]' : ''}`;

  const progressStep = STEP_PROGRESS[step];
  const stepTitle = STEP_TITLE_KEY[step] ? t(STEP_TITLE_KEY[step] as any) : '';
  const stepDescription = getStepDescription(step, t);
  const stepHeaderDescription = getStepHeaderDescription(step, t);

  // ── render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-0 md:p-8">
      <style>{`
        @keyframes axis-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes axis-pop-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
      `}</style>
      <div className="w-full max-w-[480px] h-screen md:h-[820px] md:max-h-[90vh] bg-white md:rounded-3xl md:shadow-xl md:border md:border-gray-100 flex flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center justify-between mb-2 px-2">
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-semibold text-gray-800 uppercase tracking-wide">
                {t('proctor.header.title')}
              </span>
            </div>
          </div>
          <ProgressBar current={progressStep} total={TOTAL_STEPS} />
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          {/* Error banner */}
          {error && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] leading-snug">
              {error}
            </div>
          )}

          {/* ── STEP 1: Permission ── */}
          {step === 'PERMISSION' && (
            <div className="flex flex-col h-full">
              <StepHeader
                currentStep={progressStep}
                totalSteps={TOTAL_STEPS}
                title={t('proctor.permission.title')}
                description={stepHeaderDescription}
              />
              <div className="flex-1 flex flex-col items-center justify-start mt-4 px-6 text-center">
                <div className="w-full max-w-full">
                    <img
                      src={idCardGuideImage}
                      alt="신분증 가이드"
                      className="mx-auto block w-full max-w-[350px] rounded-xl bg-white"
                    />
                <ul className="text-[18px] text-gray-800  text-left mt-6 mx-4">
                  <li className="flex items-start gap-1.5">
                    <span className="mt-0.5 text-blue-500">•</span>
                     밝은 조명에서 정면을 응시해주세요.
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="mt-0.5 text-blue-500">•</span>
                     모자나 선글라스는 벗어주세요.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-500">•</span>
                      시험 중에는  얼굴 위치와 시선을 모니터링합니다.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-blue-500">•</span>
                      시험 중에는 마이크가 켜져 있습니다.
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 text-red-400">•</span>
                      조용한 환경에서 응시해주세요. <br/> 본인의 목소리도 경고 대상입니다.
                  </li>
                </ul>
                </div>
              </div>
              <StepFooter onBack={() => navigate(-1)}>
                <button
                  onClick={requestPermissionAndStart}
                  disabled={cameraSwitching}
                  className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 disabled:opacity-50 transition-colors text-white font-medium"
                >
                  {cameraSwitching
                    ? t('proctor.camera.switching')
                    : permissionRequested
                    ? t('proctor.permission.retry')
                    : t('proctor.permission.allow')}
                </button>
              </StepFooter>
            </div>
          )}

          {/* ── STEP 3: Face capture guide ── */}
          {step === 'FACE_GUIDE' && (
            <div className="flex flex-col h-full">
              <StepHeader
                currentStep={progressStep}
                totalSteps={TOTAL_STEPS}
                title={t('proctor.face.title')}
                description={stepHeaderDescription}
              />
              <div className="flex-1 flex flex-col items-center justify-start mt-4 px-6 text-center">
                <div className="w-full max-w-full">
                  <img
                    src={idFaceGuideImage}
                    alt="얼굴 촬영 가이드"
                    className="mx-auto block w-full max-w-[200px] mt-6 mb-10 rounded-xl bg-white"
                  />
                  <ul className="text-[18px] text-gray-800 text-left mt-6 mx-4">
                    <li className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-blue-500">•</span>
                       얼굴이 화면 가운데 오도록 해주세요.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="mt-0.5 text-blue-500">•</span>
                       모자, 마스크, 선글라스를 벗어주세요.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-blue-500">•</span>
                       밝은 곳에서 정면을 응시해주세요.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-blue-500">•</span>
                       머리카락이 얼굴을 가리지 않도록 해주세요.
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="mt-0.5 text-red-400">•</span>
                       신분증 사진과 동일한 인물인지 확인합니다.
                    </li>
                  </ul>
                </div>
              </div>
              <StepFooter onBack={() => setStep('ID_CAPTURE')}>
                <button
                  onClick={() => setStep('FACE_CAPTURE')}
                  disabled={cameraSwitching}
                  className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 disabled:opacity-50 transition-colors text-white font-medium"
                >
                  {cameraSwitching ? t('proctor.camera.switching') : '촬영 시작'}
                </button>
              </StepFooter>
            </div>
          )}

          {/* ── STEPS 2/4: Camera capture ── */}
          {(step === 'ID_CAPTURE' ||
            step === 'FACE_CAPTURE' ||
            step === 'ID_DONE' ||
            step === 'FACE_DONE' ||
            step === 'VERIFYING') && (
            <div className="flex flex-col h-full">
              <StepHeader currentStep={progressStep} totalSteps={TOTAL_STEPS} title={stepTitle} description={stepHeaderDescription}>
                <h1 className="text-[24px] md:text-[26px] font-bold tracking-tight text-gray-900 mb-1">
                  {step === 'ID_DONE' && t('proctor.captureDone.id')}
                  {step === 'FACE_CAPTURE' && t('proctor.face.title')}
                  {step === 'FACE_DONE' && t('proctor.captureDone.face')}
                  {step === 'VERIFYING' && t('proctor.verifying.title')}
                </h1>
                {stepDescription && <p className="text-[13px] text-gray-500">{stepDescription}</p>}
              </StepHeader>

              {/* Camera selector — always shown so the viewfinder box height stays
                  consistent across ID_CAPTURE → ID_DONE → FACE_CAPTURE → FACE_DONE → VERIFYING. */}
              {cameras.length > 0 && (
                <div className="mx-6 mb-2 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs">
                  <span className="text-gray-400 shrink-0">{t('proctor.camera.label')}:</span>
                  <select
                    value={activeDeviceId ?? ''}
                    onChange={(e) => handlePickDevice(e.target.value)}
                    disabled={
                      cameraSwitching ||
                      capturing ||
                      step === 'ID_DONE' ||
                      step === 'FACE_DONE' ||
                      step === 'VERIFYING'
                    }
                    className="flex-1 min-w-0 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 px-2 py-1 disabled:opacity-50"
                  >
                      {cameras.map((c) => (
                        <option key={c.deviceId} value={c.deviceId}>
                          {c.label}
                          {c.facing === 'environment' ? ' · ' + t('proctor.camera.rear') : ''}
                          {c.facing === 'user' ? ' · ' + t('proctor.camera.front') : ''}
                        </option>
                      ))}
                    </select>
                </div>
              )}

              {/* Video viewfinder */}
              <div className="flex-1 flex flex-col items-center justify-center px-6 py-3">
                <div
                  className="relative bg-gray-900 rounded-md overflow-hidden w-full h-full"
                  style={{ maxWidth: 480 }}
                >
                  <div className="h-full">
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className={videoCls}
                    />

                    {step === 'ID_CAPTURE' && (
                      <>
                        <IdOverlay
                          countdown={countdown}
                          holdLabel=""
                          readableLabel=""
                        />
                        {countdown == null && (
                          <>
                            <div className="absolute top-10 left-0 right-0 z-20 px-4 text-center">
                              <p className="text-gray-300 text-[18px] font-normal leading-relaxed drop-shadow">
                                신분증 앞면을 사각형 안에 맞춰주세요.
                              </p>
                            </div>
                            <div className="absolute bottom-9 left-0 right-0 z-20 bg-black/60 px-4 py-3">
                              <div className="grid grid-cols-2 gap-2 text-gray-300 text-[14px] text-center">
                                <div className="flex flex-col items-center gap-1">
                                  <RectangleHorizontal className="w-9 h-9" />
                                  <span>조명이 있는곳에서 <br/> 촬영해주세요</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                  <ScanSearch className="w-9 h-9" />
                                  <span>빛이 반사되지 않도록 <br/> 주의해주세요</span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {step === 'FACE_CAPTURE' && (
                      <>
                        <FaceOverlay countdown={countdown} />
                        {countdown == null && (
                          <>
                            <div className="absolute top-10 left-0 right-0 z-20 px-4 text-center">
                              <p className="text-gray-300 text-[18px] font-normal leading-relaxed drop-shadow">
                                얼굴을 원 안에 맞춰주세요.
                              </p>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    {(step === 'ID_DONE' || step === 'FACE_DONE') && (
                      <div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white"
                        style={{ animation: 'axis-overlay-in 200ms ease-out' }}
                      >
                        <div
                          className="flex h-18 w-18 items-center justify-center rounded-full bg-blue-500"
                          style={{ animation: 'axis-pop-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        >
                          <Check className="w-10 h-10 text-white" strokeWidth={3.5} />
                        </div>
                        <div className="text-[18px] font-bold tracking-tight text-gray-900">
                          {step === 'ID_DONE' ? t('proctor.captureDone.id') : t('proctor.captureDone.face')}
                        </div>
                      </div>
                    )}

                    {step === 'VERIFYING' && (
                      <div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-white px-6"
                        style={{ animation: 'axis-overlay-in 200ms ease-out' }}
                      >
                        <div
                          className="flex h-18 w-18 items-center justify-center rounded-full bg-blue-500"
                          style={{ animation: 'axis-pop-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                        >
                          <Loader2 className="w-9 h-9 text-white animate-spin" strokeWidth={3} />
                        </div>
                        <div className="text-center">
                          <div className="text-[18px] font-bold tracking-tight text-gray-900">
                            {t('proctor.verifying.title')}
                          </div>
                          <div className="mt-1 text-[13px] text-gray-500">
                            {t('proctor.verifying.running')}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom CTA */}
              <StepFooter
                className="pt-2"
                onBack={() => {
                  if (step === 'ID_CAPTURE') setStep('PERMISSION');
                  else if (step === 'FACE_CAPTURE') setStep('FACE_GUIDE');
                  else setStep('ID_CAPTURE');
                }}
                backDisabled={capturing || cameraSwitching || step === 'ID_DONE' || step === 'FACE_DONE' || step === 'VERIFYING'}
              >
                {step === 'ID_CAPTURE' && (
                  <button
                    onClick={() => captureWithCountdown('ID')}
                    disabled={capturing || cameraSwitching}
                    className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 disabled:opacity-50 transition-colors text-white font-medium flex items-center justify-center gap-2"
                  >
                    <Camera className="w-5 h-5" />
                    {capturing
                      ? t('proctor.capturing', { n: countdown ?? '' })
                      : t('proctor.id.captureNow')}
                  </button>
                )}

                {step === 'FACE_CAPTURE' && (
                  <button
                    onClick={() => captureWithCountdown('FACE')}
                    disabled={capturing || cameraSwitching}
                    className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 disabled:opacity-50 transition-colors text-white font-medium flex items-center justify-center gap-2"
                  >
                    <Camera className="w-5 h-5" />
                    {capturing
                      ? t('proctor.capturing', { n: countdown ?? '' })
                      : t('proctor.face.capture')}
                  </button>
                )}
              </StepFooter>
            </div>
          )}

          {/* ── STEP 5: Result ── */}
          {step === 'RESULT' && result && (
            <ResultView
              result={result}
              onRetry={retry}
              onProceed={handleResultProceed}
              t={t}
              currentStep={progressStep}
              totalSteps={TOTAL_STEPS}
            />
          )}

          {/* ── STEP 6: Consent (PASS 만 진입) ── */}
          {step === 'CONSENT' && (
            <ConsentView
              currentStep={progressStep}
              totalSteps={TOTAL_STEPS}
              t={t}
              agreeRules={agreeRules}
              setAgreeRules={setAgreeRules}
              agreeAi={agreeAi}
              setAgreeAi={setAgreeAi}
              agreeScreenShare={agreeScreenShare}
              setAgreeScreenShare={setAgreeScreenShare}
              consenting={consenting}
              consentError={consentError}
              onBack={() => setStep('RESULT')}
              onSubmit={submitConsentAndProceed}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── overlays (unchanged logic, same visual) ──────────────────

function IdOverlay({
  countdown, holdLabel, readableLabel,
}: {
  countdown: number | null;
  holdLabel: string;
  readableLabel: string;
}) {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative -translate-y-12 bg-transparent border-2 border-blue-500 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{ width: '80%', maxWidth: 480, aspectRatio: '1.6 / 1' }}
      >
        {holdLabel && <span className="absolute -top-7 left-0 text-xs text-white">{holdLabel}</span>}
        {readableLabel && <span className="absolute -bottom-6 right-0 text-[11px] text-white/70">{readableLabel}</span>}
      </div>

      {countdown != null && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/55" />
          <div className="text-[10vw] font-extrabold text-white drop-shadow-lg animate-pulse">{countdown}</div>
        </div>
      )}
    </div>
  );
}

function FaceOverlay({ countdown }: { countdown: number | null }) {
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative translate-y-2 bg-transparent border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
        style={{ width: '62%', maxWidth: 260, aspectRatio: '0.78 / 1', borderRadius: '50%' }}
      />
      {countdown != null && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/55" />
          <div className="text-[10vw] font-extrabold text-white drop-shadow-lg animate-pulse">{countdown}</div>
        </div>
      )}
    </div>
  );
}


function ResultView({
  result, onRetry, onProceed, t, currentStep, totalSteps,
}: {
  result: VerifyResult;
  onRetry: () => void;
  onProceed: () => void;
  t: (k: any, v?: any) => string;
  currentStep: number;
  totalSteps: number;
}) {
  const isPass = result.verdict === 'PASS';
  const isReview = result.verdict === 'REVIEW';

  const verdictBg = isPass ? 'bg-blue-500' : isReview ? 'bg-amber-400' : 'bg-rose-400';
  const verdictIcon = isPass
    ? <Check className="w-10 h-10 text-white" strokeWidth={3.5} />
    : isReview
    ? <AlertTriangle className="w-10 h-10 text-white" strokeWidth={2.5} />
    : <X className="w-10 h-10 text-white" strokeWidth={3.5} />;

  const title = isPass ? t('proctor.result.pass') : isReview ? t('proctor.result.review') : t('proctor.result.fail');

  const reasonText = result.reasons
    .map((r) => { const key = `proctor.reason.${r}`; const tr = t(key); return tr === key ? r : tr; })
    .join(' · ');

  const idTypeLabel = t(`proctor.idType.${result.idCard.idType}`);

  return (
    <div className="flex flex-col h-full">
      <StepHeader currentStep={currentStep} totalSteps={totalSteps} title={t('proctor.verifying.title')} />
      <div className="flex-1 flex flex-col items-center px-6 pt-6 pb-4">
        <div
          className={`flex h-18 w-18 items-center justify-center rounded-full ${verdictBg}`}
          style={{ animation: 'axis-pop-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          {verdictIcon}
        </div>

        <h1 className="mt-5 text-[22px] font-bold tracking-tight text-gray-900 text-center">
          {title}
        </h1>

        {reasonText && (
          <p className="mt-1.5 text-[14px] text-gray-500 text-center">{reasonText}</p>
        )}

        <div className="w-full max-w-sm mt-15">
          <SingleDetail
            label={t('proctor.result.matchName')}
            value={result.nameMatch.actual ?? '—'}
            matched={result.nameMatch.matched}
          />
          {result.birthDateMatch && (
            <SingleDetail
              label={t('proctor.result.matchBirth')}
              value={result.birthDateMatch.actual ?? '—'}
              matched={result.birthDateMatch.matched}
            />
          )}
          <SingleDetail
            label={t('proctor.result.idType')}
            value={idTypeLabel}
            matched={result.idCard.idType !== 'UNKNOWN'}
          />
          {result.faceMatch.decision !== 'SKIPPED' && (
            <SingleDetail
              label={t('proctor.result.faceMatch')}
              value={`${result.faceMatch.similarity.toFixed(1)}%`}
              matched={result.faceMatch.matched}
            />
          )}
        </div>

        {!isPass && (
          <div className="w-full max-w-sm mt-4 bg-gray-50 rounded-2xl px-4 py-3.5 text-left">
            <div className="text-[13px] font-semibold text-gray-900 mb-2">{t('proctor.tips.title')}</div>
            <ul className="text-[12px] text-gray-500 space-y-1 list-disc pl-4">
              <li>{t('proctor.tips.lighting')}</li>
              <li>{t('proctor.tips.steady')}</li>
              <li>{t('proctor.tips.angle')}</li>
              <li>{t('proctor.tips.account')}</li>
            </ul>
          </div>
        )}
      </div>

      <StepFooter className="pt-4">
        {isPass && (
          <button onClick={onProceed}
            className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 text-white font-medium transition-colors">
            {t('proctor.result.continue')}
          </button>
        )}
        {isReview && (
          <>
            <button onClick={onProceed}
              className="flex-1 h-12 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-medium transition-colors">
              {t('proctor.result.continueReview')}
            </button>
          </>
        )}
        {!isPass && !isReview && (
          <button onClick={onRetry}
            className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 text-white font-medium transition-colors">
            {t('proctor.result.retry')}
          </button>
        )}
      </StepFooter>
    </div>
  );
}

/**
 * STEP 6 — 동의 사항 화면. 신원 인증 통과 직후 받는 마지막 게이트.
 * "동의하고 시험 시작" 버튼은 같은 사용자 제스처로 풀스크린까지 요청해서
 * ExamRunnerPage 진입 시 별도 풀스크린 게이트가 안 뜨도록 한다.
 * 디자인 톤은 다른 STEP 들과 동일 (StepHeader/StepFooter, border-gray-200,
 * bg-blue-500 액센트).
 */
function ConsentView({
  currentStep,
  totalSteps,
  t,
  agreeRules,
  setAgreeRules,
  agreeAi,
  setAgreeAi,
  agreeScreenShare,
  setAgreeScreenShare,
  consenting,
  consentError,
  onBack,
  onSubmit,
}: {
  currentStep: number;
  totalSteps: number;
  t: (k: any, v?: any) => string;
  agreeRules: boolean;
  setAgreeRules: (v: boolean) => void;
  agreeAi: boolean;
  setAgreeAi: (v: boolean) => void;
  agreeScreenShare: boolean;
  setAgreeScreenShare: (v: boolean) => void;
  consenting: boolean;
  consentError: string;
  onBack: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  const ready = agreeRules && agreeAi && agreeScreenShare;
  return (
    <div className="flex flex-col h-full">
      <StepHeader
        currentStep={currentStep}
        totalSteps={totalSteps}
        title={t('consent.title')}
        description={
          <>
            아래 <span className="text-blue-500">3가지 항목에 모두 동의</span>해야 시험을 시작할 수 있습니다.
          </>
        }
      />

      <div className="flex-1 flex flex-col px-6 pt-2 pb-4 overflow-y-auto">
        <div className="space-y-3">
          <ConsentCard
            checked={agreeRules}
            onChange={setAgreeRules}
            title={t('consent.rules.title')}
            description={t('consent.rules.desc')}
          />
          <ConsentCard
            checked={agreeAi}
            onChange={setAgreeAi}
            title={t('consent.ai.title')}
            description={t('consent.ai.desc')}
          />
          <ConsentCard
            checked={agreeScreenShare}
            onChange={setAgreeScreenShare}
            title={t('consent.screen.title')}
            description={t('consent.screen.desc')}
          />
        </div>

        {consentError && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[13px] text-red-700 leading-snug">
            {consentError}
          </div>
        )}
      </div>

      <StepFooter onBack={onBack} backDisabled={consenting} className="pt-4">
        <button
          onClick={() => void onSubmit()}
          disabled={consenting || !ready}
          className="flex-1 h-12 rounded-md bg-blue-500 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors inline-flex items-center justify-center gap-2"
        >
          {consenting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              동의 처리 중...
            </>
          ) : (
            '동의하고 시험 시작'
          )}
        </button>
      </StepFooter>
    </div>
  );
}

function ConsentCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-2 accent-blue-500 w-4 h-4 shrink-0"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-[18px] font-semibold text-gray-900">{title}</span>
        <span className="block text-[14px] text-gray-800 leading-relaxed">{description}</span>
      </span>
    </label>
  );
}

function StepHeader({
  currentStep,
  totalSteps,
  title,
  description,
  children,
}: {
  currentStep: number;
  totalSteps: number;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-6 pt-1 pb-2 shrink-0">
      <div className="inline-flex items-center gap-2 px-3">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-[14px] font-bold text-white">
          {currentStep}
        </span>
        <span className="text-[16px] md:text-[24px] font-semibold tracking-tight text-gray-900">
          {title}
        </span>
        <span className="text-[14px] mt-2 font-medium text-gray-400">{currentStep} / {totalSteps}</span>
      </div>
      {description && <div className="mx-3 text-[18px] text-gray-800 font-medium leading-[1.5]">{description}</div>}
    </div>
  );
}

function StepFooter({
  children,
  className = '',
  onBack,
  backDisabled = false,
}: {
  children: ReactNode;
  className?: string;
  onBack?: () => void;
  backDisabled?: boolean;
}) {
  return (
    <div className={`px-6 pb-9 shrink-0 ${className}`.trim()}>
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            onClick={onBack}
            disabled={backDisabled}
            className="h-12 min-w-[96px] px-6 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 font-medium transition-colors"
          >
            이전
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function SingleDetail({ label, value, matched }: { label: string; value: string; matched: boolean }) {
  return (
    <div className="px-4 py-3.5 flex items-center justify-between">
      <span className="text-[18px] font-semibold text-gray-900">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[18px] text-gray-700">{value}</span>
        {matched ? (
          <Check className="w-4 h-4 text-emerald-500" strokeWidth={3} />
        ) : (
          <X className="w-4 h-4 text-rose-500" strokeWidth={3} />
        )}
      </div>
    </div>
  );
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function verificationErrorMessage(e: any, t: (k: any, v?: any) => string): string {
  const status: number | undefined = e?.response?.status;
  const code: string | undefined = e?.code;
  const serverMsg = e?.response?.data?.message ?? e?.response?.data?.error;
  if (code === 'ECONNABORTED' || /timeout/i.test(e?.message ?? '')) return t('proctor.error.timeout');
  if (!e?.response) return t('proctor.error.networkFailed');
  if (status) {
    const detail = Array.isArray(serverMsg) ? serverMsg.join(', ') : serverMsg ?? e.message ?? '';
    return t('proctor.error.serverFailed', { status, detail });
  }
  return t('proctor.error.serverGeneric', { detail: serverMsg ?? e?.message ?? String(e) });
}
