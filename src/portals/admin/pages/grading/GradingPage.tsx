import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Loader2, UserPlus } from 'lucide-react';
import {
  Card,
  PageHeader,
  Button,
  FilterBar,
  Pagination,
  Select,
  Tabs,
  TabItem,
  TableWrap,
  Table,
  Th,
  Td,
  SimpleKpiCard,
  pushToast,
  CertTag,
  certCodeOf,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  GradingCounts,
  GradingQueueTab,
  GradingRow,
  PracticalState,
  ExpertRow,
  exportTableCsv,
} from '@admin/services/api';
import { getStoredAdminUser } from '@admin/utils/auth';
import { AxiosError } from 'axios';
import GradingDetailModal from './GradingDetailModal';

const PAGE_SIZE = 20;

type CertFilter = 'all' | 'AXIS' | 'AXIS_C' | 'AXIS_H';
type LevelFilter = 'all' | 'L1' | 'L2' | 'L3';
type StateFilter = 'all' | PracticalState;

const TABS: { id: GradingQueueTab; labelKey: string; warn?: boolean }[] = [
  { id: 'all', labelKey: 'grade.tab.all' },
  { id: 'auto_done', labelKey: 'grade.tab.autoDone' },
  { id: 'ai_graded', labelKey: 'grade.tab.aiDone' },
  { id: 'reviewing', labelKey: 'grade.tab.reviewing' },
  { id: 'final', labelKey: 'grade.tab.final' },
  { id: 'overdue', labelKey: 'grade.tab.overdue', warn: true },
  { id: 'terminated', labelKey: 'grade.tab.terminated', warn: true },
];

function pracBadge(s: PracticalState, t: (k: string) => string) {
  switch (s) {
    case 'auto':
      return <span className="text-[var(--gray-500)]">{t('grade.prac.auto')}</span>;
    case 'ai_graded':
      return <span className="text-[var(--blue)]">{t('grade.prac.aiGraded')}</span>;
    case 'expert_reviewing':
      return <span className="text-[var(--orange)]">{t('grade.prac.reviewing')}</span>;
    case 'final':
      return <span className="text-[var(--green)]">{t('grade.prac.final')}</span>;
    case 'expert_disputed':
      return <span className="text-[var(--red)]">{t('grade.prac.disputed')}</span>;
  }
}

function ddayLabel(daysToDue: number, overdue: boolean): string {
  if (overdue) return `D+${Math.abs(daysToDue)}`;
  if (daysToDue <= 0) return 'D-day';
  return `D-${daysToDue}`;
}

function tabCount(c: GradingCounts | null, id: GradingQueueTab): number {
  if (!c) return 0;
  switch (id) {
    case 'all':
      return c.all;
    case 'auto_done':
      return c.autoDone;
    case 'ai_graded':
      return c.aiDone;
    case 'reviewing':
      return c.reviewing;
    case 'final':
      return c.final;
    case 'overdue':
      return c.overdue;
    case 'terminated':
      return c.terminated ?? 0;
  }
}

