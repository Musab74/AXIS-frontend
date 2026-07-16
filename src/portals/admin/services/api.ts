import axios, { AxiosError } from 'axios';
import { showAdminSessionSupersededModal } from '@admin/lib/sessionSupersededModal';

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '/api';

const api = axios.create({
  baseURL: apiBase,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('adminToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function isPublicAuthRequest(config: { url?: string } | undefined): boolean {
  const url = config?.url ?? '';
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/admin/login') ||
    url.includes('/auth/refresh')
  );
}

function getApiErrorCode(err: AxiosError): string | undefined {
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (!data) return undefined;
  if (typeof data.error === 'string') return data.error;
  const msg = data.message;
  if (msg && typeof msg === 'object' && msg !== null && 'error' in msg) {
    const nested = (msg as { error?: unknown }).error;
    return typeof nested === 'string' ? nested : undefined;
  }
  return undefined;
}

const ADMIN_SESSION_SUPERSEDED_KEY = 'axis:adminSessionSuperseded';

export function consumeAdminSessionSupersededMessage(): string | null {
  const msg = sessionStorage.getItem(ADMIN_SESSION_SUPERSEDED_KEY);
  if (msg) sessionStorage.removeItem(ADMIN_SESSION_SUPERSEDED_KEY);
  return msg;
}

function notifyAdminSessionSuperseded(customMessage?: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ADMIN_SESSION_SUPERSEDED_KEY);
  showAdminSessionSupersededModal({
    redirectTo: 'login',
    backendMessage: customMessage,
  });
}

function handleSessionSuperseded(err: AxiosError): boolean {
  if (getApiErrorCode(err) !== 'SESSION_SUPERSEDED') return false;
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
  localStorage.removeItem('adminUser');
  const data = err.response?.data as Record<string, unknown> | undefined;
  const raw = data?.message;
  const message =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in raw
        ? String((raw as { message?: unknown }).message ?? '')
        : undefined;
  notifyAdminSessionSuperseded(message || undefined);
  return true;
}

/**
 * Single in-flight refresh promise — multiple parallel 401s share one
 * /auth/refresh call rather than racing.
 */
