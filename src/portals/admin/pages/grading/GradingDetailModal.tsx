import { useEffect, useState } from 'react';
import { X, Loader2, Bot, AlertTriangle, ShieldAlert, CheckCircle2, Save, Download, Code2, Users, MessageSquare } from 'lucide-react';
import { Button, pushToast, CertTag, certCodeOf } from '@admin/components/shared/ui-kit';
import { adminApi, type GradingDetail } from '@admin/services/api';
import { AxiosError } from 'axios';

interface Props {
  sessionId: string;
  /** When true the session is already GRADED — read-only detail view. */
  readOnly?: boolean;
  /** Current user's ID — used to check if they are the assigned expert. */
  currentUserId?: string;
  /** Current user's roles — used for role-based button logic. */
  currentUserRoles?: string[];
  onClose: () => void;
  onFinalized?: () => void;
}

function bandTone(band: string | null): string {
  switch (band) {
    case 'excellent':
      return 'text-[var(--green)]';
    case 'normal':
      return 'text-[var(--blue)]';
    case 'borderline':
      return 'text-[var(--orange)]';
    case 'fail':
      return 'text-[var(--red)]';
    default:
      return 'text-[var(--gray-500)]';
  }
}

const isAdminRole = (roles: string[] | undefined) =>
  roles?.some((r) => r === 'SUPER_ADMIN' || r === 'GRADING_ADMIN' || r === 'EXAM_ADMIN') ?? false;

type CritRow = { label?: string; maxPoints?: number; score?: number; kind?: 'objective' | 'rationale' };

/** Badge describing which grader produced the first-pass score (aiModel). */
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

/** L3 objective-vs-rationale point split from kind-tagged aiCriterionScores. */
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

/** L1 section header per exam part. */
function partHeader(part: string): string | null {
  if (part === 'DELIVERABLE') return 'Part B · Execution Plan';
  if (part === 'ESSAY') return 'Part C · Essay';
  return null;
}

