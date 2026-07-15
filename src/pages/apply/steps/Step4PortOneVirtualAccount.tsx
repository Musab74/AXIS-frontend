import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { PaymentPayMethod, requestPayment } from '@portone/browser-sdk/v2';
import { useI18n } from '@/i18n';
import { useWizard } from '@/pages/apply/lib/WizardContext';
import { paymentApi, userApi } from '@/services/api';
import { createOrResumeRegistration, formatRegisterError } from '@/pages/apply/lib/applyRegisterSession';
import { BankSelectWithLogos } from '@/pages/apply/components/BankSelectWithLogos';
import {
  writeApplyPaymentDemo,
} from '@/pages/apply/lib/applyPaymentDemo';
import { requestPortoneV1Vbank } from '@/pages/apply/lib/requestPortoneV1Vbank';
import type { PaymentRequestResponse } from '@/services/api';
import { H_CARD, T_BODY, T_META, INK_900, GRAY_500, BORDER, ACCENT } from '@/pages/apply/lib/applyTokens';
import { ApplySectionHeader } from '@/pages/apply/components/ApplySectionHeader';
import { InfoCallout } from '@/components/InfoCallout';


function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row border-b first:border-t sm:h-16"
      style={{ borderColor: BORDER }}
    >
      <div className="w-full sm:w-27.5 lg:w-32.5 shrink-0 flex items-center px-4 py-3 sm:py-4 bg-[#F8FAFC]">
        <span className={`${T_BODY} font-semibold`} style={{ color: INK_900 }}>
          {label}
        </span>
      </div>
      <div className="flex-1 min-w-0 px-4 py-3 sm:py-4 flex items-center min-h-11">
        {children}
      </div>
    </div>
  );
}

function formatDate(iso: string, time?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return time ? `${yyyy}.${mm}.${dd} ${time}` : `${yyyy}.${mm}.${dd}`;
}

function certFullLabel(t: (k: never) => string, certType: string | null, level: string | null) {
  const certKey = `apply.certLabel.${certType ?? 'AXIS'}` as never;
  const levelKey = `apply.levelLabel.${level ?? 'L3'}` as never;
  return `${t(certKey)} ${t(levelKey)}`;
}

function MiniToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 3200);
    return () => clearTimeout(id);
  }, [onClose]);
  return (
    <div className="fixed bottom-6 left-1/2 z-[3000] -translate-x-1/2 px-4 py-3 rounded-xl bg-[#0F172A] text-white text-sm shadow-lg max-w-[90vw] text-center">
      {message}
      <button type="button" className="ml-3 opacity-70 hover:opacity-100" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

export default function Step4PortOneVirtualAccount() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    regId,
    seatHeldUntil,
    selectedCert,
    selectedLevel,
    selectedSchedule,
    setRegistration,
    prevStep,
  } = useWizard();

  const [secsLeft, setSecsLeft] = useState<number>(() => {
    if (seatHeldUntil) {
      return Math.max(0, Math.round((new Date(seatHeldUntil).getTime() - Date.now()) / 1000));
    }
    return 10 * 60;
  });

  const [bankCode, setBankCode] = useState<string>('');
  const [consent, setConsent] = useState(false);
  const [loadingParams, setLoadingParams] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [paymentDemo, setPaymentDemo] = useState(false);
  const [payMethodChoice, setPayMethodChoice] = useState<'card' | 'va' | 'demo'>('card');

  const handleSelectPayMethod = (id: 'card' | 'va' | 'demo') => {
    setPayMethodChoice(id);
    const demoOn = id === 'demo';
    setPaymentDemo(demoOn);
    writeApplyPaymentDemo(demoOn);
  };

  // Keep demo flag in sync for return visits / other apply steps.
  useEffect(() => {
    writeApplyPaymentDemo(payMethodChoice === 'demo');
  }, [payMethodChoice]);

  const [reqData, setReqData] = useState<PaymentRequestResponse | null>(null);
  const [profile, setProfile] = useState<{
    name?: string;
    birthDate?: string;
    phone?: string;
    email?: string;
  }>({});

  const demoPayAvailable = reqData?.testPaymentEnabled === true;

  useEffect(() => {
    if (secsLeft <= 0) return;
    const id = setInterval(() => setSecsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secsLeft]);

  // Backend may disable test payment (e.g. prod) — drop a stale demo selection.
  useEffect(() => {
    if (reqData?.testPaymentEnabled === false && payMethodChoice === 'demo') {
      setPayMethodChoice('card');
      setPaymentDemo(false);
      writeApplyPaymentDemo(false);
    }
  }, [reqData?.testPaymentEnabled, payMethodChoice]);

  useEffect(() => {
    userApi
      .getProfile()
      .then((r) => setProfile(r.data as typeof profile))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Registration is created here (not on step 2) — keep separate from payment/request
  // so updating regId does not fire a second concurrent /payment/request.
  useEffect(() => {
    if (!selectedSchedule || regId) return;
    let cancelled = false;
    void (async () => {
      try {
        const ensured = await createOrResumeRegistration(selectedSchedule);
        if (cancelled) return;
        setRegistration(ensured.id, ensured.seatHeldUntil);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAxiosError(err) && err.response?.status === 401) {
          navigate('/login', { replace: true, state: { from: '/apply' } });
          return;
        }
        setError(formatRegisterError(err, t('apply.step4.readyFailed' as never)));
        setLoadingParams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSchedule, regId, setRegistration, navigate, t]);

  useEffect(() => {
    if (!selectedSchedule) {
      setLoadingParams(false);
      setError(t('apply.step4.readyFailed' as never));
      return;
    }
    if (!regId) return;

    let cancelled = false;
    setLoadingParams(true);
    setError('');
    void (async () => {
      try {
        const prefer =
          payMethodChoice === 'card' ? 'CARD' : payMethodChoice === 'va' ? 'VBANK' : undefined;
        const res = await paymentApi.request(regId, prefer);
        if (cancelled) return;
        setReqData(res.data);
        if (prefer === 'VBANK' && res.data.alreadyIssued && res.data.vbankNum) {
          setToast(t('apply.step4.vaAlreadyIssued' as never));
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAxiosError(err) && err.response?.status === 401) {
          navigate('/login', { replace: true, state: { from: '/apply' } });
          return;
        }
        const msg = isAxiosError(err) ? err.response?.data?.message : undefined;
        if (msg === 'MISSING_L1_DOCUMENT') {
          setError(t('apply.step4.missingL1Doc' as never));
        } else if (msg === 'SESSION_EXPIRED') {
          setError(t('apply.step4.sessionExpired' as never));
        } else {
          setError(typeof msg === 'string' ? msg : formatRegisterError(err, t('apply.step4.readyFailed' as never)));
        }
      } finally {
        if (!cancelled) setLoadingParams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [regId, navigate, selectedSchedule, t, payMethodChoice]);

  const handleIssue = async () => {
    if (!regId) return;
    if (!consent) return;

    if (paymentDemo) {
      if (!reqData) return;
      setPaying(true);
      setError('');
      try {
        // Backend flips the registration to PAID (requires TEST_PAYMENT_ENABLED=true
        // on the server). On prod the endpoint is 404 — we surface that as a clear
        // error rather than silently falling back to the old preview-only behaviour,
        // because the old fallback left the registration unpaid and the candidate
        // couldn't enter the exam.
        await paymentApi.testConfirm(regId);
        window.alert('결제가 완료되었습니다.');
        navigate('/mypage', { replace: true });
      } catch (e: unknown) {
        if (isAxiosError(e) && e.response?.status === 404) {
          setToast(
            '테스트 결제는 이 환경에서 비활성화되어 있습니다. (TEST_PAYMENT_ENABLED 미설정)',
          );
        } else if (isAxiosError(e) && e.response?.status === 401) {
          navigate('/login', { replace: true, state: { from: '/apply' } });
          return;
        } else if (isAxiosError(e) && e.response?.data?.message === 'SESSION_EXPIRED') {
          setError(t('apply.step4.sessionExpired' as never));
        } else {
          const msg = isAxiosError(e) ? e.response?.data?.message : undefined;
          setToast(typeof msg === 'string' && msg ? msg : '테스트 결제 처리에 실패했습니다.');
        }
        setPaying(false);
      }
      return;
    }

    if (!reqData) return;
    const needBank = payMethodChoice === 'va' && !reqData.alreadyIssued;
    if (needBank && !bankCode) return;

    if (
      payMethodChoice === 'va' &&
      reqData.alreadyIssued &&
      reqData.vbankNum &&
      reqData.vbankName
    ) {
      navigate('/apply/complete', {
        replace: false,
        state: {
          vbankName: reqData.vbankName,
          vbankNum: reqData.vbankNum,
          vbankExpiry: reqData.vbankExpiry ?? '',
          amount: reqData.totalAmount,
          orderName: reqData.orderName,
          registrationId: regId,
        },
      });
      return;
    }

    setPaying(true);
    setError('');

    const customer = reqData.customer ?? {
      fullName: reqData.customerName,
      email: reqData.customerEmail,
      phoneNumber: reqData.customerPhone,
    };

    const isV1 = reqData.portoneVersion === 'v1';
    const useCard = payMethodChoice === 'card';

    try {
      let paymentIdForConfirm: string;

      if (isV1) {
        if (useCard) {
          setToast(t('apply.step4.cardNeedsV2' as never));
          setPaying(false);
          return;
        }
        const impCode = reqData.impCode?.trim();
        if (!impCode) {
          setToast('결제 설정 오류(imp_code). 고객센터로 문의해 주세요.');
          setPaying(false);
          return;
        }
        paymentIdForConfirm = await requestPortoneV1Vbank({
          impCode,
          pgProvider: reqData.pgProvider ?? 'kcp',
          merchantUid: reqData.merchantId,
          orderName: reqData.orderName,
          amount: reqData.totalAmount,
          bankCode,
          buyerName: customer.fullName,
          buyerEmail: customer.email,
          buyerTel: customer.phoneNumber,
        });
      } else {
        const storeId =
          (import.meta.env.VITE_PORTONE_STORE_ID as string | undefined)?.trim() || reqData.storeId;
        const channelKey =
          (import.meta.env.VITE_PORTONE_CHANNEL_KEY as string | undefined)?.trim() ||
          reqData.channelKey;

        // SDK typings incorrectly require extra method option objects on the union.
        // PortOne rejects VA if any non-VA option is present; CARD must omit virtualAccount.
        const res = await requestPayment(
          (useCard
            ? {
                storeId,
                channelKey,
                paymentId: reqData.merchantId,
                orderName: reqData.orderName,
                totalAmount: reqData.totalAmount,
                currency: reqData.currency,
                payMethod: PaymentPayMethod.CARD,
                customer: {
                  fullName: customer.fullName,
                  email: customer.email || undefined,
                  phoneNumber: customer.phoneNumber || undefined,
                },
              }
            : {
                storeId,
                channelKey,
                paymentId: reqData.merchantId,
                orderName: reqData.orderName,
                totalAmount: reqData.totalAmount,
                currency: reqData.currency,
                payMethod: PaymentPayMethod.VIRTUAL_ACCOUNT,
                customer: {
                  fullName: customer.fullName,
                  email: customer.email || undefined,
                  phoneNumber: customer.phoneNumber || undefined,
                },
                virtualAccount: {
                  bankCode,
                  accountExpiry: { validHours: 24 },
                },
              }) as unknown as Parameters<typeof requestPayment>[0],
        );

        if (!res) {
          setError(
            useCard
              ? t('apply.step4.payFailed' as never)
              : '가상계좌 발급에 실패했습니다. 다시 시도해 주세요.',
          );
          setPaying(false);
          return;
        }

        if (res.code) {
          console.warn('PortOne requestPayment error', res.message, res.code);
          setToast(
            useCard
              ? `${t('apply.step4.payFailed' as never)}: ${res.message ?? ''}`.trim()
              : `가상계좌 발급 실패: ${res.message ?? '알 수 없는 오류'}`,
          );
          setPaying(false);
          return;
        }
        paymentIdForConfirm = res.paymentId;
      }

      const confirmRes = await paymentApi.confirm({
        paymentId: paymentIdForConfirm,
        merchantId: reqData.merchantId,
      });

      const d = confirmRes.data;
      if (d.status === 'PAID') {
        window.alert(t('apply.step4.payOk' as never));
        navigate('/mypage', { replace: true });
        return;
      }

      navigate('/apply/complete', {
        replace: false,
        state: {
          vbankName: d.vbankName,
          vbankNum: d.vbankNum,
          vbankExpiry: d.vbankExpiry,
          amount: d.amount ?? reqData.totalAmount,
          orderName: d.orderName ?? reqData.orderName,
          registrationId: d.registrationId,
        },
      });
    } catch (e: unknown) {
      if (isAxiosError(e)) {
        if (e.response?.status === 401) {
          navigate('/login', { replace: true, state: { from: '/apply' } });
          return;
        }
        const body = e.response?.data as { error?: string; message?: string } | undefined;
        if (body?.error === 'amount_mismatch') {
          setToast('결제 금액이 일치하지 않습니다. 고객센터로 문의해 주세요.');
        } else if (!e.response) {
          setToast('서버 연결 실패. 잠시 후 다시 시도해 주세요.');
        } else if (e.config?.url?.includes('/payment/confirm')) {
          setToast('결제 확인 실패. 고객센터(1811-9530)로 문의해 주세요.');
        } else {
          setToast(body?.message ?? '서버 연결 실패. 잠시 후 다시 시도해 주세요.');
        }
      } else if (e instanceof Error && e.message.trim()) {
        setToast(e.message.trim());
      } else {
        setToast('서버 연결 실패. 잠시 후 다시 시도해 주세요.');
      }
      setPaying(false);
    }
  };

  const mins = String(Math.floor(secsLeft / 60)).padStart(2, '0');
  const secs = String(secsLeft % 60).padStart(2, '0');
  const expired = secsLeft === 0;
  const urgent = secsLeft <= 5 * 60;
  const examLabel = certFullLabel(t as (k: never) => string, selectedCert, selectedLevel);

  return (
    <div>
      {toast && <MiniToast message={toast} onClose={() => setToast(null)} />}

      <ApplySectionHeader
        title={t('apply.s4.title')}
        sub={t('apply.s4.sub')}
      />

      <section className="bg-white mb-4">
        <header className="py-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h3 className={H_CARD} style={{ color: INK_900 }}>
            {t('apply.s4.summaryTitle')}
          </h3>
          <div
            aria-live="polite"
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${T_META} font-semibold ${
              expired
                ? 'bg-[#FEE2E2] text-status-danger'
                : urgent
                  ? 'bg-[#FEF3C7] text-[#A16207]'
                  : 'bg-[#DCFCE7] text-[#16A34A]'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {expired
              ? t('apply.s4.expired')
              : t('apply.s4.timeLeft').replace('{mm}', mins).replace('{ss}', secs)}
          </div>
        </header>
        <div>
          <FieldRow label="자격명">
            <div className={T_BODY} style={{ color: INK_900 }}>{examLabel}</div>
          </FieldRow>
          {selectedSchedule && (
            <FieldRow label="시험일">
              <div className={T_BODY} style={{ color: INK_900 }}>
                {formatDate(selectedSchedule.examDate, selectedSchedule.examStartTime)}
              </div>
            </FieldRow>
          )}
          <FieldRow label="접수번호">
            <div className={`font-mono ${T_META}`} style={{ color: INK_900 }}>
              {reqData?.registrationNumber ?? '—'}
            </div>
          </FieldRow>
          <FieldRow label="이름">
            <div className={T_BODY} style={{ color: INK_900 }}>
              {profile.name ?? reqData?.customer?.fullName ?? reqData?.customerName ?? '—'}
            </div>
          </FieldRow>
          <FieldRow label="생년월일">
            <div className={T_BODY} style={{ color: INK_900 }}>
              {profile.birthDate ?? '—'}
            </div>
          </FieldRow>
          <FieldRow label="휴대폰 번호">
            <div className={T_BODY} style={{ color: INK_900 }}>
              {profile.phone ?? reqData?.customer?.phoneNumber ?? reqData?.customerPhone ?? '—'}
            </div>
          </FieldRow>
          <FieldRow label="이메일">
            <div className={T_BODY} style={{ color: INK_900 }}>
              {profile.email ?? reqData?.customer?.email ?? reqData?.customerEmail ?? '—'}
            </div>
          </FieldRow>
        </div>
      </section>

      <header className="py-4 flex items-center justify-between gap-3">
          <h3 className={H_CARD} style={{ color: INK_900 }}>
            결제수단 선택
          </h3>
      </header>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        {([
          { id: 'card' as const, label: t('apply.step4.method.card' as never) },
          { id: 'va' as const, label: t('apply.kcp.method.va' as never) },
          ...(demoPayAvailable
            ? [{ id: 'demo' as const, label: t('apply.step4.testUserToggle' as never) }]
            : []),
        ]).map((opt) => {
          const selected = payMethodChoice === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelectPayMethod(opt.id)}
              aria-pressed={selected}
              className={`w-full sm:w-auto sm:min-w-35 h-12 px-5 rounded-md border ${T_BODY} font-semibold transition-colors cursor-pointer ${
                selected
                  ? 'border-[#2563EB] bg-white text-[#2563EB]'
                  : 'border-[#E5E5E5] bg-white hover:bg-[#F8FAFC]'
              }`}
              style={selected ? undefined : { color: INK_900 }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {payMethodChoice === 'card' && (
        <InfoCallout tone="blue" className="mb-4">
          <p>{t('apply.step4.cardRefundHint' as never)}</p>
        </InfoCallout>
      )}

      {payMethodChoice === 'demo' && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl border border-[#FCD34D] bg-[#FFFBEB] ${T_BODY}`}
          style={{ color: '#92400E' }}
        >
          {t('apply.step4.demoBanner' as never)}
        </div>
      )}

      {expired ? (
        <div className="py-10 text-center bg-white border rounded-xl mb-4" style={{ borderColor: BORDER }}>
          <div className="text-[32px] mb-2">⏰</div>
          <div className={`${H_CARD} mb-1`} style={{ color: INK_900 }}>{t('apply.s4.expiredTitle')}</div>
          <p className={T_BODY} style={{ color: GRAY_500 }}>{t('apply.s4.expiredDesc')}</p>
        </div>
      ) : loadingParams ? (
        <div className="py-10 text-center bg-white border rounded-xl mb-4" style={{ borderColor: BORDER }}>
          <div className="inline-block w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-3" />
          <div className={T_BODY} style={{ color: GRAY_500 }}>{t('apply.s4.preparing')}</div>
        </div>
      ) : (
        <>
          {payMethodChoice === 'va' && !reqData?.alreadyIssued && (
            <section className="bg-white mb-4">
              <div>
                <div
                  className="flex flex-col sm:flex-row border-b first:border-t"
                  style={{ borderColor: BORDER }}
                >
                  <div className="w-full sm:w-27.5 lg:w-32.5 shrink-0 flex items-center px-4 py-3 sm:py-4 bg-[#F8FAFC]">
                    <span
                      id="va-bank-label"
                      className={`${T_BODY} font-semibold`}
                      style={{ color: INK_900 }}
                    >
                      입금 은행 선택
                    </span>
                    <span className="text-status-danger ml-1">*</span>
                  </div>
                  <div className="flex-1  px-4 py-3 sm:py-4 flex items-center min-h-11">
                    <div className="w-full sm:w-70">
                      <BankSelectWithLogos
                        id="va-bank"
                        labelId="va-bank-label"
                        value={bankCode}
                        onChange={setBankCode}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {payMethodChoice === 'va' && (
            <div>
            <InfoCallout tone="blue" >
              <p>
                결제 완료 후 발급된 계좌번호로 24시간 이내 이체해 주세요.
              </p>
            </InfoCallout>
            <InfoCallout tone="blue">
              <p>
                입금 확인 즉시 SMS와 이메일로 접수 확정 안내를 드립니다.
              </p>
            </InfoCallout>
            <InfoCallout tone="red" className="mb-6">
              <p>
                입금기한 초과 시 접수가 자동으로 취소됩니다.
              </p>
            </InfoCallout>
            </div>
          )}

          {error && (
            <div className={`mb-4 px-4 py-3 bg-[#FEE2E2] border border-[#FECACA] rounded-xl ${T_BODY} text-status-danger`}>
              {error}
            </div>
          )}

          <div className="mb-6">
            <button
              type="button"
              onClick={() => setConsent(!consent)}
              className={`w-full flex items-start gap-3 text-left p-5 rounded-xl transition-all cursor-pointer min-h-13 ${
                consent ? 'bg-white border border-blue-500' : 'border border-border hover:bg-[#EFF6FF]/60'
              }`}
            >
              <div
                className={`shrink-0 w-5 h-5 mt-0.5 rounded-[5px] flex items-center justify-center transition-all ${
                  consent ? 'bg-[#2563EB]' : 'border border-border bg-white'
                }`}
              >
                {consent && (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>
              <span className={`${T_BODY} break-keep`} style={{ color: INK_900 }}>
                결제 진행 및 환불 규정에 동의합니다. (필수){' '}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[#2563EB] font-medium underline underline-offset-2"
                >
                  환불 규정 보기 ↗
                </a>
              </span>
            </button>
          </div>
        </>
      )}

      {!expired && !loadingParams && (
        <div className="sticky bottom-0 sm:static bg-white pt-2 pb-4 sm:pb-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={prevStep}
              className="sm:flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium border bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer"
              style={{ borderColor: BORDER, color: GRAY_500 }}
            >
              {t('apply.nav.prev')}
            </button>
            <button
              type="button"
              onClick={handleIssue}
              disabled={
                !reqData ||
                paying ||
                !consent ||
                !!error ||
                (payMethodChoice === 'va' && !!reqData && !reqData.alreadyIssued && !bankCode)
              }
              className="w-full sm:flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-2"
              style={{ background: ACCENT }}
            >
              {paying ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {payMethodChoice === 'va'
                    ? t('apply.step4.issuingVa' as never)
                    : t('apply.step4.processing' as never)}
                </>
              ) : payMethodChoice === 'va' && reqData?.alreadyIssued ? (
                <>{t('apply.step4.viewVa' as never)}</>
              ) : (
                <>{t('apply.step4.payCta' as never)}</>
              )}
            </button>
          </div>
        </div>
      )}

      {expired && (
        <button
          type="button"
          onClick={() => window.location.assign('/apply')}
          className="w-full h-12 rounded-xl text-[14px] font-medium bg-[#0F172A] text-white hover:bg-[#14253B] transition-colors cursor-pointer"
        >
          {t('apply.s4.startOver')}
        </button>
      )}
    </div>
  );
}
