import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  StatusBadge,
  Table,
  TableWrap,
  Th,
  Td,
  Button,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi, type ExamineeCertificate, type ExamineeDetail } from '@admin/services/api';
import { AxiosError } from 'axios';
import { fmtDate } from '../lib/format';

function statusTone(
  s: ExamineeCertificate['displayStatus'],
): 'green' | 'orange' | 'red' | 'gray' | 'purple' {
  if (s === 'VALID') return 'green';
  if (s === 'EXPIRED') return 'gray';
  if (s === 'SUSPENDED') return 'orange';
  if (s === 'REVOKED') return 'red';
  return 'purple';
}

export function CertTab({
  detail,
  onRefresh,
}: {
  detail: ExamineeDetail;
  onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (detail.certificates.length === 0) {
    return <div className="py-6 text-center text-sm text-slate-400">{t('exm.cert.empty')}</div>;
  }

  const setStatus = async (
    c: ExamineeCertificate,
    status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
  ) => {
    let reason: string | undefined;
    if (status === 'SUSPENDED' || status === 'REVOKED') {
      const promptLabel =
        status === 'SUSPENDED' ? t('exm.cert.reasonSuspend') : t('exm.cert.reasonRevoke');
      const entered = window.prompt(promptLabel);
      if (entered === null) return;
      reason = entered.trim();
      if (reason.length < 3) {
        pushToast(t('exm.cert.reasonShort'), 'orange');
        return;
      }
    } else if (
      !window.confirm(t('exm.cert.confirmReinstate', { n: c.certNumber }))
    ) {
      return;
    }

    setBusyId(c.id);
    try {
      await adminApi.updateCertificateStatus(c.id, { status, reason });
      pushToast(t('exm.cert.statusSaved'), 'green');
      onRefresh?.();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || t('exm.cert.statusFail'), 'red');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <TableWrap>
      <Table className="text-sm [&_td]:py-2 [&_th]:py-2">
        <thead>
          <tr>
            <Th className="text-left!">{t('exm.cert.number')}</Th>
            <Th>{t('exm.cert.subject')}</Th>
            <Th>{t('exm.cert.issued')}</Th>
            <Th>{t('exm.cert.until')}</Th>
            <Th>{t('exm.cert.score')}</Th>
            <Th>{t('exm.col.status')}</Th>
            <Th align="right">{t('exm.cert.actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {detail.certificates.map((c) => {
            const display = c.displayStatus ?? 'VALID';
            const busy = busyId === c.id;
            return (
              <tr key={c.id}>
                <Td mono className="text-left! whitespace-nowrap text-[var(--primary)] font-medium">
                  {c.certNumber}
                </Td>
                <Td className="whitespace-nowrap">
                  {c.certType} {c.level}
                </Td>
                <Td muted className="whitespace-nowrap tabular-nums">
                  {fmtDate(c.issuedAt)}
                </Td>
                <Td muted className="whitespace-nowrap tabular-nums">
                  {fmtDate(c.validUntil)}
                </Td>
                <Td className="tabular-nums">{c.totalScore ?? '—'}</Td>
                <Td>
                  <StatusBadge tone={statusTone(display)}>
                    {t(`exm.cert.status.${display}`)}
                  </StatusBadge>
                  {c.statusReason && (
                    <div className="text-[11px] text-slate-500 mt-1 max-w-[160px] truncate" title={c.statusReason}>
                      {c.statusReason}
                    </div>
                  )}
                </Td>
                <Td align="right">
                  <div className="flex flex-wrap gap-1 justify-end">
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                    ) : (
                      <>
                        {c.lifecycleStatus !== 'SUSPENDED' && display !== 'EXPIRED' && (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 text-[11px]"
                            onClick={() => void setStatus(c, 'SUSPENDED')}
                          >
                            {t('exm.cert.suspend')}
                          </Button>
                        )}
                        {c.lifecycleStatus !== 'REVOKED' && (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 text-[11px]"
                            onClick={() => void setStatus(c, 'REVOKED')}
                          >
                            {t('exm.cert.revoke')}
                          </Button>
                        )}
                        {c.lifecycleStatus && c.lifecycleStatus !== 'ACTIVE' && (
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 text-[11px]"
                            onClick={() => void setStatus(c, 'ACTIVE')}
                          >
                            {t('exm.cert.reinstate')}
                          </Button>
                        )}
                      </>
                    )}
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
