import { useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button, Modal, pushToast } from './ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi } from '@admin/services/api';
import { isSuperAdmin } from '@admin/utils/auth';

type PiiField = 'phone' | 'birthDate';

/**
 * One reveal per member covers both fields (phone + birth date) and is
 * audit-logged once, so cache the raw values for the rest of the session.
 */
const revealCache = new Map<string, { phone: string; birthDate: string | null }>();

/**
 * Renders a server-masked PII value (e.g. 010****7878 / 1995****). For
 * SUPER_ADMIN it becomes clickable: a modal asks for a reason, the reason is
 * stored in the audit log, and the raw value replaces the mask.
 */
export function MaskedPii({
  userDbId,
  field,
  value,
}: {
  userDbId: string;
  field: PiiField;
  value: string | null | undefined;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);

  if (!value) return <>—</>;

  const revealed = revealCache.get(userDbId);
  if (revealed) return <span className="tabular-nums">{revealed[field] ?? '—'}</span>;
  if (!isSuperAdmin()) return <span className="tabular-nums">{value}</span>;

  const canSubmit = reason.trim().length >= 2 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await adminApi.revealUserPii(userDbId, reason.trim());
      revealCache.set(userDbId, res.data);
      setOpen(false);
      setReason('');
      bump((n) => n + 1);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response
        ?.data?.message;
      pushToast(Array.isArray(msg) ? msg.join(', ') : msg || t('pii.reveal.fail'), 'red');
    } finally {
      setBusy(false);
    }
  };

  return (
    // Rows using this cell have their own onClick (open detail / toggle) —
    // keep every click inside the reveal flow from bubbling into them.
    <span onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('pii.reveal.tooltip')}
        className="axis-focus inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-inherit hover:bg-[var(--blue-50)] hover:text-[var(--blue)] transition-colors"
      >
        <span className="tabular-nums">{value}</span>
        <Eye className="h-3.5 w-3.5 opacity-60" />
      </button>

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={t('pii.reveal.title')}
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} disabled={!canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              {t('pii.reveal.submit')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-[var(--gray-600)] mb-3">{t('pii.reveal.desc')}</p>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-[var(--gray-600)]">
            {t('pii.reveal.reason')} *
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('pii.reveal.placeholder')}
            rows={3}
            maxLength={500}
            autoFocus
            className="axis-focus w-full rounded-lg border border-[var(--gray-border)] bg-white px-2.5 py-[7px] text-[14px] text-[var(--gray-700)] outline-none transition-shadow focus:border-[var(--blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] resize-none"
          />
        </label>
      </Modal>
    </span>
  );
}
