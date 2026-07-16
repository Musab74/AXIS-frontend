import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Card,
  PageHeader,
  Button,
  FilterBar,
  Select,
  Search,
  TableWrap,
  Table,
  Th,
  Td,
  Pagination,
  SimpleKpiCard,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  CertLevel,
  CertType,
  ExamineeListResult,
  ExamineeListRow,
  ExamineeStatus,
  PaymentStatus,
  triggerBlobDownload,
} from '@admin/services/api';
import { RefundModal } from '../examinees/RefundModal';
import { useDebounce } from '../examinees/lib/useDebounce';

const DEFAULT_PAGE_SIZE = 20;

type PaymentFilter = 'PENDING' | 'CONFIRMED' | 'REFUNDED' | 'CANCELLED' | '';

function certLabel(c: CertType): string {
  return c === 'AXIS_C' ? 'AXIS-C' : c === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function fmtKRW(n: number | null | undefined, t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (n == null) return '—';
  return `${n.toLocaleString('ko-KR')}${t('unit.won')}`;
}

function payTone(
  s: PaymentStatus,
  t: (k: string) => string,
): { tone: 'green' | 'orange' | 'red' | 'gray' | 'blue' | 'teal'; label: string } {
  switch (s) {
    case 'CONFIRMED':
      return { tone: 'green', label: t('reg.pay.done') };
    case 'PENDING':
      return { tone: 'blue', label: t('reg.pay.pending') };
    case 'CANCELLED':
      return { tone: 'gray', label: t('reg.pay.cancelled') };
    case 'REFUNDED':
      return { tone: 'red', label: t('reg.pay.refunded') };
    case 'PARTIAL_REFUND':
      return { tone: 'orange', label: t('reg.pay.partial') };
  }
}

/** Prefer registration lifecycle for cancelled/refunded so pending VBANK on cancelled rows is not shown as 결제대기. */
function rowStatusDisplay(
  r: ExamineeListRow,
  t: (k: string) => string,
): { tone: 'green' | 'orange' | 'red' | 'gray' | 'blue' | 'teal'; label: string } {
  if (r.registrationStatus === 'CANCELLED') {
    return { tone: 'gray', label: t('reg.pay.cancelled') };
  }
  if (r.registrationStatus === 'REFUNDED') {
    return { tone: 'red', label: t('reg.pay.refunded') };
  }
  const pay = r.latestPayment;
  if (pay) return payTone(pay.status, t);
  return { tone: 'gray', label: t('reg.pay.unpaid') };
}

function methodLabel(m: string | null, t: (k: string) => string): string {
  if (!m) return '—';
  const key = `reg.method.${m}`;
  const translated = t(key);
  return translated === key ? m : translated;
}

function extractBlobError(e: unknown): Promise<string | null> {
  const err = e as { response?: { data?: Blob | { message?: string } } };
  const data = err.response?.data;
  if (data instanceof Blob) {
    return data.text().then((txt) => {
      try {
        const j = JSON.parse(txt) as { message?: string | string[] };
        if (Array.isArray(j.message)) return j.message.join(', ');
        return j.message ?? null;
      } catch {
        return null;
      }
    });
  }
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message?: string | string[] }).message;
    return Promise.resolve(Array.isArray(m) ? m.join(', ') : m ?? null);
  }
  return Promise.resolve(null);
}

