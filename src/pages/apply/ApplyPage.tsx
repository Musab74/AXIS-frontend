import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight } from 'lucide-react';
import { useI18n } from '@/i18n';
import { isLoggedIn } from '@/utils/authNavigate';
import { WizardProvider, useWizard } from '@/pages/apply/lib/WizardContext';
import type { CertType, CertLevel, ScheduleSummary, WizardStep } from '@/pages/apply/lib/WizardContext';
import Step0PreCheck from '@/pages/apply/steps/Step0PreCheck';
import Step1CertLevel from '@/pages/apply/steps/Step1CertLevel';
import Step2Session from '@/pages/apply/steps/Step2Session';
import Step3InfoReview from '@/pages/apply/steps/Step3InfoReview';
import Step4Payment from '@/pages/apply/steps/Step4Payment';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { ApplySidebar } from '@/pages/apply/components/ApplySidebar';

/* HomePage 디자인 토큰 정렬 */
const INK_900 = '#191919';
const GRAY_300 = '#737373';
const BORDER = '#E5E7EB';
const ACCENT = '#2b7fff';
const DONE = '#16A34A';

function StepIndicator({ current }: { current: number }) {
  const { t } = useI18n();
  const STEPS = [
    { n: 1, label: t('apply.step.precheck') },
    { n: 2, label: t('apply.step.certLevel') },
    { n: 3, label: t('apply.step.session') },
    { n: 4, label: t('apply.step.review') },
    { n: 5, label: t('apply.step.payment') },
  ];
  return (
    <div className="mx-auto mb-8 lg:mb-10 w-full max-w-[980px] overflow-x-auto sm:overflow-visible">
      <div className="mx-auto flex w-max sm:w-full items-start justify-center">
      {STEPS.map((s, i) => {
        const done = current > s.n;
        const active = current === s.n;
        return (
          <div key={s.n} className="flex min-w-0 items-start my-4 sm:my-8">
            <div className="w-[82px] sm:w-[120px] flex-shrink-0">
              <div className="flex flex-col items-center min-w-0 text-center">
              <div
                className="w-8 h-8 lg:w-10 lg:h-10 rounded-full flex items-center justify-center text-[12px] lg:text-[16px] font-semibold border transition-all"
                style={{
                  background: done ? DONE : active ? ACCENT : '#FFFFFF',
                  borderColor: done ? DONE : active ? ACCENT : BORDER,
                  color: done || active ? '#FFFFFF' : '#9CA3AF',
                }}
              >
                {done ? (
                  <Check className="w-3.5 h-3.5 lg:w-4 lg:h-4" strokeWidth={2.6} />
                ) : (
                  s.n
                )}
              </div>
              <span
                className="my-2 text-[10px] lg:text-[15px] font-medium whitespace-nowrap"
                style={{ color: active ? ACCENT : done ? DONE : '#9CA3AF' }}
              >
                {s.label}
              </span>
            </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="mx-1 sm:mx-2 mt-2 flex w-[28px] sm:w-[56px] lg:w-[60px] items-center justify-center"
                aria-hidden="true"
              >
                <div className="flex items-center">
                  <ChevronRight
                    className="-ml-1 sm:-ml-1.5 lg:-ml-2 w-4 h-4 sm:w-[18px] sm:h-[18px] lg:w-5 lg:h-5"
                    strokeWidth={1.65}
                    style={{ color: done ? DONE : '#d7d7d7' }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

function WizardRouter() {
  const { step } = useWizard();
  switch (step) {
    case 1: return <Step0PreCheck />;
    case 2: return <Step1CertLevel />;
    case 3: return <Step2Session />;
    case 4: return <Step3InfoReview />;
    case 5: return <Step4Payment />;
    default: return <Step0PreCheck />;
  }
}

function ApplyPageInner() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    step,
    agreedToPrecheck,
    selectedCert,
    selectedLevel,
    selectedSchedule,
    regId,
    consents,
    setCert,
    setLevel,
    setSchedule,
    setRegistration,
    goToStep,
  } = useWizard();
  const location = useLocation();
  const loggedIn = isLoggedIn();
  const stepTopRef = useRef<HTMLDivElement | null>(null);
  const prevStepRef = useRef(step);
  const STEP_SCROLL_OFFSET = 110;
  const hasInProgressData =
    step > 1 ||
    agreedToPrecheck ||
    !!selectedCert ||
    !!selectedLevel ||
    !!selectedSchedule ||
    !!regId ||
    consents.some(Boolean);
  const shouldWarnOnLeave = loggedIn && hasInProgressData;
  const LEAVE_WARNING_MESSAGE = '페이지를 나가시면 변경사항이 저장되지 않을 수 있습니다.\n계속하시겠습니까?';

  useEffect(() => {
    const state = location.state as {
      certType?: string;
      level?: string;
      step?: number;
      regId?: string;
      seatHeldUntil?: string | null;
      schedule?: ScheduleSummary;
    } | null;
    if (state?.certType) setCert(state.certType as CertType);
    if (state?.level) setLevel(state.level as CertLevel);
    // Must run after setCert/setLevel — both reset selectedSchedule to null.
    // Resuming payment from My Page has no wizard-selected schedule, so we
    // rehydrate it from the registration to keep the Step 5 summary complete.
    if (state?.schedule) setSchedule(state.schedule);
    // Resume payment: the seat hold may already be null once a virtual account
    // is issued, so wire up regId regardless — Step 5 only needs the regId.
    if (state?.regId) setRegistration(state.regId, state.seatHeldUntil ?? null);
    if (state?.step) goToStep(state.step as WizardStep);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prevStep = prevStepRef.current;
    if (step !== prevStep && stepTopRef.current) {
      const sectionTitle = stepTopRef.current.querySelector('h2');
      const target = sectionTitle instanceof HTMLElement ? sectionTitle : stepTopRef.current;
      const top = window.scrollY + target.getBoundingClientRect().top - STEP_SCROLL_OFFSET;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
    prevStepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!shouldWarnOnLeave) return;

    // 새로고침/탭 닫기/주소 직접 입력 가드.
    // 브라우저 정책상 returnValue에 무엇을 넣어도 커스텀 문구는 표시되지 않고
    // 브라우저 기본 안내문만 노출됨 (LEAVE_WARNING_MESSAGE는 의도적으로 사용 안 함).
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest('a');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      const url = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      const isSamePage =
        url.pathname === current.pathname &&
        url.search === current.search &&
        url.hash === current.hash;
      if (isSamePage) return;

      const ok = window.confirm(LEAVE_WARNING_MESSAGE);
      if (!ok) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // 브라우저 뒤로/앞으로 버튼 가드.
    // 같은 URL의 sentinel history entry를 push해두고, popstate 시 사용자에게 확인을 받는다.
    // 같은 URL이므로 React Router는 라우트 변경을 감지하지 않아 안전하다.
    const SENTINEL_KEY = '__applyLeaveGuard';
    const hasSentinel = () =>
      !!(window.history.state && (window.history.state as Record<string, unknown>)[SENTINEL_KEY]);
    if (!hasSentinel()) {
      window.history.pushState({ [SENTINEL_KEY]: true }, '', window.location.href);
    }

    const onPopState = () => {
      if (hasSentinel()) return;
      const ok = window.confirm(LEAVE_WARNING_MESSAGE);
      if (ok) {
        window.history.back();
      } else {
        window.history.pushState({ [SENTINEL_KEY]: true }, '', window.location.href);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('popstate', onPopState);
    };
  }, [shouldWarnOnLeave]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF', color: INK_900 }}>
      <SiteHeader active="apply" />

      <PageHeroSolid
        title={t('apply.title')}
        subtitle={t('apply.subtitle')}
      />

      <main className="flex-1 w-full mx-auto max-w-[1280px] px-5 sm:px-6 lg:px-10 py-8 sm:py-10 lg:py-16">
        {loggedIn && (
          <div data-tour="apply-steps">
            <StepIndicator current={step} />
          </div>
        )}

        {loggedIn ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 lg:gap-8 items-start">
            <div data-tour="apply-form" className="min-w-0 order-last lg:order-none">
              <div
                ref={stepTopRef}
                className=""
                style={{ background: '#FFFFFF' }}
              >
                <WizardRouter />
              </div>
            </div>
            <div data-tour="apply-sidebar" className="order-first lg:order-none min-w-0">
              <ApplySidebar />
            </div>
          </div>
        ) : (
          <div
            className="max-w-[640px] mx-auto rounded-[20px] p-6 sm:p-10 text-center"
            style={{ background: '#FFFFFF', border: `1px solid ${BORDER}` }}
          >
            <p className="text-[16px] lg:text-[18px] font-semibold" style={{ color: INK_900 }}>
              {t('apply.loginGate.title')}
            </p>
            <p className="mt-2 text-[14px]" style={{ color: GRAY_300 }}>
              {t('apply.loginGate.sub')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/login', { state: { from: '/apply' } })}
              className="mt-6 w-full sm:w-auto px-6 py-3 rounded-[10px] text-[14px] font-semibold border-none cursor-pointer transition-colors"
              style={{ background: ACCENT, color: '#FFFFFF' }}
            >
              {t('apply.loginGate.btn')}
            </button>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

export default function ApplyPage() {
  return (
    <WizardProvider>
      <ApplyPageInner />
    </WizardProvider>
  );
}
