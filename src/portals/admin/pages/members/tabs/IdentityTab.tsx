import { Table, TableWrap, Th, Td } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import type { MemberProfile } from '@admin/services/api';
import { fmtDateTime } from '../../examinees/lib/format';

function StatusPill({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: string }) {
  const tone =
    verdict === 'PASS'
      ? 'bg-emerald-50 text-emerald-700'
      : verdict === 'REVIEW'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-rose-50 text-rose-700';
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {verdict}
    </span>
  );
}

export function IdentityTab({ detail }: { detail: MemberProfile }) {
  const { t } = useI18n();
  const link = detail.accountLinkage;
  const hist = detail.identityHistory;

  return (
    <div className="space-y-8">
      <p className="text-xs text-slate-600 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2.5 leading-relaxed">
        {t('mem.identity.privacyNotice')}
      </p>

      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('mem.identity.linkage')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('mem.identity.integrated')}</span>
            <StatusPill ok={link.integrated} label={t('mem.identity.linked')} />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('mem.identity.portals')}</span>
            <span className="font-medium text-slate-800 text-right">
              {link.portals.join(' ↔ ')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('mem.identity.carrierBound')}</span>
            <StatusPill
              ok={link.carrierIdentityBound}
              label={link.carrierIdentityBound ? t('mem.identity.yes') : t('mem.identity.no')}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('exm.profile.nice')}</span>
            <StatusPill
              ok={link.niceVerified}
              label={link.niceVerified ? '✓' : '✕'}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('mem.identity.refFace')}</span>
            <StatusPill
              ok={link.hasReferenceFace}
              label={
                link.hasReferenceFace
                  ? link.referenceFaceUpdatedAt
                    ? fmtDateTime(link.referenceFaceUpdatedAt)
                    : t('mem.identity.yes')
                  : t('mem.identity.no')
              }
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
            <span className="text-slate-400">{t('mem.identity.idImage')}</span>
            <StatusPill ok={false} label={t('mem.identity.idImageNotStored')} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('mem.identity.carrier')}</h3>
        {hist.carrier.length === 0 ? (
          <div className="text-sm text-slate-400 py-4">{t('mem.identity.emptyCarrier')}</div>
        ) : (
          <TableWrap>
            <Table className="text-sm [&_td]:py-2 [&_th]:py-2">
              <thead>
                <tr>
                  <Th>{t('common.time')}</Th>
                  <Th>{t('mem.identity.authType')}</Th>
                  <Th>{t('mem.identity.status')}</Th>
                  <Th>{t('mem.activity.ip')}</Th>
                  <Th>{t('mem.identity.completed')}</Th>
                </tr>
              </thead>
              <tbody>
                {hist.carrier.map((row, i) => (
                  <tr key={`carrier-${i}`}>
                    <Td muted className="whitespace-nowrap tabular-nums">
                      {fmtDateTime(row.createdAt)}
                    </Td>
                    <Td className="text-xs">{row.authType}</Td>
                    <Td className="text-xs font-medium">{row.status}</Td>
                    <Td className="font-mono text-xs">{row.ipAddress ?? '—'}</Td>
                    <Td muted className="whitespace-nowrap tabular-nums text-xs">
                      {row.completedAt ? fmtDateTime(row.completedAt) : '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-800 mb-1">{t('mem.identity.attempts')}</h3>
        <p className="text-xs text-slate-400 mb-3">{t('mem.identity.attemptsHint')}</p>
        {hist.attempts.length === 0 ? (
          <div className="text-sm text-slate-400 py-4">{t('mem.identity.emptyAttempts')}</div>
        ) : (
          <TableWrap>
            <Table className="text-sm [&_td]:py-2 [&_th]:py-2">
              <thead>
                <tr>
                  <Th>{t('common.time')}</Th>
                  <Th>{t('mem.identity.verdict')}</Th>
                  <Th>{t('mem.identity.idType')}</Th>
                  <Th>{t('mem.identity.ocr')}</Th>
                  <Th>{t('mem.identity.nameDob')}</Th>
                  <Th>{t('mem.identity.face')}</Th>
                  <Th className="text-left!">{t('mem.identity.reasons')}</Th>
                </tr>
              </thead>
              <tbody>
                {hist.attempts.map((row) => (
                  <tr key={row.id}>
                    <Td muted className="whitespace-nowrap tabular-nums text-xs">
                      {fmtDateTime(row.createdAt)}
                    </Td>
                    <Td>
                      <VerdictPill verdict={row.verdict} />
                    </Td>
                    <Td className="text-xs">{row.idType}</Td>
                    <Td className="tabular-nums text-xs">
                      {(row.ocrConfidence * 100).toFixed(0)}%
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      {row.nameMatched ? '✓' : '✕'}
                      {' / '}
                      {row.birthDateMatched == null ? '—' : row.birthDateMatched ? '✓' : '✕'}
                    </Td>
                    <Td className="text-xs whitespace-nowrap">
                      {row.faceDecision}{' '}
                      <span className="text-slate-400">
                        ({row.faceSimilarity.toFixed(1)}%)
                      </span>
                    </Td>
                    <Td className="text-left! text-xs text-slate-500 max-w-xs truncate">
                      <span title={row.reasons.join(', ') || undefined}>
                        {row.reasons.length ? row.reasons.join(', ') : '—'}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </section>
    </div>
  );
}
