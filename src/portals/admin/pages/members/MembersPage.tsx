import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
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
  Modal,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  ExamineeRegistrationDetail,
  MemberProfile,
  SearchUsersResult,
  UserSummary,
  triggerBlobDownload,
} from '@admin/services/api';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { AccountStatusBadge } from '../examinees/components/AccountStatusBadge';
import { RefundModal } from '../examinees/RefundModal';
import { useDebounce } from '../examinees/lib/useDebounce';
import { fmtDate, fmtDateTime } from '../examinees/lib/format';
import { MemberDetailContent, type MemberDetailTab } from './components/MemberDetailContent';

const PAGE_SIZE = 20;

function fmtNice(v: boolean): string {
  return v ? '✓' : '✕';
}

async function extractBlobError(e: unknown): Promise<string | null> {
  const err = e as { response?: { data?: Blob | { message?: string } } };
  const data = err.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text) as { message?: string | string[] };
      const msg = parsed.message;
      return Array.isArray(msg) ? msg.join(', ') : msg ?? text;
    } catch {
      return null;
    }
  }
  if (data && typeof data === 'object' && 'message' in data) {
    const msg = (data as { message?: string | string[] }).message;
    return Array.isArray(msg) ? msg.join(', ') : msg ?? null;
  }
  return null;
}

