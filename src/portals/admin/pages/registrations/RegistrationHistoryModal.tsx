import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button, pushToast } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi } from '@admin/services/api';
import { AxiosError } from 'axios';

type HistoryRow = {
  id: string;
  actorId: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
};

function actionLabel(
  action: string,
  t: (k: string) => string,
): string {
  if (action === 'REGISTRATION_TICKET_RESEND') return t('reg.history.action.resend');
  if (action === 'REGISTRATION_CANCEL_ADMIN') return t('reg.history.action.cancel');
  if (action === 'REGISTRATION_REFUND_ADMIN') return t('reg.history.action.refund');
  return action;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR');
}

export function RegistrationHistoryModal({
  registrationId,
  title,
  onClose,
}: {
  registrationId: string;
  title: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    adminApi
      .getRegistrationHistory(registrationId)
      .then((res) => {
        if (!cancelled) setRows(res.data);
      })
      .catch((e: AxiosError<{ message?: string }>) => {
        if (cancelled) return;
        const msg = e.response?.data?.message ?? t('reg.history.loadFail');
        setError(msg);
        pushToast(msg, 'red');
      });
    return () => {
      cancelled = true;
    };
  }, [registrationId, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--gray-100)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-[var(--gray-900)]">{t('reg.history.title')}</div>
            <div className="mt-0.5 text-xs text-[var(--gray-500)]">{title}</div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-[var(--gray-400)] hover:bg-[var(--gray-50)] hover:text-[var(--gray-700)]"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {rows === null && !error && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--gray-400)]">
              <Loader2 className="animate-spin" size={16} />
              {t('common.loading')}
            </div>
          )}
          {error && (
            <div className="py-8 text-center text-sm text-[var(--red)]">{error}</div>
          )}
          {rows && rows.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--gray-400)]">{t('reg.history.empty')}</div>
          )}
          {rows && rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-[var(--gray-100)] bg-[var(--gray-50)] px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-[var(--gray-900)]">
                      {actionLabel(r.action, t)}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--gray-400)]">
                      {fmtWhen(r.createdAt)}
                    </span>
                  </div>
                  {r.reason && (
                    <div className="mt-1 text-xs text-[var(--gray-600)]">{r.reason}</div>
                  )}
                  <div className="mt-1 text-[11px] text-[var(--gray-400)] font-mono">
                    actor: {r.actorId}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t border-[var(--gray-100)] px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
