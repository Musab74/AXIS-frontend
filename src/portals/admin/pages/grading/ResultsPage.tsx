import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Megaphone, MessageSquare, RotateCcw, Search } from 'lucide-react';
import {
  Card,
  PageHeader,
  Button,
  TableWrap,
  Table,
  Th,
  Td,
  Modal,
  SimpleKpiCard,
  pushToast,
  Pagination,
  FilterBar,
  Select,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  GradingRow,
  exportTableCsv,
} from '@admin/services/api';
import { getStoredAdminUser } from '@admin/utils/auth';
import { AxiosError } from 'axios';
import GradingDetailModal from './GradingDetailModal';

type CertFilter = 'all' | 'AXIS' | 'AXIS_C' | 'AXIS_H';
type LevelFilter = 'all' | 'L1' | 'L2' | 'L3';
type ResultFilter = 'all' | 'pass' | 'fail' | 'pending';
type PublishFilter = 'all' | 'published' | 'unpublished';

function certLabel(certType: string): string {
  if (certType === 'AXIS_C') return 'AXIS-C';
  if (certType === 'AXIS_H') return 'AXIS-H';
  return 'AXIS';
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof AxiosError) {
    const msg = e.response?.data?.message;
    if (typeof msg === 'string') return msg;
    if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  }
  return fallback;
}

