import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Ban, Loader2, Maximize, Minimize } from 'lucide-react';
import { examApi } from '@/services/api';
import { useI18n } from '@/i18n';
import { EXAM, ExamPageHeader } from '@/pages/exam/shared';

type Result = {
  id: string;
  certType: string;
  level: string;
  status: string;
  submittedAt: string | null;
  writtenScore: number | null;
  practicalScore: number | null;
  totalScore: number | null;
  passed: boolean | null;
  failReason: string | null;
  practicalResultEtaDays?: number | null;
  breakdown: { id: string; part: string; subjectName: string; earned: number; total: number; percentage: number; subjectFailed: boolean }[];
};

const isTerminated = (status: string): boolean => status === 'TERMINATED';

// Pass line shown on the result page. L1/L2 use the spec's weighted 100-pt
// total ≥70; L3 stays at written ≥60 (L3 conformance handled separately).
const PASS_THRESHOLD: Record<string, number> = { L3: 60, L2: 70, L1: 70 };

/* 결과 페이지 전용 전체화면 토글. 시험 진행 페이지의 proctor 가드와 달리
   strike/세션종료 로직 없이 순수하게 fullscreen 진입/해제만 한다. */
function FullscreenToggle() {
  const [isFs, setIsFs] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
      } else {
        await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      }
    } catch {
      /* 사용자가 권한을 거부하거나 브라우저가 막은 경우 — 무시 */
    }
  };

  const label = isFs ? '전체화면 종료' : '전체화면';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="absolute top-0 right-0 h-[clamp(68px,5.5vw,130px)] px-[clamp(20px,1.8vw,48px)] flex items-center text-white/90 hover:text-white transition-colors"
    >
      {isFs ? (
        <Minimize className="w-[clamp(22px,1.7vw,34px)] h-[clamp(22px,1.7vw,34px)]" />
      ) : (
        <Maximize className="w-[clamp(22px,1.7vw,34px)] h-[clamp(22px,1.7vw,34px)]" />
      )}
    </button>
  );
}

const MY_PAGE_SCORES = '/mypage?section=scores';