let refreshInFlight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem('adminRefreshToken');
  if (!refreshToken) return null;
  refreshInFlight = (async () => {
    try {
      // Bare axios call — using `api` would re-trigger the response interceptor
      // and create infinite recursion if the refresh endpoint also 401s.
      const res = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${apiBase}/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      const next = res.data?.accessToken;
      if (!next) return null;
      localStorage.setItem('adminToken', next);
      if (res.data.refreshToken) localStorage.setItem('adminRefreshToken', res.data.refreshToken);
      return next;
    } catch (err) {
      if (err instanceof AxiosError && handleSessionSuperseded(err)) {
        return null;
      }
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err instanceof AxiosError && handleSessionSuperseded(err)) {
      return Promise.reject(err);
    }
    const original = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
    if (err.response?.status === 401 && original && !original._retried) {
      // Let login failures surface in the form — do not reload the page.
      if (isPublicAuthRequest(original)) {
        return Promise.reject(err);
      }
      original._retried = true;
      const next = await refreshAccessToken();
      if (next) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${next}`;
        return api.request(original);
      }
      // Refresh failed — genuine logout.
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminRefreshToken');
      localStorage.removeItem('adminUser');
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = '/axis_manager/login';
      }
    }
    return Promise.reject(err);
  },
);

export type CertType = 'AXIS' | 'AXIS_C' | 'AXIS_H';
export type CertLevel = 'L1' | 'L2' | 'L3';
export type ScheduleStatus =
  | 'UPCOMING'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface ScheduleRow {
  id: string;
  certType: CertType;
  level: CertLevel;
  roundNumber: number;
  year: number;
  registrationStart: string;
  registrationEnd: string;
  examDate: string;
  examStartTime: string;
  capacity: number;
  currentCount: number;
  status: ScheduleStatus;
  venue: string;
}

export type RegistrationStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'EXAM_COMPLETED';

export type ExamSessionStatus = 'CREATED' | 'IN_PROGRESS' | 'SUBMITTED' | 'GRADED' | 'TERMINATED';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'REFUNDED' | 'PARTIAL_REFUND';
export type PaymentMethod = 'CARD' | 'VBANK' | 'KAKAOPAY' | 'NAVERPAY' | 'TOSSPAY' | 'TRANSFER';

export type ExamineeStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'TERMINATED'
  | 'GRADED_PASSED'
  | 'GRADED_FAILED'
  | 'CERTIFIED'
  | 'PENDING_PAYMENT'
  | 'CANCELLED'
  | 'REFUNDED';

export interface ExamineeListUser {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string | null;
}

export interface ExamineeListSchedule {
  id: string;
  certType: CertType;
  level: CertLevel;
  year: number;
  roundNumber: number;
  examDate: string;
  examStartTime: string;
  status: ScheduleStatus;
  venue: string;
}

export interface ExamineeListPayment {
  id: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  approvedAt: string | null;
  refundAmount: number | null;
  /** Test-confirm / DEMO- paymentKey — no real PG money; not refundable. */
  isDemo?: boolean;
}

export interface ExamineeListSession {
  id: string;
  status: ExamSessionStatus;
  attemptNo: number;
  startedAt: string | null;
  submittedAt: string | null;
  passed: boolean | null;
  totalScore: number | null;
  writtenScore: number | null;
  practicalScore: number | null;
  failReason: string | null;
  proctorWarnings: number;
}

export interface ExamineeListRow {
  registrationId: string;
  registrationNumber: string | null;
  registrationStatus: RegistrationStatus;
  registrationCreatedAt: string;
  user: ExamineeListUser;
  schedule: ExamineeListSchedule;
  latestPayment: ExamineeListPayment | null;
  session: ExamineeListSession | null;
  examineeStatus: ExamineeStatus;
  certified: boolean;
  refundable: boolean;
}

export interface ExamineeListResult {
  items: ExamineeListRow[];
  total: number;
  page: number;
  limit: number;
  counts?: {
    pending: number;
    paid: number;
    refunded: number;
  };
}

export interface ExamineeRegistrationDetail {
  id: string;
  registrationNumber: string | null;
  status: RegistrationStatus;
  certType: CertType;
  level: CertLevel;
  partialExempt: boolean;
  cancelledAt: string | null;
  createdAt: string;
  examDeadline: string | null;
  schedule: ExamineeListSchedule;
  latestPayment: ExamineeListPayment | null;
  sessions: ExamineeListSession[];
  refundable: boolean;
  attemptsUsed: number;
  maxAttempts: number;
  attemptsLeft: number;
  attemptsExhausted: boolean;
  canGrantAttempt: boolean;
}

export interface ExamineeCertificate {
  id: string;
  certNumber: string;
  certType: string;
  level: string;
  issuedAt: string;
  validUntil: string;
  totalScore: number | null;
  sessionId: string;
}

export interface ExamineePenalty {
  id: string;
  reason: string;
  status: 'ACTIVE' | 'RELEASED';
  startAt: string;
  endAt: string;
  releasedAt: string | null;
  releaseReason: string | null;
  sessionId: string | null;
  decidedBy: string | null;
}

export interface ExamineeDetail {
  user: ExamineeListUser & {
    accountStatus: 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN';
    niceVerified: boolean;
    birthDate: string | null;
    gender: string | null;
    createdAt: string;
    lastLoginAt: string | null;
  };
  registrations: ExamineeRegistrationDetail[];
  certificates: ExamineeCertificate[];
  penalties: ExamineePenalty[];
  activePenaltyCount: number;
}

export type AdminRole =
  | 'SUPER_ADMIN'
  | 'EXAM_ADMIN'
  | 'GRADING_ADMIN'
  | 'PROCTOR'
  | 'EXPERT'
  | 'EXAMINEE';

export interface UserSummary {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'WITHDRAWN';
  niceVerified: boolean;
  roles: AdminRole[];
  activePenaltyCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SearchUsersResult {
  items: UserSummary[];
  total: number;
  page: number;
  limit: number;
  counts?: {
    active: number;
    suspended: number;
    withPenalty: number;
  };
}

export interface UserRoleDetail {
  role: AdminRole;
  grantedAt: string;
  grantedBy: string | null;
}

export interface MemberProfile extends ExamineeDetail {
  roles: AdminRole[];
  rolesDetail: UserRoleDetail[];
  accountLinkage: AccountLinkage;
  identityHistory: MemberIdentityHistory;
}

export interface AccountLinkage {
  integrated: true;
  portals: ['axisexam.com', 'cbt.axisexam.com'];
  niceVerified: boolean;
  carrierIdentityBound: boolean;
  hasReferenceFace: boolean;
  referenceFaceUpdatedAt: string | null;
  idImageStored: false;
}

export interface IdentityVerificationAttemptSummary {
  id: string;
  examSessionId: string | null;
  verdict: string;
  reasons: string[];
  idType: string;
  ocrConfidence: number;
  nameMatched: boolean;
  birthDateMatched: boolean | null;
  faceDecision: string;
  faceSimilarity: number;
  createdAt: string;
}

export interface CarrierVerificationEntry {
  authType: string;
  status: string;
  ipAddress: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface MemberIdentityHistory {
  carrier: CarrierVerificationEntry[];
  attempts: IdentityVerificationAttemptSummary[];
}

export interface UserActivity {
  lastLoginAt: string | null;
  loginHistory: Array<{
    at: string;
    ip: string;
    userAgent: string | null;
    source: 'web' | 'admin';
  }>;
  consentIps: Array<{
    consentType: string;
    ipAddress: string | null;
    userAgent: string | null;
    consentedAt: string;
  }>;
  niceIps: Array<{
    authType: string;
    ipAddress: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
}

export interface GrantAttemptResult {
  ok: true;
  attemptsUsed: number;
  maxAttempts: number;
  attemptsLeft: number;
  bonusGranted: number;
}

export interface ExamineeFilters {
  q?: string;
  status?: ExamineeStatus;
  paymentStatus?: 'PENDING' | 'CONFIRMED' | 'REFUNDED';
  certType?: CertType;
  level?: CertLevel;
  page?: number;
  limit?: number;
}

export type AdminRefundMode = 'TIERED' | 'FULL';
export interface AdminRefundResult {
  ok: boolean;
  alreadyCancelled?: boolean;
  refundAmount: number;
  refundTier?: string;
}

export interface RegisteredExamRow {
  id: string;
  certType: CertType;
  level: CertLevel;
  status: RegistrationStatus;
  registrationNumber: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    phone: string;
  };
  schedule: {
    id: string;
    year: number;
    roundNumber: number;
    examDate: string;
    examStartTime: string;
    status: ScheduleStatus;
    venue: string;
  };
}

export interface DashboardStats {
  cumulativeUsers: number;
  passRate: number;
  monthlyRegistrations: number;
  gradingProgress: number;
  gradingDonut: { completed: number; reviewing: number; waiting: number };
  alerts: { id: string; level: string; message: string; createdAt: string }[];
  upcomingExams: { scheduleId: string; name: string; dDay: number; date: string }[];
}

export interface PassRateStats {
  trend: { round: string; l3: number; l2: number; l1: number }[];
  distribution: { pass: number; fail: number; partial: number; inProgress: number };
  byCert: { certType: CertType; registered: number; passed: number }[];
}

export interface SubjectStats {
  averages: { subject: string; avgScore: number }[];
  heatmap: { subject: string; round: number; avgScore: number }[];
  practical: { task: string; avgScore: number }[];
  aiVsExpert: { aiScore: number; expertScore: number }[];
}

export type GradingQueueTab = 'all' | 'auto_done' | 'ai_graded' | 'reviewing' | 'final' | 'overdue' | 'terminated';
export type PracticalState = 'auto' | 'ai_graded' | 'expert_reviewing' | 'final' | 'expert_disputed';

export interface GradingRow {
  sessionId: string;
  candidate: string;
  certType: CertType;
  level: CertLevel;
  roundNumber: number | null;
  year?: number | null;
  scheduleId?: string | null;
  writtenScore: number | null;
  practicalScore?: number | null;
  totalScore?: number | null;
  practicalState: PracticalState;
  result: 'pass' | 'fail' | null;
  /** Parent schedule has resultsAnnouncedAt set. */
  announced?: boolean;
  dueDate: string;
  daysToDue: number;
  overdue: boolean;
  assignedExpertId: string | null;
  assignedExpert: string | null;
  mandatoryReview: boolean;
  /** Force-terminated (unfinished) exam — answers saved, graded only on demand. */
  terminated?: boolean;
}

export interface GradingTaskDetail {
  taskId: string;
  part: string;
  title: string;
  scenario: string;
  maxPoints: number;
  rubric: unknown;
  modelAnswer: string | null;
  contentText: string;
  hasAttachment?: boolean;
  attachmentFileName?: string | null;
  deliverableReview?: 'accepted' | 'rejected' | null;
  /** @deprecated use hasAttachment — kept for backward compat */
  attachmentUrl?: string | null;
  aiChatLog: { role: 'user' | 'assistant'; text: string; ts: number }[] | null;
  aiPreScore: number | null;
  aiBand: string | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  aiCriterionScores: unknown;
  aiRiskFlags: unknown;
  /** Which grader produced the first pass: 'l3-answer-key' | 'claude-opus-4-8' | 'hybrid-l3+claude' | 'judge0-autotest'. */
  aiModel: string | null;
  /** Raw AI first-pass points (0..maxPoints). */
  earnedPoints: number | null;
  expertScore: number | null;
  expertNotes: string | null;
}

export interface GradingDetail {
  sessionId: string;
  candidate: string;
  certType: CertType;
  level: CertLevel;
  status: ExamSessionStatus;
  writtenScore: number | null;
  practicalScore: number | null;
  totalScore: number | null;
  passed: boolean | null;
  failReason?: string | null;
  mandatoryReview: boolean;
  assignedExpertId: string | null;
  proctorWarnings?: number;
  cheatingSuspect?: boolean;
  tasks: GradingTaskDetail[];
  scoringHistory?: ScoringHistoryEntry[];
}

export interface ScoringHistoryEntry {
  id: string;
  taskId: string;
  taskTitle: string;
  scoringRound: 'FIRST' | 'SECOND' | 'ADJUST';
  total: number;
  raterId: string;
  raterName: string;
  confidenceComment: string | null;
  finalDecision: string | null;
  createdAt: string;
}

export interface FinalizeResult {
  sessionId: string;
  writtenScore: number | null;
  practicalScore: number;
  totalScore: number;
  passed: boolean;
  failReason: string | null;
}

export interface EligibilityRow {
  registrationId: string;
  registrationNumber: string | null;
  candidate: string;
  candidateUserId: string;
  certType: CertType;
  level: CertLevel;
  eligibilityType: string | null;
  eligibilityStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  hasDocument: boolean;
  documentFileName: string | null;
  eligibilityNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  registrationStatus: string;
  createdAt: string;
}

export interface EligibilityRefundRow {
  registrationId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  certType: CertType;
  level: CertLevel;
  roundNumber: number;
  examDate: string;
  amount: number;
  eligibilityStatus: string;
  eligibilityNote: string | null;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  candidateNote?: string;
  processedAt?: string;
  processedBy?: string;
  adminNote?: string;
}

export interface RefundRequestRow {
  registrationId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  certType: CertType;
  level: CertLevel;
  roundNumber: number;
  examDate: string;
  paidAmount: number;
  expectedAmount: number;
  refundTier: string;
  paymentMethod: string | null;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  candidateNote?: string;
  processedAt?: string;
  processedBy?: string;
  processedAmount?: number;
  adminNote?: string;
}

export interface ExpertRow {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string;
  accountStatus: string;
  competencies: CertType[];
  activePenaltyCount: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CreateExpertInput {
  userId: string;
  password: string;
  name: string;
  phone: string;
  email?: string;
  competencies: CertType[];
}

export interface GradingCounts {
  all: number;
  autoDone: number;
  aiDone: number;
  reviewing: number;
  final: number;
  overdue: number;
  terminated?: number;
}

export type LiveStatus = 'normal' | 'warning' | 'danger' | 'disconnected' | 'submitted' | 'terminated';

export interface LiveSessionRow {
  sessionId: string;
  candidateName: string;
  examName: string;
  level: CertLevel;
  progressPct: number;
  warnings: number;
  status: LiveStatus;
  /** Epoch-ms of the last server-observed activity. null = never seen. */
  lastSeenAt: number | null;
  /** Webcam thumb received within the freshness window. */
  webcamOnline: boolean;
  /** Screen-share thumb received within the freshness window. */
  screenOnline: boolean;
  webcamLastAt: number | null;
  screenLastAt: number | null;
}

export interface LiveSummary {
  inProgress: boolean;
  examName: string | null;
  takers: number;
  warnings: number;
}

/**
 * Per-event AI evidence row (signed NCP URLs valid ~30 min). Returned by the
 * `getAiEvidence(sessionId)` admin endpoint. Mirrors the backend's
 * `AiProctorService.formatEvidence` shape. The MonitoringPage matches these
 * to `LiveDetail.events` rows by `id` to render thumbnails inline.
 */
export interface AiEvidenceItem {
  id: string;
  // The backend's formatEvidence() now surfaces page-leave + webcam-heuristic
  // events alongside the AI/audio verdicts so the EvidenceModal can render a
  // webcam + screen thumbnail per FULLSCREEN_EXIT / TAB_SWITCH / WINDOW_BLUR
  // / TAB_HIDDEN / BEFORE_UNLOAD, plus the existing visual heuristics. The
  // type is union'd loosely with `string` because the timeline match is by
  // event id, not by reading this field — but enumerating known values
  // keeps autocomplete useful in IDEs.
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
    | 'BEFORE_UNLOAD';
  severity: 'LOW' | 'MED' | 'HIGH' | null;
  captionKo: string | null;
  captionEn: string | null;
  ruleBroken: string | null;
  confidence: number | null;
  createdAt: string;
  retainUntil: string | null;
  evidenceUrl: string | null;
  videoClipUrl: string | null;
  screenEvidenceUrl: string | null;
}

export interface LiveDetail {
  sessionId: string;
  candidate: { id: string; name: string; email: string | null; userId: string };
  certType: CertType;
  level: CertLevel;
  status: string;
  startedAt: string | null;
  hardDeadline: string | null;
  submittedAt: string | null;
  progressPct: number;
  answered: number;
  total: number;
  warnings: number;
  failReason?: string | null;
  /** Session-level: IMMEDIATE vs AFTER_WARNING when terminated; null if not. */
  terminationMode?: 'IMMEDIATE' | 'AFTER_WARNING' | 'INFO' | null;
  timerPaused?: boolean;
  events: {
    id: string;
    type: string;
    createdAt: string;
    captionKo: string | null;
    captionEn: string | null;
    severity: string | null;
    evidenceUrl: string | null;
    /**
     * NCP key of the screen-share frame at the moment the AI confirmed
     * cheating, or null if the candidate had not granted screen share / the
     * event predates the screen-evidence rollout. Like `evidenceUrl`, the
     * raw key — sign via the existing AI evidence endpoint when displaying.
     */
    screenEvidenceUrl: string | null;
    /** Explicit dispute mode: immediate terminate vs after warnings. */
    triggerMode?: 'IMMEDIATE' | 'AFTER_WARNING' | 'INFO';
    /** Exact (or best-effort) wording shown / stamped for the candidate. */
    candidateMessage?: string | null;
    metadata?: {
      kind?: string;
      message?: string;
      reason?: string;
      terminate?: boolean;
      source?: string;
      strikes?: number;
      candidateMessage?: string;
      actorId?: string;
      [key: string]: unknown;
    };
  }[];
}

export interface QuestionRow {
  id: string;
  certType: CertType;
  level: CertLevel;
  subjectIndex: number;
  subjectName: string;
  type: string;
  stem: string;
  choices: { label: string; text: string }[] | null;
  correctAnswer: string | null;
  points: number;
  qVersion: number;
  active: boolean;
  createdAt: string;
}

export interface QuestionStats {
  total: number;
  byCertType: { certType: CertType; count: number }[];
  byLevel: { level: CertLevel; count: number }[];
  byType: { type: string; count: number }[];
}

export interface SubjectRow {
  certType: CertType;
  level: CertLevel;
  subjectIndex: number;
  subjectName: string;
  questionCount: number;
}

export interface TaskRow {
  id: string;
  certType: CertType;
  level: CertLevel;
  part: string;
  title: string;
  scenario: string;
  rubric: Record<string, unknown>;
  durationMin: number;
  points: number;
  orderIndex: number;
  createdAt: string;
}

export interface TaskStats {
  total: number;
  byCertType: { certType: CertType; count: number }[];
  byLevel: { level: CertLevel; count: number }[];
  byPart: { part: string; count: number }[];
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface QuestionFilters {
  certType?: CertType;
  level?: CertLevel;
  subjectIndex?: number;
  search?: string;
  page?: number;
  limit?: number;
}

export interface QuestionUploadResult {
  kind: 'mcq' | 'task';
  fileName: string;
  rowsParsed: number;
  rowsValid: number;
  errors: string[];
  warnings: string[];
  storedAt: string;
}

export interface TaskFilters {
  certType?: CertType;
  level?: CertLevel;
  part?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export type AdminNotificationCategory =
  | 'EXAM_START'
  | 'EXAM_FINISH'
  | 'CHEATING'
  | 'INQUIRY'
  | 'INQUIRY_REPLY'
  | 'GRADING'
  | 'REGISTRATION';

export type AdminNotificationSeverity = 'INFO' | 'MEDIUM' | 'HIGH';

export interface AdminNotificationRow {
  id: string;
  category: AdminNotificationCategory;
  titleKo: string;
  titleEn: string;
  bodyKo: string;
  bodyEn: string;
  severity: AdminNotificationSeverity;
  href?: string;
  meta?: Record<string, unknown>;
  ts: number;
  read: boolean;
}

export interface AdminNotificationPreferences {
  examStart: boolean;
  examFinish: boolean;
  cheating: boolean;
  inquiry: boolean;
  inquiryReply: boolean;
  grading: boolean;
  registration: boolean;
}

export interface AdminNotificationInbox {
  items: AdminNotificationRow[];
  unreadCount: number;
}

export const adminApi = {
  login: async (userId: string, password: string) => {
    type LoginResponse = {
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        userId: string;
        name: string;
        roles: string[];
        mustChangePassword?: boolean;
      };
    };
    return api.post<LoginResponse>('/auth/admin/login', { userId, password });
  },

  logout: () => api.post('/auth/logout'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: true }>('/auth/change-password', { currentPassword, newPassword }),

  getUsers: (params?: { q?: string; accountStatus?: string; role?: string; page?: number; limit?: number }) =>
    api.get<SearchUsersResult>('/admin/users', { params }),
  exportUsers: (params?: { q?: string; accountStatus?: string; role?: string }) =>
    api.get<Blob>('/admin/users/export', {
      params,
      responseType: 'blob',
      timeout: 120_000,
    }),

  getUserDetail: (id: string) => api.get(`/admin/users/${id}`),

  getMemberProfile: (id: string) => api.get<MemberProfile>(`/admin/users/${id}/member-profile`),

  getMemberActivity: (id: string) => api.get<UserActivity>(`/admin/users/${id}/activity`),

  updateRole: (id: string, role: string, grant: boolean) =>
    api.patch(`/admin/users/${id}/roles`, { role, grant }),

  /** SUPER_ADMIN: reset to the fixed temp password; target must change it at next login. */
  resetUserPassword: (id: string) =>
    api.post<{ ok: true; tempPassword: string }>(`/admin/users/${id}/reset-password`),

  /** SUPER_ADMIN: reveal masked phone/birth date. The reason is stored in the audit log. */
  revealUserPii: (id: string, reason: string) =>
    api.post<{ phone: string; birthDate: string | null }>(`/admin/users/${id}/pii-reveal`, { reason }),

  issuePenalty: (id: string, data: { reason: string; startAt: string; endAt: string; relatedSessionId?: string }) =>
    api.post(`/admin/users/${id}/penalties`, data),

  releasePenalty: (id: string, penaltyId: string, releaseReason: string) =>
    api.patch(`/admin/users/${id}/penalties/${penaltyId}/release`, { releaseReason }),

  grantAttempt: (registrationId: string, reason?: string) =>
    api.post<GrantAttemptResult>(`/admin/registrations/${registrationId}/grant-attempt`, { reason }),

  getSchedules: (params?: { certType?: CertType; level?: CertLevel; status?: ScheduleStatus }) =>
    api.get<ScheduleRow[]>('/schedules', { params }),

  getOnDemandSettings: () =>
    api.get<{
      businessHoursStart: number;
      businessHoursEnd: number;
      defaultSlotCapacity: number;
      slotUnitMinutes: number;
    }>('/admin/schedules/on-demand-settings'),

  updateOnDemandSettings: (data: {
    businessHoursStart?: number;
    businessHoursEnd?: number;
    defaultSlotCapacity?: number;
    slotUnitMinutes?: number;
  }) =>
    api.patch<{
      businessHoursStart: number;
      businessHoursEnd: number;
      defaultSlotCapacity: number;
      slotUnitMinutes: number;
    }>('/admin/schedules/on-demand-settings', data),

  createSchedule: (data: {
    certType: CertType;
    level: CertLevel;
    examDate: string;
    examStartTime: string;
    registrationStart: string;
    registrationEnd: string;
    capacity?: number;
    venue?: string;
    venueDetail?: string;
    status?: ScheduleStatus;
    roundNumber?: number;
  }) => api.post<ScheduleRow>('/admin/schedules', data),

  updateSchedule: (
    id: string,
    data: {
      certType?: CertType;
      level?: CertLevel;
      examDate?: string;
      examStartTime?: string;
      registrationStart?: string;
      registrationEnd?: string;
      capacity?: number;
      venue?: string;
      venueDetail?: string;
      status?: ScheduleStatus;
      roundNumber?: number;
    },
  ) => api.patch<ScheduleRow>(`/admin/schedules/${id}`, data),

  getRegisteredExams: (params?: { certType?: CertType; level?: CertLevel; scheduleStatus?: ScheduleStatus }) =>
    api.get<RegisteredExamRow[]>('/admin/schedules/registrations', { params }),

  // ── Admin stats ─────────────────────────────────────────────
  getAdminDashboard: () => api.get<DashboardStats>('/admin/stats/dashboard'),
  getAdminPassRate: (params?: { certType?: CertType; level?: CertLevel; from?: string; to?: string }) =>
    api.get<PassRateStats>('/admin/stats/pass-rate', { params }),
  getAdminSubjects: (params?: { certType?: CertType; level?: CertLevel }) =>
    api.get<SubjectStats>('/admin/stats/subjects', { params }),

  // ── Admin grading ──────────────────────────────────────────
  getGradingQueue: (status?: GradingQueueTab) =>
    api.get<GradingRow[]>('/admin/grading/queue', { params: status && status !== 'all' ? { status } : {} }),
  getGradingCounts: () => api.get<GradingCounts>('/admin/grading/queue/counts'),
  getGradingDetail: (sessionId: string) =>
    api.get<GradingDetail>(`/admin/grading/sessions/${sessionId}/detail`),
  /** Admin-only signed URL for a practical deliverable attachment. */
  getDeliverableUrl: (sessionId: string, taskId: string) =>
    api.get<{ url: string }>(`/admin/grading/sessions/${sessionId}/deliverable`, {
      params: { taskId },
    }),
  publishResults: (sessionIds: string[]) =>
    api.post<{
      ok: true;
      sessionCount: number;
      scheduleCount: number;
      newlyAnnounced: number;
      schedules: {
        scheduleId: string;
        certType: string;
        level: string;
        year: number;
        roundNumber: number;
        alreadyAnnounced: boolean;
      }[];
    }>('/admin/results/publish', { sessionIds }),
  aiPrescore: (sessionId: string) =>
    api.post(`/admin/grading/sessions/${sessionId}/ai-prescore`, {}),
  saveExpertScore: (
    sessionId: string,
    body: { tasks: { taskId: string; expertScore: number; expertNotes?: string }[] },
  ) =>
    api.patch<{ ok: true; sessionId: string; scoredTasks: number; mandatoryReviewCleared: boolean }>(
      `/admin/grading/sessions/${sessionId}/expert-score`,
      body,
    ),
  finalizeSession: (
    sessionId: string,
    body: { tasks: { taskId: string; expertScore: number; expertNotes?: string }[]; failReason?: string },
  ) => api.post<FinalizeResult>(`/admin/grading/sessions/${sessionId}/finalize`, body),
  /**
   * Pass/fail decision on a force-terminated (cheating) exam. Confirm = pass
   * (certificate issued), reject = fail. Judged on the saved answers + evidence.
   * Pass optional expert task scores so the total is graded before lock.
   */
  reviewTerminated: (
    sessionId: string,
    decision: 'pass' | 'fail',
    note?: string,
    tasks?: Array<{
      taskId: string;
      expertScore: number;
      expertNotes?: string;
      deliverableReview?: 'accepted' | 'rejected';
    }>,
  ) =>
    api.post<{
      sessionId: string;
      passed: boolean;
      totalScore: number | null;
      certificate: { certNumber: string } | null;
    }>(`/admin/grading/sessions/${sessionId}/review-terminated`, {
      decision,
      note,
      ...(tasks?.length ? { tasks } : {}),
    }),
  assignExpert: (sessionId: string, expertId: string) =>
    api.post<{ ok: true }>(`/admin/grading/sessions/${sessionId}/assign`, { expertId }),
  assignBulk: (sessionIds: string[], expertId: string) =>
    api.post<{ assigned: number; skipped: string[] }>('/admin/grading/assign-bulk', {
      sessionIds,
      expertId,
    }),

  // ── Admin experts (graders) ────────────────────────────────
  getExperts: () => api.get<ExpertRow[]>('/admin/users/experts'),
  createExpert: (body: CreateExpertInput) =>
    api.post<ExpertRow>('/admin/users/experts', body),

  // ── L1 eligibility review ──────────────────────────────────
  getEligibilityQueue: (status?: 'PENDING' | 'APPROVED' | 'REJECTED') =>
    api.get<EligibilityRow[]>('/admin/registrations/eligibility', {
      params: status ? { status } : {},
    }),
  getEligibilityCounts: () =>
    api.get<{ pending: number }>('/admin/registrations/eligibility/counts'),
  getEligibilityDoc: (registrationId: string) =>
    api.get<{ url: string | null; fileName: string | null }>(
      `/admin/registrations/eligibility/${registrationId}/document`,
    ),
  reviewEligibility: (registrationId: string, decision: 'APPROVED' | 'REJECTED', note?: string) =>
    api.post<{ ok: true; eligibilityStatus: string }>(
      `/admin/registrations/eligibility/${registrationId}/review`,
      { decision, note },
    ),

  getEligibilityRefundQueue: (status: 'PENDING' | 'ALL' = 'PENDING') =>
    api.get<EligibilityRefundRow[]>('/admin/registrations/eligibility-refunds', {
      params: { status },
    }),
  getEligibilityRefundCounts: () =>
    api.get<{ pending: number }>('/admin/registrations/eligibility-refunds/counts'),
  approveEligibilityRefund: (registrationId: string, note?: string) =>
    api.post<{ ok: true; refundAmount: number; refundTier: string }>(
      `/admin/registrations/eligibility-refunds/${registrationId}/approve`,
      { note },
    ),
  rejectEligibilityRefund: (registrationId: string, note?: string) =>
    api.post<{ ok: true }>(
      `/admin/registrations/eligibility-refunds/${registrationId}/reject`,
      { note },
    ),

  // ── Candidate refund requests (bank account → admin confirm) ───────────
  getRefundRequestQueue: (status: 'PENDING' | 'ALL' = 'PENDING') =>
    api.get<RefundRequestRow[]>('/admin/registrations/refund-requests', {
      params: { status },
    }),
  getRefundRequestCounts: () =>
    api.get<{ pending: number }>('/admin/registrations/refund-requests/counts'),
  approveRefundRequest: (registrationId: string, note?: string) =>
    api.post<{ ok: true; refundAmount: number; refundTier: string }>(
      `/admin/registrations/refund-requests/${registrationId}/approve`,
      { note },
    ),
  rejectRefundRequest: (registrationId: string, note?: string) =>
    api.post<{ ok: true }>(
      `/admin/registrations/refund-requests/${registrationId}/reject`,
      { note },
    ),

  // ── Admin monitor ──────────────────────────────────────────
  getMonitorLive: () => api.get<LiveSessionRow[]>('/admin/monitor/live'),
  getMonitorSummary: () => api.get<LiveSummary>('/admin/monitor/summary'),
  getMonitorSession: (id: string) => api.get<LiveDetail>(`/admin/monitor/sessions/${id}`),
  warnMonitorSession: (id: string, body?: { message?: string }) =>
    api.post<{ ok: true; action: string }>(`/admin/monitor/sessions/${id}/warn`, body ?? {}),
  pauseMonitorSession: (id: string, body?: { reason?: string }) =>
    api.post<{ ok: true; action: string; timerPaused?: boolean }>(
      `/admin/monitor/sessions/${id}/pause`,
      body ?? {},
    ),
  extendMonitorSession: (id: string, body: { seconds: number }) =>
    api.post<{ ok: true; action: string; hardDeadline?: string | null }>(
      `/admin/monitor/sessions/${id}/extend`,
      body,
    ),
  terminateMonitorSession: (id: string, body?: { reason?: string }) =>
    api.post<{ ok: true; action: string; status?: string }>(
      `/admin/monitor/sessions/${id}/terminate`,
      body ?? {},
    ),

  // ── Admin notifications ────────────────────────────────────
  getNotifications: () => api.get<AdminNotificationInbox>('/admin/notifications'),
  getNotificationUnreadCount: () => api.get<{ count: number }>('/admin/notifications/unread-count'),
  markNotificationRead: (id: string) => api.post<{ ok: true }>(`/admin/notifications/${id}/read`),
  markAllNotificationsRead: () => api.post<{ ok: true }>('/admin/notifications/read-all'),
  getNotificationPreferences: () => api.get<AdminNotificationPreferences>('/admin/notifications/preferences'),
  updateNotificationPreferences: (patch: Partial<AdminNotificationPreferences>) =>
    api.patch<AdminNotificationPreferences>('/admin/notifications/preferences', patch),

  /**
   * Fetch the per-event AI evidence list (signed NCP URLs valid 30 min).
   * Includes both the webcam evidence frame (`evidenceUrl`) and, when the
   * candidate had screen share active at the moment of the violation, the
   * screen frame (`screenEvidenceUrl`). The MonitoringPage merges these by
   * event id with the `LiveDetail.events` rows from `getMonitorSession`.
   */
  getAiEvidence: (sessionId: string) =>
    api.get<{ items: AiEvidenceItem[] }>(`/admin/sessions/${sessionId}/proctor/evidence`),

  // ── Admin questions ──────────────────────────────────────
  getQuestionStats: () => api.get<QuestionStats>('/admin/questions/stats'),
  getSubjects: () => api.get<SubjectRow[]>('/admin/questions/subjects'),
  getQuestions: (filters: QuestionFilters) =>
    api.get<{ questions: QuestionRow[]; pagination: Pagination }>('/admin/questions/list', { params: filters }),
  getQuestionById: (id: string) => api.get<QuestionRow>(`/admin/questions/${id}`),
  uploadQuestionCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<QuestionUploadResult>('/admin/questions/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  /**
   * Returns a fully-qualified URL for the CSV template download.
   * Includes the access token as a query string fallback only when needed —
   * here we simply trigger a fetch+blob from the modal so the bearer header
   * goes along normally.
   */
  downloadQuestionTemplate: async (kind: 'mcq' | 'task') => {
    const res = await api.get<Blob>('/admin/questions/template', {
      params: { type: kind },
      responseType: 'blob',
    });
    return res.data;
  },

  // ── Admin reports (정기/맞춤 리포트) ─────────────────────
  getReportRounds: () =>
    api.get<ReportRound[]>('/admin/reports/rounds'),
  downloadRoundComprehensive: (params: ReportFilterParams) =>
    api.get<Blob>('/admin/reports/round-comprehensive', { params, responseType: 'blob', timeout: 120_000 }),
  downloadPassList: (params: ReportFilterParams) =>
    api.get<Blob>('/admin/reports/pass-list', { params, responseType: 'blob', timeout: 120_000 }),
  downloadItemAnalysis: (params: ReportFilterParams) =>
    api.get<Blob>('/admin/reports/item-analysis', { params, responseType: 'blob', timeout: 120_000 }),
  downloadGradingStatus: (params: ReportFilterParams) =>
    api.get<Blob>('/admin/reports/grading-status', { params, responseType: 'blob', timeout: 120_000 }),
  downloadCustomReport: (params: CustomReportParams) =>
    api.get<Blob>('/admin/reports/custom', { params, responseType: 'blob', timeout: 120_000 }),

  // ── Admin tasks ──────────────────────────────────────────
  getTaskStats: () => api.get<TaskStats>('/admin/tasks/stats'),
  getTasks: (filters: TaskFilters) =>
    api.get<{ tasks: TaskRow[]; pagination: Pagination }>('/admin/tasks/list', { params: filters }),
  getTaskById: (id: string) => api.get<TaskRow>(`/admin/tasks/${id}`),

  // ── Admin examinees (응시자 관리) ───────────────────────
  getExaminees: (filters: ExamineeFilters = {}) =>
    api.get<ExamineeListResult>('/admin/examinees', { params: filters }),
  exportExaminees: (filters: ExamineeFilters = {}) =>
    api.get<Blob>('/admin/examinees/export', {
      params: filters,
      responseType: 'blob',
      timeout: 120_000,
    }),
  getExamineeDetail: (userId: string) =>
    api.get<ExamineeDetail>(`/admin/examinees/${userId}`),
  adminRefundRegistration: (
    registrationId: string,
    body: {
      mode: AdminRefundMode;
      reason: string;
      refundAccount?: {
        bank: string;
        number: string;
        holderName: string;
        holderPhoneNumber?: string;
      };
    },
  ) => api.post<AdminRefundResult>(`/admin/registrations/${registrationId}/refund`, body),

  // ── Admin inquiries (Q&A) ──────────────────────────────
  getInquiryStats: () => api.get<InquiryStats>('/admin/inquiries/stats'),
  getInquiries: (filters: InquiryFilters) =>
    api.get<{ inquiries: InquiryRow[]; pagination: Pagination }>('/admin/inquiries', { params: filters }),
  getInquiryById: (id: string) => api.get<InquiryDetail>(`/admin/inquiries/${id}`),
  replyToInquiry: (id: string, content: string) =>
    api.post<InquiryReply>(`/admin/inquiries/${id}/replies`, { content }),
  updateInquiryStatus: (id: string, status: InquiryStatus) =>
    api.patch(`/admin/inquiries/${id}/status`, { status }),
  deleteInquiry: (id: string) => api.delete(`/admin/inquiries/${id}`),
  uploadInquiryAttachment: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<InquiryAttachment>('/inquiries/uploads', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // ── Admin notices (공지사항) ─────────────────────────────
  getNotices: (filters: ContentNoticeFilters = {}) =>
    api.get<{ notices: ContentNoticeRow[]; pagination: Pagination }>('/admin/notices', { params: filters }),
  getNoticeById: (id: string) => api.get<ContentNoticeRow>(`/admin/notices/${id}`),
  createNotice: (data: CreateNoticePayload) =>
    api.post<ContentNoticeRow>('/admin/notices', data),
  updateNotice: (id: string, data: UpdateNoticePayload) =>
    api.put<ContentNoticeRow>(`/admin/notices/${id}`, data),
  deleteNotice: (id: string) => api.delete(`/admin/notices/${id}`),

  // ── Admin FAQ ────────────────────────────────────────────
  getFaqs: (filters: ContentFaqFilters = {}) =>
    api.get<{ faqs: ContentFaqRow[]; pagination: Pagination }>('/admin/faq', { params: filters }),
  getFaqById: (id: string) => api.get<ContentFaqRow>(`/admin/faq/${id}`),
  createFaq: (data: CreateFaqPayload) =>
    api.post<ContentFaqRow>('/admin/faq', data),
  updateFaq: (id: string, data: UpdateFaqPayload) =>
    api.put<ContentFaqRow>(`/admin/faq/${id}`, data),
  deleteFaq: (id: string) => api.delete(`/admin/faq/${id}`),
};

export interface InquiryAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

const ATTACHMENT_RE = /\[\[attachment\|([^\]]+?)\|([^\]]+?)\|([^\]]+?)\|(\d+)\]\]/g;

export function buildAttachmentMarker(a: InquiryAttachment): string {
  return `[[attachment|${encodeURIComponent(a.url)}|${encodeURIComponent(
    a.filename,
  )}|${encodeURIComponent(a.mimeType)}|${a.size}]]`;
}

export function resolveAttachmentUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (apiBase && apiBase !== '/api') return `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`;
  return url;
}

export interface ParsedMessagePart {
  type: 'text' | 'attachment';
  text?: string;
  attachment?: InquiryAttachment;
}

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

export type InquiryCategory = 'REGISTRATION' | 'PAYMENT' | 'EXAM' | 'TECHNICAL' | 'CERTIFICATE' | 'OTHER';
export type InquiryStatus = 'PENDING' | 'ANSWERED' | 'CLOSED';

export interface InquiryStats {
  total: number;
  pending: number;
  answered: number;
  byCategory: { category: InquiryCategory; count: number }[];
}

export interface InquiryFilters {
  status?: InquiryStatus;
  category?: InquiryCategory;
  search?: string;
  page?: number;
  limit?: number;
}

export interface InquiryRow {
  id: string;
  userId: string;
  category: InquiryCategory;
  title: string;
  content: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string; email: string };
  replies: InquiryReply[];
  _count: { replies: number };
}

export interface InquiryDetail extends InquiryRow {
  user: { id: string; name: string; email: string; phone: string };
}

export interface InquiryReply {
  id: string;
  inquiryId: string;
  authorId: string;
  content: string;
  isAdmin: boolean;
  createdAt: string;
}

// ── Content (notices & FAQ) types ────────────────────────────────────

export type NoticeTagType = 'IMPORTANT' | 'NORMAL';
export type ContentNoticeStatus = 'PUBLISHED' | 'DRAFT';
export type ContentFaqCategory =
  | 'REGISTRATION'
  | 'EXAM'
  | 'PASS'
  | 'REFUND'
  | 'ENVIRONMENT'
  | 'CERTIFICATE'
  | 'OTHER';

export interface ContentNoticeRow {
  id: string;
  tag: string;
  tagType: NoticeTagType;
  title: string;
  content: string;
  status: ContentNoticeStatus;
  pinned: boolean;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContentNoticeFilters {
  status?: ContentNoticeStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateNoticePayload {
  tag: string;
  tagType?: NoticeTagType;
  title: string;
  content: string;
  status?: ContentNoticeStatus;
  pinned?: boolean;
}

export interface UpdateNoticePayload {
  tag?: string;
  tagType?: NoticeTagType;
  title?: string;
  content?: string;
  status?: ContentNoticeStatus;
  pinned?: boolean;
}

export interface ContentFaqRow {
  id: string;
  category: ContentFaqCategory;
  question: string;
  answer: string;
  sortOrder: number;
  pinned: boolean;
  published: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContentFaqFilters {
  category?: ContentFaqCategory;
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateFaqPayload {
  category?: ContentFaqCategory;
  question: string;
  answer: string;
  sortOrder?: number;
  pinned?: boolean;
  published?: boolean;
}

export interface UpdateFaqPayload {
  category?: ContentFaqCategory;
  question?: string;
  answer?: string;
  sortOrder?: number;
  pinned?: boolean;
  published?: boolean;
}

// ── Admin reports types ──────────────────────────────────────────────
export interface ReportRound {
  value: string; // "<year>-<roundNumber>"
  label: string;
  year: number;
  roundNumber: number;
}

export interface ReportFilterParams {
  certType?: 'AXIS' | 'AXIS_C' | 'AXIS_H' | 'all';
  level?: 'L1' | 'L2' | 'L3';
  round?: string;
  from?: string;
  to?: string;
}

export interface CustomReportParams extends ReportFilterParams {
  fields?: string; // comma-separated: examinees,scores,results
}

/**
 * Save a Blob to the user's machine via a temporary <a download>. Filename
 * falls back to `report.bin` if nothing useful is passed (which would be
 * unfortunate naming, but at least nothing explodes).
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'report.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** UTF-8 BOM CSV that Excel opens with correct Korean/English text. */
export function exportTableCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  triggerBlobDownload(blob, name);
}

export default api;
