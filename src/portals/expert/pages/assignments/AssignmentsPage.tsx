import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Card,
  CertTag,
  certCodeOf,
  FilterBar,
  PageHeader,
  Pagination,
  Select,
  SimpleKpiCard,
  Tabs,
  TabItem,
  Table,
  TableWrap,
  Td,
  Th,
} from '@expert/components/shared/ui-kit';
import {
  expertApi,
  type CertLevel,
  type CertType,
  type GradingCounts,
  type GradingQueueTab,
  type GradingRow,
  type PracticalState,
} from '@expert/services/api';

const PAGE_SIZE = 20;

const TABS: { id: GradingQueueTab; label: string; warn?: boolean }[] = [
  { id: 'all', label: '전체' },
  { id: 'ai_graded', label: 'AI 1차 완료' },
  { id: 'reviewing', label: '검수 중' },
  { id: 'final', label: '확정' },
  { id: 'overdue', label: '지연', warn: true },
];

function pracBadge(s: PracticalState) {
  switch (s) {
    case 'auto':
      return <span className="text-[var(--gray-600)]">자동</span>;
    case 'ai_graded':
      return <span className="text-[var(--blue)]">AI 1차</span>;
    case 'expert_reviewing':
      return <span className="text-[var(--orange)]">검수 중</span>;
    case 'final':
      return <span className="text-[var(--green)]">확정</span>;
    case 'expert_disputed':
      return <span className="text-[var(--red)]">이의제기</span>;
  }
}

function ddayLabel(daysToDue: number, overdue: boolean): string {
  if (overdue) return `D+${Math.abs(daysToDue)}`;
  if (daysToDue <= 0) return 'D-day';
  return `D-${daysToDue}`;
}