export default function ResultsPage() {
  const { t } = useI18n();
  const adminUser = getStoredAdminUser();
  const [rows, setRows] = useState<GradingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [certFilter, setCertFilter] = useState<CertFilter>('all');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [publishFilter, setPublishFilter] = useState<PublishFilter>('all');

  const reload = useCallback(() => {
    setError(null);
    return adminApi
      .getGradingQueue('final')
      .then((r) => {
        setRows(r.data);
      })
      .catch((e) => {
        setError(apiErrorMessage(e, 'Failed to load results'));
        setRows([]);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getGradingQueue('final')
      .then((r) => {
        if (!cancelled) setRows(r.data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(apiErrorMessage(e, 'Failed to load results'));
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const items = rows ?? [];
    const q = search.trim().toLowerCase();
    return items.filter((r) => {
      if (certFilter !== 'all' && r.certType !== certFilter) return false;
      if (levelFilter !== 'all' && r.level !== levelFilter) return false;
      if (resultFilter === 'pass' && r.result !== 'pass') return false;
      if (resultFilter === 'fail' && r.result !== 'fail') return false;
      if (resultFilter === 'pending' && r.result != null) return false;
      if (publishFilter === 'published' && !r.announced) return false;
      if (publishFilter === 'unpublished' && r.announced) return false;
      if (q && !r.candidate.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, certFilter, levelFilter, resultFilter, publishFilter]);

  const stats = useMemo(() => {
    const items = filtered;
    const passed = items.filter((r) => r.result === 'pass').length;
    const failed = items.filter((r) => r.result === 'fail').length;
    const partial = items.filter((r) => {
      if (r.result === 'pass' || r.level === 'L3') return false;
      const w = r.writtenScore ?? 0;
      const p = r.practicalScore ?? 0;
      return (w >= 60 && p < 60) || (w < 60 && p >= 60);
    }).length;
    return {
      total: items.length,
      passed,
      failed,
      partial,
      passRate: items.length > 0 ? ((passed / items.length) * 100).toFixed(1) : '—',
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [search, certFilter, levelFilter, resultFilter, publishFilter, pageSize]);

  const resetFilters = () => {
    setSearch('');
    setCertFilter('all');
    setLevelFilter('all');
    setResultFilter('all');
    setPublishFilter('all');
  };

  const toggleAll = () => {
    if (visible.length > 0 && visible.every((r) => selected.has(r.sessionId))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.sessionId)));
    }
  };

  const onExport = async () => {
    if (!filtered.length) {
      pushToast(t('res.exportEmpty'), 'orange');
      return;
    }
    setExporting(true);
    try {
      exportTableCsv(
        `results${certFilter !== 'all' ? `_${certFilter}` : ''}${levelFilter !== 'all' ? `_${levelFilter}` : ''}.csv`,
        [
          'Candidate',
          'Cert',
          'Level',
          'Round',
          'Written',
          'Practical',
          'Total',
          'Result',
          'Published',
          'SessionId',
        ],
        filtered.map((r) => [
          r.candidate,
          certLabel(r.certType),
          r.level,
          r.roundNumber ?? '',
          r.writtenScore ?? '',
          r.practicalScore ?? '',
          r.totalScore ?? r.writtenScore ?? '',
          r.result ?? 'pending',
          r.announced ? 'published' : 'unpublished',
          r.sessionId,
        ]),
      );
      pushToast(t('res.exportOk'), 'green');
    } catch {
      pushToast(t('res.exportFailed'), 'red');
    } finally {
      setExporting(false);
    }
  };

  const onPublish = async () => {
    if (selected.size === 0) return;
    setPublishing(true);
    try {
      const res = await adminApi.publishResults([...selected]);
      setConfirmOpen(false);
      setSelected(new Set());
      if (res.data.newlyAnnounced === 0) {
        pushToast(t('res.toastAlreadyPublished'), 'orange');
      } else {
        pushToast(
          t('res.toastPublished', {
            schedules: res.data.newlyAnnounced,
            sessions: res.data.sessionCount,
          }),
          'green',
        );
      }
      await reload();
    } catch (e) {
      pushToast(apiErrorMessage(e, t('res.publishFailed')), 'red');
    } finally {
      setPublishing(false);
    }
  };

  const allVisibleSelected =
    visible.length > 0 && visible.every((r) => selected.has(r.sessionId));

  return (
    <div>
      <PageHeader
        title={t('page.results.title')}
        subtitle={t('page.results.sub')}
        actions={
          <>
            <Button variant="secondary" onClick={onExport} disabled={exporting || rows === null}>
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}{' '}
              {t('res.exportBatch')}
            </Button>
            <Button
              variant="secondary"
              disabled
              title={t('res.objectionsSoon')}
              className="opacity-50 cursor-not-allowed"
            >
              <MessageSquare className="w-3.5 h-3.5" /> {t('res.objections', { n: 0 })}
            </Button>
            <Button
              variant="blue"
              disabled={selected.size === 0 || publishing}
              onClick={() => setConfirmOpen(true)}
              className={selected.size === 0 ? 'opacity-50 cursor-not-allowed' : ''}
            >
              <Megaphone className="w-3.5 h-3.5" /> {t('res.publish')}
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <SimpleKpiCard
          label={t('res.kpi.total')}
          value={stats.total}
          unit={t('unit.people')}
          meta={
            <>
              <span className="font-medium text-[var(--gray-900)]">{stats.total}</span> {t('common.all')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('res.kpi.passed')}
          value={stats.passed}
          unit={t('unit.people')}
          meta={
            <>
              <span className="font-medium text-[var(--green)]">{stats.passRate}%</span>{' '}
              {t('dash.col.passRate')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('res.kpi.failed')}
          value={stats.failed}
          unit={t('unit.people')}
          meta={
            <>
              <span className="font-medium text-[var(--red)]">{stats.failed}</span> {t('res.fail')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('res.kpi.partial')}
          value={stats.partial}
          unit={t('unit.people')}
          meta={<span className="text-[var(--gray-500)]">{t('res.partial.l2note')}</span>}
        />
        <SimpleKpiCard
          label={t('res.kpi.objections')}
          value="—"
          meta={<span className="text-[var(--gray-500)]">{t('res.objectionsSoon')}</span>}
        />
      </div>

      <FilterBar className="mb-4 flex-wrap gap-2">
        <Select
          value={certFilter}
          onChange={(e) => setCertFilter(e.target.value as CertFilter)}
          aria-label={t('res.filter.certAll')}
        >
          <option value="all">{t('res.filter.certAll')}</option>
          <option value="AXIS">AXIS</option>
          <option value="AXIS_C">AXIS-C</option>
          <option value="AXIS_H">AXIS-H</option>
        </Select>
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
          aria-label={t('res.filter.levelAll')}
        >
          <option value="all">{t('res.filter.levelAll')}</option>
          <option value="L3">L3</option>
          <option value="L2">L2</option>
          <option value="L1">L1</option>
        </Select>
        <Select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as ResultFilter)}
          aria-label={t('res.filter.resultAll')}
        >
          <option value="all">{t('res.filter.resultAll')}</option>
          <option value="pass">{t('res.pass')}</option>
          <option value="fail">{t('res.fail')}</option>
          <option value="pending">{t('res.pending')}</option>
        </Select>
        <Select
          value={publishFilter}
          onChange={(e) => setPublishFilter(e.target.value as PublishFilter)}
          aria-label={t('res.filter.publishAll')}
        >
          <option value="all">{t('res.filter.publishAll')}</option>
          <option value="published">{t('res.published')}</option>
          <option value="unpublished">{t('res.unpublished')}</option>
        </Select>
        <div className="relative min-w-[180px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--gray-400)] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('res.search.placeholder')}
            className="w-full h-9 pl-8 pr-3 border border-[var(--gray-border)] rounded-md text-[13px] bg-white"
            aria-label={t('res.search.placeholder')}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={resetFilters} type="button">
          <RotateCcw className="w-3.5 h-3.5" /> {t('res.filter.reset')}
        </Button>
      </FilterBar>

      {error && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>
      )}

      <div className="border-0">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th align="center">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    aria-label="Select all on page"
                  />
                </Th>
                <Th>{t('res.col.examinee')}</Th>
                <Th>{t('res.col.examInfo')}</Th>
                <Th align="right">{t('res.col.written')}</Th>
                <Th align="right">{t('res.col.practical')}</Th>
                <Th align="right">{t('res.col.total')}</Th>
                <Th>{t('res.col.pass')}</Th>
                <Th>{t('res.col.publish')}</Th>
                <Th align="right">{t('res.col.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <Td colSpan={9} className="!text-center !text-[var(--gray-400)] !py-12">
                    {t('common.loading')}
                  </Td>
                </tr>
              )}
              {rows !== null && visible.length === 0 && (
                <tr>
                  <Td colSpan={9} className="!text-center !text-[var(--gray-400)] !py-12">
                    {t('common.empty')}
                  </Td>
                </tr>
              )}
              {visible.map((r) => {
                const checked = selected.has(r.sessionId);
                return (
                  <tr key={r.sessionId} className="hover:bg-[var(--gray-50)]">
                    <Td align="center">
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={`Select ${r.candidate}`}
                        onChange={() => {
                          const next = new Set(selected);
                          if (checked) next.delete(r.sessionId);
                          else next.add(r.sessionId);
                          setSelected(next);
                        }}
                      />
                    </Td>
                    <Td strong>{r.candidate}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-[var(--primary)]">
                          {certLabel(r.certType)}
                        </span>
                        <b>{r.level}</b>
                        {r.roundNumber != null && (
                          <>
                            <span className="text-[var(--gray-500)]">·</span>
                            <span>{t('common.roundLabel', { n: r.roundNumber })}</span>
                          </>
                        )}
                      </span>
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.writtenScore ?? '—'}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {r.practicalScore ?? '—'}
                    </Td>
                    <Td align="right" strong className="tabular-nums">
                      {r.totalScore ?? r.writtenScore ?? '—'}
                    </Td>
                    <Td>
                      {r.result === 'pass' ? (
                        <span className="text-[var(--green)]">{t('res.pass')}</span>
                      ) : r.result === 'fail' ? (
                        <span className="text-[var(--red)]">{t('res.fail')}</span>
                      ) : (
                        <span className="text-[var(--gray-600)]">{t('res.pending')}</span>
                      )}
                    </Td>
                    <Td>
                      {r.announced ? (
                        <span className="text-[var(--teal,#0D9488)]">{t('res.published')}</span>
                      ) : (
                        <span className="text-[var(--gray-600)]">{t('res.unpublished')}</span>
                      )}
                    </Td>
                    <Td align="right">
                      <Button
                        variant="blue"
                        size="sm"
                        type="button"
                        onClick={() => setDetailSessionId(r.sessionId)}
                      >
                        {t('common.detailBtn')}
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          onChange={setPage}
          total={filtered.length}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !publishing && setConfirmOpen(false)}
        title={null}
        width={480}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={publishing}
            >
              {t('res.cancel')}
            </Button>
            <Button variant="blue" onClick={onPublish} disabled={publishing}>
              {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}{' '}
              {t('res.publishConfirm')}
            </Button>
          </>
        }
      >
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-[var(--blue-50)] grid place-items-center mx-auto mb-4">
            <Megaphone className="w-7 h-7 text-[var(--blue)]" />
          </div>
          <h3 className="text-[17px] font-extrabold text-[var(--primary)] mb-2 tracking-tight">
            {t('res.confirmTitle')}
          </h3>
          <p className="text-[13px] text-[var(--gray-600)] leading-relaxed mb-4">
            {t('res.confirmBody', { n: selected.size })}
          </p>
          <div className="text-[12px] text-[var(--orange)] bg-[var(--orange-50)] border border-orange-200 rounded-lg px-3 py-2 text-left">
            {t('res.confirmFooter')}
          </div>
        </div>
      </Modal>

      {detailSessionId && (
        <GradingDetailModal
          sessionId={detailSessionId}
          readOnly
          currentUserId={adminUser?.id}
          currentUserRoles={adminUser?.roles}
          onClose={() => setDetailSessionId(null)}
        />
      )}
    </div>
  );
}
