import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { showSessionSupersededModal } from '@/lib/sessionSupersededModal';

/** Absolute API origin (e.g. `https://api.axis...`). Empty → use `/api` (Vite dev proxy). */
const apiBaseRaw = typeof import.meta.env.VITE_API_BASE_URL === 'string' ? import.meta.env.VITE_API_BASE_URL.trim() : '';
const apiBase = apiBaseRaw.length > 0 ? apiBaseRaw.replace(/\/$/, '') : '/api';

/** Origin of the Nest API — NICE return bridge pages postMessage from here (must match event.origin). */
export function getApiMessageOrigin(): string {
  if (apiBaseRaw.length > 0 && /^https?:\/\//i.test(apiBaseRaw)) {
    try {
      return new URL(apiBaseRaw).origin;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:3333`;
  }
  return 'http://127.0.0.1:3333';
}

const api = axios.create({
  baseURL: apiBase,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─────────────────────────────────────────────────────────────────────────────
// 401 → silent refresh → retry
//
// The access token TTL is short (15m) but exam sessions can last well over an
// hour. Without this interceptor a candidate who finishes an exam after their
// access token has expired hits a bare "Unauthorized" screen on submit. The
// refresh token is valid for 14 days, so we can transparently reissue the
// access token and retry the failed request.
// ─────────────────────────────────────────────────────────────────────────────

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

/** Endpoints whose 401 should never trigger a refresh attempt (avoids loops). */
const REFRESH_BLOCKLIST = ['/auth/login', '/auth/refresh', '/auth/signup'];

/** Nest may return `error` at top level or nested under `message`. */
export function getApiErrorCode(error: AxiosError): string | undefined {
  const data = error.response?.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (typeof data.error === 'string') return data.error;
  const msg = data.message;
  if (msg && typeof msg === 'object' && msg !== null && 'error' in msg) {
    const nested = (msg as { error?: unknown }).error;
    return typeof nested === 'string' ? nested : undefined;
  }
  return undefined;
}

export function clearAuthTokens(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

const SESSION_SUPERSEDED_KEY = 'axis:sessionSuperseded';

export function consumeSessionSupersededMessage(): string | null {
  const msg = sessionStorage.getItem(SESSION_SUPERSEDED_KEY);
  if (msg) sessionStorage.removeItem(SESSION_SUPERSEDED_KEY);
  return msg;
}

function notifySessionSuperseded(customMessage?: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_SUPERSEDED_KEY);
  showSessionSupersededModal({
    redirectTo: '/login',
    backendMessage: customMessage,
  });
}

function handleSessionSuperseded(error: AxiosError): boolean {
  if (getApiErrorCode(error) !== 'SESSION_SUPERSEDED') return false;
  clearAuthTokens();
  const data = error.response?.data as Record<string, unknown> | undefined;
  const raw = data?.message;
  const message =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in raw
        ? String((raw as { message?: unknown }).message ?? '')
        : undefined;
  notifySessionSuperseded(message || undefined);
  return true;
}

let refreshInflight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;
  try {
    // Bare axios call so the request interceptor doesn't attach the (expired)
    // access token, and the response interceptor doesn't recurse on 401.
    const res = await axios.post(`${apiBase}/auth/refresh`, { refreshToken });
    const newAccess = res.data?.accessToken as string | undefined;
    const newRefresh = res.data?.refreshToken as string | undefined;
    if (!newAccess) return null;
    localStorage.setItem('accessToken', newAccess);
    if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
    return newAccess;
  } catch (err) {
    if (err instanceof AxiosError && handleSessionSuperseded(err)) {
      return null;
    }
    clearAuthTokens();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (handleSessionSuperseded(error)) {
      return Promise.reject(error);
    }

    if (
      status !== 401 ||
      !original ||
      original._retry ||
      REFRESH_BLOCKLIST.some((p) => (original.url ?? '').includes(p))
    ) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (!refreshInflight) {
      refreshInflight = performRefresh().finally(() => {
        refreshInflight = null;
      });
    }

    const newAccess = await refreshInflight;

    if (!newAccess) {
      // Refresh failed — user must log back in. Don't auto-redirect from
      // inside the interceptor; let calling code surface the error so e.g.
      // an in-progress exam doesn't disappear silently.
      return Promise.reject(error);
    }

    const retryConfig: AxiosRequestConfig = {
      ...original,
      headers: {
        ...(original.headers ?? {}),
        Authorization: `Bearer ${newAccess}`,
      },
    };
    return api.request(retryConfig);
  },
);

// Auth API
export const authApi = {
  // NICE 본인인증 요청
  requestNiceVerification: (authType: 'CHECKPLUS' | 'IPIN', returnUrl?: string) =>
    api.post('/auth/nice/request', { authType, returnUrl }),

  // NICE 인증 결과 처리 (legacy postMessage path)
  handleNiceCallback: (encData: string, authType: 'CHECKPLUS' | 'IPIN', requestNo: string) =>
    api.post('/auth/nice/callback', { encData, authType, requestNo }),

  // NICE 세션 상태 조회 — 팝업이 NICE에서 돌아오면 옆에서 폴링하는 엔드포인트
  getNiceSession: (sessionId: string) =>
    api.get(`/auth/nice/session/${encodeURIComponent(sessionId)}`),

  // 회원가입
  signup: (data: {
    userId: string;
    password: string;
    niceSessionId: string;
    email?: string;
    agreePrivacy: boolean;
    agreeTerms: boolean;
    agreeMarketing?: boolean;
  }) => api.post('/auth/signup', data),

  // 로그인
  login: (userId: string, password: string) =>
    api.post('/auth/login', { userId, password }),

  // 아이디 중복 확인
  checkUserId: (userId: string) =>
    api.get(`/auth/check-userid?userId=${userId}`),

  // [DEV] NICE 인증 시뮬레이션
  devNiceVerify: (phone: string, authType: 'CHECKPLUS' | 'IPIN') =>
    api.post('/auth/nice/dev-verify', { phone, authType }),

  // 비밀번호 재설정
  resetPassword: (data: { niceSessionId: string; newPassword: string }) =>
    api.post('/auth/reset-password', data),

  // 토큰 갱신
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  // 로그아웃 (현재 기기 세션 종료)
  logout: () => api.post('/auth/logout'),
};

// User API
export const userApi = {
  getProfile: () => api.get('/users/profile'),
  updateProfile: (data: { email?: string }) => api.patch('/users/profile', data),
  updatePhone: (data: { niceSessionId: string; phone: string }) =>
    api.patch('/auth/profile-phone', data),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.post('/auth/change-password', data),
  getDashboard: () => api.get('/users/me/dashboard'),
  downloadCertificatePdf: (certNumber: string) =>
    api.get<Blob>(`/certificates/mine/${encodeURIComponent(certNumber)}/download`, {
      responseType: 'blob',
    }),
  downloadConfirmationPdf: (resultId: string) =>
    api.get<Blob>(`/results/mine/${encodeURIComponent(resultId)}/confirmation.pdf`, {
      responseType: 'blob',
    }),
  downloadVoucherPdf: (registrationId: string) =>
    api.get<Blob>(`/registrations/${encodeURIComponent(registrationId)}/voucher.pdf`, {
      responseType: 'blob',
    }),
};

// Schedules API
export const schedulesApi = {
  list: (params?: { certType?: string; level?: string; status?: string; upcomingOnly?: boolean }) =>
    api.get('/schedules', { params }),
  get: (id: string) => api.get(`/schedules/${id}`),
  available: (params?: { certType?: string; level?: string }) =>
    api.get('/schedules/available', { params }),
  slots: (certType: string, date: string, level?: string) =>
    api.get('/schedules/slots', { params: { certType, date, level } }),
  calendar: (year: number, month: number, certType?: string, level?: string) =>
    api.get('/schedules/calendar', { params: { year, month, certType, level } }),
  /** Create on-demand schedule for any date/time (online exams) */
  createOnDemand: (data: { certType: string; level: string; examDate: string; examStartTime?: string; capacity?: number }) =>
    api.post('/schedules/on-demand', data),
  /** Find existing or create new schedule for date/time */
  findOrCreate: (data: { certType: string; level: string; examDate: string; examStartTime?: string }) =>
    api.post<{ schedule: unknown; created: boolean }>('/schedules/find-or-create', data),
};

// Registrations API
export const registrationsApi = {
  mine: () => api.get('/registrations/mine'),
  create: (scheduleId: string) => api.post('/registrations', { scheduleId }),
  /** Quick book: Create schedule + registration for any date/time (online exams, start immediately) */
  quickBook: (data: { certType: string; level: string; examDate?: string }) =>
    api.post<{ registration: unknown; schedule: unknown; fee: number; message: string }>(
      '/registrations/quick-book',
      data,
    ),
  cancel: (id: string, reason?: string) => api.delete(`/registrations/${id}`, { data: { reason } }),
  ticket: (id: string) => api.get(`/registrations/${id}/ticket`),
  uploadDocument: (registrationId: string, file: File, eligibilityType?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('registrationId', registrationId);
    if (eligibilityType) fd.append('eligibilityType', eligibilityType);
    return api.post('/registrations/document', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  setEligibilityBasis: (registrationId: string, eligibilityType: string) =>
    api.patch(`/registrations/${registrationId}/eligibility-basis`, { eligibilityType }),
  eligibilityRefund: (registrationId: string, note?: string) =>
    api.post<{ ok: true; status: 'REQUESTED'; requestedAt: string }>(
      `/registrations/${registrationId}/eligibility-refund`,
      note ? { note } : {},
    ),
};

// Results API
export type PublicRoundPublicationState = 'announced' | 'grading' | 'upcoming';

export interface PublicRoundRow {
  scheduleId: string;
  certType: 'AXIS' | 'AXIS_C' | 'AXIS_H';
  level: string;
  roundNumber: number;
  year: number;
  examDate: string;
  scheduleStatus: string;
  publicationState: PublicRoundPublicationState;
  /** 결제·확정 접수 (PAID + EXAM_COMPLETED) */
  registeredCount: number;
  passCount: number | null;
  failCount: number | null;
  labelRound: string;
}

export interface PublicRoundsListResponse {
  items: PublicRoundRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface PublicPassListResponse {
  schedule: {
    id: string;
    certType: string;
    level: string;
    roundNumber: number;
    year: number;
    examDate: string;
    status: string;
    labelRound: string;
  };
  summary: {
    registeredCount: number;
    passCount: number;
    failCount: number;
    /** 채점이 확정된 접수 건수 (명단 행 수) */
    gradedCount: number;
  };
  entries: { registrationNumberMasked: string; passed: boolean }[];
}

export type PublicLookupResponse =
  | { status: 'NOT_FOUND' }
  | { status: 'NOT_ANNOUNCED' }
  | {
      status: 'RESULT';
      passed: boolean;
      totalScore: number | null;
      cutScore: number;
      certType: string;
      level: string;
      roundNumber: number;
      roundLabel: string;
      examDate: string;
      sections: { name: string; score: number; max: number }[];
    };

export const resultsApi = {
  mine: () => api.get('/results/mine'),
  publicLookup: (body: { registrationNumber: string; name: string; birthDate: string }) =>
    api.post<PublicLookupResponse>('/results/public/lookup', body),
  publicRounds: (opts?: {
    certType?: 'AXIS' | 'AXIS_C' | 'AXIS_H';
    status?: PublicRoundPublicationState;
    /** 시험일 범위 (KST, YYYY-MM-DD) */
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) =>
    api.get<PublicRoundsListResponse>('/results/public/rounds', {
      params: {
        ...(opts?.certType ? { certType: opts.certType } : {}),
        ...(opts?.status ? { status: opts.status } : {}),
        ...(opts?.from ? { from: opts.from } : {}),
        ...(opts?.to ? { to: opts.to } : {}),
        ...(opts?.page != null ? { page: opts.page } : {}),
        ...(opts?.pageSize != null ? { pageSize: opts.pageSize } : {}),
      },
    }),
  publicPassList: (scheduleId: string) => api.get<PublicPassListResponse>(`/results/public/${scheduleId}`),
};

export type CertificateVerifyResponse =
  | { ok: false }
  | {
      ok: true;
      status: 'valid' | 'expired';
      certNo: string;
      holder: string;
      track: string;
      level: string;
      issuedAt: string;
      validUntil: string;
      expiredAt?: string;
      org: string;
    }
  | {
      ok: true;
      status: 'demo';
      certNo: string;
      holder: string;
      track: string;
      level: string;
      org: string;
    };

export const certificatesApi = {
  verify: (certNumber: string, holderName: string) =>
    api.get<CertificateVerifyResponse>(`/certificates/verify/${encodeURIComponent(certNumber)}`, {
      params: { holderName },
    }),
};

/** PortOne — /apply Step 4 virtual account (V1 IAMPORT or V2 SDK per portoneVersion) */
export type PaymentRequestResponse = {
  portoneVersion?: 'v1' | 'v2';
  storeId: string;
  channelKey: string;
  impCode?: string;
  pgProvider?: string;
  merchantId: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: 'KRW';
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customer?: { fullName: string; email: string; phoneNumber: string };
  registrationNumber: string | null;
  alreadyIssued?: boolean;
  vbankName?: string;
  vbankNum?: string;
  vbankExpiry?: string;
};

export const paymentApi = {
  request: (registrationId: string, payMethod?: 'CARD' | 'VBANK') =>
    api.post<PaymentRequestResponse>('/payment/request', {
      registrationId,
      ...(payMethod ? { payMethod } : {}),
    }),
  confirm: (body: { paymentId: string; merchantId: string }) =>
    api.post<
      | {
          ok: true;
          status: 'VA_ISSUED';
          registrationId: string;
          vbankName: string;
          vbankNum: string;
          vbankExpiry: string;
          amount: number;
          orderName: string;
        }
      | {
          ok: true;
          status: 'PAID';
          registrationId: string;
        }
    >('/payment/confirm', body),
  /**
   * Demo/staging only — flips the registration to PAID without going through
   * PortOne. Backend returns 404 unless TEST_PAYMENT_ENABLED=true, so this is
   * a no-op (404) on production.
   */
  testConfirm: (registrationId: string) =>
    api.post<{ ok: true; status: 'PAID'; registrationId: string }>(
      '/payment/test-confirm',
      { registrationId },
    ),
};

export type ProctorEventKind =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'GAZE_AWAY'
  | 'EYES_CLOSED'
  | 'IDENTITY_MISMATCH'
  | 'EXTERNAL_DISPLAY'
  | 'POSSIBLE_MIRROR'
  | 'FULLSCREEN_EXIT'
  | 'TAB_SWITCH'
  | 'TAB_HIDDEN'
  | 'WINDOW_BLUR'
  | 'BEFORE_UNLOAD'
  | 'KEY_BLOCKED'
  | 'ERROR';

export interface ProctorEventResult {
  type: ProctorEventKind;
  warningCount: number;
  threshold: number;
  terminated: boolean;
  status: 'CREATED' | 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'TERMINATED';
}

// Proctoring — uses .env AWS Rekognition + Upstage credentials
export const proctorApi = {
  /** Pre-exam ID + face verify. Multipart: idCard (File) + liveFace (File). */
  verify: (idCard: File, liveFace: File, opts?: { examSessionId?: string }) => {
    const fd = new FormData();
    fd.append('idCard', idCard);
    fd.append('liveFace', liveFace);
    if (opts?.examSessionId) fd.append('examSessionId', opts.examSessionId);
    return api.post('/identity-verification/verify', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  /** Periodic webcam frame check during exam (Rekognition — second-opinion every 30s). */
  faceCheck: (imageBase64: string, opts?: { purpose?: 'DEMO' | 'EXAM'; sessionId?: string }) =>
    api.post('/cbt/proctor/face-check', { imageBase64, ...opts }),
  setDemoReference: (imageBase64: string) =>
    api.post('/cbt/proctor/demo-reference', { imageBase64 }),
  /** Client-side detector verdict reached the >3s sustain threshold. Server logs + counts. */
  event: (
    sessionId: string,
    body: {
      type: ProctorEventKind;
      detail?: Record<string, unknown>;
      // Optional frame(s) captured at the moment of the violation, attached as
      // the event's evidence snapshot server-side (capture-on-violation).
      webcamFrameBase64?: string;
      screenFrameBase64?: string;
    },
  ) => api.post<ProctorEventResult>(`/cbt/sessions/${sessionId}/proctor/event`, body),
  /** Live webcam thumbnail for the admin monitor (in-memory fan-out, never persisted). */
  webcamThumb: (sessionId: string, imageBase64: string, ts: number) =>
    api.post<{ ok: true }>('/cbt/proctor/webcam-thumb', { sessionId, imageBase64, ts }),
  /** Live screen-capture thumbnail for the admin monitor (in-memory fan-out, never persisted). */
  screenThumb: (sessionId: string, imageBase64: string, ts: number) =>
    api.post<{ ok: true }>('/cbt/proctor/screen-thumb', { sessionId, imageBase64, ts }),
  /**
   * Hard-violation: the candidate's microphone has been unplugged or stopped
   * delivering audio for longer than the grace window. The server records an
   * AUDIO_HIGH audit row with `metadata.kind = 'MIC_DISCONNECTED'` and
   * force-terminates the session (Article 28). Idempotent — safe to call more
   * than once if the network retries.
   */
  micDisconnected: (
    sessionId: string,
    body: { reason: 'ENDED' | 'MUTED' | 'STOPPED' | 'NO_TRACK'; detail?: Record<string, unknown> },
  ) =>
    api.post<{
      type: 'MIC_DISCONNECTED';
      terminated: boolean;
      status: string;
      warningCount: number;
      threshold: number;
      failReason: string | null;
      action: 'TERMINATED';
    }>(`/cbt/sessions/${sessionId}/proctor/mic-disconnected`, body),
  /**
   * Voice-strike threshold reached. The candidate's sustained voice bursts
   * have hit the audio strike budget — flip the session row from IN_PROGRESS
   * to TERMINATED on the server so the admin dashboard and the result page
   * agree with what the candidate already saw on the client. Idempotent —
   * safe to retry; a second call against an already-TERMINATED session is a
   * no-op.
   */
  voiceStrikeThreshold: (
    sessionId: string,
    body: { strikes: number; detail?: Record<string, unknown> },
  ) =>
    api.post<{
      type: 'VOICE_STRIKE_THRESHOLD';
      terminated: boolean;
      status: string;
      warningCount: number;
      threshold: number;
      failReason: string | null;
      action: 'TERMINATED';
    }>(`/cbt/sessions/${sessionId}/proctor/voice-strike-threshold`, body),
};

// ─────────────────────────── AI proctoring (tier 1 + 2) ───────────────────────────

export type AiVerdict = 'OK' | 'LOW' | 'MED' | 'HIGH';

export interface AiReviewResponse {
  aiVerdict: AiVerdict;
  captionKo: string | null;
  captionEn: string | null;
  ruleBroken: string | null;
  evidenceUrl: string | null;
  degraded: boolean;
  escalated: boolean;
  duplicate: boolean;
}

export interface AiEvidenceItem {
  id: string;
  // Backend surfaces page-leave + webcam-heuristic events here too so the
  // SessionEvidencePage can render a webcam/screen thumbnail per event.
  // Demo evidence also flows through this shape and may carry kinds outside
  // the strict ProctorEventType enum (e.g. LOOK_AWAY, VOICE, PAGE_LEAVE,
  // DUPLICATE_TAB) — the `(string & {})` widening preserves autocomplete
  // for the known set while accepting arbitrary demo kinds.
  type:
    | 'AI_FLAG_SUSPICIOUS'
    | 'AI_FLAG_CONFIRMED'
    | 'AUDIO_HIGH'
    | 'GAZE_AWAY'
    | 'NO_FACE'
    | 'EYES_CLOSED'
    | 'MULTIPLE_FACES'
    | 'IDENTITY_MISMATCH'
    | 'FACE_NOT_DETECTED'
    | 'PHONE_DETECTED'
    | 'FULLSCREEN_EXIT'
    | 'TAB_SWITCH'
    | 'WINDOW_BLUR'
    | 'TAB_HIDDEN'
    | 'BEFORE_UNLOAD'
    | (string & {});
  severity: 'LOW' | 'MED' | 'HIGH' | null;
  captionKo: string | null;
  captionEn: string | null;
  ruleBroken: string | null;
  confidence: number | null;
  createdAt: string;
  retainUntil: string | null;
  evidenceUrl: string | null;
  videoClipUrl: string | null;
}

export const aiProctorApi = {
  /**
   * Two-tier AI screening — frontend tick every 10s. The optional
   * `screenImageBase64` carries the candidate's most recent screen-capture
   * thumbnail; when AI confirms cheating, the backend persists that frame as
   * additional evidence (alongside the webcam frame) so admins can see what
   * was on screen at the moment of the violation.
   */
  review: (
    sessionId: string,
    ts: number,
    imageBase64: string,
    screenImageBase64?: string | null,
  ) =>
    api.post<AiReviewResponse>(
      '/cbt/proctor/ai-review',
      {
        sessionId,
        ts,
        imageBase64,
        ...(screenImageBase64 ? { screenImageBase64 } : {}),
      },
      // Gemini→Claude 체인은 정상적으로 ~10초까지 걸릴 수 있지만, 무한정
      // 매달리면 훅의 in-flight 가드가 풀리지 않아 남은 시험 내내 AI 감독이
      // 조용히 멈춘다. 20초에서 끊고 다음 tick 이 새 프레임으로 재시도.
      { timeout: 20_000 },
    ),
  /** Demo-only: Gemini tier-1 screening, no session needed. */
  demoReview: (ts: number, imageBase64: string) =>
    api.post<AiReviewResponse>('/cbt/proctor/demo-ai-review', {
      ts,
      imageBase64,
    }),
  /** Voice-burst clip + still frame upload. Multipart. */
  voiceClip: (
    sessionId: string,
    ts: number,
    clip: Blob,
    still: Blob | null,
    extras: { peakDb?: number; durationMs?: number } = {},
  ) => {
    const fd = new FormData();
    fd.append('sessionId', sessionId);
    fd.append('ts', String(ts));
    if (extras.peakDb != null) fd.append('peakDb', String(extras.peakDb));
    if (extras.durationMs != null) fd.append('durationMs', String(extras.durationMs));
    fd.append('clip', clip, 'clip.webm');
    if (still) fd.append('still', still, 'still.jpg');
    return api.post('/cbt/proctor/voice-clip', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  /** Student-side evidence list for a session (their own). */
  myEvidence: (sessionId: string) =>
    api.get<{ items: AiEvidenceItem[] }>(`/cbt/sessions/${sessionId}/proctor/evidence`),

  /**
   * Demo-mode evidence persistence. Demo runs aren't tied to an ExamSession,
   * so these route to /cbt/demo/proctor/* and are scoped by the JWT user.
   * MyPage surfaces the aggregated list via demoMyEvidence().
   */
  demoUploadEvidence: (
    ts: number,
    kind: string,
    imageBase64: string,
    severity?: string,
  ) =>
    api.post('/cbt/demo/proctor/evidence', {
      ts,
      kind,
      imageBase64,
      ...(severity ? { severity } : {}),
    }),
  demoVoiceClip: (
    ts: number,
    clip: Blob,
    still: Blob | null,
    extras: { peakDb?: number; durationMs?: number } = {},
  ) => {
    const fd = new FormData();
    fd.append('ts', String(ts));
    if (extras.peakDb != null) fd.append('peakDb', String(extras.peakDb));
    if (extras.durationMs != null) fd.append('durationMs', String(extras.durationMs));
    fd.append('clip', clip, 'clip.webm');
    if (still) fd.append('still', still, 'still.jpg');
    return api.post('/cbt/demo/proctor/voice-clip', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  demoMyEvidence: () =>
    api.get<{ items: AiEvidenceItem[] }>('/cbt/demo/proctor/evidence'),
};

export interface DemoPracticalTaskDto {
  id: string;
  title: string;
  scenario: string;
  durationMin: number;
  points: number;
}

export interface DemoCertificateResponse {
  certNumber: string;
  certType: CertType;
  level: CertLevel;
  holderName: string;
  issuedAt: string;
  validUntil: string;
}

// Demo (mostly public — issueCertificate requires auth)
export const demoApi = {
  paper: (certType: CertType, level: CertLevel) =>
    api.get(`/cbt/demo/${certType}/${level}`),
  grade: (
    certType: CertType,
    level: CertLevel,
    answers: { questionId: string; selectedChoice: string | null }[],
  ) => api.post('/cbt/demo/grade', { certType, level, answers }),
  issueCertificate: (certType: CertType, level: CertLevel) =>
    api.post<DemoCertificateResponse>('/cbt/demo/certificate', { certType, level }),
};

// Exam (CBT) API
export type CertType = 'AXIS' | 'AXIS_C' | 'AXIS_H';
export type CertLevel = 'L3' | 'L2' | 'L1';
export type ExamPart = 'WRITTEN' | 'PRACTICAL' | 'DELIVERABLE' | 'ESSAY';

export const examApi = {
  createSession: (certType: CertType, level: CertLevel) =>
    api.post('/cbt/sessions', { certType, level }),
  createFromRegistration: (registrationId: string) =>
    api.post('/cbt/sessions/from-registration', { registrationId }),
  consent: (sessionId: string, body: { consentRules: boolean; consentAiReview: boolean; consentVersion?: string }) =>
    api.post(`/cbt/sessions/${sessionId}/consent`, body),
  start: (sessionId: string) => api.post(`/cbt/sessions/${sessionId}/start`),
  paper: (sessionId: string) => api.get(`/cbt/sessions/${sessionId}/paper`),
  saveAnswer: (
    sessionId: string,
    body: { questionId: string; selectedChoice?: string | null; flagged?: boolean; version: number },
  ) => api.post(`/cbt/sessions/${sessionId}/answers`, body),
  savePractical: (
    sessionId: string,
    body: {
      taskId: string;
      contentText: string;
      aiChatLog?: { role: 'user' | 'assistant'; text: string; ts: number }[];
      version: number;
    },
  ) => api.post(`/cbt/sessions/${sessionId}/practical`, body),
  uploadDeliverable: (sessionId: string, taskId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ attachmentUrl: string }>(
      `/cbt/sessions/${sessionId}/deliverable?taskId=${encodeURIComponent(taskId)}`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  },
  askPracticalAi: (
    sessionId: string,
    body: { taskId: string; prompt: string; history?: { role: 'user' | 'assistant'; text: string }[] },
  ) => api.post<{ text: string; degraded: boolean }>(`/cbt/sessions/${sessionId}/practical/ai`, body),
  submit: (sessionId: string) => api.post(`/cbt/sessions/${sessionId}/submit`),
  result: (sessionId: string) => api.get(`/cbt/sessions/${sessionId}/result`),
  mine: () => api.get('/cbt/sessions/mine'),
};

export type InquiryCategory = 'REGISTRATION' | 'PAYMENT' | 'EXAM' | 'TECHNICAL' | 'CERTIFICATE' | 'OTHER';
export type InquiryStatus = 'PENDING' | 'ANSWERED' | 'CLOSED';

export interface Inquiry {
  id: string;
  userId: string;
  category: InquiryCategory;
  title: string;
  content: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; name: string; email: string };
  replies?: InquiryReply[];
  _count?: { replies: number };
}

export interface InquiryReply {
  id: string;
  inquiryId: string;
  authorId: string;
  content: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface InquiryAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export const inquiryApi = {
  create: (data: { category: InquiryCategory; title: string; content: string }) =>
    api.post<Inquiry>('/inquiries', data),
  getMyInquiries: (page = 1, limit = 10) =>
    api.get<{ inquiries: Inquiry[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
      '/inquiries/my',
      { params: { page, limit } },
    ),
  getById: (id: string) => api.get<Inquiry>(`/inquiries/${id}`),
  addReply: (id: string, content: string) =>
    api.post<InquiryReply>(`/inquiries/${id}/replies`, { content }),
  uploadAttachment: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<InquiryAttachment>('/inquiries/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── Notices (public, no auth) ─────────────────────────────────────────

export type NoticeTagType = 'IMPORTANT' | 'NORMAL';

export interface NoticeItem {
  id: string;
  tag: string;
  tagEn?: string | null;
  tagType: NoticeTagType;
  title: string;
  titleEn?: string | null;
  content: string;
  contentEn?: string | null;
  pinned: boolean;
  views: number;
  createdAt: string;
}

export const noticeApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<{
      notices: NoticeItem[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>('/notices', { params: { page, limit } }),
  getById: (id: string) => api.get<NoticeItem>(`/notices/${id}`),
};

// ── FAQ (public, no auth) ─────────────────────────────────────────────

export type FaqCategoryEnum =
  | 'REGISTRATION'
  | 'EXAM'
  | 'PASS'
  | 'REFUND'
  | 'ENVIRONMENT'
  | 'CERTIFICATE'
  | 'OTHER';

export interface FaqItem {
  id: string;
  category: FaqCategoryEnum;
  question: string;
  answer: string;
  pinned: boolean;
  sortOrder: number;
}

export const faqApi = {
  getAll: (category?: FaqCategoryEnum) =>
    api.get<FaqItem[]>('/faq', { params: category ? { category } : {} }),
};

/** Public site hints (IP-scoped footer link, etc.) — no auth. */
export type PublicSiteContextResponse = {
  footerAdminLink: string | null;
};

export const publicSiteApi = {
  context: () => api.get<PublicSiteContextResponse>('/public/site-context'),
};

// ── Inquiry attachment marker helpers ─────────────────────────────────
// We encode attachments inside the existing `content` column so no DB
// schema change is needed. Marker shape:
//   [[attachment|<url>|<filename>|<mimeType>|<size>]]
// Components are URL-encoded so '|' and ']]' inside values can't break
// the parser. Plain message text remains untouched.

const ATTACHMENT_RE = /\[\[attachment\|([^\]]+?)\|([^\]]+?)\|([^\]]+?)\|(\d+)\]\]/g;

/** Build an attachment marker that can be pasted into inquiry content. */
export function buildAttachmentMarker(a: InquiryAttachment): string {
  return `[[attachment|${encodeURIComponent(a.url)}|${encodeURIComponent(
    a.filename,
  )}|${encodeURIComponent(a.mimeType)}|${a.size}]]`;
}

/** Resolve a stored (relative) attachment URL to an absolute one. */
export function resolveAttachmentUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base =
    apiBaseRaw.length > 0 && /^https?:\/\//i.test(apiBaseRaw)
      ? apiBaseRaw.replace(/\/$/, '')
      : typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:3333`
        : '';
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface ParsedMessagePart {
  type: 'text' | 'attachment';
  text?: string;
  attachment?: InquiryAttachment;
}

/**
 * Split a message content string into text + attachment parts so the
 * renderer can show inline images / file chips around the prose.
 */
export function parseInquiryContent(content: string): ParsedMessagePart[] {
  if (!content) return [];
  const parts: ParsedMessagePart[] = [];
  let cursor = 0;
  ATTACHMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTACHMENT_RE.exec(content)) !== null) {
    if (match.index > cursor) {
      const text = content.slice(cursor, match.index);
      if (text.trim().length > 0) parts.push({ type: 'text', text });
    }
    try {
      parts.push({
        type: 'attachment',
        attachment: {
          url: decodeURIComponent(match[1]),
          filename: decodeURIComponent(match[2]),
          mimeType: decodeURIComponent(match[3]),
          size: Number(match[4]),
        },
      });
    } catch {
      parts.push({ type: 'text', text: match[0] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor);
    if (tail.trim().length > 0) parts.push({ type: 'text', text: tail });
  }
  return parts;
}

export default api;
