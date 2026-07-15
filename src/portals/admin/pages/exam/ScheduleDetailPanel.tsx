import { Drawer, Button } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { CertType, ScheduleRow, ScheduleStatus } from '@admin/services/api';

const STATUS_KEY: Record<ScheduleStatus, string> = {
  UPCOMING: 'sched.status.draft',
  REGISTRATION_OPEN: 'sched.status.open',
  REGISTRATION_CLOSED: 'sched.status.closed',
  IN_PROGRESS: 'sched.status.in_progress',
  COMPLETED: 'sched.status.completed',
  CANCELLED: 'sched.status.cancelled',
};

function certLabel(c: CertType): string {
  return c === 'AXIS_C' ? 'AXIS-C' : c === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

function fmtYmd(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${y}.${m}.${d}`;
  }
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function fmtExamDateTime(r: ScheduleRow): string {
  return `${fmtYmd(r.examDate)} ${r.examStartTime.slice(0, 5)}`;
}

export function ScheduleDetailPanel({
  schedule,
  onClose,
  onEdit,
}: {
  schedule: ScheduleRow | null;
  onClose: () => void;
  onEdit: (row: ScheduleRow) => void;
}) {
  const { t } = useI18n();
  const open = !!schedule;
  const regPct =
    schedule && schedule.capacity > 0
      ? Math.round((schedule.currentCount / schedule.capacity) * 100)
      : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t('sched.detail.title')}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {schedule && (
            <Button
              variant="blue"
              onClick={() => {
                onEdit(schedule);
              }}
            >
              {t('common.editBtn')}
            </Button>
          )}
        </>
      }
    >
      {schedule && (
        <div className="space-y-4">
          <Row label={t('sched.col.cert')} value={certLabel(schedule.certType)} />
          <Row label={t('sched.col.level')} value={schedule.level} />
          <Row
            label={t('sched.col.round')}
            value={t('common.roundLabel', { n: schedule.roundNumber })}
          />
          <Row
            label={t('sched.col.regPeriod')}
            value={`${fmtYmd(schedule.registrationStart)} ~ ${fmtYmd(schedule.registrationEnd)}`}
          />
          <Row label={t('sched.col.datetime')} value={fmtExamDateTime(schedule)} />
          <Row
            label={t('sched.col.cap')}
            value={`${schedule.capacity.toLocaleString()}${t('sched.cap.suffix')}`}
          />
          <Row
            label={t('sched.col.seatsLeft')}
            value={Math.max(0, schedule.capacity - schedule.currentCount).toLocaleString()}
          />
          <Row
            label={t('sched.col.regProgress')}
            value={`${schedule.currentCount.toLocaleString()}${regPct != null ? ` (${regPct}%)` : ''}`}
          />
          <Row label={t('sched.form.venue')} value={schedule.venue === 'ONLINE_CBT' ? t('sched.form.venueOnline') : schedule.venue} />
          <Row label={t('sched.col.statusH')} value={t(STATUS_KEY[schedule.status])} />
        </div>
      )}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--gray-100)] pb-3 last:border-0 last:pb-0">
      <span className="text-[12px] font-semibold text-[var(--gray-500)] shrink-0">{label}</span>
      <span className="text-[13px] text-[var(--gray-800)] text-right tabular-nums">{value}</span>
    </div>
  );
}

export default ScheduleDetailPanel;