export default function GradingDetailModal({
  sessionId,
  readOnly,
  currentUserId,
  currentUserRoles,
  onClose,
  onFinalized,
}: Props) {
  const [detail, setDetail] = useState<GradingDetail | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingScores, setSavingScores] = useState(false);
  const [prescoring, setPrescoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Force-terminated (cheating) review — pass/fail decision on saved answers.
  const [terminatedNote, setTerminatedNote] = useState('');
  const [reviewingTerminated, setReviewingTerminated] = useState(false);

  const load = () => {
    adminApi
      .getGradingDetail(sessionId)
      .then((res) => {
        const d = res.data;
        setDetail(d);
        const s: Record<string, string> = {};
        const n: Record<string, string> = {};
        for (const t of d.tasks) {
          const init =
            t.expertScore ??
            (t.aiPreScore != null ? Math.round((t.aiPreScore / 100) * t.maxPoints) : 0);
          s[t.taskId] = String(init);
          n[t.taskId] = t.expertNotes ?? '';
        }
        setScores(s);
        setNotes(n);
      })
      .catch((e) => setError((e as AxiosError<{ message?: string }>)?.response?.data?.message ?? 'Failed to load'));
  };

  useEffect(load, [sessionId]);

  const runPrescore = async () => {
    setPrescoring(true);
    try {
      await adminApi.aiPrescore(sessionId);
      pushToast('AI 1차 채점을 실행했습니다', 'green');
      load();
    } catch {
      pushToast('AI 채점 실행 실패 (API 키 확인)', 'red');
    } finally {
      setPrescoring(false);
    }
  };

  const buildTaskPayload = () =>
    (detail?.tasks ?? []).map((t) => ({
      taskId: t.taskId,
      expertScore: Math.max(0, Math.min(t.maxPoints, Number(scores[t.taskId] ?? 0))),
      expertNotes: notes[t.taskId]?.trim() || undefined,
    }));

  /**
   * Save scores to the FIRST-round record without finalizing.
   * The session stays SUBMITTED for a second reviewer or admin to finalize.
   */
  const saveScores = async () => {
    if (!detail) return;
    setSavingScores(true);
    try {
      const res = await adminApi.saveExpertScore(sessionId, { tasks: buildTaskPayload() });
      pushToast(
        `점수 저장 완료 — ${res.data.scoredTasks}개 과제${res.data.mandatoryReviewCleared ? ' · 필수검수 해제' : ''}`,
        'green',
      );
      load();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '점수 저장 실패', 'red');
    } finally {
      setSavingScores(false);
    }
  };

  /** Finalize: lock scores, compute pass/fail, issue certificate. */
  const finalize = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await adminApi.finalizeSession(sessionId, { tasks: buildTaskPayload() });
      pushToast(
        `확정 완료 — 총점 ${res.data.totalScore}/100 · ${res.data.passed ? '합격' : '불합격'}`,
        res.data.passed ? 'green' : 'orange',
      );
      onFinalized?.();
      onClose();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '확정 실패', 'red');
    } finally {
      setBusy(false);
    }
  };

  const isAxisC = detail?.certType === 'AXIS_C';
  // Force-terminated (unfinished/cheating) exam: answers are saved; MCQ is
  // auto-graded. The standard finalize flow does not apply — instead a reviewer
  // makes an explicit pass/fail call via reviewTerminated (confirm = pass).
  const isTerminated = detail?.status === 'TERMINATED';

  /** Pass/fail decision on a force-terminated exam. */
  const reviewTerminated = async (decision: 'pass' | 'fail') => {
    if (!detail) return;
    setReviewingTerminated(true);
    try {
      const res = await adminApi.reviewTerminated(sessionId, decision, terminatedNote.trim() || undefined);
      pushToast(
        `강제 종료 시험 판정 완료 — ${res.data.passed ? '합격' : '불합격'}`,
        res.data.passed ? 'green' : 'orange',
      );
      onFinalized?.();
      onClose();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '판정 처리 실패', 'red');
    } finally {
      setReviewingTerminated(false);
    }
  };

  const downloadDeliverable = async (taskId: string) => {
    try {
      const res = await adminApi.getDeliverableUrl(sessionId, taskId);
      if (!res.data.url) {
        pushToast('첨부 파일을 찾을 수 없습니다', 'orange');
        return;
      }
      window.open(res.data.url, '_blank', 'noopener');
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || '다운로드에 실패했습니다', 'red');
    }
  };

  // Finalize is blocked for an EXPERT who is NOT the assigned expert,
  // unless the session has no assignment (open to any qualified expert).
  const canFinalize = (() => {
    if (!detail) return false;
    if (isAdminRole(currentUserRoles)) return true;
    if (!detail.assignedExpertId) return true;
    return currentUserId === detail.assignedExpertId;
  })();

  const assignedButNotMe =
    !isAdminRole(currentUserRoles) &&
    !!detail?.assignedExpertId &&
    currentUserId !== detail.assignedExpertId;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">
              {readOnly ? '채점 상세' : '실기 채점'}
            </h2>
            {detail && <CertTag code={certCodeOf(detail.certType)} />}
            {detail && <span className="text-sm text-slate-500">{detail.level} · {detail.candidate}</span>}
            {detail?.mandatoryReview && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                <ShieldAlert className="w-3 h-3" /> 필수 검수
              </span>
            )}
            {detail?.assignedExpertId && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--blue)] bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                <Users className="w-3 h-3" /> 채점위원 배정됨
              </span>
            )}
            {isTerminated && (
              <span className="inline-flex items-center gap-1 text-[12px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 font-medium">
                <ShieldAlert className="w-3 h-3" /> 강제종료 (미완료)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Grade the exam — the ONLY trigger for AI grading (essays stay
                saved-but-unscored until this is clicked). MCQ is auto-graded. */}
            {!readOnly && (
              <Button onClick={runPrescore} disabled={prescoring || !detail}>
                {prescoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                시험 채점
              </Button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Assignment warning for experts viewing someone else's session */}
          {assignedButNotMe && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>이 세션은 다른 채점위원에게 배정되어 있습니다. 열람은 가능하지만 확정은 배정된 채점위원만 가능합니다.</span>
            </div>
          )}

          {isTerminated && detail && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5">
              <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">강제종료된 시험 (부정행위 의심) — 합·불 판정 필요</div>
                <div className="mt-0.5">
                  응시자는 이 시험을 이어서 볼 수 없습니다. 답안은 저장되어 있으며, 객관식은 자동
                  채점되었습니다. 저장된 답안과 감독 증거를 검토한 뒤, 아래 [합격 확정] 또는
                  [불합격] 버튼으로 최종 판정하세요. 결과는 사라지지 않고 확정 처리됩니다.
                </div>
                {detail.failReason && (
                  <div className="mt-1 text-[12px] text-rose-600">사유: {detail.failReason}</div>
                )}
                <div className="mt-2.5">
                  <label
                    htmlFor="admin-terminated-note"
                    className="block text-[12px] font-semibold text-rose-700 mb-1"
                  >
                    판정 사유 (선택)
                  </label>
                  <textarea
                    id="admin-terminated-note"
                    value={terminatedNote}
                    onChange={(e) => setTerminatedNote(e.target.value)}
                    rows={2}
                    placeholder="합격/불합격 판정 근거를 남겨주세요 (감사 로그에 기록됩니다)"
                    className="w-full border border-rose-200 rounded-lg px-2.5 py-1.5 text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-rose-400"
                  />
                </div>
              </div>
            </div>
          )}

          {!detail ? (
            <div className="py-12 flex justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-sm bg-slate-50 rounded-lg px-4 py-2.5">
                <span className="text-slate-600">필기 점수 (자동채점): <b className="text-slate-900">{detail.writtenScore ?? '—'}%</b></span>
                <span className="text-[12px] text-slate-400">AI 채점은 상단 [시험 채점] 버튼으로 실행됩니다</span>
              </div>

              {detail.tasks.map((t, i) => {
                const src = gradingSource(t.aiModel);
                const l3 = l3Split(t.aiCriterionScores);
                const ph = partHeader(t.part);
                return (
                <div key={t.taskId} className="border border-slate-200 rounded-lg p-4">
                  {ph && (
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 mb-1">{ph}</div>
                  )}
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
                    <div className="font-semibold text-slate-800">
                      과제 {i + 1} · {t.title}{' '}
                      <span className="text-slate-400 font-normal">({t.part} · 만점 {t.maxPoints})</span>
                      {isAxisC && <span className="ml-2 text-[11px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">CODE</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {src && (
                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${src.cls}`}>
                          <Bot className="w-3 h-3" /> {src.label}
                        </span>
                      )}
                      {t.aiModel && <span className="text-[10px] text-slate-400 font-mono">{t.aiModel}</span>}
                      {t.earnedPoints != null && (
                        <span className="text-[11px] text-slate-500">원점수 {t.earnedPoints}/{t.maxPoints}</span>
                      )}
                      {t.aiBand && (
                        <span className={`text-[12px] font-medium ${bandTone(t.aiBand)}`}>
                          AI: {t.aiBand}{t.aiConfidence != null ? ` · conf ${(t.aiConfidence * 100).toFixed(0)}%` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">시나리오</div>
                      <p className="text-[13px] text-slate-600 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">{t.scenario}</p>

                      <div className="text-[11px] uppercase tracking-wide text-slate-400 mt-3 mb-1">
                        {isAxisC ? (
                          <span className="inline-flex items-center gap-1"><Code2 className="w-3 h-3" /> 제출 코드</span>
                        ) : '응시자 답안'}
                      </div>

                      {/* AXIS-C: render contentText as code block */}
                      {isAxisC ? (
                        <pre className="text-[12px] text-slate-800 font-mono leading-relaxed max-h-56 overflow-y-auto bg-slate-900 text-green-300 rounded p-3 whitespace-pre-wrap">
                          {t.contentText || '(미제출)'}
                        </pre>
                      ) : (
                        <p className="text-[13px] text-slate-800 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto bg-slate-50 rounded p-2">
                          {t.contentText || '(미제출)'}
                        </p>
                      )}

                      {/* DELIVERABLE: show file attachment download link */}
                      {t.part === 'DELIVERABLE' && (
                        <div className="mt-2">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">첨부파일</div>
                          {t.hasAttachment || t.attachmentUrl ? (
                            <button
                              type="button"
                              onClick={() => void downloadDeliverable(t.taskId)}
                              className="inline-flex items-center gap-1.5 text-[12px] text-[var(--blue)] hover:underline"
                            >
                              <Download className="w-3.5 h-3.5" />
                              파일 다운로드
                            </button>
                          ) : (
                            <span className="text-[12px] text-slate-400">파일 없음</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      {l3 && (
                        <div className="mb-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">AI 점수 구성 (L3)</div>
                          <div className="flex flex-wrap gap-2 text-[12px]">
                            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">객관식 {l3.obj}/{l3.objMax}</span>
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5">근거 {l3.rat}/{l3.ratMax}</span>
                          </div>
                        </div>
                      )}
                      {t.part === 'PRACTICAL' && Array.isArray(t.aiChatLog) && t.aiChatLog.length > 0 && (
                        <div className="mb-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1 inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" /> AI 대화 기록 · 검증 ({t.aiChatLog.length})</div>
                          <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-50 rounded p-2 border border-slate-200">
                            {t.aiChatLog.map((m, j) => (
                              <div key={j} className={`text-[12px] leading-relaxed rounded px-2 py-1 ${m.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-emerald-50 text-emerald-900'}`}>
                                <span className="font-semibold mr-1">{m.role === 'user' ? '응시자' : 'AI'}:</span>{m.text}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {t.aiRationale && (
                        <div className="mb-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1 inline-flex items-center gap-1"><Bot className="w-3 h-3" /> AI 근거</div>
                          <p className="text-[12px] text-slate-600 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto bg-indigo-50/50 rounded p-2">{t.aiRationale}</p>
                        </div>
                      )}
                      {Array.isArray(t.aiRiskFlags) && (t.aiRiskFlags as unknown[]).length > 0 && (
                        <div className="mb-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2 inline-flex items-start gap-1">
                          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>위험 플래그 {(t.aiRiskFlags as unknown[]).length}건 — 확인 필요</span>
                        </div>
                      )}
                      <label className="block text-[12px] font-semibold text-slate-600 mb-1">점수 (0–{t.maxPoints})</label>
                      <input
                        type="number"
                        min={0}
                        max={t.maxPoints}
                        disabled={readOnly || isTerminated}
                        value={scores[t.taskId] ?? ''}
                        onChange={(e) => setScores((s) => ({ ...s, [t.taskId]: e.target.value }))}
                        className="w-28 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-100"
                      />
                      <label className="block text-[12px] font-semibold text-slate-600 mt-3 mb-1">검수 메모</label>
                      <textarea
                        disabled={readOnly || isTerminated}
                        value={notes[t.taskId] ?? ''}
                        onChange={(e) => setNotes((n) => ({ ...n, [t.taskId]: e.target.value }))}
                        rows={2}
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>
                );
              })}
            </>
          )}

          {detail?.scoringHistory && detail.scoringHistory.length > 0 && (
            <div className="px-6 pb-4">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                점수 변경 이력
              </div>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">시각</th>
                      <th className="text-left px-3 py-2 font-medium">라운드</th>
                      <th className="text-left px-3 py-2 font-medium">과제</th>
                      <th className="text-left px-3 py-2 font-medium">채점자</th>
                      <th className="text-right px-3 py-2 font-medium">점수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.scoringHistory.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                          {new Date(h.createdAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">{h.scoringRound}</td>
                        <td className="px-3 py-2">{h.taskTitle}</td>
                        <td className="px-3 py-2">{h.raterName}</td>
                        <td className="px-3 py-2 text-right font-medium">{h.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
          <div className="text-[12px] text-slate-400">
            {!readOnly && detail?.assignedExpertId && (
              <span>
                배정 채점위원 ID: <code className="font-mono">{detail.assignedExpertId.slice(0, 8)}…</code>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-sm bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-md"
            >
              닫기
            </button>
            {!readOnly && isTerminated && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => reviewTerminated('fail')}
                  disabled={reviewingTerminated || !detail}
                  title="저장된 답안·증거를 근거로 불합격 처리합니다."
                >
                  {reviewingTerminated ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  불합격 (반려)
                </Button>
                <Button
                  onClick={() => reviewTerminated('pass')}
                  disabled={reviewingTerminated || !detail}
                  title="저장된 답안·증거를 근거로 합격 처리합니다 (수료증 발급)."
                >
                  {reviewingTerminated ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  합격 확정 (승인)
                </Button>
              </>
            )}
            {!readOnly && !isTerminated && (
              <>
                {/* Save scores — available to any expert/admin; doesn't finalize */}
                <Button
                  variant="secondary"
                  onClick={saveScores}
                  disabled={savingScores || !detail}
                  title="점수를 저장하되 확정하지 않습니다. 2차 검토자가 확정 가능합니다."
                >
                  {savingScores ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  점수 저장 (1차)
                </Button>

                {/* Finalize — enforced by backend; blocked client-side for wrong expert */}
                <Button
                  onClick={finalize}
                  disabled={busy || !detail || !canFinalize}
                  title={
                    !canFinalize
                      ? '이 세션의 배정 채점위원만 확정할 수 있습니다.'
                      : '채점을 확정하고 합격 여부를 판정합니다.'
                  }
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  채점 확정 · 합격 판정
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
