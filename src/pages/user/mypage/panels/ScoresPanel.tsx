import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { userApi, type InquiryCategory } from '@/services/api';
import { useI18n } from '@/i18n';
import {
  Badge,
  Btn,
  EmptyState,
  KebabMenu,
  SectionTitle,
} from '../primitives';
import { ScoreDetailModal } from '../SharedModals';
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

function ResultsSection({ data }: { data: DashboardDto }) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [scoreDetailFor, setScoreDetailFor] = useState<ResultDto | null>(null);

  const openConfirmation = async (r: ResultDto) =>
    openProtectedPdf(
      async () => (await userApi.downloadConfirmationPdf(r.id)).data,
      `AXIS_confirmation_${r.id}.pdf`,
    );

  // 데스크톱 테이블/모바일 카드가 같은 케밥 메뉴 항목을 공유한다.
  const kebabItems = (r: ResultDto) => [
    { label: t('mypage.scores.detail'), onClick: () => setScoreDetailFor(r) },
    {
      label: t('mypage.scores.appeal'),
      onClick: () =>
        navigate('/qna', {
          state: {
            prefill: {
              category: 'EXAM' as InquiryCategory,
              title: `[Score Appeal] ${certLabel(r.certType, r.level)} · ${formatExamRoundLabel(r.roundNumber, r.scheduleYear, 'en')}`,
            },
          },
        }),
    },
    {
      label: t('mypage.scores.evidence'),
      onClick: () => navigate(`/cbt/sessions/${r.id}/evidence`),
    },
  ];

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

      <ScoreDetailModal
        open={!!scoreDetailFor}
        result={scoreDetailFor}
        onClose={() => setScoreDetailFor(null)}
      />
    </>
  );
}

export function ScoresPanel({ data }: { data: DashboardDto }) {
  return <ResultsSection data={data} />;
}