export function GradingScreen() {
  const { t } = useI18n();
  const adminUser = getStoredAdminUser();
  const [tab, setTab] = useState<GradingQueueTab>('all');
  const [rows, setRows] = useState<GradingRow[] | null>(null);
  const [counts, setCounts] = useState<GradingCounts | null>(null);
  const [overdueRows, setOverdueRows] = useState<GradingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const [detailSession, setDetailSession] = useState<{ id: string; readOnly: boolean } | null>(null);
  const [assignFor, setAssignFor] = useState<GradingRow | null>(null);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [experts, setExperts] = useState<ExpertRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [certFilter, setCertFilter] = useState<CertFilter>('all');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [roundFilter, setRoundFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');

  useEffect(() => {
    adminApi.getExperts().then((r) => setExperts(r.data)).catch(() => undefined);
  }, []);

  const openAction = (r: GradingRow) => {
    if (r.terminated) {
      // Unfinished (force-terminated) exam — open the scoring screen directly;
      // grading runs only via its "Grade the exam" button.
      setDetailSession({ id: r.sessionId, readOnly: false });
      return;
    }
    if (r.practicalState === 'ai_graded' || r.practicalState === 'auto') {
      setAssignFor(r);
    } else {
      setDetailSession({ id: r.sessionId, readOnly: r.practicalState === 'final' });
    }
  };

  const doAssign = async (sessionId: string, expertId: string) => {
    try {
      await adminApi.assignExpert(sessionId, expertId);
      pushToast('채점위원이 배정되었습니다', 'green');
      setAssignFor(null);
      reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || '배정 실패', 'red');
    }
  };

  const doBulkAssign = async (expertId: string) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await adminApi.assignBulk([...selectedIds], expertId);
      pushToast(
        `일괄 배정 완료 — ${res.data.assigned}건 성공${res.data.skipped.length > 0 ? `, ${res.data.skipped.length}건 건너뜀` : ''}`,
        'green',
      );
      setSelectedIds(new Set());
      setBulkAssignOpen(false);
      reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || '일괄 배정 실패', 'red');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allIds = (pagedRows ?? []).map((r) => r.sessionId);
    if (allIds.every((id) => selectedIds.has(id))) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => new Set([...prev, ...allIds]));
    }
  };

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    adminApi
      .getGradingQueue(tab)
      .then((res) => {
        if (!cancelled) setRows(res.data);
      })
      .catch(
        (e) => !cancelled && setError(e?.response?.data?.message ?? 'Failed to load queue'),
      );
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [certFilter, levelFilter, roundFilter, stateFilter]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminApi.getGradingCounts(), adminApi.getGradingQueue('overdue')])
      .then(([c, o]) => {
        if (cancelled) return;
        setCounts(c.data);
        setOverdueRows(o.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tab, reloadKey]);

  const filteredRows = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (certFilter !== 'all' && r.certType !== certFilter) return false;
      if (levelFilter !== 'all' && r.level !== levelFilter) return false;
      if (roundFilter !== 'all' && String(r.roundNumber ?? '') !== roundFilter) return false;
      if (stateFilter !== 'all' && r.practicalState !== stateFilter) return false;
      return true;
    });
  }, [rows, certFilter, levelFilter, roundFilter, stateFilter]);

  const roundOptions = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows ?? []) {
      if (r.roundNumber != null) set.add(r.roundNumber);
    }
    return [...set].sort((a, b) => a - b);
  }, [rows]);

  const showOverdue = overdueRows.length > 0;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredRows, safePage],
  );

  const awaitingAssignment = (counts?.autoDone ?? 0) + (counts?.aiDone ?? 0);

  const onExport = () => {
    if (!filteredRows.length) {
      pushToast(t('common.empty'), 'orange');
      return;
    }
    setExporting(true);
    try {
      exportTableCsv(
        `grading_${tab}.csv`,
        [
          'Session',
          'Candidate',
          'Cert',
          'Level',
          'Round',
          'Written',
          'PracticalState',
          'Result',
          'D-Day',
          'Expert',
          'Terminated',
        ],
        filteredRows.map((r) => [
          r.sessionId,
          r.candidate,
          r.certType === 'AXIS_C' ? 'AXIS-C' : r.certType === 'AXIS_H' ? 'AXIS-H' : 'AXIS',
          r.level,
          r.roundNumber ?? '',
          r.writtenScore ?? '',
          r.practicalState,
          r.terminated ? 'terminated' : r.result ?? '',
          ddayLabel(r.daysToDue, r.overdue),
          r.assignedExpert ?? '',
          r.terminated ? 'Y' : 'N',
        ]),
      );
      pushToast(t('res.exportOk'), 'green');
    } finally {
      setExporting(false);
    }
  };

  const tabItems: TabItem<GradingQueueTab>[] = TABS.map((tt) => ({
    id: tt.id,
    label: t(tt.labelKey),
    count: tabCount(counts, tt.id),
    warn: tt.warn,
  }));

  return (
    <div>
      <PageHeader
        title={t('page.grading.title')}
        subtitle={t('page.grading.sub')}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (selectedIds.size === 0) {
                  pushToast('먼저 세션을 선택하세요 (체크박스 활용)', 'orange');
                  return;
                }
                setBulkAssignOpen(true);
              }}
            >
              <UserPlus className="w-3.5 h-3.5" />
              {t('grade.bulkAssign')}
              {selectedIds.size > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-[var(--blue)] text-white rounded-full">
                  {selectedIds.size}
                </span>
              )}
            </Button>
            <Button variant="secondary" onClick={onExport} disabled={exporting || rows === null}>
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}{' '}
              {t('common.excel')}
            </Button>
          </>
        }
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3.5 mb-5">
        <SimpleKpiCard
          label={t('grade.kpi.aiQueue')}
          value={counts?.aiDone ?? '—'}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--blue)]">{counts?.aiDone ?? '—'}</span>{' '}
              {t('grade.kpi.review.sub')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('grade.kpi.reviewNeeded')}
          value={counts?.reviewing ?? '—'}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--orange)]">{counts?.reviewing ?? '—'}</span>{' '}
              {t('grade.prac.reviewing')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('grade.kpi.expertAssigned')}
          value={counts ? awaitingAssignment : '—'}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--gray-900)]">{counts ? awaitingAssignment : '—'}</span>{' '}
              {t('grade.kpi.review.sub')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('grade.kpi.finalToday')}
          value={counts?.final ?? '—'}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--green)]">{counts?.final ?? '—'}</span>{' '}
              {t('grade.prac.final')}
            </>
          }
        />
      </div>

      {showOverdue && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">
              <span className="font-medium">{t('grade.overdue.banner')}</span>{' '}
              {overdueRows
                .slice(0, 5)
                .map((r) => `${r.candidate} (${ddayLabel(r.daysToDue, r.overdue)})`)
                .join(' · ')}
            </span>
          </div>
        </Card>
      )}

      <Tabs tabs={tabItems} active={tab} onChange={setTab} />

      <FilterBar>
        <Select
          value={certFilter}
          onChange={(e) => setCertFilter(e.target.value as CertFilter)}
          aria-label={t('common.cert')}
        >
          <option value="all">
            {t('common.cert')} {t('common.all')}
          </option>
          <option value="AXIS">AXIS</option>
          <option value="AXIS_C">AXIS-C</option>
          <option value="AXIS_H">AXIS-H</option>
        </Select>
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
          aria-label={t('common.level')}
        >
          <option value="all">
            {t('common.level')} {t('common.all')}
          </option>
          <option value="L3">L3</option>
          <option value="L2">L2</option>
          <option value="L1">L1</option>
        </Select>
        <Select
          value={roundFilter}
          onChange={(e) => setRoundFilter(e.target.value)}
          aria-label={t('common.round')}
        >
          <option value="all">
            {t('common.round')} {t('common.all')}
          </option>
          {roundOptions.map((n) => (
            <option key={n} value={String(n)}>
              {t('common.roundLabel', { n })}
            </option>
          ))}
        </Select>
        <Select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as StateFilter)}
          aria-label={t('grade.filter.gradingState')}
        >
          <option value="all">
            {t('grade.filter.gradingState')} {t('common.all')}
          </option>
          <option value="auto">{t('grade.prac.auto')}</option>
          <option value="ai_graded">{t('grade.prac.aiGraded')}</option>
          <option value="expert_reviewing">{t('grade.prac.reviewing')}</option>
          <option value="final">{t('grade.prac.final')}</option>
          <option value="expert_disputed">{t('grade.prac.disputed')}</option>
        </Select>
      </FilterBar>

      {error && <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>}

      <div className="border-0">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={pagedRows.length > 0 && pagedRows.every((r) => selectedIds.has(r.sessionId))}
                    onChange={toggleSelectAll}
                    title="현재 페이지 전체 선택"
                  />
                </Th>
                <Th>{t('grade.col.session')}</Th>
                <Th>{t('grade.col.examinee')}</Th>
                <Th>{t('common.cert')}</Th>
                <Th>{t('common.level')}</Th>
                <Th>{t('common.round')}</Th>
                <Th align="right">{t('grade.col.written')}</Th>
                <Th>{t('grade.col.practical')}</Th>
                <Th>{t('grade.col.final')}</Th>
                <Th>D-Day</Th>
                <Th>{t('grade.col.expert')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <Td colSpan={12} className="!text-center !text-[var(--gray-400)] !py-12">
                    {t('common.loading')}
                  </Td>
                </tr>
              )}
              {rows !== null && filteredRows.length === 0 && (
                <tr>
                  <Td colSpan={12} className="!text-center !text-[var(--gray-400)] !py-12">
                    {t('common.empty')}
                  </Td>
                </tr>
              )}
              {pagedRows.map((r) => (
                <tr
                  key={r.sessionId}
                  className={`hover:bg-[var(--gray-50)] ${
                    r.overdue ? 'bg-[var(--red-50)]' : ''
                  } ${selectedIds.has(r.sessionId) ? 'bg-blue-50' : ''}`}
                >
                  <Td>
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selectedIds.has(r.sessionId)}
                      onChange={() => toggleSelect(r.sessionId)}
                    />
                  </Td>
                  <Td mono>{r.sessionId.slice(-12)}</Td>
                  <Td strong>{r.candidate}</Td>
                  <Td strong>
                    {r.certType === 'AXIS_C' ? 'AXIS-C' : r.certType === 'AXIS_H' ? 'AXIS-H' : 'AXIS'}
                  </Td>
                  <Td strong>{r.level}</Td>
                  <Td>
                    {r.roundNumber != null
                      ? t('common.roundLabel', { n: r.roundNumber })
                      : '—'}
                  </Td>
                  <Td align="right" className="tabular-nums" strong>
                    {r.writtenScore != null ? `${r.writtenScore}${t('grade.score.suffix')}` : '—'}
                  </Td>
                  <Td>{pracBadge(r.practicalState, t)}</Td>
                  <Td>
                    {r.terminated ? (
                      <span className="inline-flex items-center text-[11px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 font-medium">
                        {t('grade.badge.terminated')}
                      </span>
                    ) : r.result === 'pass' ? (
                      <span className="text-[var(--green)]">{t('result.pass')}</span>
                    ) : r.result === 'fail' ? (
                      <span className="text-[var(--gray-600)]">{t('result.fail')}</span>
                    ) : (
                      <span className="text-[var(--gray-300)]">—</span>
                    )}
                  </Td>
                  <Td
                    className={`tabular-nums ${
                      r.overdue
                        ? '!text-[var(--red)] font-semibold'
                        : r.daysToDue <= 1
                        ? '!text-[var(--red)] font-medium'
                        : ''
                    }`}
                  >
                    {ddayLabel(r.daysToDue, r.overdue)}
                  </Td>
                  <Td muted>
                    {r.assignedExpert ?? t('grade.expert.unassigned')}
                    {r.mandatoryReview && (
                      <span className="ml-1.5 inline-flex items-center text-[10px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1 py-0.5">
                        필수
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    <Button variant="blue" size="sm" onClick={() => openAction(r)}>
                      {r.terminated
                        ? t('grade.action.grade')
                        : r.practicalState === 'ai_graded' || r.practicalState === 'auto'
                        ? t('grade.action.assign')
                        : r.practicalState === 'final'
                        ? t('common.detail')
                        : t('grade.action.review')}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onChange={setPage}
          total={filteredRows.length}
        />
      </div>

      {detailSession && (
        <GradingDetailModal
          sessionId={detailSession.id}
          readOnly={detailSession.readOnly}
          currentUserId={adminUser?.id}
          currentUserRoles={adminUser?.roles}
          onClose={() => setDetailSession(null)}
          onFinalized={reload}
        />
      )}

      {assignFor && (
        <AssignExpertModal
          row={assignFor}
          experts={experts.filter((e) => e.competencies.includes(assignFor.certType))}
          onAssign={(expertId) => doAssign(assignFor.sessionId, expertId)}
          onClose={() => setAssignFor(null)}
        />
      )}

      {bulkAssignOpen && (
        <BulkAssignModal
          count={selectedIds.size}
          experts={experts}
          onAssign={doBulkAssign}
          onClose={() => setBulkAssignOpen(false)}
        />
      )}
    </div>
  );
}

function AssignExpertModal({
  row,
  experts,
  onAssign,
  onClose,
}: {
  row: GradingRow;
  experts: ExpertRow[];
  onAssign: (expertId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-base font-semibold text-slate-900">채점위원 배정</h3>
          <CertTag code={certCodeOf(row.certType)} />
          <span className="text-sm text-slate-500">{row.level} · {row.candidate}</span>
        </div>
        <p className="text-[12px] text-slate-500 mb-3">
          {row.certType.replace('_', '-')} 담당 채점위원만 표시됩니다.
        </p>
        {experts.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            이 분야 담당 채점위원이 없습니다. 채점위원 관리에서 먼저 등록하세요.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto mb-4">
            {experts.map((e) => (
              <label
                key={e.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                  selected === e.id ? 'border-[var(--blue)] bg-[var(--blue-50)]' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input type="radio" name="expert" checked={selected === e.id} onChange={() => setSelected(e.id)} />
                <span className="text-sm text-slate-800">{e.name}</span>
                <span className="text-[11px] text-slate-400">@{e.userId}</span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50">
            취소
          </button>
          <Button onClick={() => selected && onAssign(selected)} disabled={!selected}>
            배정
          </Button>
        </div>
      </div>
    </div>
  );
}
function BulkAssignModal({
  count,
  experts,
  onAssign,
  onClose,
}: {
  count: number;
  experts: ExpertRow[];
  onAssign: (expertId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState('');
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-slate-900">일괄 채점위원 배정</h3>
          <span className="text-sm text-slate-500">{count}개 세션 선택됨</span>
        </div>
        <p className="text-[12px] text-slate-500 mb-3">
          선택한 {count}개 세션에 동일한 채점위원을 배정합니다.
          해당 채점 유형과 다른 분야의 세션은 자동으로 건너뜁니다.
        </p>
        {experts.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">
            등록된 채점위원이 없습니다. 채점위원 관리에서 먼저 등록하세요.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto mb-4">
            {experts.map((e) => (
              <label
                key={e.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                  selected === e.id ? 'border-[var(--blue)] bg-[var(--blue-50)]' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input type="radio" name="bulk-expert" checked={selected === e.id} onChange={() => setSelected(e.id)} />
                <span className="text-sm text-slate-800">{e.name}</span>
                <span className="text-[11px] text-slate-400">@{e.userId}</span>
                <span className="ml-auto text-[11px] text-slate-400">
                  {e.competencies.map((c) => c.replace('_', '-')).join(', ')}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3.5 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-50">
            취소
          </button>
          <Button onClick={() => selected && onAssign(selected)} disabled={!selected}>
            <UserPlus className="w-3.5 h-3.5" /> 일괄 배정
          </Button>
        </div>
      </div>
    </div>
  );
}

export default GradingScreen;
