import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { useWizard } from '@/pages/apply/lib/WizardContext';
import { H_CARD, T_BODY, T_META, INK_900, GRAY_500, BORDER, ACCENT } from '@/pages/apply/lib/applyTokens';
import { ApplySectionHeader } from '@/pages/apply/components/ApplySectionHeader';

type PayMethod = 'va' | 'card' | 'kakao' | 'naver';
type BankId = 'kb' | 'shinhan' | 'woori' | 'hana' | 'ibk' | 'nh';

const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const EN_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatExamDisplay(isoDate: string, time: string, lang: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (lang === 'ko') {
    const w = KO_WEEKDAYS[dt.getDay()];
    return `${y}년 ${m}월 ${d}일 (${w}) ${time}`;
  }
  const w = EN_WEEKDAYS[dt.getDay()];
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} (${w}) ${time}`;
}

function buildReceiptNo(cert: string | null, level: string | null, year: number, round: number): string {
  const c = cert === 'AXIS_C' ? 'AXIS-C' : cert === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
  const lv = level ?? 'L3';
  const rnd = String(round).padStart(3, '0');
  return `${c}-${year}-${lv}-${rnd}-0247`;
}


function CardSection({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white mb-4 ${className}`}>
      <header className="py-4">
        <h3 className={H_CARD} style={{ color: INK_900 }}>
          {title}
        </h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row border-b first:border-t"
      style={{ borderColor: BORDER }}
    >
      <div className="w-full sm:w-27.5 lg:w-32.5 shrink-0 flex items-center px-4 py-3 sm:py-4 bg-[#F8FAFC]">
        <span className={`${T_BODY} font-semibold`} style={{ color: INK_900 }}>
          {label}
        </span>
        {required && <span className="text-status-danger ml-1">*</span>}
      </div>
      <div className="flex-1 min-w-0 px-4 py-3 sm:py-4">
        {children}
      </div>
    </div>
  );
}