function certLabel(c: CertType) {
  return c === 'AXIS_C' ? 'AXIS-C' : c === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

function tabCount(c: GradingCounts | null, id: GradingQueueTab): number {
  if (!c) return 0;
  const map: Record<GradingQueueTab, number> = {
    all: c.all,
    auto_done: c.autoDone,
    ai_graded: c.aiDone,
    reviewing: c.reviewing,
    final: c.final,
    overdue: c.overdue,
    terminated: c.terminated,
  };
  return map[id];
}

interface Props {
  onCompetenciesChanged?: (cts: CertType[]) => void;
  onOverdueChanged?: (n: number) => void;
}

export default function AssignmentsPage({ onCompetenciesChanged, onOverdueChanged }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<GradingQueueTab>('all');
  const [rows, setRows] = useState<GradingRow[] | null>(null);
  const [counts, setCounts] = useState<GradingCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [certFilter, setCertFilter] = useState<CertType | 'ALL'>('ALL');
  const [levelFilter, setLevelFilter] = useState<CertLevel | 'ALL'>('ALL');
  const [roundFilter, setRoundFilter] = useState<number | 'ALL'>('ALL');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    expertApi
      .getQueue(tab)
      .then((res) => {
        if (cancelled) return;
        setRows(res.data);
        const distinct = Array.from(new Set(res.data.map((r) => r.certType)));
        if (distinct.length > 0) onCompetenciesChanged?.(distinct);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e?.response?.data?.message ?? '배정 목록을 불러오지 못했습니다');
      });
    return () => {
      cancelled = true;
    };
  }, [tab, onCompetenciesChanged]);

  useEffect(() => {
    expertApi
      .getCounts()
      .then((r) => {
        setCounts(r.data);
        onOverdueChanged?.(r.data.overdue);
      })
      .catch(() => undefined);
  }, [tab, onOverdueChanged]);

  useEffect(() => setPage(1), [tab, certFilter, levelFilter, roundFilter]);

  const distinctCerts = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.certType))),
    [rows],
  );
  const distinctRounds = useMemo(
    () =>
      Array.from(
        new Set((rows ?? []).map((r) => r.roundNumber).filter((n): n is number => n != null)),
      ).sort((a, b) => b - a),
    [rows],
  );

  const filtered = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (certFilter !== 'ALL' && r.certType !== certFilter) return false;
      if (levelFilter !== 'ALL' && r.level !== levelFilter) return false;
      if (roundFilter !== 'ALL' && r.roundNumber !== roundFilter) return false;
      return true;
    });
  }, [rows, certFilter, levelFilter, roundFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  const tabItems: TabItem<GradingQueueTab>[] = TABS.map((tt) => ({
    id: tt.id,
    label: tt.label,
    count: tabCount(counts, tt.id),
    warn: tt.warn,
  }));

  const overdueRows = (rows ?? []).filter((r) => r.overdue);

  return (
    <div>
      <PageHeader
        title="내 배정 과제"
        subtitle="L1·L2 실기 시험이 제출되면 자동으로 표시됩니다. 관리자 배정 없이 채점을 시작할 수 있습니다."
      />

      <div className="grid grid-cols-4 gap-3.5 mb-5">
        <SimpleKpiCard label="AI 1차 완료" value={counts?.aiDone ?? '—'} unit="건" />
        <SimpleKpiCard label="검수 진행" value={counts?.reviewing ?? '—'} unit="건" />
        <SimpleKpiCard label="확정" value={counts?.final ?? '—'} unit="건" />
        <SimpleKpiCard label="지연" value={counts?.overdue ?? '—'} unit="건" />
      </div>

      {overdueRows.length > 0 && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40">
          <div className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">
              <span className="font-medium">지연된 채점 {overdueRows.length}건</span> —{' '}
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
        {distinctCerts.length > 1 && (
          <Select
            value={certFilter}
            onChange={(e) => setCertFilter(e.target.value as CertType | 'ALL')}
          >
            <option value="ALL">자격 전체</option>
            {distinctCerts.map((c) => (
              <option key={c} value={c}>
                {certLabel(c)}
              </option>
            ))}
          </Select>
        )}
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as CertLevel | 'ALL')}
        >
          <option value="ALL">등급 전체</option>
          <option value="L1">L1</option>
          <option value="L2">L2</option>
          <option value="L3">L3</option>
        </Select>
        <Select
          value={roundFilter === 'ALL' ? 'ALL' : String(roundFilter)}
          onChange={(e) =>
            setRoundFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
          }
        >
          <option value="ALL">회차 전체</option>
          {distinctRounds.map((n) => (
            <option key={n} value={n}>
              {n}회차
            </option>
          ))}
        </Select>
      </FilterBar>

      {error && (
        <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">
          {error}
        </Card>
      )}

      <TableWrap>
        <Table>
          <thead>
            <tr>
              <Th>세션</Th>
              <Th>응시자</Th>
              <Th>자격</Th>
              <Th>등급</Th>
              <Th>회차</Th>
              <Th align="right">필기</Th>
              <Th>실기 상태</Th>
              <Th>합/불</Th>
              <Th>D-Day</Th>
              <Th align="right">동작</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <Td colSpan={10} className="!text-center !text-[var(--gray-400)] !py-12">
                  불러오는 중…
                </Td>
              </tr>
            )}
            {rows !== null && filtered.length === 0 && (
              <tr>
                <Td colSpan={10} className="!text-center !text-[var(--gray-400)] !py-12">
                  표시할 과제가 없습니다.
                </Td>
              </tr>
            )}
            {pagedRows.map((r) => (
              <tr
                key={r.sessionId}
                className={`hover:bg-[var(--gray-50)] ${r.overdue ? 'bg-[var(--red-50)]' : ''}`}
              >
                <Td mono>{r.sessionId.slice(-12)}</Td>
                <Td strong>{r.candidate}</Td>
                <Td>
                  <CertTag code={certCodeOf(r.certType)} />
                </Td>
                <Td strong>{r.level}</Td>
                <Td>{r.roundNumber != null ? `${r.roundNumber}회차` : '—'}</Td>
                <Td align="right" className="tabular-nums" strong>
                  {r.writtenScore != null ? `${r.writtenScore}점` : '—'}
                </Td>
                <Td>{pracBadge(r.practicalState)}</Td>
                <Td>
                  {r.result === 'pass' ? (
                    <span className="text-[var(--green)]">합격</span>
                  ) : r.result === 'fail' ? (
                    <span className="text-[var(--gray-600)]">불합격</span>
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
                  {r.mandatoryReview && (
                    <span className="ml-1.5 inline-flex items-center text-[10px] text-[var(--red)] bg-rose-50 border border-rose-200 rounded px-1 py-0.5">
                      필수
                    </span>
                  )}
                </Td>
                <Td align="right">
                  <Button
                    variant="blue"
                    size="sm"
                    onClick={() => navigate(`/sessions/${r.sessionId}`)}
                  >
                    {r.practicalState === 'final' ? '상세' : '채점하기'}
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      <Pagination page={page} totalPages={totalPages} onChange={setPage} total={filtered.length} />
    </div>
  );
}