/* ─── 페이지 셸 — Runner/Readiness 와 동일한 ExamPageHeader + 라이트 배경 ─── */
function ResultShell({ title, children }: { title: string; children: ReactNode }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  const goMyPage = useCallback(() => {
    navigate(MY_PAGE_SCORES, { replace: true });
  }, [navigate]);

  // Browser-back from the result page must never return to the exam runner
  // (or any preflight step). Always land on My Page → scores tab.
  useEffect(() => {
    window.history.pushState({ examResultBackGuard: true }, '', window.location.href);
    const onPopState = () => {
      navigate(MY_PAGE_SCORES, { replace: true });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigate]);

  return (
    <div className="min-h-screen w-full bg-[#F8FAFC] flex flex-col font-sans [&_svg]:stroke-[1.5]">
      <div className="relative shrink-0">
        <ExamPageHeader title={title} hideClock />
        <FullscreenToggle />
      </div>
      <main className="flex-1 min-h-0 overflow-y-auto">
        <div className={`${EXAM.layout.container} ${EXAM.layout.containerPx} pt-[clamp(12px,1vw,24px)]`}>
          <button
            type="button"
            onClick={goMyPage}
            className={`${EXAM.text.helper} ${EXAM.color.muted} hover:text-[var(--exam-text,#0F172A)] inline-flex items-center gap-1`}
          >
            ← {t('result.toMyPageBtn')}
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}

/* InfoRow 의 value 슬롯에 넣는 합격/불합격/채점중 강조 텍스트. */
function ResultBadge({ kind, label }: { kind: 'pass' | 'fail' | 'pending'; label: string }) {
  const cls = kind === 'fail' ? EXAM.color.danger : EXAM.color.brand;
  return <span className={`${cls} font-bold`}>{label}</span>;
}

export default function ExamResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [r, setR] = useState<Result | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    examApi
      .result(sessionId)
      .then((res) => setR(res.data))
      .catch((e) => {
        const status = e?.response?.status;
        const serverMsg = e?.response?.data?.message;
        if (status === 401) {
          setError(t('result.sessionExpired'));
        } else {
          setError(serverMsg || t('result.loadFailed'));
        }
      });
  }, [sessionId, t]);

  /* ── Error state ────────────────────────────────────────────── */
  if (error) {
    return (
      <ResultShell title={t('result.title')}>
        <div className={`${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} flex justify-center`}>
          <div className={`max-w-lg w-full ${EXAM.surface.dangerBox} ${EXAM.layout.cardPadding}`}>
            <div className="w-12 h-12 rounded-full bg-[#FECACA] flex items-center justify-center mb-4">
              <AlertTriangle className={`w-6 h-6 ${EXAM.color.danger}`} />
            </div>
            <div className={`${EXAM.text.cardHeading} ${EXAM.color.danger} mb-2`}>{t('result.cantLoad')}</div>
            <p className={`${EXAM.text.bodySm} ${EXAM.color.body} mb-6`}>{error}</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => navigate('/login')} className={`${EXAM.button.primaryLg} ${EXAM.text.button} w-auto! px-6`}>
                {t('result.toLogin')}
              </button>
              <button onClick={() => navigate(MY_PAGE_SCORES, { replace: true })} className={`${EXAM.button.outlineLg} ${EXAM.text.button} w-auto! px-6`}>
                {t('result.toMyPage')}
              </button>
            </div>
          </div>
        </div>
      </ResultShell>
    );
  }

  /* ── Loading state ──────────────────────────────────────────── */
  if (!r) {
    return (
      <ResultShell title={t('result.title')}>
        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-3">
          <Loader2 className={`w-8 h-8 animate-spin ${EXAM.color.brand}`} />
          <span className={`${EXAM.text.helper} ${EXAM.color.muted}`}>{t('common.loading')}</span>
        </div>
      </ResultShell>
    );
  }

  const isPassed = r.passed === true;
  const practicalPending = (r.level === 'L2' || r.level === 'L1') && r.passed == null;
  const terminated = isTerminated(r.status);
  const total = r.totalScore ?? 0;
  const threshold = PASS_THRESHOLD[r.level] ?? 60;
  const certType = r.certType.replace('_', '-');
  const certLabel = `${certType} · ${r.level}`;
  const pts = t('result.unit.points');
  const submittedText = r.submittedAt
    ? new Date(r.submittedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    : '—';

  /* ── STATE: Terminated / Void ────────────────────────────────── */
  if (terminated) {
    return (
      <ResultShell title={certLabel}>
        <div className={`${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy} flex justify-center`}>
          <div className={`max-w-2xl w-full ${EXAM.surface.dangerBox} ${EXAM.layout.cardPadding} text-center`}>
            <div
              className="mx-auto rounded-full flex items-center justify-center mb-6"
              style={{ width: 'clamp(72px,6vw,120px)', height: 'clamp(72px,6vw,120px)', background: '#FEE2E2', border: 'clamp(3px,0.3vw,6px) solid #FECACA' }}
              aria-hidden
            >
              <Ban className="text-status-danger" style={{ width: 'clamp(32px,2.6vw,56px)', height: 'clamp(32px,2.6vw,56px)' }} />
            </div>
            <div className={`${EXAM.text.sectionTitle} ${EXAM.color.danger} mb-2`}>
              {t('result.terminatedTitle')}
            </div>
            <p className={`${EXAM.text.bodySm} ${EXAM.color.body} mb-3 max-w-lg mx-auto`}>
              {t('result.terminatedDefault')}
            </p>
            <p className={`${EXAM.text.helper} ${EXAM.color.muted} mb-2 max-w-lg mx-auto`}>
              {t('result.terminatedAdminReview')}
            </p>
            <div className="flex flex-wrap gap-3 justify-center mt-7">
              <button onClick={() => navigate(`/cbt/sessions/${r.id}/evidence`)} className={`${EXAM.button.primaryLg} ${EXAM.text.button} w-auto! px-6 bg-status-danger!`}>
                {t('result.viewEvidence')}
              </button>
              <button onClick={() => navigate(MY_PAGE_SCORES, { replace: true })} className={`${EXAM.button.outlineLg} ${EXAM.text.button} w-auto! px-6`}>
                {t('result.toMyPageBtn')}
              </button>
            </div>
          </div>
        </div>
      </ResultShell>
    );
  }

  /* 시험결과 표 — 과목별점수 표와 동일한 컬럼 헤더 구조. 컬럼은 레벨/점수 유무에 따라 가변. */
  const resultCols: { header: string; cell: ReactNode }[] = [
    { header: '응시종목', cell: certLabel },
    { header: '응시일시', cell: submittedText },
  ];
  if (r.writtenScore != null) {
    resultCols.push({ header: t('result.objective'), cell: `${r.writtenScore}${pts}` });
  }
  if (r.level !== 'L3') {
    resultCols.push({
      header: t('result.practical'),
      cell: practicalPending ? t('result.scoring') : r.practicalScore == null ? '—' : `${r.practicalScore}${pts}`,
    });
  }
  resultCols.push({
    header: t('result.totalLabel'),
    cell: practicalPending ? t('result.scoring') : `${total}${pts} / ${threshold}${pts}`,
  });
  resultCols.push({
    header: '가채점결과',
    cell: (
      <ResultBadge
        kind={practicalPending ? 'pending' : isPassed ? 'pass' : 'fail'}
        label={practicalPending ? t('result.scoring') : isPassed ? t('result.pass') : t('result.fail')}
      />
    ),
  });

  return (
    <ResultShell title={certLabel}>
      <div className={`${EXAM.layout.container} ${EXAM.layout.containerPx} ${EXAM.layout.containerPy}`}>
        <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mb-4 text-[clamp(22px,1.8vw,30px)]`}>
          {t('result.title')}
        </h2>

        <div className="border-t-[2px] border-[#0a0e1a] bg-white text-[clamp(18px,1.25vw,26px)] leading-[1.35]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#ced4df]">
                {resultCols.map((c, idx) => (
                  <th
                    key={c.header}
                    className={`px-8 py-4 bg-[#DBEBFF] font-semibold text-[#0F172A] text-center ${idx < resultCols.length - 1 ? 'border-r border-[#ced4df]' : ''}`}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {resultCols.map((c, idx) => (
                  <td
                    key={c.header}
                    className={`px-8 py-4 text-[#0F172A] text-center ${idx < resultCols.length - 1 ? 'border-r border-[#ced4df]' : ''}`}
                  >
                    {c.cell}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {practicalPending ? (
          <div className={`mt-[clamp(12px,1vw,28px)] ${EXAM.surface.infoBox} ${EXAM.layout.cardPaddingX} py-[clamp(10px,0.9vw,20px)]`}>
            <p className={`${EXAM.text.bodySm} ${EXAM.color.body} mb-1`}>채점 중, 결과 발표를 기다려 주세요.</p>
            <p className={`${EXAM.text.helper} ${EXAM.color.muted}`}>
              {t('result.practicalNoteEta')}
              <span className={`${EXAM.color.brand} font-bold`}>{r.practicalResultEtaDays ?? 14}</span>
              {t('result.practicalNoteEtaTail')} · {t('result.practicalDecisionLater')}
            </p>
          </div>
        ) : null}

        {r.breakdown.length > 0 && (
          <>
            <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink} mt-[clamp(28px,2.4vw,64px)] mb-4 text-[clamp(22px,1.8vw,30px)]`}>
              {t('result.subjects')}
            </h2>
            <div className="border-t-[2px] border-[#0a0e1a] bg-white text-[clamp(18px,1.25vw,26px)] leading-[1.35]">
              <table className="w-full border-collapse table-fixed">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[35%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#ced4df]">
                    <th className="px-8 py-4 bg-[#DBEBFF] font-semibold text-[#0F172A] text-center border-r border-[#ced4df]">과목명</th>
                    <th className="px-8 py-4 bg-[#DBEBFF] font-semibold text-[#0F172A] text-center border-r border-[#ced4df]">취득득점</th>
                    <th className="px-8 py-4 bg-[#DBEBFF] font-semibold text-[#0F172A] text-center">결과</th>
                  </tr>
                </thead>
                <tbody>
                  {r.breakdown.map((b, idx) => (
                    <tr key={b.id} className={idx < r.breakdown.length - 1 ? 'border-b border-[#ced4df]' : ''}>
                      <td className="px-8 py-4 text-[#0F172A] text-center border-r border-[#ced4df]">{b.subjectName}</td>
                      <td className="px-8 py-4 text-center tabular-nums text-[#0F172A] border-r border-[#ced4df]">
                        {b.earned}/{b.total}
                      </td>
                      <td className="px-8 py-4 text-center">
                        <span className={`font-bold ${b.subjectFailed ? EXAM.color.danger : EXAM.color.success}`}>
                          {b.subjectFailed ? t('result.fail') : t('result.pass')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-3 justify-center mt-[clamp(28px,2.4vw,64px)]">
          <button
            onClick={() => navigate(MY_PAGE_SCORES, { replace: true })}
            className="w-[clamp(132px,10vw,260px)] h-[clamp(48px,3.8vw,84px)] rounded-md bg-[var(--exam-accent,#2563EB)] text-white hover:bg-[var(--exam-accent-hover,#1D4ED8)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-[clamp(17px,1.35vw,32px)] font-semibold inline-flex items-center justify-center gap-2"
          >
            결과확인
          </button>
        </div>
      </div>
    </ResultShell>
  );
}
