import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { ScheduleCalendarView } from '@admin/pages/exam/ScheduleCalendarView';
import { NewExamPanel } from '@admin/pages/exam/NewExamPanel';
import { ScheduleDetailPanel } from '@admin/pages/exam/ScheduleDetailPanel';
import { OnDemandSettingsPanel } from '@admin/pages/exam/OnDemandSettingsPanel';
import {
  Card,
  PageHeader,
  Button,
  FilterBar,
  Pagination,
  Select,
  Search,
  Tabs,
  TabItem,
  TableWrap,
  Table,
  Th,
  Td,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  ScheduleRow,
  ScheduleStatus,
  CertType,
  CertLevel,
} from '@admin/services/api';

type ChipTone = 'gray' | 'blue' | 'orange' | 'red' | 'green' | 'teal';

const STATUS_TONE: Record<ScheduleStatus, { tone: ChipTone; key: string }> = {
  UPCOMING: { tone: 'gray', key: 'sched.status.draft' },
  REGISTRATION_OPEN: { tone: 'blue', key: 'sched.status.open' },
  REGISTRATION_CLOSED: { tone: 'orange', key: 'sched.status.closed' },
  IN_PROGRESS: { tone: 'red', key: 'sched.status.in_progress' },
  COMPLETED: { tone: 'teal', key: 'sched.status.completed' },
  CANCELLED: { tone: 'gray', key: 'sched.status.cancelled' },
};

/** Official fixed rounds use 1–999; on-demand / rolling slots use 1001+. */
const ON_DEMAND_ROUND_MIN = 1001;
const SEAT_POLL_MS = 20_000;

