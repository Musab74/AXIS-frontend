import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  FileWarning,
  Gavel,
  Loader2,
  Lock,
  MessageSquare,
  ScanEye,
  ShieldAlert,
  ShieldX,
  Sparkles,
  XCircle,
} from 'lucide-react';
import {
  Button,
  Card,
  CertTag,
  certCodeOf,
  PageHeader,
  pushToast,
} from '@expert/components/shared/ui-kit';
import {
  expertApi,
  type AiGate,
  type AiRiskFlag,
  type DecisionStatus,
  type DeliverableReview,
  type GradingDetail,
  type GradingTaskDetail,
} from '@expert/services/api';
import { ProctorEvidencePanel } from '@expert/components/grading/ProctorEvidencePanel';
import { AxiosError } from 'axios';

function bandPill(band: string | null): string {
  switch (band) {
    case 'excellent':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'normal':
      return 'bg-blue-50 text-blue-800 border-blue-200';
    case 'borderline':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'fail':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

/** Colour + label for a risk-flag severity chip. */
function severityChip(sev: string): string {
  switch ((sev || '').toUpperCase()) {
    case 'CRITICAL':
      return 'bg-rose-100 text-rose-800 border-rose-300';
    case 'HIGH':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'MED':
    case 'MEDIUM':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-300';
  }
}

/** Decision-status badge — the v2.0 state machine, shown to the reviewer. */
function decisionBadge(status: DecisionStatus): { label: string; cls: string; icon: typeof Lock } {
  switch (status) {
    case 'PROVISIONAL':
      return { label: '잠정 (확정 대기)', cls: 'bg-sky-50 text-sky-800 border-sky-200', icon: Sparkles };
    case 'IN_REVIEW':
      return { label: '검수 중', cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: ScanEye };
    case 'CONFIRMED_PASS':
      return { label: '확정 · 합격', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Lock };
    case 'CONFIRMED_FAIL':
      return { label: '확정 · 불합격', cls: 'bg-rose-50 text-rose-800 border-rose-200', icon: Lock };
    case 'INVALIDATED':
      return { label: '무효', cls: 'bg-slate-200 text-slate-700 border-slate-300', icon: ShieldX };
    default:
      return { label: '레거시(v1.1)', cls: 'bg-slate-50 text-slate-500 border-slate-200', icon: Bot };
  }
}

function aiSuggestedPoints(task: GradingTaskDetail): number | null {
  if (task.aiPreScore == null || task.maxPoints <= 0) return null;
  return Math.max(0, Math.min(task.maxPoints, Math.round((task.aiPreScore / 100) * task.maxPoints)));
}

type CritRow = { key?: string; label?: string; maxPoints?: number; score?: number; kind?: 'objective' | 'rationale' };

function gradingSource(aiModel: string | null | undefined): { label: string; cls: string } | null {
  switch (aiModel) {
    case 'l3-answer-key':
      return { label: 'Answer-key (L3)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'hybrid-l3+claude':
      return { label: 'Hybrid', cls: 'bg-violet-50 text-violet-700 border-violet-200' };
    case 'claude-opus-4-8':
      return { label: 'AI 1st-pass', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    case 'judge0-autotest':
      return { label: 'Code auto-test', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    default:
      return null;
  }
}

function l3Split(aiCriterionScores: unknown): { obj: number; objMax: number; rat: number; ratMax: number } | null {
  if (!Array.isArray(aiCriterionScores)) return null;
  const rows = aiCriterionScores as CritRow[];
  if (!rows.some((r) => r?.kind === 'objective' || r?.kind === 'rationale')) return null;
  let obj = 0, objMax = 0, rat = 0, ratMax = 0;
  for (const r of rows) {
    if (r.kind === 'rationale') { rat += r.score ?? 0; ratMax += r.maxPoints ?? 0; }
    else { obj += r.score ?? 0; objMax += r.maxPoints ?? 0; }
  }
  return { obj, objMax, rat, ratMax };
}

/** Selection-field keys eligible for gate-zeroing (from kind-tagged criterion scores). */
function selectionFieldKeys(aiCriterionScores: unknown): { key: string; label: string; score: number }[] {
  if (!Array.isArray(aiCriterionScores)) return [];
  return (aiCriterionScores as CritRow[])
    .filter((r) => r?.key && r.kind !== 'rationale' && (r.score ?? 0) > 0)
    .map((r) => ({ key: r.key!, label: r.label ?? r.key!, score: r.score ?? 0 }));
}

function partHeader(part: string): string | null {
  if (part === 'DELIVERABLE') return 'Part B · Execution Plan';
  if (part === 'ESSAY') return 'Part C · Essay';
  return null;
}

function isAiRationaleReady(text: string | null): boolean {
  if (!text?.trim()) return false;
  return !/pending|대기 중|manual or ai review/i.test(text);
}

function riskFlagList(v: AiRiskFlag[] | null): AiRiskFlag[] {
  return Array.isArray(v) ? v : [];
}

export default function GradeSessionPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<GradingDetail | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deliverableReviews, setDeliverableReviews] = useState<Record<string, DeliverableReview | null>>({});
  const [aiConfirmed, setAiConfirmed] = useState<Record<string, boolean>>({});
  const [gateField, setGateField] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Force-terminated (cheating) review — the expert makes a pass/fail call on
  // the saved answers + proctoring evidence.
  const [terminatedNote, setTerminatedNote] = useState('');
  const [reviewingTerminated, setReviewingTerminated] = useState(false);

  const hydrate = useCallback((d: GradingDetail) => {
    setDetail(d);
    const s: Record<string, string> = {};
    const n: Record<string, string> = {};
    const confirmed: Record<string, boolean> = {};
    const dr: Record<string, DeliverableReview | null> = {};
    for (const t of d.tasks) {
      const aiPts = aiSuggestedPoints(t);
      const init = t.expertScore ?? (aiPts != null ? aiPts : 0);
      s[t.taskId] = String(init);
      n[t.taskId] = t.expertNotes ?? '';
      dr[t.taskId] = t.deliverableReview ?? null;
      if (t.expertScore != null && aiPts != null && t.expertScore === aiPts) confirmed[t.taskId] = true;
    }
    setScores(s);
    setNotes(n);
    setDeliverableReviews(dr);
    setAiConfirmed(confirmed);
  }, []);

  const reload = useCallback(async () => {
    const res = await expertApi.getDetail(sessionId);
    hydrate(res.data);
  }, [sessionId, hydrate]);

  useEffect(() => {
    if (!sessionId) return;
    expertApi
      .getDetail(sessionId)
      .then((res) => hydrate(res.data))
      .catch((e) =>
        setError((e as AxiosError<{ message?: string }>)?.response?.data?.message ?? '불러오기 실패'),
      );
  }, [sessionId, hydrate]);

  const isV2 = detail?.specVersion !== '1.1';
  const isL3 = detail?.level === 'L3';
  const isTerminated = detail?.status === 'TERMINATED';
  const readOnly =
    detail?.status === 'GRADED' ||
    detail?.decisionStatus === 'CONFIRMED_PASS' ||
    detail?.decisionStatus === 'CONFIRMED_FAIL' ||
    detail?.decisionStatus === 'INVALIDATED';

  const applyAiScore = (task: GradingTaskDetail) => {
    const pts = aiSuggestedPoints(task);
    if (pts == null || readOnly) return;
    setScores((s) => ({ ...s, [task.taskId]: String(pts) }));
    setAiConfirmed((c) => ({ ...c, [task.taskId]: true }));
    pushToast(`AI 제안 ${pts}/${task.maxPoints}점을 적용했습니다`, 'green');
  };

  const onScoreChange = (taskId: string, value: string) => {
    setScores((s) => ({ ...s, [taskId]: value }));
    setAiConfirmed((c) => ({ ...c, [taskId]: false }));
  };

  const buildTaskPayload = () =>
    detail!.tasks.map((t) => ({
      taskId: t.taskId,
      expertScore: Math.max(0, Math.min(t.maxPoints, Number(scores[t.taskId] ?? 0))),
      expertNotes: notes[t.taskId]?.trim() || undefined,
      ...(t.part === 'DELIVERABLE' && deliverableReviews[t.taskId]
        ? { deliverableReview: deliverableReviews[t.taskId]! }
        : {}),
    }));

  const setDeliverableReview = (taskId: string, review: DeliverableReview) => {
    setDeliverableReviews((prev) => ({ ...prev, [taskId]: review }));
    if (review === 'rejected') setScores((s) => ({ ...s, [taskId]: '0' }));
    pushToast(review === 'accepted' ? '증빙 파일을 승인했습니다' : '증빙 파일을 반려했습니다', review === 'accepted' ? 'green' : 'orange');
  };

  const saveDraft = async () => {
    if (!detail) return;
    setSavingDraft(true);
    try {
      const res = await expertApi.saveDraft(sessionId, { tasks: buildTaskPayload() });
      pushToast(`임시 저장 완료 — ${res.data.scoredTasks}개 과제 저장됨`, 'green');
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '임시 저장 실패', 'red');
    } finally {
      setSavingDraft(false);
    }
  };

  const finalize = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await expertApi.finalize(sessionId, { tasks: buildTaskPayload() });
      pushToast(
        `결과 확정 — 총점 ${res.data.totalScore}/100 · ${res.data.passed ? '합격' : '불합격'}`,
        res.data.passed ? 'green' : 'orange',
      );
      navigate('/');
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '결과 확정 실패', 'red');
    } finally {
      setBusy(false);
    }
  };

  /** v2.0 human-lock for auto-staged sessions (L3): confirm the staged decision. */
  const confirmDecision = async () => {
    if (!detail) return;
    setConfirming(true);
    try {
      const res = await expertApi.confirmDecision(sessionId);
      pushToast(
        `결정 확정 — ${res.data.passed ? '합격' : '불합격'}${res.data.totalScore != null ? ` (총점 ${res.data.totalScore}/100)` : ''}`,
        res.data.passed ? 'green' : 'orange',
      );
      navigate('/');
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '결정 확정 실패', 'red');
    } finally {
      setConfirming(false);
    }
  };

  /**
   * Pass/fail decision on a force-terminated (cheating) exam. Confirm = pass
   * (certificate issued), reject = fail. Judged on the saved answers + evidence.
   */
  const reviewTerminated = async (decision: 'pass' | 'fail') => {
    if (!detail) return;
    setReviewingTerminated(true);
    try {
      const res = await expertApi.reviewTerminated(sessionId, decision, terminatedNote.trim() || undefined);
      pushToast(
        `강제 종료 시험 판정 완료 — ${res.data.passed ? '합격' : '불합격'}`,
        res.data.passed ? 'green' : 'orange',
      );
      navigate('/');
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '판정 처리 실패', 'red');
    } finally {
      setReviewingTerminated(false);
    }
  };

  /** v2.0 gate confirmation: zero the contradicted selection field (expert authority). */
  const confirmGate = async (taskId: string) => {
    const fieldKey = gateField[taskId];
    if (!fieldKey) {
      pushToast('무효 처리할 선택 필드를 먼저 고르세요', 'orange');
      return;
    }
    try {
      const res = await expertApi.confirmGate(sessionId, taskId, fieldKey);
      pushToast(`게이트 확정 — "${fieldKey}" 0점 처리 (점수 ${res.data.expertScore})`, 'orange');
      await reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '게이트 확정 실패', 'red');
    }
  };

  const isAxisC = detail?.certType === 'AXIS_C';
  const dBadge = detail ? decisionBadge(detail.decisionStatus) : null;

  return (
    <div className="max-w-[1400px]">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="axis-focus inline-flex items-center gap-1 text-[13px] text-[var(--gray-500)] hover:text-[var(--gray-800)] mb-2"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> 목록으로
      </button>

      <PageHeader
        title={readOnly ? '채점 상세 (확정됨)' : '실기 채점'}
        subtitle={
          detail
            ? `${detail.candidate} · ${detail.level} · 세션 ${detail.sessionId.slice(-12)}`
            : '세션 정보를 불러오는 중…'
        }
        actions={
          detail && (
            <div className="flex items-center gap-2">
              <CertTag code={certCodeOf(detail.certType)} />
              {dBadge && isV2 && (
                <span className={`inline-flex items-center gap-1 text-[12px] rounded px-2 py-0.5 border ${dBadge.cls}`}>
                  <dBadge.icon className="w-3 h-3" /> {dBadge.label}
                </span>
              )}
              {detail.mandatoryReview && (
                <span className="inline-flex items-center gap-1 text-[12px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                  <ShieldAlert className="w-3 h-3" /> 필수 검수
                </span>
              )}
            </div>
          )
        }
      />

      {error && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {!detail ? (
        <div className="py-16 flex justify-center text-[var(--gray-400)]">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* v2.0 review context — why this session needs a human, and the gate rule. */}
          {isV2 && detail.reviewReasons.length > 0 && (
            <Card className="p-4 mb-4 border-amber-200 bg-amber-50/50">
              <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-800 mb-2">
                <ScanEye className="w-4 h-4" /> 검수 사유 ({detail.reviewReasons.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {detail.reviewReasons.map((r, i) => (
                  <span key={i} className="inline-flex items-center text-[12px] bg-white text-amber-900 border border-amber-300 rounded-full px-2.5 py-1">
                    {r}
                  </span>
                ))}
              </div>
              <p className="text-[12px] text-amber-700 mt-2">
                최종 합·불 판정은 사람(채점위원·관리자)이 확정합니다. AI 점수는 잠정값입니다.
              </p>
            </Card>
          )}

          <Card className="p-5 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-indigo-50/40 border border-slate-200">
            <div className="flex items-center gap-8">
              <div>
                <div className="text-[12px] uppercase tracking-wide text-slate-500 mb-1">필기 점수</div>
                <div className="text-2xl font-bold text-slate-900">
                  {detail.writtenScore != null ? `${detail.writtenScore}%` : '—'}
                </div>
              </div>
              {detail.totalScore != null && (
                <div>
                  <div className="text-[12px] uppercase tracking-wide text-slate-500 mb-1">총점</div>
                  <div className="text-2xl font-bold text-slate-900">{detail.totalScore}/100</div>
                </div>
              )}
            </div>
            <p className="text-[13px] text-slate-600 max-w-md leading-relaxed">
              <Sparkles className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-indigo-500" />
              AI 1차 채점은 참고용입니다. 제안 점수에 동의하면{' '}
              <span className="font-semibold text-indigo-700">확인</span>을 눌러 적용하거나 직접 수정하세요.
            </p>
          </Card>

          {isTerminated && (
            <Card className="p-4 mb-6 border-rose-200 bg-rose-50/50">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0 text-rose-600" />
                <div>
                  <div className="text-[13px] font-semibold text-rose-800">
                    강제 종료된 시험 (부정행위 의심) — 합·불 판정 필요
                  </div>
                  <div className="mt-1 text-[13px] text-rose-700 leading-relaxed">
                    이 응시자는 부정행위 등으로 시험이 강제 종료되었습니다. 저장된 답안과 아래 감독
                    증거를 검토한 뒤, 최종 합격(승인) 또는 불합격(반려)을 판정하세요. 판정 후 결과는
                    사라지지 않고 확정 처리됩니다.
                  </div>
                </div>
              </div>
            </Card>
          )}

          <ProctorEvidencePanel
            sessionId={detail.sessionId}
            proctorWarnings={detail.proctorWarnings}
            cheatingSuspect={detail.cheatingSuspect}
            events={detail.proctoringEvents}
          />

          <div className="space-y-6">
            {detail.tasks.map((t, i) => {
              const aiPts = aiSuggestedPoints(t);
              const hasAi = aiPts != null;
              const scoreMatchesAi = hasAi && Number(scores[t.taskId] ?? '') === aiPts;
              const confirmed = aiConfirmed[t.taskId] || scoreMatchesAi;
              const flags = riskFlagList(t.aiRiskFlags);
              const critFails = Array.isArray(t.aiCriticalFails) ? t.aiCriticalFails : [];
              const gate: AiGate | null = t.aiGate && t.aiGate.triggered ? t.aiGate : null;
              const src = gradingSource(t.aiModel);
              const l3 = l3Split(t.aiCriterionScores);
              const ph = partHeader(t.part);
              const fieldKeys = selectionFieldKeys(t.aiCriterionScores);

              return (
                <Card key={t.taskId} className="overflow-hidden border border-slate-200 shadow-sm">
                  <div className="px-6 py-4 border-b border-slate-100 bg-white flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 mb-1">
                        {ph ?? `과제 ${i + 1}`}
                      </div>
                      <h3 className="text-lg font-semibold text-slate-900">{t.title}</h3>
                      <p className="text-[13px] text-slate-500 mt-0.5">{t.part} · 만점 {t.maxPoints}점</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {src && (
                        <span className={`inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full border ${src.cls}`}>
                          <Bot className="w-3.5 h-3.5" /> {src.label}
                        </span>
                      )}
                      {t.earnedPoints != null && (
                        <span className="text-[12px] text-slate-500">원점수 {t.earnedPoints}/{t.maxPoints}</span>
                      )}
                      {t.aiBand && (
                        <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium px-3 py-1.5 rounded-full border ${bandPill(t.aiBand)}`}>
                          <Bot className="w-3.5 h-3.5" />
                          AI {t.aiBand}
                          {t.aiConfidence != null && (
                            <span className="opacity-75">· 신뢰도 {(t.aiConfidence * 100).toFixed(0)}%</span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* v2.0 signal strip — the reasons a task routes to review. */}
                  {(gate || t.aiInjectionSuspected || critFails.length > 0 || flags.length > 0) && (
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
                      {gate && (
                        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4">
                          <div className="flex items-center gap-2 text-[13px] font-semibold text-rose-800 mb-1">
                            <Gavel className="w-4 h-4" /> 게이트 발동 · {gate.rule}
                          </div>
                          <p className="text-[13px] text-rose-900 leading-relaxed">{gate.contradiction ?? '근거와 선택이 상충하는 정황'}</p>
                          {!readOnly && (
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              <select
                                value={gateField[t.taskId] ?? ''}
                                onChange={(e) => setGateField((g) => ({ ...g, [t.taskId]: e.target.value }))}
                                className="h-9 rounded-lg border border-rose-300 bg-white px-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-300"
                              >
                                <option value="">무효 처리할 선택 필드…</option>
                                {fieldKeys.map((f) => (
                                  <option key={f.key} value={f.key}>{f.label} ({f.score}점)</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => confirmGate(t.taskId)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-rose-600 text-white hover:bg-rose-700"
                              >
                                <Gavel className="w-4 h-4" /> 게이트 확정 (해당 필드 0점)
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {t.aiInjectionSuspected && (
                        <div className="flex items-start gap-2 text-[13px] text-fuchsia-900 bg-fuchsia-50 border border-fuchsia-300 rounded-xl px-4 py-3">
                          <ShieldX className="w-4 h-4 mt-0.5 shrink-0" />
                          <span><b>프롬프트 인젝션 의심</b> — 답안에 채점 지시 문구가 포함된 정황입니다. 점수에 반영하지 마세요.</span>
                        </div>
                      )}
                      {critFails.length > 0 && (
                        <div className="text-[13px] text-rose-900 bg-rose-50 border border-rose-300 rounded-xl px-4 py-3">
                          <div className="flex items-center gap-2 font-semibold mb-1"><ShieldAlert className="w-4 h-4" /> 치명 실패 후보</div>
                          <ul className="list-disc list-inside space-y-0.5">
                            {critFails.map((c, j) => <li key={j}>{c}</li>)}
                          </ul>
                          <p className="text-[12px] text-rose-700 mt-1">확정은 채점위원 판단입니다.</p>
                        </div>
                      )}
                      {flags.length > 0 && (
                        <div>
                          <div className="text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">위험 플래그 ({flags.length})</div>
                          <div className="flex flex-col gap-1.5">
                            {flags.map((f, j) => (
                              <div key={j} className="flex items-start gap-2 text-[13px]">
                                <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${severityChip(f.severity)}`}>
                                  {(f.severity || '—').toUpperCase()}
                                </span>
                                <span className="text-slate-700"><b>{f.code}</b>{f.detail ? ` — ${f.detail}` : ''}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 xl:grid-cols-2 min-h-[420px]">
                    <div className="p-6 space-y-5 border-b xl:border-b-0 xl:border-r border-slate-100 bg-slate-50/30">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">시나리오</div>
                        <div className="text-[14px] text-slate-700 whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto rounded-xl bg-white border border-slate-200 p-4">
                          {t.scenario}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                          {isAxisC ? '제출 코드' : '응시자 답안'}
                        </div>
                        {isAxisC ? (
                          <pre className="text-[12px] font-mono leading-relaxed max-h-72 overflow-y-auto rounded-xl bg-slate-900 text-green-300 border border-slate-700 p-4 whitespace-pre-wrap">
                            {t.contentText || '(미제출)'}
                          </pre>
                        ) : (
                          <div className="text-[14px] text-slate-800 whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto rounded-xl bg-white border border-slate-200 p-4 font-mono text-[13px]">
                            {t.contentText || '(미제출)'}
                          </div>
                        )}
                      </div>

                      {t.part === 'DELIVERABLE' && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-amber-800 mb-2">
                            <FileWarning className="w-4 h-4" />
                            L1 증빙 파일 (열람 전용 · 다운로드 불가)
                          </div>
                          {t.hasAttachment ? (
                            <>
                              <p className="text-[13px] text-slate-700">
                                업로드됨: <span className="font-medium">{t.attachmentFileName ?? '첨부파일'}</span>
                              </p>
                              <p className="text-[12px] text-slate-500 mt-1">
                                파일 내용은 다운로드할 수 없습니다. 메타정보와 답안을 바탕으로 승인/반려하세요.
                              </p>
                              {!readOnly && (
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <button
                                    type="button"
                                    onClick={() => setDeliverableReview(t.taskId, 'accepted')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border ${
                                      deliverableReviews[t.taskId] === 'accepted'
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                                    }`}
                                  >
                                    <CheckCircle2 className="w-4 h-4" /> 승인
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeliverableReview(t.taskId, 'rejected')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium border ${
                                      deliverableReviews[t.taskId] === 'rejected'
                                        ? 'bg-rose-600 text-white border-rose-600'
                                        : 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                                    }`}
                                  >
                                    <XCircle className="w-4 h-4" /> 반려
                                  </button>
                                </div>
                              )}
                              {readOnly && deliverableReviews[t.taskId] && (
                                <p className="text-[13px] mt-2 font-medium text-slate-700">
                                  처리: {deliverableReviews[t.taskId] === 'accepted' ? '승인' : '반려'}
                                </p>
                              )}
                            </>
                          ) : (
                            <p className="text-[13px] text-slate-500">증빙 파일이 업로드되지 않았습니다.</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="p-6 flex flex-col gap-5 bg-white">
                      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white p-5">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                            <Bot className="w-4 h-4 text-indigo-600" />
                          </div>
                          <div>
                            <div className="text-[13px] font-semibold text-slate-800">AI 1차 채점</div>
                            <div className="text-[11px] text-slate-500">참고용 — 최종 점수는 채점위원이 결정</div>
                          </div>
                        </div>

                        {l3 && (
                          <div className="mb-4 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1 text-[12px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-3 py-1.5">
                              선택(자동) <b>{l3.obj}/{l3.objMax}</b>
                            </span>
                            <span className="inline-flex items-center gap-1 text-[12px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5">
                              근거(AI보조) <b>{l3.rat}/{l3.ratMax}</b>
                            </span>
                          </div>
                        )}

                        {hasAi ? (
                          <div className="flex flex-wrap items-stretch gap-4 mb-4">
                            <div className="flex-1 min-w-[140px] rounded-xl bg-white border border-indigo-200 px-5 py-4 shadow-sm">
                              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 mb-1">AI 제안 점수</div>
                              <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-bold text-indigo-700">{aiPts}</span>
                                <span className="text-lg text-slate-400 font-medium">/ {t.maxPoints}</span>
                              </div>
                              {t.aiPreScore != null && (
                                <div className="text-[12px] text-slate-500 mt-1">({t.aiPreScore}% · {t.aiBand ?? '—'})</div>
                              )}
                            </div>
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => applyAiScore(t)}
                                disabled={confirmed && scoreMatchesAi}
                                className={`flex flex-col items-center justify-center gap-2 min-w-[120px] px-4 py-3 rounded-xl border-2 transition-all ${
                                  confirmed && scoreMatchesAi
                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                                    : 'border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-400 shadow-md hover:shadow-lg'
                                }`}
                                title="AI 제안 점수를 내 점수에 적용"
                              >
                                {confirmed && scoreMatchesAi ? (
                                  <>
                                    <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                                    <span className="text-[12px] font-semibold">적용됨</span>
                                  </>
                                ) : (
                                  <>
                                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                                      <Check className="w-6 h-6" strokeWidth={2.5} />
                                    </div>
                                    <span className="text-[13px] font-semibold">AI 점수 적용</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="rounded-xl bg-white/70 border border-dashed border-indigo-200 px-4 py-6 text-center text-[13px] text-slate-500 mb-4">
                            AI 1차 채점 대기 중입니다.
                          </div>
                        )}

                        {isAiRationaleReady(t.aiRationale) ? (
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">AI 채점 근거</div>
                            <p className="text-[14px] text-slate-700 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto rounded-xl bg-white/90 border border-indigo-100 p-4">
                              {t.aiRationale}
                            </p>
                          </div>
                        ) : (
                          t.aiRationale && <p className="text-[13px] text-slate-500 italic">{t.aiRationale}</p>
                        )}
                      </div>

                      {t.part === 'PRACTICAL' && Array.isArray(t.aiChatLog) && t.aiChatLog.length > 0 && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-500 mb-3">
                            <MessageSquare className="w-4 h-4 text-slate-500" /> AI 대화 기록 · 검증 ({t.aiChatLog.length})
                          </div>
                          <div className="max-h-64 overflow-y-auto space-y-2">
                            {t.aiChatLog.map((m, j) => (
                              <div key={j} className={`text-[13px] leading-relaxed rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-emerald-50 text-emerald-900'}`}>
                                <span className="font-semibold mr-1.5">{m.role === 'user' ? '응시자' : 'AI'}:</span>{m.text}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-3">채점위원 최종 점수</div>
                        <div className="flex flex-wrap items-end gap-4">
                          <div>
                            <label htmlFor={`score-${t.taskId}`} className="block text-[12px] text-slate-600 mb-1.5">점수 (0–{t.maxPoints})</label>
                            <input
                              id={`score-${t.taskId}`}
                              type="number"
                              min={0}
                              max={t.maxPoints}
                              disabled={readOnly}
                              value={scores[t.taskId] ?? ''}
                              onChange={(e) => onScoreChange(t.taskId, e.target.value)}
                              className="w-32 h-12 border-2 border-slate-300 rounded-xl px-3 text-xl font-bold text-slate-900 text-center placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
                            />
                          </div>
                          {hasAi && !readOnly && (
                            <p className="text-[12px] text-slate-500 pb-2">
                              AI 제안: <strong className="text-indigo-700">{aiPts}점</strong>
                              {scoreMatchesAi ? (
                                <span className="ml-2 text-emerald-600 font-medium">· AI와 일치</span>
                              ) : (
                                <span className="ml-2 text-amber-600">· 수동 조정 중</span>
                              )}
                            </p>
                          )}
                        </div>
                        <label htmlFor={`notes-${t.taskId}`} className="block text-[12px] font-semibold text-slate-600 mt-4 mb-1.5">검수 메모</label>
                        <textarea
                          id={`notes-${t.taskId}`}
                          disabled={readOnly}
                          value={notes[t.taskId] ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [t.taskId]: e.target.value }))}
                          rows={4}
                          placeholder="채점 근거·감점 사유를 적어주세요"
                          className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {isTerminated && (
            <div className="mt-8">
              <label
                htmlFor="terminated-note"
                className="block text-[12px] font-semibold text-slate-600 mb-1.5"
              >
                판정 사유 (선택)
              </label>
              <textarea
                id="terminated-note"
                value={terminatedNote}
                onChange={(e) => setTerminatedNote(e.target.value)}
                rows={2}
                placeholder="합격/불합격 판정 근거를 남겨주세요 (감사 로그에 기록됩니다)"
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-[14px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 leading-relaxed"
              />
            </div>
          )}

          {detail.scoringHistory && detail.scoringHistory.length > 0 && (
            <Card className="p-4 mt-8">
              <div className="text-[12px] font-semibold uppercase tracking-wider text-[var(--gray-500)] mb-3">
                점수 변경 이력
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[var(--gray-500)] border-b border-[var(--gray-200)]">
                      <th className="pb-2 pr-3 font-medium">시각</th>
                      <th className="pb-2 pr-3 font-medium">라운드</th>
                      <th className="pb-2 pr-3 font-medium">과제</th>
                      <th className="pb-2 pr-3 font-medium">채점자</th>
                      <th className="pb-2 text-right font-medium">점수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scoringHistory.map((h) => (
                      <tr key={h.id} className="border-b border-[var(--gray-100)] last:border-0">
                        <td className="py-2 pr-3 text-[var(--gray-600)] whitespace-nowrap">
                          {new Date(h.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">{h.scoringRound}</td>
                        <td className="py-2 pr-3">{h.taskTitle}</td>
                        <td className="py-2 pr-3">{h.raterName}</td>
                        <td className="py-2 text-right font-medium">{h.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex items-center justify-end gap-2 mt-8 pb-4">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 text-sm bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-lg"
            >
              닫기
            </button>
            {isTerminated ? (
              <>
                <Button
                  variant="danger"
                  onClick={() => reviewTerminated('fail')}
                  disabled={reviewingTerminated}
                >
                  {reviewingTerminated ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  불합격 (반려)
                </Button>
                <Button onClick={() => reviewTerminated('pass')} disabled={reviewingTerminated}>
                  {reviewingTerminated ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  합격 확정 (승인)
                </Button>
              </>
            ) : (
              !readOnly && (
              <>
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={savingDraft || busy || confirming}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
                >
                  {savingDraft ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  임시 저장
                </button>
                {/* L3 v2.0: the practicals are auto-scored — the expert human-locks
                    the staged decision (issues the certificate on a pass). L1/L2:
                    the expert enters scores and finalize computes + locks. */}
                {isV2 && isL3 ? (
                  <Button onClick={confirmDecision} disabled={confirming || savingDraft || busy}>
                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                    결정 확정 (사람 잠금)
                  </Button>
                ) : (
                  <Button onClick={finalize} disabled={busy || savingDraft || confirming}>
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    결과 확정 (합/불 판정)
                  </Button>
                )}
              </>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
