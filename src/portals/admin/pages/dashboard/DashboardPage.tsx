import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  RefreshCw,
  Download,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import {
  Card,
  CardHeader,
  PageHeader,
  Button,
  CertTag,
  certCodeOf,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { MiniScheduleCalendar } from '@admin/pages/dashboard/MiniScheduleCalendar';
import {
  adminApi,
  DashboardStats,
  LiveSummary,
  PassRateStats,
  ScheduleRow,
  triggerBlobDownload,
} from '@admin/services/api';
import { sessionCanAccessAdminPage } from '@admin/adminRoutes';
import { AxiosError } from 'axios';

const WEEKDAY_KEYS = [
  'dash.weekday.sun',
  'dash.weekday.mon',
  'dash.weekday.tue',
  'dash.weekday.wed',
  'dash.weekday.thu',
  'dash.weekday.fri',
  'dash.weekday.sat',
];

function formatToday(t: (k: string, vars?: Record<string, string | number>) => string): string {
  const d = new Date();
  const w = t(WEEKDAY_KEYS[d.getDay()]);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return t('dash.dateLine', {
    y: d.getFullYear(),
    m: d.getMonth() + 1,
    d: d.getDate(),
    w,
    hh,
    mm,
  });
}

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function scheduleYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function countTodayBuckets(schedules: ScheduleRow[]): {
  inProgress: number;
  upcoming: number;
  completed: number;
} {
  const day = todayYmd();
  let inProgress = 0;
  let upcoming = 0;
  let completed = 0;
  for (const s of schedules) {
    if (scheduleYmd(s.examDate) !== day) continue;
    if (s.status === 'IN_PROGRESS') inProgress += 1;
    else if (s.status === 'COMPLETED' || s.status === 'CANCELLED') completed += 1;
    else upcoming += 1; // UPCOMING / REGISTRATION_* on today's date
  }
  return { inProgress, upcoming, completed };
}

type PendingItem = {
  id: string;
  labelKey: string;
  count: number;
  onJump?: () => void;
};

export function DashboardScreen({
  onJumpToMonitoring,
  onJumpToStats,
  onJumpToSchedule,
  onJumpToGrading,
  onJumpToRefunds,
  onJumpToEligibility,
  onJumpToObjections,
}: {
  onJumpToMonitoring: () => void;
  onJumpToStats: () => void;
  onJumpToSchedule: () => void;
  onJumpToGrading: () => void;
  onJumpToRefunds: () => void;
  onJumpToEligibility: () => void;
  onJumpToObjections: () => void;
}) {
  const { t } = useI18n();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [passRate, setPassRate] = useState<PassRateStats | null>(null);
  const [live, setLive] = useState<LiveSummary | null>(null);
  const [todayBuckets, setTodayBuckets] = useState({ inProgress: 0, upcoming: 0, completed: 0 });
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const refresh = () => {
    setLoading(true);

    const core = Promise.all([
      adminApi.getAdminDashboard(),
      adminApi.getMonitorSummary(),
      adminApi.getAdminPassRate(),
      adminApi.getSchedules().catch(() => ({ data: [] as ScheduleRow[] })),
    ]);

    const optional: Promise<void>[] = [];

    let gradingPending = 0;
    let refundPending: number | null = null;
    let eligibilityPending: number | null = null;
    let objectionPending: number | null = null;

    if (sessionCanAccessAdminPage('grading')) {
      optional.push(
        adminApi
          .getGradingCounts()
          .then((r) => {
            gradingPending = (r.data.aiDone ?? 0) + (r.data.reviewing ?? 0) + (r.data.overdue ?? 0);
          })
          .catch(() => undefined),
      );
    }
    if (sessionCanAccessAdminPage('refund-requests')) {
      optional.push(
        adminApi
          .getRefundRequestCounts()
          .then((r) => {
            refundPending = r.data.pending ?? 0;
          })
          .catch(() => undefined),
      );
    }
    if (sessionCanAccessAdminPage('eligibility')) {
      optional.push(
        adminApi
          .getEligibilityCounts()
          .then((r) => {
            eligibilityPending = r.data.pending ?? 0;
          })
          .catch(() => undefined),
      );
    }
    if (sessionCanAccessAdminPage('objections')) {
      optional.push(
        adminApi
          .getObjectionCounts()
          .then((r) => {
            objectionPending = r.data.pending ?? 0;
          })
          .catch(() => undefined),
      );
    }

    Promise.all([core, Promise.all(optional)])
      .then(([[s, l, p, schedules]]) => {
        setStats(s.data);
        setLive(l.data);
        setPassRate(p.data);
        setTodayBuckets(countTodayBuckets(schedules.data ?? []));

        const next: PendingItem[] = [];
        if (sessionCanAccessAdminPage('grading')) {
          next.push({
            id: 'grading',
            labelKey: 'dash.pending.grading',
            count: gradingPending || (s.data.gradingDonut.waiting + s.data.gradingDonut.reviewing),
            onJump: onJumpToGrading,
          });
        }
        if (refundPending != null) {
          next.push({
            id: 'refunds',
            labelKey: 'dash.pending.refunds',
            count: refundPending,
            onJump: onJumpToRefunds,
          });
        }
        if (eligibilityPending != null) {
          next.push({
            id: 'eligibility',
            labelKey: 'dash.pending.eligibility',
            count: eligibilityPending,
            onJump: onJumpToEligibility,
          });
        }
        if (objectionPending != null) {
          next.push({
            id: 'objections',
            labelKey: 'dash.pending.objections',
            count: objectionPending,
            onJump: onJumpToObjections,
          });
        }
        next.push({
          id: 'alerts',
          labelKey: 'dash.pending.alerts',
          count: l.data.warnings ?? 0,
          onJump: onJumpToMonitoring,
        });
        setPending(next);
        setError(null);
      })
      .catch((e) => setError(e?.response?.data?.message ?? 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const int = setInterval(refresh, 30_000);
    return () => clearInterval(int);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDailyReport = async () => {
    setExporting(true);
    try {
      const day = todayYmd();
      const res = await adminApi.downloadGradingStatus({ from: day, to: day });
      triggerBlobDownload(res.data, `daily-report_${day}.xlsx`);
      pushToast(t('dash.reportOk'), 'green');
    } catch (e) {
      const msg =
        e instanceof AxiosError && typeof e.response?.data?.message === 'string'
          ? e.response.data.message
          : t('dash.reportFailed');
      pushToast(msg, 'red');
    } finally {
      setExporting(false);
    }
  };

  const fmtNum = (n: number) => n.toLocaleString();

  const todayInProgress = live?.takers ?? 0;
  const todayWarnings = live?.warnings ?? 0;
  const gradedCompleted = stats?.gradingDonut.completed ?? 0;
  const gradingPendingCount = stats ? stats.gradingDonut.reviewing + stats.gradingDonut.waiting : '—';

  const passRateSummary = useMemo(
    () =>
      (passRate?.byCert ?? []).map((c) => ({
        cert: c.certType,
        registered: c.registered,
        passed: c.passed,
      })),
    [passRate],
  );

  const pendingTotal = pending.reduce((n, p) => n + p.count, 0);

  return (
    <div>
      <PageHeader
        title={t('page.dashboard.title')}
        subtitle={`${t('dash.todaysOps')} · ${formatToday(t)} · ${t('dash.autoRefresh')}`}
        actions={
          <>
            <Button variant="secondary" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
            <Button variant="secondary" onClick={onDailyReport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {t('dash.dailyReport')}
            </Button>
          </>
        }
      />

      {error && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>
      )}

      {/* Today's exam status buckets */}
      <div className="mb-4 rounded-xl border border-[var(--gray-border)] bg-[var(--gray-50)] px-4 py-3">
        <div className="mb-2 text-[12px] font-semibold text-[var(--gray-500)]">{t('dash.todayStatus')}</div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { key: 'dash.today.inProgress', value: todayBuckets.inProgress, tone: 'text-[var(--blue)]' },
              { key: 'dash.today.upcoming', value: todayBuckets.upcoming, tone: 'text-[var(--gray-900)]' },
              { key: 'dash.today.completed', value: todayBuckets.completed, tone: 'text-[var(--gray-600)]' },
            ] as const
          ).map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={onJumpToSchedule}
              className="rounded-lg bg-white px-3 py-2 text-left border border-[var(--gray-100)] hover:border-[var(--gray-border)]"
            >
              <div className="text-[11px] text-[var(--gray-500)]">{t(b.key)}</div>
              <div className={`mt-1 text-[20px] font-bold tabular-nums ${b.tone}`}>{fmtNum(b.value)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Pending inbox */}
      <Card className="mb-5">
        <CardHeader
          title={t('dash.pendingInbox')}
          right={
            <span className="text-[12px] text-[var(--gray-500)] tabular-nums">
              {fmtNum(pendingTotal)}
            </span>
          }
        />
        <div className="px-[18px] pb-4">
          {pending.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--gray-400)]">{t('dash.pending.empty')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {pending.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onJump}
                  disabled={!item.onJump}
                  className="flex items-center justify-between rounded-lg border border-[var(--gray-100)] bg-white px-3 py-2.5 text-left hover:border-[var(--gray-border)] disabled:cursor-default"
                >
                  <span className="text-[13px] text-[var(--gray-700)]">{t(item.labelKey)}</span>
                  <span
                    className={[
                      'text-[16px] font-bold tabular-nums',
                      item.count > 0 ? 'text-[var(--red)]' : 'text-[var(--gray-400)]',
                    ].join(' ')}
                  >
                    {fmtNum(item.count)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* KPI grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3.5 mb-5">
        <SimpleKpiCard
          label={t('dash.kpi.todayTakers')}
          value={live ? fmtNum(todayInProgress) : '—'}
          unit={t('unit.people')}
          meta={
            <>
              {t('dash.inProgress')}{' '}
              <span className="font-medium text-[var(--gray-900)]">{fmtNum(todayInProgress)}</span>
              {' · '}
              {t('dash.kpi.cheatAlerts')}{' '}
              <span className="font-medium text-[var(--red)]">{fmtNum(todayWarnings)}</span>
            </>
          }
          onClick={onJumpToMonitoring}
        />
        <SimpleKpiCard
          label={t('dash.kpi.monthReg')}
          value={stats ? fmtNum(stats.monthlyRegistrations) : '—'}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--gray-900)]">{fmtNum(stats?.monthlyRegistrations ?? 0)}</span>{' '}
              {t('dash.kpi.monthReg')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('dash.kpi.gradingPending')}
          value={gradingPendingCount}
          unit={t('unit.cases')}
          meta={
            <>
              {t('grade.kpi.aiQueue')}{' '}
              <span className="font-medium text-[var(--gray-900)]">{stats?.gradingDonut.waiting ?? '—'}</span> ·{' '}
              {t('grade.kpi.reviewNeeded')}{' '}
              <span className="font-medium text-[var(--orange)]">{stats?.gradingDonut.reviewing ?? '—'}</span>
              {' · '}
              {t('dash.completed')}{' '}
              <span className="font-medium text-[var(--blue)]">{fmtNum(gradedCompleted)}</span>
            </>
          }
          onClick={sessionCanAccessAdminPage('grading') ? onJumpToGrading : undefined}
        />
        <SimpleKpiCard
          label={t('dash.kpi.cheatAlerts')}
          value={fmtNum(todayWarnings)}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--red)]">{t('dash.todayOccurred')}</span> · {t('dash.confirm')}
            </>
          }
          onClick={onJumpToMonitoring}
        />
      </div>

      {/* live / pass-rate / upcoming row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1.15fr_0.7fr] gap-3.5 mb-4">
        {/* live exams */}
        <Card>
          <CardHeader
            title={<>{t('dash.activeExam')}</>}
            right={<span className="text-[11px] text-[var(--gray-400)]">{t('dash.live30s')}</span>}
          />
          <div className="px-[18px] pt-1 pb-1">
            {live?.inProgress ? (
              <LiveExamRow
                name={live.examName ?? ''}
                takers={live.takers}
                started=""
                remaining={null}
                onMonitor={onJumpToMonitoring}
              />
            ) : (
              <div className="py-12 text-center text-sm text-[var(--gray-400)]">{t('dash.noActiveExam')}</div>
            )}
          </div>
        </Card>

        {/* pass rates */}
        <Card>
          <CardHeader
            title={t('dash.passRateSummary')}
            right={
              <button
                type="button"
                onClick={onJumpToStats}
                className="text-[12px] text-[var(--gray-500)] hover:text-[var(--primary)]"
              >
                {t('common.statsDetail')}
              </button>
            }
          />
          <div className="px-[18px] pb-[10px]">
            {passRate === null ? (
              <div className="py-6 text-center text-sm text-[var(--gray-400)]">{t('common.loading')}</div>
            ) : passRateSummary.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--gray-400)]">{t('common.empty')}</div>
            ) : (
              passRateSummary.map((r) => {
                const rate =
                  r.registered > 0 ? Number(((r.passed / r.registered) * 100).toFixed(1)) : null;

                return (
                  <div
                    key={r.cert}
                    className="flex items-center justify-between gap-3 border-b border-[var(--gray-100)] py-3 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[13px] leading-none">
                        <CertTag code={certCodeOf(r.cert)} />
                      </div>
                      <div className="mt-1 text-[12px] text-[var(--gray-500)]">
                        {t('dash.col.registered')} {r.registered} · {t('dash.col.passed')} {r.passed}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-[18px] font-extrabold tabular-nums text-[var(--primary)]">
                        {rate != null ? `${rate}%` : '—'}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* upcoming exams */}
        <Card>
          <CardHeader
            title={
              <>
                {t('dash.upcoming')}{' '}
                <span className="text-[11px] text-[var(--gray-400)] font-medium">
                  {t('dash.alerts.within7d')}
                </span>
              </>
            }
            right={
              <button
                type="button"
                onClick={onJumpToSchedule}
                className="text-[12px] text-[var(--gray-500)] hover:text-[var(--primary)]"
              >
                {t('common.viewAll')}
              </button>
            }
          />
          <div className="px-[18px] pt-1 pb-[18px]">
            {stats === null ? (
              <div className="py-6 text-center text-sm text-[var(--gray-400)]">{t('common.loading')}</div>
            ) : (
              <MiniScheduleCalendar exams={stats.upcomingExams} focusDate={new Date()} />
            )}
          </div>
        </Card>
      </div>

      {/* Real analytics live under Stats — avoid a fake empty 30-day chart here */}
    </div>
  );
}

function LiveExamRow({
  name,
  takers,
  started,
  remaining,
  onMonitor,
}: {
  name: string;
  takers: number;
  started: string;
  remaining: number | null;
  onMonitor: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-4 py-3 border-b border-[var(--gray-100)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-[var(--primary)] truncate">{name}</div>
        <div className="text-[12px] text-[var(--gray-500)] mt-0.5">
          {t('dash.takers.line', { n: takers })}
          {started ? t('dash.takers.startedSuffix', { t: started }) : ''}
          {remaining != null ? t('dash.takers.remainingSuffix', { t: remaining }) : ''}
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={onMonitor}>
        {t('dash.gotoMonitor')} <ArrowRight className="w-3 h-3" />
      </Button>
    </div>
  );
}

export default DashboardScreen;

function SimpleKpiCard({
  label,
  value,
  unit,
  meta,
  onClick,
}: {
  label: string;
  value: string | number;
  unit?: string;
  meta: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Card
      className={[
        'px-5 py-4 ',
        onClick ? 'cursor-pointer transition-shadow hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)]' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="w-full text-left disabled:cursor-default"
      >
        <div className="text-[13px] font-medium text-[var(--gray-500)]">
          <span>{label}</span>
        </div>
        <div className="mt-3 flex items-end gap-1.5">
          <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--gray-900)] tabular-nums">
            {value}
          </span>
          {unit ? (
            <span className="pb-0.5 text-[13px] font-medium text-[var(--gray-500)]">{unit}</span>
          ) : null}
        </div>
        <div className="mt-2 text-[12px] text-[var(--gray-500)]">{meta}</div>
      </button>
    </Card>
  );
}