function certLabel(c: CertType): string {
  return c === 'AXIS_C' ? 'AXIS-C' : c === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function fmtExamDateTime(r: ScheduleRow): string {
  const d = new Date(r.examDate);
  const ymd = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return `${ymd} ${r.examStartTime}`;
}

type ViewMode = 'list' | 'calendar';
type KindFilter = 'rounds' | 'ondemand';
const PAGE_SIZE = 20;

export function ScheduleScreen() {
  const { t } = useI18n();
  const [view, setView] = useState<ViewMode>('calendar');
  const [kind, setKind] = useState<KindFilter>('rounds');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);
  const [detail, setDetail] = useState<ScheduleRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<{
    certType?: CertType;
    level?: CertLevel;
    status?: ScheduleStatus;
    year?: string;
    q?: string;
  }>({});

  useEffect(() => {
    let cancelled = false;
    const load = (silent = false) => {
      if (!silent) {
        setRows(null);
        setError(null);
      }
      adminApi
        .getSchedules({
          certType: filter.certType,
          level: filter.level,
          status: filter.status,
        })
        .then((res) => {
          if (!cancelled) setRows(res.data);
        })
        .catch((e) => {
          if (!cancelled && !silent) {
            setError(e?.response?.data?.message ?? 'Failed to load schedules');
          }
        });
    };
    load(false);
    const timer = window.setInterval(() => load(true), SEAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [filter.certType, filter.level, filter.status, reloadKey]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      const isOnDemand = r.roundNumber >= ON_DEMAND_ROUND_MIN;
      if (kind === 'ondemand' && !isOnDemand) return false;
      if (kind === 'rounds' && isOnDemand) return false;
      if (filter.year && String(r.year) !== filter.year) return false;
      if (filter.q) {
        const hay = `${certLabel(r.certType)} ${r.level} ${r.year} ${r.roundNumber} ${r.venue}`.toLowerCase();
        if (!hay.includes(filter.q.toLowerCase())) return false;
      }
      return true;
    });
  }, [rows, filter.q, filter.year, kind]);

  const calendarDate = useMemo(() => {
    if (!filter.year) return new Date();
    return new Date(Number(filter.year), 0, 1);
  }, [filter.year]);

  useEffect(() => {
    setPage(1);
  }, [filter.certType, filter.level, filter.status, filter.year, filter.q, view, kind]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const kindTabs: TabItem<KindFilter>[] = [
    { id: 'rounds', label: t('sched.kind.rounds') },
    { id: 'ondemand', label: t('sched.kind.ondemand') },
  ];

  const tabs: TabItem<ViewMode>[] = [
    { id: 'calendar', label: t('sched.view.calendar') },
    { id: 'list', label: t('sched.view.list') },
  ];

  const openCreate = () => {
    setDetail(null);
    setEditing(null);
    setFormOpen(true);
  };

  const openDetail = (row: ScheduleRow) => {
    setFormOpen(false);
    setEditing(null);
    setDetail(row);
  };

  const openEdit = (row: ScheduleRow) => {
    setDetail(null);
    setEditing(row);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <div>
      <PageHeader
        title={t('page.schedule.title')}
        subtitle={`${t('page.schedule.sub')}${t('sched.subSuffix', { n: filtered.length })}`}
        actions={
          <Button variant="blue" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" /> {t('sched.new')}
          </Button>
        }
      />

      <Tabs tabs={kindTabs} active={kind} onChange={setKind} />

      {kind === 'ondemand' && <OnDemandSettingsPanel />}

      <Tabs tabs={tabs} active={view} onChange={setView} />

      <FilterBar>
        <Select
          value={filter.certType ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, certType: (e.target.value as CertType) || undefined }))
          }
        >
          <option value="">{t('common.cert')} {t('common.all')}</option>
          <option value="AXIS">AXIS</option>
          <option value="AXIS_C">AXIS-C</option>
          <option value="AXIS_H">AXIS-H</option>
        </Select>
        <Select
          value={filter.level ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, level: (e.target.value as CertLevel) || undefined }))
          }
        >
          <option value="">{t('common.level')} {t('common.all')}</option>
          <option value="L3">L3</option>
          <option value="L2">L2</option>
          <option value="L1">L1</option>
        </Select>
        <Select
          value={filter.status ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, status: (e.target.value as ScheduleStatus) || undefined }))
          }
        >
          <option value="">{t('common.status')} {t('common.all')}</option>
          <option value="UPCOMING">{t('sched.status.draft')}</option>
          <option value="REGISTRATION_OPEN">{t('sched.status.open')}</option>
          <option value="REGISTRATION_CLOSED">{t('sched.status.closed')}</option>
          <option value="IN_PROGRESS">{t('sched.status.in_progress')}</option>
          <option value="COMPLETED">{t('sched.status.completed')}</option>
          <option value="CANCELLED">{t('sched.status.cancelled')}</option>
        </Select>
        <Select value={filter.year ?? ''} onChange={(e) => setFilter((f) => ({ ...f, year: e.target.value || undefined }))}>
          <option value="">{t('sched.year', { y: new Date().getFullYear() })}</option>
          <option value={String(new Date().getFullYear() - 1)}>{t('sched.year', { y: new Date().getFullYear() - 1 })}</option>
        </Select>
        <Search
          placeholder={t('sched.searchPlaceholder')}
          value={filter.q ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
        />
      </FilterBar>

      {error && <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>}

      {view === 'list' ? (
        <>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t('sched.col.round')}</Th>
                  <Th>{t('sched.col.cert')}</Th>
                  <Th>{t('sched.col.level')}</Th>
                  <Th>{t('sched.col.regPeriod')}</Th>
                  <Th>{t('sched.col.datetime')}</Th>
                  <Th align="right">{t('sched.col.cap')}</Th>
                  <Th>{t('sched.col.seatsLeft')}</Th>
                  <Th>{t('sched.col.regProgress')}</Th>
                  <Th>{t('sched.col.statusH')}</Th>
                  <Th align="right">{t('sched.col.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows === null && (
                  <tr>
                    <Td colSpan={10} className="!text-center !text-[var(--gray-400)] !py-12">
                      {t('common.loading')}
                    </Td>
                  </tr>
                )}
                {rows !== null && filtered.length === 0 && (
                  <tr>
                    <Td colSpan={10} className="!text-center !text-[var(--gray-400)] !py-12">
                      {t('common.empty')}
                    </Td>
                  </tr>
                )}
                {pagedRows.map((r) => {
                  const cfg = STATUS_TONE[r.status];
                  const remaining = Math.max(0, r.capacity - r.currentCount);
                  const regPct =
                    r.capacity > 0 ? Math.round((r.currentCount / r.capacity) * 100) : null;
                  return (
                    <tr key={r.id} className="hover:bg-[var(--gray-50)]">
                      <Td strong>{t('common.roundLabel', { n: r.roundNumber })}</Td>
                      <Td strong>{certLabel(r.certType)}</Td>
                      <Td strong>{r.level}</Td>
                      <Td className="tabular-nums">
                        {fmtDate(r.registrationStart)}~{fmtDate(r.registrationEnd)}
                      </Td>
                      <Td className="tabular-nums">{fmtExamDateTime(r)}</Td>
                      <Td align="right" className="tabular-nums">
                        {r.capacity.toLocaleString()}
                      </Td>
                      <Td className="tabular-nums">
                        <span className={remaining <= 5 ? 'text-[var(--red)]' : 'text-[var(--gray-700)]'}>
                          {remaining.toLocaleString()}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-[12px] text-[var(--gray-500)] tabular-nums">
                          {r.currentCount.toLocaleString()}
                          {regPct != null ? ` (${regPct}%)` : ''}
                        </span>
                      </Td>
                      <Td className={cfg.tone === 'red' ? 'text-[var(--red)]' : cfg.tone === 'blue' ? 'text-[var(--blue)]' : cfg.tone === 'orange' ? 'text-[var(--orange)]' : cfg.tone === 'teal' ? 'text-[var(--teal)]' : 'text-[var(--gray-600)]'}>
                        {t(cfg.key)}
                      </Td>
                      <Td align="right">
                        <Button size="sm" variant="blue" className="mr-2" onClick={() => openDetail(r)}>
                          {t('common.detailBtn')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => openEdit(r)}>
                          {t('common.editBtn')}
                        </Button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} />
        </>
      ) : (
        <ScheduleCalendarView
          rows={filtered}
          focusDate={calendarDate}
          onSelectSchedule={openDetail}
        />
      )}

      <ScheduleDetailPanel
        schedule={detail}
        onClose={() => setDetail(null)}
        onEdit={openEdit}
      />

      <NewExamPanel
        open={formOpen}
        schedule={editing}
        onClose={closeForm}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

export default ScheduleScreen;