export default function RegistrationsPage() {
  const { t } = useI18n();
  const [list, setList] = useState<ExamineeListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [certType, setCertType] = useState<CertType | ''>('');
  const [level, setLevel] = useState<CertLevel | ''>('');
  const [payFilter, setPayFilter] = useState<PaymentFilter>('');
  const [exporting, setExporting] = useState(false);
  const [refundTarget, setRefundTarget] = useState<{
    row: ExamineeListRow;
    detail: any;
  } | null>(null);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    setPage(1);
  }, [debouncedQ, certType, level, payFilter, pageSize]);

  const listParams = useMemo(() => {
    const paymentStatus =
      payFilter === 'PENDING' || payFilter === 'CONFIRMED' || payFilter === 'REFUNDED'
        ? payFilter
        : undefined;
    const status: ExamineeStatus | undefined =
      payFilter === 'CANCELLED' ? 'CANCELLED' : undefined;
    return {
      q: debouncedQ.trim() || undefined,
      certType: (certType || undefined) as CertType | undefined,
      level: (level || undefined) as CertLevel | undefined,
      paymentStatus,
      status,
      page,
      limit: pageSize,
    };
  }, [debouncedQ, certType, level, payFilter, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setError(null);
    adminApi
      .getExaminees(listParams)
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > totalPages) {
          setPage(totalPages);
          return;
        }
        setList(data);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.message ?? 'Failed to load registrations'));
    return () => {
      cancelled = true;
    };
  }, [listParams, page, pageSize, reloadKey]);

  const totalPages = list ? Math.max(1, Math.ceil(list.total / pageSize)) : 1;

  const counts = useMemo(() => {
    return {
      total: list?.total ?? 0,
      pending: list?.counts?.pending ?? 0,
      paid: list?.counts?.paid ?? 0,
      refunded: list?.counts?.refunded ?? 0,
    };
  }, [list]);

  const onRefundClick = async (row: ExamineeListRow) => {
    try {
      const detail = await adminApi.getExamineeDetail(row.user.id);
      const reg = detail.data.registrations.find((r) => r.id === row.registrationId);
      if (reg) {
        setRefundTarget({ row, detail: reg });
      } else {
        pushToast(t('reg.refundDetailFail'), 'red');
      }
    } catch {
      pushToast(t('reg.refundDetailFail'), 'red');
    }
  };

  const onExport = async () => {
    if (list && list.total === 0) {
      pushToast(t('reg.exportEmpty'), 'orange');
      return;
    }
    setExporting(true);
    try {
      const { page: _p, limit: _l, ...exportFilters } = listParams;
      const res = await adminApi.exportExaminees(exportFilters);
      const stamp = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(res.data, `registrations_${stamp}.xlsx`);
      pushToast(t('reg.exportOk'), 'green');
    } catch (e) {
      const msg = (await extractBlobError(e)) || t('reg.exportFailed');
      pushToast(msg, 'red');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('page.registrations.title')}
        subtitle={t('page.registrations.sub')}
        actions={
          <Button variant="secondary" onClick={onExport} disabled={exporting || list === null}>
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}{' '}
            {t('reg.export')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 mb-5">
        <SimpleKpiCard
          label={t('reg.kpi.total')}
          value={counts.total.toLocaleString()}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--gray-900)]">{counts.total.toLocaleString()}</span> {t('common.all')}
            </>
          }
        />
        <SimpleKpiCard
          label={t('reg.filter.payPending')}
          value={counts.pending.toLocaleString()}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--blue)]">{counts.pending.toLocaleString()}</span> {t('reg.pay.pending')}
            </>
          }
          onClick={() => setPayFilter('PENDING')}
        />
        <SimpleKpiCard
          label={t('reg.kpi.paid')}
          value={counts.paid.toLocaleString()}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--green)]">{counts.paid.toLocaleString()}</span> {t('reg.filter.payDone')}
            </>
          }
          onClick={() => setPayFilter('CONFIRMED')}
        />
        <SimpleKpiCard
          label={t('reg.kpi.refunded')}
          value={counts.refunded.toLocaleString()}
          unit={t('unit.cases')}
          meta={
            <>
              <span className="font-medium text-[var(--orange)]">{counts.refunded.toLocaleString()}</span> {t('reg.filter.payRefunded')}
            </>
          }
          onClick={() => setPayFilter('REFUNDED')}
        />
      </div>

      <FilterBar>
        <Select
          value={certType}
          onChange={(e) => setCertType((e.target.value as CertType) || '')}
        >
          <option value="">{t('common.cert')} {t('common.all')}</option>
          <option value="AXIS">AXIS</option>
          <option value="AXIS_C">AXIS-C</option>
          <option value="AXIS_H">AXIS-H</option>
        </Select>
        <Select
          value={level}
          onChange={(e) => setLevel((e.target.value as CertLevel) || '')}
        >
          <option value="">{t('common.level')} {t('common.all')}</option>
          <option value="L3">L3</option>
          <option value="L2">L2</option>
          <option value="L1">L1</option>
        </Select>
        <Select
          value={payFilter}
          onChange={(e) => setPayFilter((e.target.value as PaymentFilter) || '')}
        >
          <option value="">{t('reg.filter.payAll', { all: t('common.all') })}</option>
          <option value="PENDING">{t('reg.filter.payPending')}</option>
          <option value="CONFIRMED">{t('reg.filter.payDone')}</option>
          <option value="REFUNDED">{t('reg.filter.payRefunded')}</option>
          <option value="CANCELLED">{t('reg.filter.payCancelled')}</option>
        </Select>
        <Search
          placeholder={t('reg.search.placeholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(certType || level || payFilter || q) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setCertType('');
              setLevel('');
              setPayFilter('');
              setQ('');
            }}
          >
            {t('res.filter.reset')}
          </Button>
        )}
      </FilterBar>

      {error && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>
      )}

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>{t('reg.col.regNo')}</Th>
              <Th>{t('reg.col.name')}</Th>
              <Th>{t('reg.col.email')}</Th>
              <Th>{t('reg.col.examInfo')}</Th>
              <Th>{t('reg.col.regDate')}</Th>
              <Th align="right">{t('reg.col.amount')}</Th>
              <Th>{t('reg.col.payMethod')}</Th>
              <Th>{t('reg.col.payStatus')}</Th>
              <Th align="right">{t('reg.col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {list === null && (
              <tr>
                <Td colSpan={9} className="!text-center !text-[var(--gray-400)] !py-12">
                  {t('common.loading')}
                </Td>
              </tr>
            )}
            {list !== null && list.items.length === 0 && (
              <tr>
                <Td colSpan={9} className="!text-center !text-[var(--gray-400)] !py-12">
                  {t('common.empty')}
                </Td>
              </tr>
            )}
            {(list?.items ?? []).map((r) => {
              const pay = r.latestPayment;
              const tone = rowStatusDisplay(r, t);
              return (
                <tr key={r.registrationId} className="hover:bg-[var(--gray-50)]">
                  <Td mono>{r.registrationNumber ?? '—'}</Td>
                  <Td strong>{r.user.name}</Td>
                  <Td muted className="text-[12px]">
                    {r.user.email ?? '—'}
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-semibold text-[var(--primary)]">{certLabel(r.schedule.certType)}</span>
                      <b>{r.schedule.level}</b>
                      <span className="text-[var(--gray-500)]">·</span>
                      <span>{t('common.roundLabel', { n: r.schedule.roundNumber })}</span>
                    </span>
                  </Td>
                  <Td className="tabular-nums">{fmtDate(r.registrationCreatedAt)}</Td>
                  <Td align="right" className="tabular-nums" strong>
                    <div>{fmtKRW(pay?.amount, t)}</div>
                    {pay?.isDemo && (
                      <div
                        className="mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800"
                        title={t('reg.pay.demoHint')}
                      >
                        {t('reg.pay.demo')}
                      </div>
                    )}
                  </Td>
                  <Td>{methodLabel(pay?.method ?? null, t)}</Td>
                  <Td
                    className={
                      tone.tone === 'red'
                        ? 'text-[var(--red)]'
                        : tone.tone === 'blue'
                          ? 'text-[var(--blue)]'
                          : tone.tone === 'orange'
                            ? 'text-[var(--orange)]'
                            : tone.tone === 'green'
                              ? 'text-[var(--green)]'
                              : 'text-[var(--gray-600)]'
                    }
                  >
                    {tone.label}
                    {pay?.isDemo && r.registrationStatus !== 'CANCELLED' && r.registrationStatus !== 'REFUNDED'
                      ? ` · ${t('reg.pay.demo')}`
                      : ''}
                  </Td>
                  <Td align="right">
                    {r.refundable && (
                      <Button variant="danger" size="sm" onClick={() => onRefundClick(r)}>
                        {t('common.refund')}
                      </Button>
                    )}
                    {!r.refundable && pay?.isDemo && r.registrationStatus === 'PAID' && (
                      <span className="text-[11px] text-amber-700">{t('exm.history.demoNoRefund')}</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination
        page={page}
        totalPages={totalPages}
        onChange={setPage}
        total={list?.total}
        pageSize={pageSize}
        onPageSizeChange={setPageSize}
      />

      {refundTarget && (
        <RefundModal
          registration={refundTarget.detail}
          examineeName={refundTarget.row.user.name}
          onClose={() => setRefundTarget(null)}
          onSuccess={() => {
            setRefundTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
