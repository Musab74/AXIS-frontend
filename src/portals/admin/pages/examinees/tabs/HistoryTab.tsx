import { useMemo } from 'react';
import { StatusBadge, Button, Table, TableWrap, Th, Td } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import type {
  ExamineeDetail,
  ExamineeRegistrationDetail,
} from '@admin/services/api';
import { fmtDate, fmtKRW } from '../lib/format';
import { certLabel, mapRegToStatus, statusBadgeTone } from '../lib/status';
import { SessionStatusPill } from '../components/SessionStatusPill';

export function HistoryTab({
  detail,
  onRefund,
  onViewEvidence,
}: {
  detail: ExamineeDetail;
  onRefund: (reg: ExamineeRegistrationDetail) => void;
  onViewEvidence: (sessionId: string) => void;
}) {
  const { t } = useI18n();

  const certBySessionId = useMemo(() => {
    const map = new Map<string, (typeof detail.certificates)[number]>();
    for (const c of detail.certificates) map.set(c.sessionId, c);
    return map;
  }, [detail.certificates]);

  if (detail.registrations.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-400">{t('exm.history.empty')}</div>;
  }

  return (
    <TableWrap>
      <Table className="text-sm [&_td]:py-2 [&_th]:py-2">
        <thead>
          <tr>
            <Th className="text-left!">{t('exm.col.exam')}</Th>
            <Th>{t('exm.history.regCreated')}</Th>
            <Th>{t('exm.refund.examDate')}</Th>
            <Th>{t('exm.history.fee')}</Th>
            <Th>{t('exm.history.result')}</Th>
            <Th>{t('exm.col.status')}</Th>
            <Th>{t('exm.history.manage')}</Th>
          </tr>
        </thead>
        <tbody>
          {detail.registrations.map((r) => {
            const showNotRefundable =
              r.status === 'PAID' && r.sessions.some((s) => s.status !== 'CREATED');
            return (
              <tr key={r.id}>
                <Td className="text-left! whitespace-nowrap">
                  <div className="font-medium text-[var(--primary)]">
                    {certLabel(r.certType)} {r.level} · {t('common.round')} {r.schedule.roundNumber}
                  </div>
                  {r.registrationNumber && (
                    <div className="mt-0.5 text-[11px] text-slate-400 font-mono">
                      {r.registrationNumber}
                    </div>
                  )}
                </Td>
                <Td muted className="whitespace-nowrap tabular-nums">
                  {fmtDate(r.createdAt)}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {fmtDate(r.schedule.examDate)}
                  <div className="text-[11px] text-slate-400">{r.schedule.examStartTime}</div>
                </Td>
                <Td className="whitespace-nowrap">
                  <div className="tabular-nums">{fmtKRW(r.latestPayment?.amount)}</div>
                  <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1 flex-wrap">
                    <span>{r.latestPayment?.status ?? '—'}</span>
                    {r.latestPayment?.isDemo && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800"
                        title={t('reg.pay.demoHint')}
                      >
                        {t('reg.pay.demo')}
                      </span>
                    )}
                  </div>
                </Td>
                <Td>
                  {r.sessions.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      {r.sessions.map((s) => {
                        const cert = certBySessionId.get(s.id);
                        return (
                          <div
                            key={s.id}
                            className="flex items-center justify-center gap-1.5 flex-wrap"
                          >
                            <span className="text-slate-500">
                              {t('exm.history.attempt', { n: s.attemptNo })}
                            </span>
                            <SessionStatusPill status={s.status} passed={s.passed} />
                            {s.totalScore != null && (
                              <span className="text-slate-600 tabular-nums">{s.totalScore}</span>
                            )}
                            {s.proctorWarnings > 0 && (
                              <span className="text-amber-700 tabular-nums text-xs">
                                ⚠ {s.proctorWarnings}
                              </span>
                            )}
                            {cert && <StatusBadge tone="purple">{cert.certNumber}</StatusBadge>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Td>
                <Td>
                  <StatusBadge tone={statusBadgeTone(mapRegToStatus(r))}>
                    {t(`exm.status.${mapRegToStatus(r)}`)}
                  </StatusBadge>
                </Td>
                <Td>
                  <div className="flex flex-col items-center gap-1.5">
                    {r.refundable ? (
                      <Button size="sm" variant="danger" onClick={() => onRefund(r)}>
                        {t('exm.history.refund')}
                      </Button>
                    ) : r.latestPayment?.isDemo && r.status === 'PAID' ? (
                      <span className="text-[11px] text-amber-700 max-w-[120px] leading-tight">
                        {t('exm.history.demoNoRefund')}
                      </span>
                    ) : showNotRefundable ? (
                      <span className="text-[11px] text-slate-400 max-w-[120px] leading-tight">
                        {t('exm.history.notRefundable')}
                      </span>
                    ) : null}
                    {r.sessions
                      .filter((s) => s.status === 'TERMINATED')
                      .map((s) => (
                        <Button
                          key={s.id}
                          size="sm"
                          variant="secondary"
                          onClick={() => onViewEvidence(s.id)}
                        >
                          {t('exm.history.viewEvidence')}
                        </Button>
                      ))}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
