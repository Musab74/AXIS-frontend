import { useEffect, useState } from 'react';
import { useI18n } from '@admin/i18n';
import type {
  ExamineeRegistrationDetail,
  MemberProfile,
  UserActivity,
} from '@admin/services/api';
import { adminApi } from '@admin/services/api';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { AccountStatusBadge } from '../../examinees/components/AccountStatusBadge';
import { ProfileTab } from '../../examinees/tabs/ProfileTab';
import { HistoryTab } from '../../examinees/tabs/HistoryTab';
import { CertTab } from '../../examinees/tabs/CertTab';
import { ExamsTab } from '../tabs/ExamsTab';
import { ActivityTab } from '../tabs/ActivityTab';
import { MemberPenaltiesTab } from '../tabs/MemberPenaltiesTab';
import { IdentityTab } from '../tabs/IdentityTab';

export type MemberDetailTab =
  | 'profile'
  | 'identity'
  | 'exams'
  | 'payments'
  | 'cert'
  | 'activity'
  | 'penalty';

interface MemberDetailContentProps {
  detail: MemberProfile | null;
  detailError: string | null;
  activeTab: MemberDetailTab;
  onTabChange: (t: MemberDetailTab) => void;
  onRefund: (reg: ExamineeRegistrationDetail) => void;
  onReload: () => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="text-sm font-medium text-slate-800">{value}</div>
    </div>
  );
}

export function MemberDetailContent({
  detail,
  detailError,
  activeTab,
  onTabChange,
  onRefund,
  onReload,
}: MemberDetailContentProps) {
  const { t } = useI18n();
  const [activity, setActivity] = useState<UserActivity | null>(null);

  useEffect(() => {
    if (!detail || activeTab !== 'activity') return;
    let cancelled = false;
    setActivity(null);
    adminApi
      .getMemberActivity(detail.user.id)
      .then((res) => !cancelled && setActivity(res.data))
      .catch(() => !cancelled && setActivity({ lastLoginAt: null, loginHistory: [], consentIps: [], niceIps: [] }));
    return () => {
      cancelled = true;
    };
  }, [detail, activeTab]);

  if (detailError) {
    return <div className="py-8 text-center text-sm text-rose-600">{detailError}</div>;
  }
  if (!detail) {
    return <div className="py-12 text-center text-sm text-slate-400">{t('common.loading')}</div>;
  }

  const u = detail.user;
  const tabs: { id: MemberDetailTab; key: string }[] = [
    { id: 'profile', key: 'mem.tab.profile' },
    { id: 'identity', key: 'mem.tab.identity' },
    { id: 'exams', key: 'mem.tab.exams' },
    { id: 'payments', key: 'mem.tab.payments' },
    { id: 'cert', key: 'exm.tab.cert' },
    { id: 'activity', key: 'mem.tab.activity' },
    { id: 'penalty', key: 'mem.tab.penalty' },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <Field label={t('mem.col.userId')} value={u.userId} />
          <Field label={t('mem.col.email')} value={u.email ?? '—'} />
          <Field
            label={t('mem.col.phone')}
            value={<MaskedPii userDbId={u.id} field="phone" value={u.phone} />}
          />
          <Field label={t('mem.profile.roles')} value={detail.roles.join(', ') || '—'} />
        </div>
        <AccountStatusBadge status={u.accountStatus} />
      </div>

      <div className="mt-5 flex flex-wrap gap-6 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={[
              'pb-2.5 text-sm font-medium transition-colors -mb-px border-b-2',
              activeTab === tab.id
                ? 'text-[var(--primary)] border-[var(--primary)]'
                : 'text-slate-400 hover:text-slate-700 border-transparent',
            ].join(' ')}
          >
            {t(tab.key)}
          </button>
        ))}
      </div>

      <div className="pt-5">
        {activeTab === 'profile' && <ProfileTab detail={detail} />}
        {activeTab === 'identity' && <IdentityTab detail={detail} />}
        {activeTab === 'exams' && <ExamsTab detail={detail} onReload={onReload} />}
        {activeTab === 'payments' && (
          <HistoryTab detail={detail} onRefund={onRefund} onViewEvidence={() => undefined} />
        )}
        {activeTab === 'cert' && <CertTab detail={detail} />}
        {activeTab === 'activity' && <ActivityTab activity={activity} />}
        {activeTab === 'penalty' && (
          <MemberPenaltiesTab detail={detail} onReload={onReload} />
        )}
      </div>
    </div>
  );
}
