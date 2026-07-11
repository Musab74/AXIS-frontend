import { useI18n } from '@admin/i18n';
import type { ExamineeDetail } from '@admin/services/api';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { fmtDate, fmtDateTime } from '../lib/format';

export function ProfileTab({ detail }: { detail: ExamineeDetail }) {
  const { t } = useI18n();
  const u = detail.user;
  const rows: Array<[string, React.ReactNode]> = [
    [t('exm.profile.userId'), u.userId],
    [t('exm.profile.email'), u.email ?? '—'],
    [t('exm.profile.birth'), <MaskedPii userDbId={u.id} field="birthDate" value={u.birthDate} />],
    [t('exm.profile.gender'), u.gender ?? '—'],
    [t('exm.profile.nice'), u.niceVerified ? '✓' : '✕'],
    [t('exm.profile.joined'), fmtDate(u.createdAt)],
    [t('exm.profile.lastLogin'), fmtDateTime(u.lastLoginAt)],
    [t('exm.profile.activePenalty'), String(detail.activePenaltyCount)],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2">
          <dt className="text-sm text-slate-400">{k}</dt>
          <dd className="text-sm font-medium text-slate-900 text-right break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
