import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
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
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  ExamineeRegistrationDetail,
  MemberProfile,
  SearchUsersResult,
  UserSummary,
} from '@admin/services/api';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { AccountStatusBadge } from '../examinees/components/AccountStatusBadge';
import { RefundModal } from '../examinees/RefundModal';
import { useDebounce } from '../examinees/lib/useDebounce';
import { fmtDate, fmtDateTime } from '../examinees/lib/format';
import { MemberDetailContent, type MemberDetailTab } from './components/MemberDetailContent';

const PAGE_SIZE = 20;

function fmtNice(v: boolean, t: (k: string) => string): string {
  return v ? '✓' : '✕';
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

  const kpis = useMemo(() => {
    const items = list?.items ?? [];
    return {
      total: list?.total ?? 0,
      active: items.filter((u) => u.accountStatus === 'ACTIVE').length,
      suspended: items.filter((u) => u.accountStatus === 'SUSPENDED').length,
      penalty: items.filter((u) => u.activePenaltyCount > 0).length,
    };
  }, [list]);

  const openRow = (row: UserSummary) => {
    setSelectedId(row.id);
    setActiveTab('profile');
  };

  const selectedName = detail?.user.name ?? list?.items.find((r) => r.id === selectedId)?.name;

  return (
    <div>
      <PageHeader
        title={t('page.members.title')}
        subtitle={t('page.members.sub')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            {t('common.refresh')}
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SimpleKpiCard label={t('mem.kpi.total')} value={kpis.total} />
        <SimpleKpiCard label={t('mem.kpi.active')} value={kpis.active} />
        <SimpleKpiCard label={t('mem.kpi.suspended')} value={kpis.suspended} />
        <SimpleKpiCard label={t('mem.kpi.penalty')} value={kpis.penalty} />
      </div>

      <FilterBar className="mb-4">
        <Select
          value={accountStatus}
          onChange={(e) => setAccountStatus(e.target.value)}
        >
          <option value="">{t('mem.filter.status')}: {t('mem.filter.all')}</option>
          <option value="ACTIVE">{t('exm.account.ACTIVE')}</option>
          <option value="SUSPENDED">{t('exm.account.SUSPENDED')}</option>
          <option value="WITHDRAWN">{t('exm.account.WITHDRAWN')}</option>
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t('mem.filter.role')}: {t('mem.filter.all')}</option>
          <option value="EXAMINEE">EXAMINEE</option>
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
                  <Td>{fmtNice(row.niceVerified, t)}</Td>
                  <Td className="tabular-nums">{row.activePenaltyCount}</Td>
                  <Td muted className="whitespace-nowrap tabular-nums">{fmtDate(row.createdAt)}</Td>
                  <Td muted className="whitespace-nowrap tabular-nums text-xs">
                    {row.lastLoginAt ? fmtDateTime(row.lastLoginAt) : '—'}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableWrap>

      {list && list.total > PAGE_SIZE && (
        <div className="mt-4">
          <Pagination
            page={page}
            totalPages={Math.ceil(list.total / PAGE_SIZE)}
            onChange={setPage}
            total={list.total}
          />
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