export default function MembersPage() {
  const { t } = useI18n();

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [accountStatus, setAccountStatus] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);

  const [list, setList] = useState<SearchUsersResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemberProfile | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MemberDetailTab>('profile');

  const [refundTarget, setRefundTarget] = useState<ExamineeRegistrationDetail | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    setPage(1);
    setSelectedId(null);
  }, [debouncedQ, accountStatus, role]);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setListError(null);
    adminApi
      .getUsers({
        q: debouncedQ.trim() || undefined,
        accountStatus: accountStatus || undefined,
        role: role || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((res) => !cancelled && setList(res.data))
      .catch((e) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setListError(err.response?.data?.message ?? 'Failed to load members');
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, accountStatus, role, page, reloadKey]);

  const loadDetail = (userId: string) => {
    setDetail(null);
    setDetailError(null);
    adminApi
      .getMemberProfile(userId)
      .then((res) => setDetail(res.data))
      .catch((e) => {
        const err = e as { response?: { data?: { message?: string } } };
        setDetailError(err.response?.data?.message ?? 'Failed to load member');
      });
  };

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    loadDetail(selectedId);
  }, [selectedId, reloadKey]);

  const kpis = useMemo(
    () => ({
      total: list?.total ?? 0,
      active: list?.counts?.active ?? 0,
      suspended: list?.counts?.suspended ?? 0,
      penalty: list?.counts?.withPenalty ?? 0,
    }),
    [list],
  );

  const openRow = (row: UserSummary) => {
    setSelectedId(row.id);
    setActiveTab('profile');
  };

  const onExport = async () => {
    if (list && list.total === 0) {
      pushToast(t('mem.exportEmpty'), 'orange');
      return;
    }
    setExporting(true);
    try {
      const res = await adminApi.exportUsers({
        q: debouncedQ.trim() || undefined,
        accountStatus: accountStatus || undefined,
        role: role || undefined,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(res.data, `members_${stamp}.xlsx`);
      pushToast(t('mem.exportOk'), 'green');
    } catch (e) {
      const msg = (await extractBlobError(e)) || t('mem.exportFailed');
      pushToast(msg, 'red');
    } finally {
      setExporting(false);
    }
  };

  const selectedName = detail?.user.name ?? list?.items.find((r) => r.id === selectedId)?.name;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <PageHeader
        title={t('page.members.title')}
        subtitle={t('page.members.sub')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onExport} disabled={exporting || list === null}>
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-1.5" />
              )}
              {t('common.excel')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SimpleKpiCard label={t('mem.kpi.total')} value={kpis.total} />
        <SimpleKpiCard label={t('mem.kpi.active')} value={kpis.active} />
        <SimpleKpiCard label={t('mem.kpi.suspended')} value={kpis.suspended} />
        <SimpleKpiCard label={t('mem.kpi.penalty')} value={kpis.penalty} />
      </div>

      <FilterBar className="mb-4">
        <Select value={accountStatus} onChange={(e) => setAccountStatus(e.target.value)}>
          <option value="">
            {t('mem.filter.status')}: {t('mem.filter.all')}
          </option>
          <option value="ACTIVE">{t('exm.account.ACTIVE')}</option>
          <option value="SUSPENDED">{t('exm.account.SUSPENDED')}</option>
          <option value="WITHDRAWN">{t('exm.account.WITHDRAWN')}</option>
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">
            {t('mem.filter.role')}: {t('mem.filter.all')}
          </option>
          <option value="EXAMINEE">EXAMINEE</option>
          <option value="EXPERT">EXPERT</option>
          <option value="PROCTOR">PROCTOR</option>
          <option value="GRADING_ADMIN">GRADING_ADMIN</option>
          <option value="EXAM_ADMIN">EXAM_ADMIN</option>
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
        </Select>
        <Search
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('mem.search')}
          className="min-w-[240px] flex-1"
        />
      </FilterBar>

      {listError && (
        <Card className="mb-4 border-rose-200 bg-rose-50 text-sm text-rose-700 px-4 py-3">
          {listError}
        </Card>
      )}

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th className="text-left!">{t('mem.col.userId')}</Th>
              <Th className="text-left!">{t('mem.col.name')}</Th>
              <Th className="text-left!">{t('mem.col.email')}</Th>
              <Th className="text-left!">{t('mem.col.phone')}</Th>
              <Th>{t('mem.col.status')}</Th>
              <Th>{t('mem.col.nice')}</Th>
              <Th>{t('mem.col.penalty')}</Th>
              <Th>{t('mem.col.joined')}</Th>
              <Th>{t('mem.col.lastLogin')}</Th>
            </tr>
          </thead>
          <tbody>
            {!list ? (
              <tr>
                <Td colSpan={9} className="text-center py-10 text-slate-400">
                  {t('common.loading')}
                </Td>
              </tr>
            ) : list.items.length === 0 ? (
              <tr>
                <Td colSpan={9} className="text-center py-10 text-slate-400">
                  {t('common.empty')}
                </Td>
              </tr>
            ) : (
              list.items.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => openRow(row)}
                >
                  <Td className="text-left! font-mono text-xs">{row.userId}</Td>
                  <Td className="text-left! font-medium">{row.name}</Td>
                  <Td className="text-left! text-sm">{row.email ?? '—'}</Td>
                  <Td className="text-left! text-sm tabular-nums">
                    <MaskedPii userDbId={row.id} field="phone" value={row.phone} />
                  </Td>
                  <Td>
                    <AccountStatusBadge status={row.accountStatus} />
                  </Td>
                  <Td>{fmtNice(row.niceVerified)}</Td>
                  <Td className="tabular-nums">{row.activePenaltyCount}</Td>
                  <Td muted className="whitespace-nowrap tabular-nums">
                    {fmtDate(row.createdAt)}
                  </Td>
                  <Td muted className="whitespace-nowrap tabular-nums text-xs">
                    {row.lastLoginAt ? fmtDateTime(row.lastLoginAt) : '—'}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

      {list && list.total > 0 && (
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} total={list.total} />
        </div>
      )}

      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={selectedName ?? t('page.members.title')}
        width={1120}
      >
        <MemberDetailContent
          detail={detail}
          detailError={detailError}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onRefund={setRefundTarget}
          onReload={() => setReloadKey((k) => k + 1)}
        />
      </Modal>

      {refundTarget && detail && (
        <RefundModal
          registration={refundTarget}
          examineeName={detail.user.name}
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
