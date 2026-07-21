import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { registrationsApi, userApi } from '@/services/api';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';
import { InfoBox, Btn } from './mypage/primitives';
import { isValidSection, registrationExamEntryState, sectionToTab } from './mypage/helpers';
import { TAB_CONFIG } from './mypage/types';
import type { DashboardDto, RegistrationDto, TabKey } from './mypage/types';
import { RegistrationsPanel } from './mypage/panels/RegistrationsPanel';
import { MyExamsPanel } from './mypage/panels/MyExamsPanel';
import { ScoresPanel } from './mypage/panels/ScoresPanel';
import { CertsPanel } from './mypage/panels/CertsPanel';
import { InquiryPanel } from './mypage/panels/InquiryPanel';
import { ProfilePanel } from './mypage/panels/ProfilePanel';

export default function MyPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, lang } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const s = searchParams.get('section');
    if (isValidSection(s)) return sectionToTab(s);
    return 'registrations';
  });
  const [data, setData] = useState<DashboardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const profile = data?.profile ?? null;

  const tabs = useMemo(
    () =>
      TAB_CONFIG.map((tab) => ({
        key: tab.key,
        label: lang === 'ko' ? tab.labelKo : tab.labelEn,
      })),
    [lang],
  );

  const selectTab = (k: TabKey) => {
    setActiveTab(k);
    setSearchParams({}, { replace: true });
  };

  useEffect(() => {
    const raw = searchParams.get('section');
    if (raw === 'inquiry') {
      navigate('/qna', { replace: true });
      return;
    }
    if (isValidSection(raw)) {
      const tab = sectionToTab(raw);
      if (tab !== activeTab) setActiveTab(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const res = await userApi.getDashboard();
      setData(res.data);
      setError('');
    } catch (err: unknown) {
      if (isAxiosError(err) && err.response?.status === 401) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        navigate('/login', { replace: true });
        return;
      }
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const apiMessage = isAxiosError(err)
        ? (typeof err.response?.data?.message === 'string' ? err.response.data.message : undefined)
        : undefined;
      const transient = !status || status >= 502;
      setError(apiMessage || (transient ? t('home.profileNetworkError') : t('home.profileError')));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancelRegistration = async (id: string) => {
    try {
      await registrationsApi.cancel(id);
    } catch (err: any) {
      alert(err.response?.data?.message ?? 'Failed to cancel registration');
      throw err;
    }
  };

  const handleOpenPayment = (reg: RegistrationDto) => {
    navigate('/apply', {
      state: {
        step: 5,
        regId: reg.id,
        seatHeldUntil: reg.seatHeldUntil,
        certType: reg.certType,
        level: reg.level,
        // Rehydrate the wizard schedule so Step 5 doesn't hard-fail with
        // "Failed to prepare payment" (it previously required a wizard-selected
        // schedule that never exists when resuming payment from My Page).
        // capacity/remainingSeats are unused at the payment step.
        schedule: reg.schedule
          ? {
              id: reg.schedule.id,
              certType: reg.certType,
              level: reg.level,
              roundNumber: reg.schedule.roundNumber,
              year: reg.schedule.year,
              examDate: reg.schedule.examDate,
              examStartTime: reg.schedule.examStartTime,
              venue: reg.schedule.venue,
              capacity: 0,
              remainingSeats: 0,
              registrationEnd: reg.schedule.registrationEnd ?? '',
            }
          : undefined,
      },
    });
  };

  const handleEnterExam = async (registrationId: string) => {
    const reg = data?.registrations.find((r) => r.id === registrationId);
    if (!reg) {
      alert('Registration not found');
      return;
    }
    const gate = registrationExamEntryState(reg);
    if (!gate.canEnter) {
      alert(gate.hint);
      return;
    }
    navigate('/exam-ready', {
      state: {
        examInfo: {
          registrationId: reg.id,
          certType: reg.certType,
          level: reg.level,
          examDate: reg.schedule.examDate,
          examStartTime: reg.schedule.examStartTime,
          venue: reg.schedule.venue,
        },
      },
    });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ fontFamily: 'var(--font-sans)' }}>
      <SiteHeader active="mypage" />

      <PageHeroSolid
        title={t('gnb.mypage')}
        subtitle={
          lang === 'ko'
            ? '접수·성적·자격증·문의 내역을 확인합니다.'
            : 'Manage your registrations, scores, certificates, and inquiries.'
        }
      />

      <div data-tour="mypage-tabs">
        <PageTabs<TabKey>
          tabs={tabs}
          active={activeTab}
          onChange={selectTab}
        />
      </div>

      {error && (
        <div className="mx-auto px-5 sm:px-6 lg:px-8 mt-3 w-full" style={{ maxWidth: 'var(--spacing-content-w)' }}>
          <InfoBox variant="important">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span role="alert">{error}</span>
              <Btn variant="primary" className="btn-sm" onClick={() => void loadDashboard()} disabled={loading}>
                {t('common.retry')}
              </Btn>
            </div>
          </InfoBox>
        </div>
      )}

      <div className="flex-1">
        <div
          data-tour="mypage-content"
          className="mx-auto px-5 sm:px-6 lg:px-8 pt-6 sm:pt-8 lg:pt-10 pb-14 sm:pb-16 lg:pb-20"
          style={{ maxWidth: 'var(--spacing-content-w)', minHeight: '585px' }}
        >
          {loading || !data ? (
            <div aria-live="polite" className="space-y-4">
              <div className="h-8 bg-[#F3F5F9] rounded-lg animate-pulse" />
              <div className="h-24 bg-[#F3F5F9] rounded-lg animate-pulse" />
              <div className="h-24 bg-[#F3F5F9] rounded-lg animate-pulse" />
            </div>
          ) : (
            <>
              {activeTab === 'registrations' && (
                <RegistrationsPanel
                  data={data}
                  onCancel={handleCancelRegistration}
                  onRefresh={loadDashboard}
                  onPayNow={handleOpenPayment}
                />
              )}
              {activeTab === 'myExams' && (
                <MyExamsPanel
                  data={data}
                  onEnter={handleEnterExam}
                  onPayNow={handleOpenPayment}
                  onRefresh={loadDashboard}
                />
              )}
              {activeTab === 'scores' && <ScoresPanel data={data} />}
              {activeTab === 'certs' && <CertsPanel data={data} />}
              {activeTab === 'inquiry' && <InquiryPanel data={data} />}
              {activeTab === 'profile' && (
                <ProfilePanel profile={profile} onProfileUpdated={loadDashboard} />
              )}
            </>
          )}
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
