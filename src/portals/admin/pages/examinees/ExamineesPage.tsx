import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { PageHeader, Button, Modal, pushToast } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  CertLevel,
  CertType,
  ExamineeDetail,
  ExamineeListResult,
  ExamineeRegistrationDetail,
  ExamineeStatus,
  adminApi,
  triggerBlobDownload,
} from '@admin/services/api';
import { RefundModal } from './RefundModal';
import { EvidenceModal } from './EvidenceModal';
import { useDebounce } from './lib/useDebounce';
import { ExamineesFilters } from './components/ExamineesFilters';
import { ExamineesList } from './components/ExamineesList';
import { ExamineeDetailContent, type DetailTab } from './components/ExamineeDetailContent';

const PAGE_SIZE = 20;

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

export function ExamineesScreen() {
  const { t } = useI18n();

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const [certType, setCertType] = useState<CertType | ''>('');
  const [level, setLevel] = useState<CertLevel | ''>('');
  const [status, setStatus] = useState<ExamineeStatus | ''>('');
  const [page, setPage] = useState(1);

  const [list, setList] = useState<ExamineeListResult | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExamineeDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('history');

  const [refundTarget, setRefundTarget] = useState<ExamineeRegistrationDetail | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<{ sessionId: string; name: string } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      return;
    }
    setPage(1);
    setExpandedId(null);
  }, [debouncedQ, certType, level, status]);

  useEffect(() => {
    let cancelled = false;
    setList(null);
    setListError(null);
    adminApi
      .getExaminees({
        q: debouncedQ.trim() || undefined,
        certType: (certType || undefined) as CertType | undefined,
        level: (level || undefined) as CertLevel | undefined,
        status: (status || undefined) as ExamineeStatus | undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        setList(res.data);
      })
      .catch((e) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setListError(err.response?.data?.message ?? 'Failed to load examinees');
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, certType, level, status, page, reloadKey]);

  useEffect(() => {
    if (!list || !expandedId) return;
    if (!list.items.some((r) => r.registrationId === expandedId)) {
      setExpandedId(null);
    }
  }, [list, expandedId]);

  useEffect(() => {
    if (!expandedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const row = list?.items.find((r) => r.registrationId === expandedId);
    if (!row) return;
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    adminApi
      .getExamineeDetail(row.user.id)
      .then((res) => !cancelled && setDetail(res.data))
      .catch((e) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setDetailError(err.response?.data?.message ?? 'Failed to load detail');
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, list, reloadKey]);

  const handleToggleExpand = (registrationId: string) => {
    setExpandedId((prev) => (prev === registrationId ? null : registrationId));
  };

  const onExport = async () => {
    if (list && list.total === 0) {
      pushToast(t('exm.exportEmpty'), 'orange');
      return;
    }
    setExporting(true);
    try {
      const res = await adminApi.exportExaminees({
        q: debouncedQ.trim() || undefined,
        certType: (certType || undefined) as CertType | undefined,
        level: (level || undefined) as CertLevel | undefined,
        status: (status || undefined) as ExamineeStatus | undefined,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(res.data, `examinees_${stamp}.xlsx`);
      pushToast(t('exm.exportOk'), 'green');
    } catch (e) {
      const msg = (await extractBlobError(e)) || t('exm.exportFailed');
      pushToast(msg, 'red');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('exm.title')}
        subtitle={t('exm.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onExport} disabled={exporting || list === null}>
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t('common.excel')}
            </Button>
            <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
              <RefreshCw className="w-4 h-4" />
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      <ExamineesFilters
        q={q}
        onQChange={setQ}
        certType={certType}
        onCertChange={setCertType}
        level={level}
        onLevelChange={setLevel}
        status={status}
        onStatusChange={setStatus}
      />

      <ExamineesList
        list={list}
        listError={listError}
        expandedId={expandedId}
        onToggleExpand={handleToggleExpand}
        page={page}
        onPageChange={setPage}
      />

      <Modal
        open={!!expandedId}
        onClose={() => setExpandedId(null)}
        title={detail?.user.name ?? t('exm.title')}
        width={1120}
      >
        <ExamineeDetailContent
          detail={detail}
          detailError={detailError}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onRefund={(reg) => setRefundTarget(reg)}
          onViewEvidence={(sessionId, name) => setEvidenceTarget({ sessionId, name })}
          onRefresh={() => setReloadKey((k) => k + 1)}
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
      {evidenceTarget && (
        <EvidenceModal
          sessionId={evidenceTarget.sessionId}
          candidateName={evidenceTarget.name}
          onClose={() => setEvidenceTarget(null)}
        />
      )}
    </div>
  );
}

export default ExamineesScreen;
