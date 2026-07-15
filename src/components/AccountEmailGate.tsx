import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Mail, Loader2, Info } from 'lucide-react';
import { isAxiosError } from 'axios';
import { userApi } from '@/services/api';
import { useI18n } from '@/i18n';

/**
 * Account email gate.
 *
 * Email became mandatory at signup, but accounts created before that have none —
 * and we cannot send those candidates a payment receipt or, worse, the warning that
 * their exam window is about to close. This dialog blocks the app until they supply
 * one. It is the mechanism that eventually lets `users.email` become NOT NULL.
 *
 * Deliberately NOT shown on the exam routes. A candidate mid-exam is being proctored
 * and on a hard clock; throwing an undismissable dialog over the top of that would
 * cost them the attempt. The payment path is separately gated server-side
 * (EMAIL_REQUIRED), so a no-email user still cannot pay their way past this — the
 * worst case is that they finish an already-paid exam and get prompted afterwards.
 */
const EXEMPT_PREFIXES = [
  '/cbt/exam',
  '/demo',
  '/proctor',
  '/verify',
  '/env-check',
  '/exam-ready',
  '/login',
  '/signup',
  '/forgot-password',
];

export function AccountEmailGate() {
  const { t } = useI18n();
  const location = useLocation();
  const [needsEmail, setNeedsEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const exempt = EXEMPT_PREFIXES.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (exempt) return;
    if (!localStorage.getItem('accessToken')) return;
    let cancelled = false;
    userApi
      .getProfile()
      .then((r) => {
        if (cancelled) return;
        setNeedsEmail((r.data as { mustAddEmail?: boolean }).mustAddEmail === true);
      })
      // A failed profile fetch (401/offline) must not wedge a dialog over the app.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exempt, location.pathname]);

  if (!needsEmail || exempt) return null;

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await userApi.updateProfile({ email: email.trim().toLowerCase() });
      setNeedsEmail(false);
    } catch (err: unknown) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const msg = isAxiosError(err)
        ? (err.response?.data as { message?: string | string[] } | undefined)?.message
        : undefined;
      setError(
        status === 409
          ? t('emailGate.taken' as never)
          : (Array.isArray(msg) ? msg.join(', ') : msg) || t('emailGate.failed' as never),
      );
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl break-keep sm:p-8">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary/10">
          <Mail className="h-6 w-6 text-brand-primary" strokeWidth={2.2} />
        </div>
        <h2 className="text-xl font-extrabold text-text-strong">{t('emailGate.title' as never)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">
          {t('emailGate.body' as never)}
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5">
          <label htmlFor="gate-email" className="form-label">
            {t('emailGate.label' as never)}
          </label>
          <input
            id="gate-email"
            type="email"
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError('');
            }}
            placeholder={t('emailGate.placeholder' as never)}
            // 16px min on mobile so iOS Safari does not zoom the viewport on focus.
            className="w-full rounded-lg border border-border-default px-4 py-3 text-base outline-none focus:border-brand-primary"
          />
          {error && (
            <div role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-status-danger">
              <Info className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span>{error}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={!valid || busy}
            className="mt-5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand-primary px-4 py-3 font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('emailGate.submit' as never)}
          </button>
        </form>
      </div>
    </div>
  );
}
