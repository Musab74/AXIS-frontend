import { useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import {
  Card,
  PageHeader,
  SectionHeader,
  Button,
  Chip,
  Tabs,
  type TabItem,
  TableWrap,
  Table,
  Th,
  Td,
  CertTag,
  certCodeOf,
  pushToast,
  StatusBadge,
  Select,
} from '@admin/components/shared/ui-kit';
import {
  adminApi,
  type ObjectionKind,
  type ObjectionRow,
  type ObjectionStatus,
} from '@admin/services/api';
import { AxiosError } from 'axios';
import { useI18n } from '@admin/i18n';
import { adminPathForPage } from '@admin/adminRoutes';

type StatusTab = 'OPEN' | 'COMPLETE' | 'ALL';

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd} ${hh}:${mi}`;
}

function statusTone(s: ObjectionStatus): 'amber' | 'blue' | 'green' {
  if (s === 'RECEIVED') return 'amber';
  if (s === 'UNDER_REVIEW') return 'blue';
  return 'green';
}

export default function ObjectionsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<StatusTab>('OPEN');
  const [kindFilter, setKindFilter] = useState<ObjectionKind | 'ALL'>('ALL');
  const [rows, setRows] = useState<ObjectionRow[] | null>(null);
  const [selected, setSelected] = useState<ObjectionRow | null>(null);
  const [history, setHistory] = useState<NonNullable<ObjectionRow['history']>>([]);
  const [busy, setBusy] = useState(false);
  const [resolution, setResolution] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    setRows(null);
    adminApi
      .getObjections({
        status: tab,
        kind: kindFilter === 'ALL' ? undefined : kindFilter,
        limit: 50,
      })
      .then((r) => setRows(r.data.items))
      .catch(() => pushToast(t('obj.loadFail'), 'red'));
  }, [tab, kindFilter, reloadKey, t]);

  const openDetail = async (row: ObjectionRow) => {
    setSelected(row);
    setResolution(row.resolution ?? '');
    setHistory([]);
    try {
      const res = await adminApi.getObjection(row.id);
      setSelected(res.data);
      setHistory(res.data.history ?? []);
      setResolution(res.data.resolution ?? '');
    } catch {
      pushToast(t('obj.loadFail'), 'red');
    }
  };

  const setStatus = async (status: ObjectionStatus) => {
    if (!selected) return;
    if (status === 'COMPLETE' && !resolution.trim()) {
      pushToast(t('obj.resolutionRequired'), 'orange');
      return;
    }
    setBusy(true);
    try {
      const res = await adminApi.updateObjectionStatus(selected.id, {
        status,
        resolution: status === 'COMPLETE' ? resolution.trim() : undefined,
      });
      setSelected(res.data);
      setHistory(res.data.history ?? []);
      pushToast(t('obj.saved'), 'green');
      reload();
    } catch (e) {
      const msg = (e as AxiosError<{ message?: string }>)?.response?.data?.message;
      pushToast(msg || t('obj.saveFail'), 'red');
    } finally {
      setBusy(false);
    }
  };

  const tabItems: TabItem<StatusTab>[] = [
    { id: 'OPEN', label: t('obj.tab.open') },
    { id: 'COMPLETE', label: t('obj.tab.complete') },
    { id: 'ALL', label: t('obj.tab.all') },
  ];

  return (
    <div>
      <PageHeader title={t('page.objections.title')} subtitle={t('page.objections.sub')} />

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <Card className="p-5 xl:col-span-3">
          <SectionHeader title={t('obj.list')} subtitle={rows ? `${rows.length}` : ''} />
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Tabs tabs={tabItems} active={tab} onChange={setTab} />
            <Select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as ObjectionKind | 'ALL')}
              aria-label={t('obj.filter.kind')}
            >
              <option value="ALL">{t('obj.filter.kindAll')}</option>
              <option value="SCORE">{t('obj.kind.SCORE')}</option>
              <option value="FORCED_TERMINATION">{t('obj.kind.FORCED_TERMINATION')}</option>
            </Select>
          </div>

          {!rows ? (
            <div className="py-12 flex justify-center text-[var(--gray-400)]">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-[var(--gray-500)] text-[14px]">{t('obj.empty')}</div>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th align="left">{t('obj.col.candidate')}</Th>
                    <Th>{t('obj.col.kind')}</Th>
                    <Th>{t('obj.col.session')}</Th>
                    <Th>{t('obj.col.filed')}</Th>
                    <Th>{t('obj.col.status')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={`cursor-pointer hover:bg-[var(--gray-50)] ${selected?.id === r.id ? 'bg-[var(--blue-50)]' : ''}`}
                      onClick={() => void openDetail(r)}
                    >
                      <Td align="left">
                        <div className="font-medium text-[var(--gray-800)]">{r.user?.name ?? '—'}</div>
                        <div className="text-[12px] text-[var(--gray-500)]">{r.user?.userId ?? r.user?.email}</div>
                      </Td>
                      <Td>
                        <Chip tone={r.kind === 'SCORE' ? 'blue' : 'red'}>{t(`obj.kind.${r.kind}`)}</Chip>
                      </Td>
                      <Td>
                        <CertTag code={certCodeOf(r.session.certType)} />
                        <span className="text-[12px] text-[var(--gray-500)] ml-1">{r.session.level}</span>
                        <div className="text-[11px] text-[var(--gray-400)] font-mono mt-0.5 truncate max-w-[120px]">
                          {r.sessionId.slice(0, 10)}…
                        </div>
                      </Td>
                      <Td className="text-[13px] text-[var(--gray-600)]">{formatWhen(r.createdAt)}</Td>
                      <Td>
                        <Chip tone={statusTone(r.status)}>{t(`obj.status.${r.status}`)}</Chip>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card className="p-5 xl:col-span-2">
          <SectionHeader title={t('obj.detail')} />
          {!selected ? (
            <div className="py-10 text-center text-sm text-[var(--gray-400)]">{t('obj.detailEmpty')}</div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone={selected.status === 'COMPLETE' ? 'green' : selected.status === 'UNDER_REVIEW' ? 'blue' : 'orange'}>
                  {t(`obj.status.${selected.status}`)}
                </StatusBadge>
                <Chip tone={selected.kind === 'SCORE' ? 'blue' : 'red'}>{t(`obj.kind.${selected.kind}`)}</Chip>
              </div>
              <div>
                <div className="text-xs text-[var(--gray-500)]">{t('obj.col.candidate')}</div>
                <div className="font-medium">{selected.user?.name}</div>
                <div className="text-[12px] text-[var(--gray-500)]">{selected.user?.email}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--gray-500)]">{t('obj.col.session')}</div>
                <div className="font-mono text-[12px]">{selected.sessionId}</div>
                <div className="text-[12px] text-[var(--gray-600)] mt-0.5">
                  {selected.session.certType} {selected.session.level} · {selected.session.status}
                  {selected.session.totalScore != null ? ` · ${selected.session.totalScore}` : ''}
                </div>
                {selected.session.failReason && (
                  <div className="text-[12px] text-rose-600 mt-1">{selected.session.failReason}</div>
                )}
                <a
                  href={`/axis_manager${adminPathForPage('examinee')}`}
                  className="inline-flex items-center gap-1 text-[12px] text-[var(--blue)] mt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" /> {t('obj.openExaminee')}
                </a>
              </div>
              <div>
                <div className="text-xs text-[var(--gray-500)] mb-1">{t('obj.reason')}</div>
                <div className="rounded-md border border-[var(--gray-border)] bg-[var(--gray-50)] p-3 whitespace-pre-wrap text-[13px] leading-relaxed">
                  {selected.reason}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--gray-500)] mb-1">{t('obj.resolution')}</div>
                <textarea
                  className="w-full min-h-[100px] text-sm border border-[var(--gray-border)] rounded-md p-2.5 bg-white text-[var(--gray-700)] disabled:bg-[var(--gray-50)]"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={selected.status === 'COMPLETE' || busy}
                  placeholder={t('obj.resolutionPh')}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.status === 'RECEIVED' && (
                  <Button variant="secondary" disabled={busy} onClick={() => void setStatus('UNDER_REVIEW')}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {t('obj.action.review')}
                  </Button>
                )}
                {selected.status !== 'COMPLETE' && (
                  <Button variant="blue" disabled={busy} onClick={() => void setStatus('COMPLETE')}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    {t('obj.action.complete')}
                  </Button>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-[var(--gray-400)] mb-2">
                  {t('obj.history')}
                </div>
                {history.length === 0 ? (
                  <div className="text-[12px] text-[var(--gray-400)]">{t('obj.historyEmpty')}</div>
                ) : (
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {history.map((h) => (
                      <li key={h.id} className="text-[12px] border-l-2 border-[var(--gray-200)] pl-2">
                        <div className="text-[var(--gray-500)]">{formatWhen(h.createdAt)}</div>
                        <div className="text-[var(--gray-800)] font-medium">{h.action}</div>
                        <div className="text-[var(--gray-600)] font-mono text-[11px] truncate">
                          {JSON.stringify(h.after)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
