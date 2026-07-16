import axios, { AxiosError } from 'axios';

const apiBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/$/, '') ?? '/api';

const api = axios.create({
  baseURL: apiBase,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('expertToken');
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

let refreshInFlight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = localStorage.getItem('expertRefreshToken');
  if (!refreshToken) return null;
  refreshInFlight = (async () => {
    try {
      const res = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${apiBase}/auth/refresh`,
        { refreshToken },
        { headers: { 'Content-Type': 'application/json' } },
      );
      const next = res.data?.accessToken;
      if (!next) return null;
      localStorage.setItem('expertToken', next);
      if (res.data.refreshToken) localStorage.setItem('expertRefreshToken', res.data.refreshToken);
      return next;
    } catch {
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
    const original = err.config as (typeof err.config & { _retried?: boolean }) | undefined;
    if (err.response?.status === 401 && original && !original._retried) {
      if (isPublicAuthRequest(original)) return Promise.reject(err);
      original._retried = true;
      const next = await refreshAccessToken();
      if (next) {
        original.headers = original.headers ?? {};
        (original.headers as Record<string, string>).Authorization = `Bearer ${next}`;
        return api(original);
      }
      localStorage.removeItem('expertToken');
      localStorage.removeItem('expertRefreshToken');
      localStorage.removeItem('expertUser');
      if (window.location.pathname !== '/axis_expert/login') {
        window.location.href = '/axis_expert/login';
      }
    }
    return Promise.reject(err);
  },
);

// ── Shared types (must match axis-backend DTOs) ──────────────────
export type CertType = 'AXIS' | 'AXIS_C' | 'AXIS_H';
export type CertLevel = 'L1' | 'L2' | 'L3';
export type ExamSessionStatus =
  | 'CREATED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'GRADED'
  | 'TERMINATED';

export type GradingQueueTab =
  | 'all'
  | 'auto_done'
  | 'ai_graded'
  | 'reviewing'
  | 'final'
  | 'overdue'
  | 'terminated';

export type PracticalState =
  | 'auto'
  | 'ai_graded'
  | 'expert_reviewing'
  | 'final'
  | 'expert_disputed';

export interface GradingRow {
  sessionId: string;
  candidate: string;
  certType: CertType;
  level: CertLevel;
  roundNumber: number | null;
  writtenScore: number | null;
  practicalState: PracticalState;
  result: 'pass' | 'fail' | null;
  dueDate: string;
  daysToDue: number;
  overdue: boolean;
  assignedExpertId: string | null;
  assignedExpert: string | null;
  mandatoryReview: boolean;
  /** Force-terminated (cheating/unfinished) exam — reviewed via reviewTerminated. */
  terminated: boolean;
}

export type DeliverableReview = 'accepted' | 'rejected';

export interface GradingProctorEvent {
  id: string;
  type: string;
  createdAt: string;
  captionKo: string | null;
  captionEn: string | null;
  severity: string;
  hasEvidence: boolean;
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
  hasAttachment: boolean;
  attachmentFileName: string | null;
  deliverableReview: DeliverableReview | null;
  aiChatLog: { role: 'user' | 'assistant'; text: string; ts: number }[] | null;
  aiPreScore: number | null;
  aiBand: string | null;
  aiConfidence: number | null;
  aiRationale: string | null;
  aiCriterionScores: unknown;
  aiRiskFlags: AiRiskFlag[] | null;
  /** v2.0 contract — selection-reason / output-verification / plan-risk gate. */
  aiGate: AiGate | null;
  /** v2.0 contract — critical-fail candidate strings (exact enum). */
  aiCriticalFails: string[] | null;
  /** v2.0 contract — an injected grading instruction was detected in the answer. */
  aiInjectionSuspected: boolean;
  /** Which grader produced the first pass: 'l3-answer-key' | 'claude-opus-4-8' | 'hybrid-l3+claude' | 'judge0-autotest'. */
  aiModel: string | null;
  /** Raw AI first-pass points (0..maxPoints). */
  earnedPoints: number | null;
  expertScore: number | null;
  expertNotes: string | null;
}

export interface AiRiskFlag {
  code: string;
  severity: 'LOW' | 'MED' | 'HIGH' | 'CRITICAL' | string;
  detail: string;
}

export interface AiGate {
  triggered: boolean;
  rule: string;
  contradiction: string | null;
}

export type DecisionStatus =
  | 'PROVISIONAL'
  | 'IN_REVIEW'
  | 'CONFIRMED_PASS'
  | 'CONFIRMED_FAIL'
  | 'INVALIDATED'
  | null;

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
  mandatoryReview: boolean;
  /** v2.0 rule version stamped on the session ("1.1" | "2.0" | "3.0"). */
  specVersion: string;
  /** v2.0 decision state machine. Null for legacy v1.1 sessions. */
  decisionStatus: DecisionStatus;
  /** Exact review-reason strings (why this session is in human review). */
  reviewReasons: string[];
  assignedExpertId: string | null;
  proctorWarnings: number;
  cheatingSuspect: boolean;
  proctoringEvents: GradingProctorEvent[];
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

export interface AiEvidenceItem {
  id: string;
  eventType: string;
  createdAt: string;
  severity: string;
  captionKo: string | null;
  captionEn: string | null;
  evidenceUrl: string | null;
  screenEvidenceUrl: string | null;
  videoClipUrl: string | null;
}

export interface FinalizeResult {
  sessionId: string;
  writtenScore: number | null;
  practicalScore: number;
  totalScore: number;
  passed: boolean;
  failReason: string | null;
}

export interface GradingCounts {
  all: number;
  autoDone: number;
  aiDone: number;
  reviewing: number;
  final: number;
  overdue: number;
  terminated: number;
}

type LoginResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    userId: string;
    name: string;
    roles: string[];
    /** Set after an admin reset — the portal must force a password change. */
    mustChangePassword?: boolean;
  };
};

export const expertApi = {
  login: async (userId: string, password: string) => {
    try {
      return await api.post<LoginResponse>('/auth/admin/login', { userId, password });
    } catch (err: unknown) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 404) {
        return api.post<LoginResponse>('/auth/login', { userId, password });
      }
      throw err;
    }
  },
  logout: () => api.post('/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ success: true }>('/auth/change-password', { currentPassword, newPassword }),

  getQueue: (status?: GradingQueueTab) =>
    api.get<GradingRow[]>('/admin/grading/queue', {
      params: status && status !== 'all' ? { status } : {},
    }),
  getCounts: () => api.get<GradingCounts>('/admin/grading/queue/counts'),
  getDetail: (sessionId: string) =>
    api.get<GradingDetail>(`/admin/grading/sessions/${sessionId}/detail`),
  saveDraft: (
    sessionId: string,
    body: {
      tasks: {
        taskId: string;
        expertScore: number;
        expertNotes?: string;
        deliverableReview?: DeliverableReview;
      }[];
    },
  ) => api.patch<{ ok: true; scoredTasks: number }>(`/admin/grading/sessions/${sessionId}/expert-score`, body),
  finalize: (
    sessionId: string,
    body: {
      tasks: {
        taskId: string;
        expertScore: number;
        expertNotes?: string;
        deliverableReview?: DeliverableReview;
      }[];
      failReason?: string;
    },
  ) => api.post<FinalizeResult>(`/admin/grading/sessions/${sessionId}/finalize`, body),
  getProctorEvidence: (sessionId: string) =>
    api.get<{ items: AiEvidenceItem[] }>(`/admin/sessions/${sessionId}/proctor/evidence`),

  // ── v2.0 decision & gate actions (experts + grading admins) ──────────
  /** Confirm a triggered gate: zero the contradicted selection field (expert authority). */
  confirmGate: (sessionId: string, taskId: string, fieldKey: string) =>
    api.post<{ sessionId: string; taskId: string; fieldKey: string; expertScore: number }>(
      `/admin/grading/sessions/${sessionId}/tasks/${taskId}/confirm-gate`,
      { fieldKey },
    ),
  /** Human-lock a staged provisional/in-review decision (confirmed_pass/fail + certificate on pass). */
  confirmDecision: (sessionId: string) =>
    api.post<{ sessionId: string; decisionStatus: string; passed: boolean; totalScore: number | null }>(
      `/admin/grading/sessions/${sessionId}/confirm`,
    ),
  /**
   * Pass/fail decision on a force-terminated (cheating) exam. Confirm = pass
   * (certificate issued), reject = fail. The saved answers + evidence stay put.
   */
  reviewTerminated: (sessionId: string, decision: 'pass' | 'fail', note?: string) =>
    api.post<{
      sessionId: string;
      passed: boolean;
      totalScore: number | null;
      certificate: { certNumber: string } | null;
    }>(`/admin/grading/sessions/${sessionId}/review-terminated`, { decision, note }),

  // ── L1 eligibility review (AXIS-C L1) ───────────────────────
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
};

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

export default expertApi;
