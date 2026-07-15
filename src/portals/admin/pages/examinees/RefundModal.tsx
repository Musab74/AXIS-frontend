import { useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { Button } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  AdminRefundMode,
  ExamineeRegistrationDetail,
  adminApi,
} from '@admin/services/api';

interface RefundModalProps {
  registration: ExamineeRegistrationDetail;
  examineeName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const REFUND_HALF_DAYS = 7;

/** PortOne cancel API bank codes (server SDK), not browser `*_BANK` enums. */
const REFUND_BANKS: { code: string; label: string }[] = [
  { code: 'KOOKMIN', label: 'KB국민은행' },
  { code: 'SHINHAN', label: '신한은행' },
  { code: 'WOORI', label: '우리은행' },
  { code: 'HANA', label: '하나은행' },
  { code: 'IBK', label: 'IBK기업은행' },
  { code: 'NONGHYUP', label: 'NH농협은행' },
  { code: 'KAKAO', label: '카카오뱅크' },
  { code: 'TOSS', label: '토스뱅크' },
];

/**
 * Mirrors the server-side tier math in RegistrationsService.cancelWithRefund
 * so the admin sees the same number the API will charge before they confirm.
 * Returns null when the registration has no confirmed payment to refund.
 */
function computeTieredAmount(reg: ExamineeRegistrationDetail): {
  amount: number;
  tier: 'FULL' | 'HALF' | 'NONE';
} | null {
  const pay = reg.latestPayment;
  if (!pay || pay.status !== 'CONFIRMED') return null;
  const examTime = new Date(reg.schedule.examDate).getTime();
  const now = Date.now();
  // We don't have schedule.registrationEnd in the detail payload — approximate
  // by treating any time before exam-7d as the "FULL" window. The server is
  // the source of truth and will recompute on submit.
  const sevenDaysMark = examTime - REFUND_HALF_DAYS * 24 * 3600 * 1000;
  if (now < sevenDaysMark) {
    // Optimistic UI: show 100% as long as we're outside the 7-day cliff. The
    // server will downgrade to 50% if reg-end has actually passed.
    return { amount: pay.amount, tier: 'FULL' };
  }
  return { amount: 0, tier: 'NONE' };
}

function formatKRW(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString('ko-KR')}원`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function needsRefundAccount(method: string | null | undefined): boolean {
  return method === 'VBANK' || method === 'TRANSFER';
}

export function RefundModal({ registration, examineeName, onClose, onSuccess }: RefundModalProps) {
  const { t } = useI18n();
  const isDemo = registration.latestPayment?.isDemo === true;
  const tiered = useMemo(() => computeTieredAmount(registration), [registration]);
  const fullAmount = registration.latestPayment?.amount ?? 0;
  const payMethod = registration.latestPayment?.method ?? null;
  const requireAccount = needsRefundAccount(payMethod);

  const [mode, setMode] = useState<AdminRefundMode>('TIERED');
  const [reason, setReason] = useState('');
  const [bank, setBank] = useState('SHINHAN');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewAmount = mode === 'FULL' ? fullAmount : (tiered?.amount ?? 0);
  const tierLabel = mode === 'FULL' ? 'ADMIN_FULL' : (tiered?.tier ?? 'NO_PAYMENT');
  const accountRequiredNow = requireAccount && previewAmount > 0;

  const submit = async () => {
    if (isDemo) {
      setError(t('exm.refund.demoBlockedBody'));
      return;
    }
    if (!reason.trim()) {
      setError(t('exm.refund.reasonLabel'));
      return;
    }
    if (accountRequiredNow) {
      if (!bank || !accountNumber.trim() || !holderName.trim()) {
        setError(t('exm.refund.accountRequired'));
        return;
      }
    }
    if (!window.confirm(t('exm.refund.confirm'))) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminApi.adminRefundRegistration(registration.id, {
        mode,
        reason: reason.trim(),
        ...(accountRequiredNow
          ? {
              refundAccount: {
                bank,
                number: accountNumber.replace(/\D+/g, ''),
                holderName: holderName.trim(),
              },
            }
          : {}),
      });
      onSuccess();
    } catch (e) {
      const err = e as { response?: { data?: { message?: string | string[] } } };
      const raw = err.response?.data?.message;
      const msg = Array.isArray(raw) ? raw.join(', ') : raw;
      setError(typeof msg === 'string' && msg ? msg : t('exm.refund.fail'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('exm.refund.title')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {isDemo && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold">{t('exm.refund.demoBlockedTitle')}</div>
                <div className="text-xs mt-0.5 leading-relaxed">{t('exm.refund.demoBlockedBody')}</div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">{t('exm.refund.regNo')}</div>
              <div className="text-slate-800 mt-0.5">{registration.registrationNumber ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('exm.refund.user')}</div>
              <div className="text-slate-800 mt-0.5">{examineeName}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('exm.refund.amount')}</div>
              <div className="text-slate-800 mt-0.5 tabular-nums flex items-center gap-2 flex-wrap">
                {formatKRW(fullAmount)}
                {isDemo && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                    {t('reg.pay.demo')}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('exm.refund.examDate')}</div>
              <div className="text-slate-800 mt-0.5">{formatDate(registration.schedule.examDate)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('exm.refund.payMethod')}</div>
              <div className="text-slate-800 mt-0.5">
                {payMethod ? t(`reg.method.${payMethod}`) : '—'}
              </div>
            </div>
          </div>

          {!isDemo && (
          <>
          <div>
            <div className="text-sm font-medium text-slate-800 mb-2">{t('exm.refund.modeLabel')}</div>
            <div className="space-y-2">
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'TIERED'
                    ? 'border-indigo-300 bg-indigo-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="refund-mode"
                  className="mt-1"
                  checked={mode === 'TIERED'}
                  onChange={() => setMode('TIERED')}
                />
                <div className="flex-1">
                  <div className="text-sm text-slate-900">{t('exm.refund.modeTiered')}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t('exm.refund.modeTieredHint')}</div>
                  {tiered && (
                    <div className="mt-1 text-xs text-slate-700 tabular-nums">
                      → {formatKRW(tiered.amount)} ({t(`exm.refund.tier.${tiered.tier}`)})
                    </div>
                  )}
                </div>
              </label>
              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'FULL'
                    ? 'border-indigo-300 bg-indigo-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="refund-mode"
                  className="mt-1"
                  checked={mode === 'FULL'}
                  onChange={() => setMode('FULL')}
                />
                <div className="flex-1">
                  <div className="text-sm text-slate-900">{t('exm.refund.modeFull')}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{t('exm.refund.modeFullHint')}</div>
                  <div className="mt-1 text-xs text-slate-700 tabular-nums">
                    → {formatKRW(fullAmount)} ({t('exm.refund.tier.ADMIN_FULL')})
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">{t('exm.refund.previewAmount')}</span>
            <span className="text-base font-semibold text-slate-900 tabular-nums">
              {formatKRW(previewAmount)}{' '}
              <span className="text-xs text-slate-500 font-normal">({t(`exm.refund.tier.${tierLabel}`)})</span>
            </span>
          </div>

          {accountRequiredNow && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <div className="text-sm font-medium text-slate-800">{t('exm.refund.accountTitle')}</div>
              <p className="text-xs text-slate-600">{t('exm.refund.accountHint')}</p>
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('exm.refund.accountBank')}</label>
                <select
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
                >
                  {REFUND_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('exm.refund.accountNumber')}</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder="1234567890123"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">{t('exm.refund.accountHolder')}</label>
                <input
                  type="text"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                  placeholder={examineeName}
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-800 block mb-1">
              {t('exm.refund.reasonLabel')}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder={t('exm.refund.reasonPlaceholder')}
            />
          </div>
          </>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('exm.refund.cancel')}
          </Button>
          {!isDemo && (
            <Button
              variant="danger"
              onClick={submit}
              disabled={
                submitting ||
                !reason.trim() ||
                (accountRequiredNow && (!accountNumber.trim() || !holderName.trim()))
              }
            >
              {t('exm.refund.execute')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RefundModal;
