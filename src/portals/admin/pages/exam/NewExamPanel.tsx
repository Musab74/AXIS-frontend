import { useEffect, useMemo, useState } from 'react';
import { Drawer, Button, pushToast } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  CertLevel,
  CertType,
  ScheduleRow,
  ScheduleStatus,
} from '@admin/services/api';

const EXAM_TIME_SLOTS = [
  '09:00',
  '10:00',
  '11:00',
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
] as const;

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function isoToYmd(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  return toYmd(new Date(iso));
}

function defaultForm() {
  const today = new Date();
  return {
    certType: 'AXIS' as CertType,
    level: 'L3' as CertLevel,
    roundNumber: '',
    registrationStart: toYmd(today),
    registrationEnd: toYmd(addDays(today, 10)),
    examDate: toYmd(addDays(today, 14)),
    examStartTime: '14:00',
    capacity: '300',
    venue: 'ONLINE_CBT',
    status: 'UPCOMING' as ScheduleStatus,
  };
}

function formFromSchedule(row: ScheduleRow) {
  return {
    certType: row.certType,
    level: row.level,
    roundNumber: String(row.roundNumber),
    registrationStart: isoToYmd(row.registrationStart),
    registrationEnd: isoToYmd(row.registrationEnd),
    examDate: isoToYmd(row.examDate),
    examStartTime: row.examStartTime.slice(0, 5),
    capacity: String(row.capacity),
    venue: row.venue || 'ONLINE_CBT',
    status: row.status,
  };
}

type FormState = ReturnType<typeof defaultForm>;

export function NewExamPanel({
  open,
  onClose,
  onSaved,
  schedule = null,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (row: ScheduleRow) => void;
  /** When set, panel runs in edit mode for this schedule. */
  schedule?: ScheduleRow | null;
}) {
  const { t } = useI18n();
  const isEdit = !!schedule;
  const [form, setForm] = useState<FormState>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(schedule ? formFromSchedule(schedule) : defaultForm());
    setError(null);
    setSaving(false);
  }, [open, schedule]);

  const timeOptions = useMemo(() => {
    const set = new Set<string>(EXAM_TIME_SLOTS);
    if (form.examStartTime) set.add(form.examStartTime);
    return Array.from(set).sort();
  }, [form.examStartTime]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async () => {
    if (
      !form.certType ||
      !form.level ||
      !form.registrationStart ||
      !form.registrationEnd ||
      !form.examDate ||
      !form.examStartTime
    ) {
      setError(t('sched.form.required'));
      return;
    }

    const capacity = Number(form.capacity);
    if (!Number.isFinite(capacity) || capacity < 1) {
      setError(t('sched.form.required'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload: Parameters<typeof adminApi.createSchedule>[0] = {
        certType: form.certType,
        level: form.level,
        examDate: form.examDate,
        examStartTime: form.examStartTime,
        registrationStart: form.registrationStart,
        registrationEnd: form.registrationEnd,
        capacity,
        venue: form.venue || 'ONLINE_CBT',
        status: form.status,
      };
      const round = form.roundNumber.trim();
      if (round) {
        const n = Number(round);
        if (!Number.isInteger(n) || n < 1) {
          setError(t('sched.form.required'));
          setSaving(false);
          return;
        }
        payload.roundNumber = n;
      } else if (isEdit) {
        setError(t('sched.form.required'));
        setSaving(false);
        return;
      }

      const res = isEdit && schedule
        ? await adminApi.updateSchedule(schedule.id, payload)
        : await adminApi.createSchedule(payload);
      pushToast(isEdit ? t('sched.form.updateSuccess') : t('sched.form.success'), 'green');
      onSaved(res.data);
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } } };
      const msg = ax?.response?.data?.message;
      const text = Array.isArray(msg)
        ? msg.join(', ')
        : msg || (isEdit ? t('sched.form.updateError') : t('sched.form.error'));
      setError(text);
      pushToast(text, 'red');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? t('sched.edit') : t('sched.new')}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button variant="blue" onClick={handleSubmit} disabled={saving}>
            {saving
              ? isEdit
                ? t('sched.form.updating')
                : t('sched.form.submitting')
              : isEdit
                ? t('common.save')
                : t('sched.form.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sched.form.cert')}>
            <select
              className="axis-input axis-focus w-full"
              value={form.certType}
              onChange={(e) => update('certType', e.target.value as CertType)}
            >
              <option value="AXIS">AXIS</option>
              <option value="AXIS_C">AXIS-C</option>
              <option value="AXIS_H">AXIS-H</option>
            </select>
          </Field>
          <Field label={t('sched.form.level')}>
            <select
              className="axis-input axis-focus w-full"
              value={form.level}
              onChange={(e) => update('level', e.target.value as CertLevel)}
            >
              <option value="L3">{t('sched.form.level.l3')}</option>
              <option value="L2">{t('sched.form.level.l2')}</option>
              <option value="L1">{t('sched.form.level.l1')}</option>
            </select>
          </Field>
        </div>

        <Field label={t('sched.form.round')} hint={isEdit ? undefined : t('sched.form.roundHint')}>
          <input
            className="axis-input axis-focus w-full"
            type="number"
            min={1}
            placeholder={isEdit ? undefined : 'auto'}
            value={form.roundNumber}
            onChange={(e) => update('roundNumber', e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sched.form.regStart')}>
            <input
              className="axis-input axis-focus w-full"
              type="date"
              value={form.registrationStart}
              onChange={(e) => update('registrationStart', e.target.value)}
            />
          </Field>
          <Field label={t('sched.form.regEnd')}>
            <input
              className="axis-input axis-focus w-full"
              type="date"
              value={form.registrationEnd}
              onChange={(e) => update('registrationEnd', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sched.form.examDate')}>
            <input
              className="axis-input axis-focus w-full"
              type="date"
              value={form.examDate}
              onChange={(e) => update('examDate', e.target.value)}
            />
          </Field>
          <Field label={t('sched.form.examTime')}>
            <select
              className="axis-input axis-focus w-full"
              value={form.examStartTime}
              onChange={(e) => update('examStartTime', e.target.value)}
            >
              {timeOptions.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('sched.form.capacity')}>
            <input
              className="axis-input axis-focus w-full"
              type="number"
              min={1}
              value={form.capacity}
              onChange={(e) => update('capacity', e.target.value)}
            />
          </Field>
          <Field label={t('sched.form.venue')}>
            <select
              className="axis-input axis-focus w-full"
              value={form.venue}
              onChange={(e) => update('venue', e.target.value)}
            >
              <option value="ONLINE_CBT">{t('sched.form.venueOnline')}</option>
            </select>
          </Field>
        </div>

        <Field label={t('sched.form.status')}>
          <select
            className="axis-input axis-focus w-full"
            value={form.status}
            onChange={(e) => update('status', e.target.value as ScheduleStatus)}
          >
            <option value="UPCOMING">{t('sched.status.draft')}</option>
            <option value="REGISTRATION_OPEN">{t('sched.status.open')}</option>
            {isEdit && (
              <>
                <option value="REGISTRATION_CLOSED">{t('sched.status.closed')}</option>
                <option value="IN_PROGRESS">{t('sched.status.in_progress')}</option>
                <option value="COMPLETED">{t('sched.status.completed')}</option>
                <option value="CANCELLED">{t('sched.status.cancelled')}</option>
              </>
            )}
          </select>
        </Field>
      </div>
    </Drawer>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-[var(--gray-400)] m-0">{hint}</p>}
    </div>
  );
}

export default NewExamPanel;