export function Step4KcpPayment() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const { selectedCert, selectedLevel, selectedSchedule, prevStep } = useWizard();

  const [method, setMethod] = useState<PayMethod>('va');
  const [bankId, setBankId] = useState<BankId>('kb');
  const [payConsent, setPayConsent] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const examDateIso = selectedSchedule?.examDate ?? '2026-09-05';
  const examTime = selectedSchedule?.examStartTime ?? '14:00';
  const year = selectedSchedule?.year ?? 2026;
  const round = selectedSchedule?.roundNumber ?? 1;

  const examDateLine = useMemo(
    () => formatExamDisplay(examDateIso, examTime, lang),
    [examDateIso, examTime, lang],
  );

  const receiptNo = useMemo(
    () => buildReceiptNo(selectedCert, selectedLevel, year, round),
    [selectedCert, selectedLevel, year, round],
  );

  const feeKrw = selectedLevel === 'L1' ? 300000 : selectedLevel === 'L2' ? 200000 : 100000;
  const feeLabel = '₩' + feeKrw.toLocaleString('ko-KR');

  const bankLabel = (id: BankId) => t(`apply.kcp.bank.${id}` as never);

  const handlePayClick = () => {
    if (!payConsent) return;
    setModalOpen(true);
  };

  const methodOptions: { id: PayMethod; hintKey: string; feeKey?: string }[] = [
    { id: 'va', hintKey: 'apply.kcp.method.vaHint', feeKey: 'apply.kcp.method.vaFee' },
    { id: 'card', hintKey: 'apply.kcp.method.cardHint', feeKey: 'apply.kcp.method.cardFee' },
    { id: 'kakao', hintKey: 'apply.kcp.method.kakaoHint' },
    { id: 'naver', hintKey: 'apply.kcp.method.naverHint' },
  ];

  return (
    <div>
      <ApplySectionHeader
        title={t('apply.s4.title')}
        sub={t('apply.s4.sub')}
      />

      {/* 결제 정보 */}
      <CardSection title={t('apply.kcp.s4.payInfoTitle')}>
        <FieldRow label={t('apply.kcp.s4.certNameLabel')}>
          <div className={T_BODY} style={{ color: INK_900 }}>
            {t('apply.kcp.demoCertLine')}
          </div>
        </FieldRow>
        <FieldRow label={t('apply.kcp.s4.examDateLabel')}>
          <div className={T_BODY} style={{ color: INK_900 }}>
            {examDateLine}
          </div>
        </FieldRow>
        <FieldRow label={t('apply.kcp.s4.regNoLabel')}>
          <div className={`font-mono ${T_META}`} style={{ color: INK_900 }}>
            {receiptNo}
          </div>
        </FieldRow>
        <FieldRow label={t('apply.kcp.s4.feeLabel')}>
          <div className="font-bold text-[16px] lg:text-[18px]" style={{ color: ACCENT }}>
            {feeLabel}
          </div>
        </FieldRow>
      </CardSection>

      {/* 결제 수단 */}
      <CardSection title={t('apply.step4.payMethod')}>
        {methodOptions.map((opt) => {
          const selected = method === opt.id;
          return (
            <FieldRow key={opt.id} label={t(`apply.kcp.method.${opt.id}` as never)}>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="pay-method-kcp"
                  className="mt-1 w-4 h-4 text-[#2563EB] border-[#CBD5E1]"
                  checked={selected}
                  onChange={() => setMethod(opt.id)}
                />
                <span className="flex-1 min-w-0">
                  <span className={`block ${T_BODY}`} style={{ color: INK_900 }}>
                    {t(opt.hintKey as never)}
                  </span>
                  {opt.feeKey && (
                    <span className={`block ${T_META} mt-1`} style={{ color: GRAY_500 }}>
                      {t(opt.feeKey as never)}
                    </span>
                  )}
                </span>
              </label>
            </FieldRow>
          );
        })}

        {method === 'va' && (
          <FieldRow label={t('apply.kcp.bankLabel')} required>
            <select
              id="kcp-bank"
              value={bankId}
              onChange={(e) => setBankId(e.target.value as BankId)}
              className={`w-full max-w-105 h-11 px-3.5 rounded-md text-[16px] sm:text-[14px] lg:text-[15px] bg-white border border-border transition-colors focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/30`}
              style={{ color: INK_900 }}
            >
              {(['kb', 'shinhan', 'woori', 'hana', 'ibk', 'nh'] as const).map((id) => (
                <option key={id} value={id}>{bankLabel(id)}</option>
              ))}
            </select>
          </FieldRow>
        )}
      </CardSection>

      {/* 약관 동의 */}
      <CardSection title={t('apply.s3.consentTitle')} className="mb-6">
        <FieldRow label={t('apply.kcp.refundLink')} required>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
              checked={payConsent}
              onChange={(e) => setPayConsent(e.target.checked)}
            />
            <span className={`${T_BODY} break-keep`} style={{ color: INK_900 }}>
              {t('apply.kcp.consentPay')}{' '}
              <a
                href="/legal/5-refund.html"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[#2563EB] font-medium underline underline-offset-2"
              >
                {t('apply.kcp.refundLink')}
              </a>
            </span>
          </label>
        </FieldRow>
      </CardSection>

      <div className="sticky bottom-0 sm:static bg-white pt-2 pb-4 sm:pb-0">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={prevStep}
            className="flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium bg-[#F4F6F8] hover:bg-[#E9EDF1] transition-colors cursor-pointer"
            style={{ color: GRAY_500 }}
          >
            {t('apply.nav.prev')}
          </button>
          <button
            type="button"
            onClick={handlePayClick}
            disabled={!payConsent}
            className="flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
            style={{ background: ACCENT }}
          >
            {t('apply.kcp.cta')}
          </button>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kcp-modal-title"
        >
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto p-5 sm:p-8 border border-[#E2E8F0]">
            {/* REMOVE_BEFORE_PRODUCTION: remove DEMO badge for launch */}
            <span className="absolute top-4 right-4 text-[10px] font-semibold uppercase tracking-wide text-white bg-[#94A3B8] px-2 py-0.5 rounded">
              {t('apply.kcp.demoBadge')}
            </span>

            <div className="text-center text-[20px] mb-1" aria-hidden>✅</div>
            <h3 id="kcp-modal-title" className="text-[17px] font-bold text-[#0F172A] text-center mb-5 pr-12">
              {method === 'va' ? t('apply.kcp.modal.title') : t('apply.kcp.modal.pgPendingTitle')}
            </h3>

            {method === 'va' ? (
              <div className="space-y-3 text-[13px] text-[#334155] mb-5">
                <div className="flex justify-between gap-3">
                  <span className="text-[#64748B]">{t('apply.kcp.modal.bank')}</span>
                  <span className="font-medium text-[#0F172A] text-right">{bankLabel(bankId)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#64748B]">{t('apply.kcp.modal.account')}</span>
                  <span className="font-medium text-[#0F172A] text-right font-mono text-[12px]">{t('apply.kcp.modal.accountVal')}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#64748B]">{t('apply.kcp.modal.amount')}</span>
                  <span className="font-semibold text-[#0F172A]">{feeLabel}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#64748B]">{t('apply.kcp.modal.deadline')}</span>
                  <span className="font-medium text-[#0F172A] text-right">{t('apply.kcp.modal.deadlineVal')}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-[#64748B]">{t('apply.kcp.modal.holder')}</span>
                  <span className="font-medium text-[#0F172A] text-right">{t('apply.kcp.modal.holderVal')}</span>
                </div>
                <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                  ⚠ {t('apply.kcp.modal.warn')}
                </p>
                <p className="text-[12px] text-[#64748B] text-center pt-1">{t('apply.kcp.modal.sent')}</p>
              </div>
            ) : (
              <p className="text-[13px] text-body mb-5 text-center">{t('apply.kcp.modal.pgPendingBody')}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="flex-1 h-12 rounded-xl text-[14px] font-semibold bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
              >
                {t('apply.kcp.modal.confirm')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/mypage')}
                className="flex-1 h-12 rounded-xl text-[14px] font-medium border border-[#E2E8F0] bg-white text-body hover:bg-[#F8FAFC]"
              >
                {t('apply.kcp.modal.mypage')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
