import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Card,
  PageHeader,
  SectionHeader,
  Button,
  Chip,
  type ChipTone,
  Tabs,
  type TabItem,
  TableWrap,
  Table,
  Th,
  Td,
  CertTag,
  certCodeOf,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { adminApi, type RefundRequestRow } from '@admin/services/api';
import { AxiosError } from 'axios';

type StatusTab = 'PENDING' | 'ALL';

const TIER_LABEL: Record<string, string> = {
  FULL: '100% 환불',
  HALF: '50% 환불',
  NONE: '환불 불가',
  ADMIN_FULL: '전액(관리자)',
  NO_PAYMENT: '결제 없음',
};

function formatKrw(n: number) {
  return `KRW ${n.toLocaleString()}`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

export default function RefundRequestsPage() {
  const [tab, setTab] = useState<StatusTab>('PENDING');
  const [rows, setRows] = useState<RefundRequestRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    setRows(null);
    adminApi
      .getRefundRequestQueue(tab)
      .then((r) => setRows(r.data))
      .catch(() => pushToast('환불 요청 목록을 불러오지 못했습니다', 'red'));
  }, [tab, reloadKey]);

  const approve = async (r: RefundRequestRow) => {
    if (
      !window.confirm(
        `환불을 실행합니다.\n\n예금주: ${r.holderName}\n${r.bankName} ${r.accountNumber}\n예상 금액: ${formatKrw(
          r.expectedAmount,
        )}\n\n되돌릴 수 없습니다. 계속하시겠습니까?`,
      )
    ) {
      return;
    }
    setBusyId(r.registrationId);
    try {
      const res = await adminApi.approveRefundRequest(r.registrationId);
      pushToast(`환불 완료 (${formatKrw(res.data.refundAmount)})`, 'green');
      reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || '환불 처리 실패', 'red');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (registrationId: string) => {
    const note = window.prompt('반려 사유 (응시자에게 안내 가능):') ?? undefined;
    if (note === undefined) return;
    setBusyId(registrationId);
    try {
      await adminApi.rejectRefundRequest(registrationId, note || undefined);
      pushToast('환불 요청이 반려되었습니다', 'orange');
      reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || '처리 실패', 'red');
    } finally {
      setBusyId(null);
    }
  };

  const tabItems: TabItem<StatusTab>[] = [
    { id: 'PENDING', label: '처리 대기' },
    { id: 'ALL', label: '전체' },
  ];

  return (
    <div>
      <PageHeader
        title="환불 요청"
        subtitle="응시자가 마이페이지에서 계좌 정보와 함께 신청한 환불 요청입니다. 확인 후 환불을 실행하면 결제가 취소되고 접수가 종료됩니다."
      />

      <Card className="p-5">
        <SectionHeader title="환불 요청 목록" subtitle={rows ? `${rows.length}건` : ''} />
        <div className="mb-4">
          <Tabs tabs={tabItems} active={tab} onChange={setTab} />
        </div>

        {!rows ? (
          <div className="py-12 flex justify-center text-[var(--gray-400)]">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-[var(--gray-500)] text-[14px]">
            {tab === 'PENDING' ? '대기 중인 환불 요청이 없습니다.' : '환불 요청 내역이 없습니다.'}
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th align="left">응시자</Th>
                  <Th>자격</Th>
                  <Th align="left">환불 계좌</Th>
                  <Th align="right">예상 금액</Th>
                  <Th>요청일</Th>
                  <Th>상태</Th>
                  <Th align="right">처리</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pending = r.status === 'PENDING';
                  const busy = busyId === r.registrationId;
                  return (
                    <tr key={r.registrationId}>
                      <Td align="left">
                        <div className="font-medium text-[var(--gray-800)]">{r.userName}</div>
                        <div className="text-[12px] text-[var(--gray-500)]">{r.userEmail ?? '—'}</div>
                        {r.candidateNote && (
                          <div className="text-[12px] text-[var(--gray-600)] mt-1 max-w-[220px]">
                            요청 메모: {r.candidateNote}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <CertTag code={certCodeOf(r.certType)} />
                        <span className="text-[12px] text-[var(--gray-500)] ml-1">{r.level}</span>
                        <div className="text-[12px] text-[var(--gray-500)] mt-1">{r.roundNumber}회</div>
                        {r.paymentMethod && (
                          <div className="text-[11px] text-[var(--gray-400)] mt-0.5">{r.paymentMethod}</div>
                        )}
                      </Td>
                      <Td align="left">
                        <div className="text-[13px] font-medium text-[var(--gray-800)]">{r.bankName}</div>
                        <div className="text-[13px] text-[var(--gray-600)] font-en">{r.accountNumber}</div>
                        <div className="text-[12px] text-[var(--gray-500)]">예금주 {r.holderName}</div>
                      </Td>
                      <Td align="right" className="font-en font-semibold">
                        {formatKrw(r.status === 'APPROVED' && r.processedAmount != null ? r.processedAmount : r.expectedAmount)}
                        <div className="text-[11px] text-[var(--gray-400)] font-normal">
                          {TIER_LABEL[r.refundTier] ?? r.refundTier}
                        </div>
                      </Td>
                      <Td className="text-[13px] text-[var(--gray-600)]">{formatWhen(r.requestedAt)}</Td>
                      <Td>
                        <Chip
                          tone={
                            (r.status === 'PENDING'
                              ? 'amber'
                              : r.status === 'APPROVED'
                                ? 'green'
                                : 'red') as ChipTone
                          }
                        >
                          {r.status === 'PENDING'
                            ? '환불 대기'
                            : r.status === 'APPROVED'
                              ? '환불 완료'
                              : '요청 반려'}
                        </Chip>
                      </Td>
                      <Td align="right">
                        {pending ? (
                          <div className="inline-flex gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={busy}
                              onClick={() => void approve(r)}
                            >
                              {busy ? '…' : '환불 실행'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void reject(r.registrationId)}
                            >
                              반려
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[var(--gray-400)]">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
