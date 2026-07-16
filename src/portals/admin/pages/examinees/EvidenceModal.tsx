import { useEffect, useState } from 'react';
import { X, AlertTriangle, ShieldAlert, Radio, Camera, Monitor } from 'lucide-react';
import { StatusBadge } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi, AiEvidenceItem, LiveDetail } from '@admin/services/api';

interface EvidenceModalProps {
  sessionId: string;
  candidateName: string;
  onClose: () => void;
}

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function modeLabel(
  t: (k: string, vars?: Record<string, string | number>) => string,
  mode: string | null | undefined,
  prefix: 'exm.ev.mode' | 'mon.mode',
): string {
  if (!mode) return '—';
  const k = `${prefix}.${mode}`;
  const tr = t(k);
  return tr === k ? mode : tr;
}

/**
 * Modal viewer for a TERMINATED (or any) session's proctor record. Pulls
 * the timeline from /admin/monitor/sessions/:id and the signed AI evidence
 * URLs from /admin/sessions/:id/proctor/evidence — the same shape the live
 * MonitoringPage uses.
 *
 * Dispute-ready fields (checklist §9-6): termination mode, failReason,
 * per-event triggerMode, and the exact (or stamped) wording shown to the
 * candidate, alongside time / type / webcam+screen evidence.
 */
export function EvidenceModal({ sessionId, candidateName, onClose }: EvidenceModalProps) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<LiveDetail | null>(null);
  const [evidenceById, setEvidenceById] = useState<Record<string, AiEvidenceItem>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setEvidenceById({});
    setError(null);
    Promise.all([adminApi.getMonitorSession(sessionId), adminApi.getAiEvidence(sessionId)])
      .then(([d, ev]) => {
        if (cancelled) return;
        setDetail(d.data);
        const map: Record<string, AiEvidenceItem> = {};
        for (const item of ev.data.items) map[item.id] = item;
        setEvidenceById(map);
      })
      .catch((e) => {
        if (cancelled) return;
        const err = e as { response?: { data?: { message?: string } } };
        setError(err.response?.data?.message ?? 'Failed to load evidence');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {t('exm.ev.title', { name: candidateName })}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('exm.ev.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {detail && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">{t('exm.ev.session')}</div>
                <div className="text-slate-800 mt-0.5 font-mono text-[11px]">{detail.sessionId}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('exm.ev.warnings')}</div>
                <div className="text-slate-800 mt-0.5 tabular-nums">{detail.warnings}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('exm.ev.startedAt')}</div>
                <div className="text-slate-800 mt-0.5 tabular-nums">{fmtDate(detail.startedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('exm.ev.terminatedAt')}</div>
                <div className="text-slate-800 mt-0.5 tabular-nums">{fmtDate(detail.submittedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">{t('exm.ev.termMode')}</div>
                <div className="mt-0.5">
                  {detail.terminationMode ? (
                    <StatusBadge
                      tone={
                        detail.terminationMode === 'IMMEDIATE'
                          ? 'red'
                          : detail.terminationMode === 'AFTER_WARNING'
                            ? 'orange'
                            : 'blue'
                      }
                    >
                      {modeLabel(t, detail.terminationMode, 'exm.ev.mode')}
                    </StatusBadge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-slate-500">{t('exm.ev.failReason')}</div>
                <div className="text-slate-800 mt-0.5 text-[13px] leading-snug">
                  {detail.failReason?.trim() || '—'}
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
              {t('exm.ev.timeline')}
            </div>
            {!detail ? (
              <div className="py-4 text-sm text-slate-400">{t('common.loading')}</div>
            ) : detail.events.length === 0 ? (
              <div className="py-4 text-sm text-slate-400">{t('exm.ev.empty')}</div>
            ) : (
              <ul className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {detail.events.map((p) => {
                  const lvl = p.severity === 'HIGH' ? 'HIGH' : p.severity === 'MED' || p.severity === 'MEDIUM' ? 'MEDIUM' : 'INFO';
                  const ev = evidenceById[p.id];
                  const webcamSrc = ev?.evidenceUrl ?? null;
                  const screenSrc = ev?.screenEvidenceUrl ?? null;
                  const audioSrc = ev?.videoClipUrl ?? null;
                  const shown =
                    p.candidateMessage?.trim() ||
                    p.captionEn?.trim() ||
                    p.captionKo?.trim() ||
                    null;
                  const typeLabel = (() => {
                    const k = `evidence.type.${p.type}`;
                    const tr = t(k);
                    return tr === k ? p.type : tr;
                  })();
                  return (
                    <li
                      key={p.id}
                      className="flex flex-col gap-2 py-2 px-3 rounded border border-slate-100 hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-3 text-sm">
                        <span className="text-xs text-slate-400 tabular-nums w-20 mt-0.5">
                          {fmtTime(new Date(p.createdAt))}
                        </span>
                        <div className="flex flex-col gap-1 shrink-0">
                          <StatusBadge tone={lvl === 'HIGH' ? 'red' : lvl === 'MEDIUM' ? 'orange' : 'blue'}>
                            {(() => { const k = `severity.${lvl}`; const tr = t(k); return tr === k ? lvl : tr; })()}
                          </StatusBadge>
                          {p.triggerMode && p.triggerMode !== 'INFO' && (
                            <StatusBadge
                              tone={p.triggerMode === 'IMMEDIATE' ? 'red' : 'orange'}
                            >
                              {modeLabel(t, p.triggerMode, 'exm.ev.mode')}
                            </StatusBadge>
                          )}
                        </div>
                        <span className="flex flex-col gap-1 flex-1 text-slate-700 min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="text-slate-400 shrink-0">
                              {lvl === 'HIGH' ? (
                                <ShieldAlert className="w-3.5 h-3.5" />
                              ) : lvl === 'MEDIUM' ? (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              ) : (
                                <Radio className="w-3.5 h-3.5" />
                              )}
                            </span>
                            <span>{typeLabel}</span>
                          </span>
                          {shown && (
                            <span className="text-[12px] text-slate-600 pl-5 leading-snug">
                              <span className="text-slate-400">{t('exm.ev.shownToCandidate')}: </span>
                              {shown}
                            </span>
                          )}
                        </span>
                      </div>
                      {webcamSrc || screenSrc || audioSrc ? (
                        <div className="flex flex-wrap gap-3 pl-[5.25rem]">
                          {webcamSrc && (
                            <EvidenceImage src={webcamSrc} label={t('exm.ev.webcam')} icon={<Camera className="w-3 h-3" />} />
                          )}
                          {screenSrc && (
                            <EvidenceImage src={screenSrc} label={t('exm.ev.screen')} icon={<Monitor className="w-3 h-3" />} />
                          )}
                          {audioSrc && (
                            <div className="flex flex-col items-start gap-1">
                              <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                                <Radio className="w-3 h-3" />
                                {t('exm.ev.audio')}
                              </span>
                              <audio controls src={audioSrc} className="h-8" />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="pl-[5.25rem] text-[11px] text-slate-400 italic">
                          {t('exm.ev.noSnapshot')}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end px-6 py-4 border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 rounded-md"
          >
            {t('exm.ev.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EvidenceImage({ src, label, icon }: { src: string; label: string; icon: React.ReactNode }) {
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className="group flex flex-col items-start gap-1">
      <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
        {icon}
        {label}
      </span>
      <img
        src={src}
        alt={label}
        className="w-40 h-28 object-cover rounded border border-slate-200 group-hover:ring-2 group-hover:ring-indigo-300"
      />
    </a>
  );
}

export default EvidenceModal;
