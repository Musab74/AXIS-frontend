import { useI18n } from '@admin/i18n';
import type {
  ExamineeDetail,
  ExamineeRegistrationDetail,
} from '@admin/services/api';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { AccountStatusBadge } from './AccountStatusBadge';
import { ProfileTab } from '../tabs/ProfileTab';
import { HistoryTab } from '../tabs/HistoryTab';
import { CertTab } from '../tabs/CertTab';
import { PenaltyTab } from '../tabs/PenaltyTab';

export type DetailTab = 'profile' | 'history' | 'cert' | 'penalty';

interface ExamineeDetailContentProps {
  detail: ExamineeDetail | null;
  detailError: string | null;
  activeTab: DetailTab;
  onTabChange: (t: DetailTab) => void;
  onRefund: (reg: ExamineeRegistrationDetail) => void;
  onViewEvidence: (sessionId: string, name: string) => void;
}

export function ExamineeDetailContent({
  detail,
  detailError,
  activeTab,
  onTabChange,
  onRefund,
  onViewEvidence,
}: ExamineeDetailContentProps) {
  const { t } = useI18n();

  if (detailError) {
    return <div className="py-8 text-center text-sm text-rose-600">{detailError}</div>;
  }
  if (!detail) {
    return <div className="py-12 text-center text-sm text-slate-400">{t('common.loading')}</div>;
  }

  const u = detail.user;
  const tabs: { id: DetailTab; key: string }[] = [
    { id: 'profile', key: 'exm.tab.profile' },
    { id: 'history', key: 'exm.tab.history' },
    { id: 'cert', key: 'exm.tab.cert' },
    { id: 'penalty', key: 'exm.tab.penalty' },
  ];

  return (
    <div>
      {/* Identity summary — name lives in the modal title bar, so keep this light */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <Field label={t('exm.profile.userId')} value={u.userId} />
          <Field
            label={t('exm.col.phone')}
            value={<MaskedPii userDbId={u.id} field="phone" value={u.phone} />}
          />
          <Field label={t('exm.tab.history')} value={detail.registrations.length} />
          <Field label={t('exm.profile.activePenalty')} value={detail.activePenaltyCount} />
        </div>
        <AccountStatusBadge status={u.accountStatus} />
      </div>

      <div className="mt-5 flex flex-wrap gap-6 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
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
        {activeTab === 'history' && (
          <HistoryTab
            detail={detail}
            onRefund={onRefund}
            onViewEvidence={(sid) => onViewEvidence(sid, detail.user.name)}
          />
        )}
        {activeTab === 'cert' && <CertTab detail={detail} />}
        {activeTab === 'penalty' && <PenaltyTab detail={detail} />}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900 break-all">{value}</div>
    </div>
  );
}
