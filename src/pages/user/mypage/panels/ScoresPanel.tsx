import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  objectionApi,
  userApi,
  type ObjectionDto,
  type ObjectionKind,
} from '@/services/api';
import { useI18n } from '@/i18n';
import {
  Badge,
  Btn,
  EmptyState,
  KebabMenu,
  SectionTitle,
} from '../primitives';
import { ScoreDetailModal } from '../SharedModals';
import { MyPageModal } from '../Modal';
import {
  certLabel,
  formatAttemptSuffix,
  formatExamDate,
  formatExamRoundLabel,
  resultStatusBadge,
} from '../helpers';
import type { DashboardDto, ResultDto } from '../types';
import { InfoCallout } from '@/components/InfoCallout';
import { openProtectedPdf } from '@/utils/openProtectedPdf';
import { AxiosError } from 'axios';

const TABLE_WRAP = 'hidden md:block w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2';

function formatAnnouncedColumn(
  r: ResultDto,
  t: (key: 'mypage.scores.pending' | 'mypage.scores.awaitingAnnouncement') => string,
): string {
  if (r.announcedAt) return formatExamDate(r.announcedAt);
  if (r.status === 'SUBMITTED' || (r.status === 'GRADED' && r.announced === false)) {
    return t('mypage.scores.awaitingAnnouncement');
  }
  return '—';
}

function defaultKind(r: ResultDto): ObjectionKind {
  return r.status === 'TERMINATED' ? 'FORCED_TERMINATION' : 'SCORE';
}

