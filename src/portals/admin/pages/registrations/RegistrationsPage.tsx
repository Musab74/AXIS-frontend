import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
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
} from '@admin/services/api';
import { RefundModal } from '../examinees/RefundModal';

const PAGE_SIZE = 20;

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

function methodLabel(m: string | null, t: (k: string) => string): string {
  if (!m) return '—';
  const key = `reg.method.${m}`;
  const translated = t(key);
  // If translation key fell through (returns the key itself), fall back to the raw code
  return translated === key ? m : translated;
}

export default function RegistrationsPage() {
  const { t } = useI18n();
  const [list, setList] = useState<ExamineeListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<{
    certType?: CertType;
    level?: CertLevel;
    status?: ExamineeStatus;
    q?: string;
  }>({});
  const [refundTarget, setRefundTarget] = useState<{
    row: ExamineeListRow;
    detail: any;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setError(null);
    adminApi
      .getExaminees({
        certType: filter.certType,
        level: filter.level,
        status: filter.status,
        q: filter.q,
        page,
        limit: PAGE_SIZE,
      })
      .then((res) => !cancelled && setList(res.data))
      .catch((e) => !cancelled && setError(e?.response?.data?.message ?? 'Failed to load registrations'));
    return () => {
      cancelled = true;
    };
  }, [filter.certType, filter.level, filter.status, filter.q, page, reloadKey]);

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  const counts = useMemo(() => {
    const items = list?.items ?? [];
    return {
      total: list?.total ?? 0,
      pending: items.filter(
        (r) => r.examineeStatus === 'PENDING_PAYMENT' || r.latestPayment?.status === 'PENDING',
      ).length,
      paid: items.filter((r) => r.latestPayment?.status === 'CONFIRMED').length,
      refunded: items.filter(
        (r) => r.latestPayment?.status === 'REFUNDED' || r.latestPayment?.status === 'PARTIAL_REFUND',
      ).length,
    };
  }, [list]);

  const onRefundClick = async (row: ExamineeListRow) => {
    try {
      const detail = await adminApi.getExamineeDetail(row.user.id);
      const reg = detail.data.registrations.find((r) => r.id === row.registrationId);
      if (reg) setRefundTarget({ row, detail: reg });
    } catch {
      // fall through
    }
  };

  return (
    <div>
      <PageHeader
        title={t('page.registrations.title')}
        subtitle={t('page.registrations.sub')}
        actions={
          <Button variant="secondary">
            <Download className="w-3.5 h-3.5" /> {t('reg.export')}
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-3.5 mb-5">
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
        />
      </div>

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
            setFilter((f) => ({ ...f, status: (e.target.value as ExamineeStatus) || undefined }))
          }
        >
          <option value="">{t('reg.filter.payAll', { all: t('common.all') })}</option>
          <option value="PENDING_PAYMENT">{t('reg.filter.payPending')}</option>
          <option value="NOT_STARTED">{t('reg.filter.payDone')}</option>
          <option value="REFUNDED">{t('reg.filter.payRefunded')}</option>
          <option value="CANCELLED">{t('reg.filter.payCancelled')}</option>
        </Select>
        <Search
          placeholder={t('reg.search.placeholder')}
          value={filter.q ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
        />
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
                const tone = pay ? payTone(pay.status, t) : { tone: 'gray' as const, label: t('reg.pay.unpaid') };
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
                    <Td className={tone.tone === 'red' ? 'text-[var(--red)]' : tone.tone === 'blue' ? 'text-[var(--blue)]' : tone.tone === 'orange' ? 'text-[var(--orange)]' : tone.tone === 'green' ? 'text-[var(--green)]' : 'text-[var(--gray-600)]'}>
                      {tone.label}
                      {pay?.isDemo ? ` · ${t('reg.pay.demo')}` : ''}
                    </Td>
                    <Td align="right">
                      {r.refundable && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => onRefundClick(r)}
                        >
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