function ResultsSection({ data }: { data: DashboardDto }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [scoreDetailFor, setScoreDetailFor] = useState<ResultDto | null>(null);
  const [appealFor, setAppealFor] = useState<ResultDto | null>(null);
  const [appealKind, setAppealKind] = useState<ObjectionKind>('SCORE');
  const [appealReason, setAppealReason] = useState('');
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState<string | null>(null);
  const [myAppeals, setMyAppeals] = useState<ObjectionDto[]>([]);

  const refreshAppeals = () => {
    if (!localStorage.getItem('accessToken')) return;
    objectionApi
      .mine()
      .then((r) => setMyAppeals(r.data))
      .catch(() => undefined);
  };

  useEffect(() => {
    refreshAppeals();
  }, []);

  const openConfirmation = async (r: ResultDto) =>
    openProtectedPdf(
      async () => (await userApi.downloadConfirmationPdf(r.id)).data,
      `AXIS_confirmation_${r.id}.pdf`,
    );

  const openAppeal = (r: ResultDto) => {
    setAppealFor(r);
    setAppealKind(defaultKind(r));
    setAppealReason('');
    setAppealError(null);
  };

  const submitAppeal = async () => {
    if (!appealFor) return;
    const reason = appealReason.trim();
    if (reason.length < 10) {
      setAppealError(t('mypage.appeal.reasonShort' as never));
      return;
    }
    setAppealBusy(true);
    setAppealError(null);
    try {
      await objectionApi.create({
        sessionId: appealFor.id,
        kind: appealKind,
        reason,
      });
      setAppealFor(null);
      refreshAppeals();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string | string[] }>)?.response?.data?.message;
      setAppealError(
        Array.isArray(msg) ? msg[0] : typeof msg === 'string' ? msg : t('mypage.appeal.fail' as never),
      );
    } finally {
      setAppealBusy(false);
    }
  };

  const kebabItems = (r: ResultDto) => [
    { label: t('mypage.scores.detail'), onClick: () => setScoreDetailFor(r) },
    {
      label: t('mypage.scores.appeal'),
      onClick: () => openAppeal(r),
    },
    {
      label: t('mypage.scores.evidence'),
      onClick: () => navigate(`/cbt/sessions/${r.id}/evidence`),
    },
  ];

  const statusLabel = useMemo(
    () => ({
      RECEIVED: lang === 'ko' ? '접수' : 'Received',
      UNDER_REVIEW: lang === 'ko' ? '검토중' : 'Under review',
      COMPLETE: lang === 'ko' ? '완료' : 'Complete',
    }),
    [lang],
  );

  return (
    <>
      <SectionTitle title={t('sec.taken.title')} sub="" />

      <InfoCallout tone="blue" className="">
        <p>{t('sec.scores.info.aiNote' as never)}</p>
      </InfoCallout>
      <InfoCallout tone="blue" className="mb-6">
        <p>{t('sec.scores.info.certLink' as never)}</p>
      </InfoCallout>

      <div className={TABLE_WRAP}>
        <table className="data-table" style={{ minWidth: 980 }}>
          <thead>
            <tr>
              <th style={{ width: 220 }}>{t('mypage.scores.col.exam')}</th>
              <th style={{ width: 120 }}>{t('mypage.scores.col.round')}</th>
              <th style={{ width: 130 }}>{t('mypage.scores.col.examDate')}</th>
              <th style={{ width: 130 }}>{t('mypage.scores.col.announced')}</th>
              <th style={{ width: 200 }}>{t('mypage.scores.col.score')}</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {data.results.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <EmptyState description={t('mypage.scores.emptyHint')}>
                    {t('mypage.scores.empty')}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              data.results.map((r) => {
                const badge = resultStatusBadge(r);
                const examDateText = r.submittedAt ? formatExamDate(r.submittedAt) : '—';
                const announcedText = formatAnnouncedColumn(r, t);
                const attemptSuffix = formatAttemptSuffix(r.attemptNo, lang);

                return (
                  <tr key={r.id}>
                    <td>
                      <span className="text-ink font-semibold">
                        {certLabel(r.certType, r.level)}
                      </span>
                    </td>
                    <td className="text-muted">
                      <div className="font-en">{formatExamRoundLabel(r.roundNumber, r.scheduleYear, lang)}</div>
                      {attemptSuffix && (
                        <div className="text-[11px] text-[#9CA3AF] mt-0.5">{attemptSuffix}</div>
                      )}
                    </td>
                    <td className="text-muted text-[13px]">{examDateText}</td>
                    <td className="text-muted text-[13px]">{announcedText}</td>
                    <td>
                      <div className="inline-flex items-center gap-2 flex-wrap">
                        {r.totalScore != null && (
                          <span className="text-[15.5px] text-ink font-en">{r.totalScore}</span>
                        )}
                        <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>
                        <KebabMenu items={kebabItems(r)} />
                      </div>
                    </td>
                    <td>
                      <Btn variant="blue" className="btn-sm" onClick={() => openConfirmation(r)}>
                        {t('mypage.act.confirmationPdf' as never)}
                      </Btn>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden mt-4 border-t-2 border-ink">
        {data.results.length === 0 ? (
          <EmptyState description={t('mypage.scores.emptyHint')}>
            {t('mypage.scores.empty')}
          </EmptyState>
        ) : (
          data.results.map((r) => {
            const badge = resultStatusBadge(r);
            const examDateText = r.submittedAt ? formatExamDate(r.submittedAt) : '—';
            const announcedText = formatAnnouncedColumn(r, t);
            const attemptSuffix = formatAttemptSuffix(r.attemptNo, lang);
            return (
              <div key={r.id} className="border-b border-border py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted font-en mb-0.5">
                      {formatExamRoundLabel(r.roundNumber, r.scheduleYear, lang)}
                      {attemptSuffix && (
                        <span className="ml-1.5 text-[#9CA3AF]">{attemptSuffix}</span>
                      )}
                    </div>
                    <div className="text-[16px] font-semibold text-ink break-keep">
                      {certLabel(r.certType, r.level)}
                    </div>
                  </div>
                  <KebabMenu items={kebabItems(r)} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {r.totalScore != null && (
                    <span className="text-[22px] font-semibold text-ink font-en">{r.totalScore}</span>
                  )}
                  <Badge tone={badge.tone}>{t(badge.labelKey)}</Badge>
                </div>
                <div className="mt-2 space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-light flex-shrink-0">{t('mypage.scores.col.examDate')}</span>
                    <span className="text-ink text-right break-keep">{examDateText}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-light flex-shrink-0">{t('mypage.scores.col.announced')}</span>
                    <span className="text-ink text-right break-keep">{announcedText}</span>
                  </div>
                </div>
                <div className="mt-3">
                  <Btn variant="blue" className="w-full min-h-[44px]" onClick={() => openConfirmation(r)}>
                    {t('mypage.act.confirmationPdf' as never)}
                  </Btn>
                </div>
              </div>
            );
          })
        )}
      </div>

      {myAppeals.length > 0 && (
        <div className="mt-10">
          <SectionTitle title={t('mypage.appeal.listTitle' as never)} sub="" />
          <ul className="mt-3 space-y-2 border-t border-border pt-3">
            {myAppeals.map((o) => (
              <li key={o.id} className="rounded-md border border-border p-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <span className="font-semibold text-ink">
                    {o.kind === 'SCORE'
                      ? t('mypage.appeal.kind.score' as never)
                      : t('mypage.appeal.kind.term' as never)}
                  </span>
                  <Badge tone={o.status === 'COMPLETE' ? 'green' : o.status === 'UNDER_REVIEW' ? 'blue' : 'gray'}>
                    {statusLabel[o.status]}
                  </Badge>
                </div>
                <p className="mt-2 text-muted whitespace-pre-wrap">{o.reason}</p>
                {o.resolution && (
                  <p className="mt-2 text-ink">
                    <span className="text-light">{t('mypage.appeal.resolution' as never)}: </span>
                    {o.resolution}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ScoreDetailModal
        open={!!scoreDetailFor}
        result={scoreDetailFor}
        onClose={() => setScoreDetailFor(null)}
      />

      <MyPageModal
        open={!!appealFor}
        title={t('mypage.appeal.title' as never)}
        onClose={() => !appealBusy && setAppealFor(null)}
        width="md"
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="default" disabled={appealBusy} onClick={() => setAppealFor(null)}>
              {t('common.cancel')}
            </Btn>
            <Btn variant="blue" disabled={appealBusy} onClick={() => void submitAppeal()}>
              {appealBusy ? '…' : t('mypage.appeal.submit' as never)}
            </Btn>
          </div>
        }
      >
        {appealFor && (
          <div className="space-y-3 text-[14px]">
            <p className="text-muted">
              {certLabel(appealFor.certType, appealFor.level)} ·{' '}
              {formatExamRoundLabel(appealFor.roundNumber, appealFor.scheduleYear, lang)}
            </p>
            <p className="text-[12px] text-light">{t('mypage.appeal.window' as never)}</p>
            <label className="block">
              <span className="text-[12px] text-muted">{t('mypage.appeal.kindLabel' as never)}</span>
              <select
                className="mt-1 w-full border border-border rounded-md px-2 py-2"
                value={appealKind}
                onChange={(e) => setAppealKind(e.target.value as ObjectionKind)}
                disabled={appealBusy}
              >
                <option value="SCORE">{t('mypage.appeal.kind.score' as never)}</option>
                <option value="FORCED_TERMINATION">{t('mypage.appeal.kind.term' as never)}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[12px] text-muted">{t('mypage.appeal.reasonLabel' as never)}</span>
              <textarea
                className="mt-1 w-full min-h-[120px] border border-border rounded-md px-2 py-2"
                value={appealReason}
                onChange={(e) => setAppealReason(e.target.value)}
                disabled={appealBusy}
                placeholder={t('mypage.appeal.reasonPh' as never)}
              />
            </label>
            {appealError && <p className="text-[13px] text-rose-600">{appealError}</p>}
          </div>
        )}
      </MyPageModal>
    </>
  );
}

export function ScoresPanel({ data }: { data: DashboardDto }) {
  return <ResultsSection data={data} />;
}
