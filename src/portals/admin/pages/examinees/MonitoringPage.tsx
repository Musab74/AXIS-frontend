import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  WifiOff,
  Ban,
  Camera,
  Monitor,
  Clock,
  ShieldAlert,
  Radio,
  Timer,
} from "lucide-react";
import {
  Card,
  CardHeader,
  PageHeader,
  SimpleKpiCard,
  StatusBadge,
  Chip,
  Button,
  Bar as ProgressBar,
  type ChipTone,
  type TabItem,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi, AiEvidenceItem, LiveDetail, LiveSessionRow, LiveStatus, LiveSummary } from '@admin/services/api';
import { getAdminSocket } from '@admin/services/adminSocket';

interface MonitorFramePayload {
  sessionId: string;
  imageBase64: string;
  ts: number;
}

interface MediaPulsePayload {
  sessionId: string;
  channel: 'webcam' | 'screen';
  ts: number;
}

interface FrameState {
  src: string;
  ts: number;
}

const FRAME_STALE_MS = 15_000;
/** Pull /monitor/live again at this cadence so the panel reconciles even if a WS event was dropped. */
const POLL_FALLBACK_MS = 10_000;
/**
 * A row missing from a poll snapshot but still receiving WS heartbeats within
 * this window is kept, so a transient empty/partial `/monitor/live` response
 * can't blink the roster out and back in.
 */
const LIVE_KEEP_MS = POLL_FALLBACK_MS * 2;
const MEDIA_FRESH_MS = 15_000;

interface FeedItem {
  id: string;
  time: string;
  level: 'HIGH' | 'MEDIUM' | 'INFO';
  who: string;
  msg: string;
  sessionId: string | null;
}

const FEED_MAX = 30;

type ProgressTone = 'blue' | 'green' | 'orange' | 'red' | 'gray';

const STATUS_CONFIG: Record<LiveStatus, { dot: string; bar: ProgressTone; tone: ChipTone; labelKey: string }> = {
  normal: { dot: 'bg-emerald-500', bar: 'green', tone: 'green', labelKey: 'mon.status.normal' },
  warning: { dot: 'bg-amber-500', bar: 'orange', tone: 'orange', labelKey: 'mon.status.warning' },
  danger: { dot: 'bg-rose-500', bar: 'red', tone: 'red', labelKey: 'mon.status.danger' },
  disconnected: { dot: 'bg-slate-400', bar: 'gray', tone: 'gray', labelKey: 'mon.status.disc' },
  submitted: { dot: 'bg-blue-500', bar: 'blue', tone: 'blue', labelKey: 'mon.status.submitted' },
  terminated: { dot: 'bg-slate-600', bar: 'gray', tone: 'red', labelKey: 'mon.status.term' },
};

const FEED_TONE: Record<FeedItem['level'], 'red' | 'orange' | 'blue'> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  INFO: 'blue',
};

function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function fmtAgo(t: (k: string, v?: Record<string, string | number>) => string, ms: number): string {
  if (ms < 1_500) return t('common.justNow');
  if (ms < 60_000) return t('common.secondsAgo', { n: Math.round(ms / 1_000) });
  if (ms < 3_600_000) return t('common.minutesAgo', { n: Math.round(ms / 60_000) });
  return t('common.hoursAgo', { n: Math.round(ms / 3_600_000) });
}

/**
 * Reconcile a fresh `/monitor/live` snapshot against the current (WS-maintained)
 * list. `wsAt` maps sessionId → the client-clock timestamp of its last WS
 * heartbeat. For any row whose heartbeat is still recent we keep the live WS
 * row verbatim and ignore the poll snapshot — otherwise a poll that lags behind
 * (reporting a live candidate as "disconnected", or omitting them entirely)
 * makes the roster flip status / blink out and back every cycle. Existing row
 * order is preserved; genuinely-new sessions from the poll are appended.
 */
function reconcileLive(
  cur: LiveSessionRow[] | null,
  fresh: LiveSessionRow[],
  wsAt: Map<string, number>,
): LiveSessionRow[] {
  const now = Date.now();
  const freshById = new Map(fresh.map((r) => [r.sessionId, r]));
  const result: LiveSessionRow[] = [];
  const used = new Set<string>();
  for (const row of cur ?? []) {
    const f = freshById.get(row.sessionId);
    const wsFresh = (wsAt.get(row.sessionId) ?? 0) > now - LIVE_KEEP_MS;
    if (f) {
      // Recent WS heartbeat → trust the live row, not the lagging poll.
      result.push(wsFresh ? row : f);
      used.add(row.sessionId);
    } else if (wsFresh) {
      result.push(row); // omitted by a stale poll but still streaming — keep it
    }
  }
  for (const f of fresh) {
    if (!used.has(f.sessionId)) result.push(f);
  }
  return result;
}

export function MonitoringScreen() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [examinees, setExaminees] = useState<LiveSessionRow[] | null>(null);
  // Mirror of `examinees` so the poll can reconcile against the latest
  // WS-updated list without adding it to the effect's dependency array.
  const examineesRef = useRef<LiveSessionRow[] | null>(null);
  // sessionId → client-clock time of its last WS heartbeat (frame or alive
  // session-update). Lets the poll tell a genuinely-gone session from one the
  // poll snapshot is merely lagging on, so live rows don't blink.
  const lastWsAtRef = useRef<Map<string, number>>(new Map());
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get('sessionId'),
  );
  const [detail, setDetail] = useState<LiveDetail | null>(null);
  /**
   * Map of `eventId → signed-url AiEvidenceItem` for the currently selected
   * session. Populated by a parallel fetch to `/admin/sessions/:id/proctor/evidence`
   * whenever the session selection changes; merged into the timeline rows so
   * we can render real `<img>` thumbnails (the raw `evidenceUrl` /
   * `screenEvidenceUrl` from `getMonitorSession` are NCP keys, not signed
   * URLs, and won't load directly in `<img>`).
   */
  const [evidenceById, setEvidenceById] = useState<Record<string, AiEvidenceItem>>({});
  const [filter, setFilter] = useState<'all' | 'warning' | 'disconnected' | 'terminated'>('all');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedIdRef = useRef(0);
  const [webcamFrame, setWebcamFrame] = useState<FrameState | null>(null);
  const [screenFrame, setScreenFrame] = useState<FrameState | null>(null);
  const [, setFrameTick] = useState(0);
  const [wsConnected, setWsConnected] = useState<boolean>(() => getAdminSocket().connected);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [extendOpen, setExtendOpen] = useState(false);

  const selectedRow = useMemo(
    () => examinees?.find((e) => e.sessionId === selectedId) ?? null,
    [examinees, selectedId],
  );
  const actionsEnabled =
    !!selectedId &&
    detail?.status === 'IN_PROGRESS' &&
    selectedRow?.status !== 'terminated' &&
    selectedRow?.status !== 'submitted';

  const pushFeed = (
    who: string,
    msg: string,
    level: FeedItem['level'] = 'INFO',
    sessionId: string | null = null,
  ) => {
    feedIdRef.current += 1;
    setFeed((prev) => [
      {
        id: `feed-${feedIdRef.current}`,
        time: fmtTime(new Date()),
        level,
        who,
        msg,
        sessionId,
      },
      ...prev,
    ].slice(0, FEED_MAX));
  };

  const jumpToSession = (sessionId: string) => {
    setSelectedId(sessionId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('sessionId', sessionId);
        return next;
      },
      { replace: true },
    );
  };

  const refreshDetail = async (sessionId: string) => {
    const res = await adminApi.getMonitorSession(sessionId);
    setDetail(res.data);
  };

  const runAction = async (fn: () => Promise<void>) => {
    if (!selectedId || actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      await fn();
    } catch {
      setActionError(t('mon.action.failed'));
    } finally {
      setActionBusy(false);
    }
  };

  // Keep the ref in lock-step with WS-driven list updates so the next poll
  // reconciles against the freshest state.
  useEffect(() => {
    examineesRef.current = examinees;
  }, [examinees]);

  // Initial load + slow polling fallback. The WS pushes session-update / live-status
  // continuously, but a poll-based reconcile every 10 s catches anything we'd lose
  // if the socket reconnects mid-session or if the sweeper hasn't fired yet for a
  // newly-started exam.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const [l, s] = await Promise.all([
          adminApi.getMonitorLive(),
          adminApi.getMonitorSummary(),
        ]);
        if (cancelled) return;
        const merged = reconcileLive(examineesRef.current, l.data, lastWsAtRef.current);
        examineesRef.current = merged;
        setExaminees(merged);
        setSummary(s.data);
        setSelectedId((cur) => {
          if (cur && merged.some((row) => row.sessionId === cur)) return cur;
          return merged[0]?.sessionId ?? null;
        });
      } catch {
        /* keep last-known state on transient failure */
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_FALLBACK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Deep-link from notification bell / feed: ?sessionId=…
  useEffect(() => {
    const deepLink = searchParams.get('sessionId');
    if (deepLink) setSelectedId(deepLink);
  }, [searchParams]);

  // WS subscriptions
  useEffect(() => {
    const sock = getAdminSocket();
    const onConnect = () => setWsConnected(true);
    const onDisconnect = () => setWsConnected(false);
    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    setWsConnected(sock.connected);

    const onSessionUpdate = (p: {
      sessionId: string;
      status: LiveStatus;
      progressPct: number;
      warnings: number;
      candidateName: string;
      examName: string;
    }) => {
      setExaminees((cur) => {
        const list = cur ? [...cur] : [];
        const idx = list.findIndex((r) => r.sessionId === p.sessionId);
        // Anything other than 'disconnected' or terminal is implicitly a heartbeat
        // — record "now" as the lastSeenAt so the per-row counter can tick down
        // from "live" without needing a fresh /monitor/live poll.
        const isAlive = p.status === 'normal' || p.status === 'warning' || p.status === 'danger';
        if (isAlive) lastWsAtRef.current.set(p.sessionId, Date.now());
        const next: LiveSessionRow = {
          sessionId: p.sessionId,
          candidateName: p.candidateName || (idx >= 0 ? list[idx].candidateName : '—'),
          examName: p.examName,
          level: idx >= 0 ? list[idx].level : 'L3',
          // The sweeper sends progressPct=0 for a status-only update; keep the
          // last-known progress so the bar doesn't snap back to 0% on disconnect.
          progressPct: idx >= 0 && p.progressPct === 0 ? list[idx].progressPct : p.progressPct,
          warnings: p.warnings,
          status: p.status,
          lastSeenAt: isAlive ? Date.now() : (idx >= 0 ? list[idx].lastSeenAt : null),
          webcamOnline: idx >= 0 ? list[idx].webcamOnline : false,
          screenOnline: idx >= 0 ? list[idx].screenOnline : false,
          webcamLastAt: idx >= 0 ? list[idx].webcamLastAt : null,
          screenLastAt: idx >= 0 ? list[idx].screenLastAt : null,
        };
        if (idx >= 0) list[idx] = next; else list.unshift(next);
        return list;
      });
    };
    const onAlert = (p: {
      sessionId: string;
      level: 'HIGH' | 'MEDIUM' | 'INFO';
      message: string;
      ts: number;
      candidateName?: string;
    }) => {
      const who =
        p.candidateName ||
        examineesRef.current?.find((r) => r.sessionId === p.sessionId)?.candidateName ||
        p.sessionId.slice(-8);
      const id = `evt-${++feedIdRef.current}`;
      setFeed((cur) => [
        {
          id,
          time: fmtTime(new Date(p.ts)),
          level: p.level,
          who,
          msg: p.message,
          sessionId: p.sessionId,
        },
        ...cur,
      ].slice(0, FEED_MAX));
      // Jump on violations (not INFO network noise).
      if (p.level === 'HIGH' || p.level === 'MEDIUM') {
        setSelectedId(p.sessionId);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.set('sessionId', p.sessionId);
            return next;
          },
          { replace: true },
        );
      }
    };
    const onLiveStatus = (p: LiveSummary) => setSummary(p);
    const applyMediaPulse = (sessionId: string, channel: 'webcam' | 'screen', ts: number) => {
      lastWsAtRef.current.set(sessionId, Date.now());
      setExaminees((cur) => {
        if (!cur) return cur;
        const idx = cur.findIndex((r) => r.sessionId === sessionId);
        if (idx < 0) return cur;
        const row = cur[idx];
        const recoveredStatus: LiveStatus =
          row.status === 'disconnected'
            ? row.warnings >= 3
              ? 'danger'
              : row.warnings >= 1
                ? 'warning'
                : 'normal'
            : row.status;
        const next: LiveSessionRow = {
          ...row,
          lastSeenAt: Date.now(),
          status: recoveredStatus,
          ...(channel === 'webcam'
            ? { webcamOnline: true, webcamLastAt: ts }
            : { screenOnline: true, screenLastAt: ts }),
        };
        const list = [...cur];
        list[idx] = next;
        return list;
      });
    };
    const bumpLastSeen = (sessionId: string) => {
      lastWsAtRef.current.set(sessionId, Date.now());
      setExaminees((cur) => {
        if (!cur) return cur;
        const idx = cur.findIndex((r) => r.sessionId === sessionId);
        if (idx < 0) return cur;
        const row = cur[idx];
        // A frame arriving means the candidate is alive. If the previous status
        // said disconnected, flip them back to normal/warning/danger based on
        // their warning count so the proctor sees the recovery instantly.
        const recoveredStatus: LiveStatus =
          row.status === 'disconnected'
            ? row.warnings >= 3
              ? 'danger'
              : row.warnings >= 1
              ? 'warning'
              : 'normal'
            : row.status;
        const next: LiveSessionRow = { ...row, lastSeenAt: Date.now(), status: recoveredStatus };
        const list = [...cur];
        list[idx] = next;
        return list;
      });
    };
    const onWebcamFrame = (p: MonitorFramePayload) => {
      bumpLastSeen(p.sessionId);
      applyMediaPulse(p.sessionId, 'webcam', p.ts);
      setWebcamFrame((cur) => {
        if (cur && cur.ts >= p.ts) return cur;
        return { src: `data:image/jpeg;base64,${p.imageBase64}`, ts: p.ts };
      });
    };
    const onScreenFrame = (p: MonitorFramePayload) => {
      bumpLastSeen(p.sessionId);
      applyMediaPulse(p.sessionId, 'screen', p.ts);
      setScreenFrame((cur) => {
        if (cur && cur.ts >= p.ts) return cur;
        return { src: `data:image/jpeg;base64,${p.imageBase64}`, ts: p.ts };
      });
    };
    const onMediaPulse = (p: MediaPulsePayload) => {
      applyMediaPulse(p.sessionId, p.channel, p.ts);
    };
    sock.on('exam:session-update', onSessionUpdate);
    sock.on('exam:alert', onAlert);
    sock.on('exam:live-status', onLiveStatus);
    sock.on('monitor:webcam-frame', onWebcamFrame);
    sock.on('monitor:screen-frame', onScreenFrame);
    sock.on('monitor:media-pulse', onMediaPulse);
    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('exam:session-update', onSessionUpdate);
      sock.off('exam:alert', onAlert);
      sock.off('exam:live-status', onLiveStatus);
      sock.off('monitor:webcam-frame', onWebcamFrame);
      sock.off('monitor:screen-frame', onScreenFrame);
      sock.off('monitor:media-pulse', onMediaPulse);
    };
  }, []);

  // Per-session subscription: tell the gateway which session's frames we want.
  // The previous selection is automatically un-watched so we don't keep paying
  // bandwidth for candidates the proctor has already moved past.
  useEffect(() => {
    if (!selectedId) return;
    const sock = getAdminSocket();
    sock.emit('admin:watch-session', { sessionId: selectedId });
    setWebcamFrame(null);
    setScreenFrame(null);
    return () => {
      sock.emit('admin:unwatch-session', { sessionId: selectedId });
    };
  }, [selectedId]);

  // Re-render once a second so the "X s ago" / "stale" overlays stay live
  // without the WS having to push a frame just to refresh the timestamp.
  useEffect(() => {
    const id = window.setInterval(() => setFrameTick((t) => (t + 1) % 1_000_000), 1_000);
    return () => window.clearInterval(id);
  }, []);

  // Detail fetch on selection. We fetch both the live session detail AND the
  // signed AI evidence list in parallel — the evidence endpoint is what
  // turns the raw NCP keys in `LiveDetail.events[].evidenceUrl` and
  // `screenEvidenceUrl` into something an `<img>` can load.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setEvidenceById({});
      return;
    }
    let cancelled = false;
    adminApi
      .getMonitorSession(selectedId)
      .then((res) => !cancelled && setDetail(res.data))
      .catch(() => !cancelled && setDetail(null));
    adminApi
      .getAiEvidence(selectedId)
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, AiEvidenceItem> = {};
        for (const item of res.data.items) map[item.id] = item;
        setEvidenceById(map);
      })
      .catch(() => !cancelled && setEvidenceById({}));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const list = examinees ?? [];
    if (filter === 'all') return list;
    if (filter === 'warning') return list.filter((e) => e.status === 'warning' || e.status === 'danger');
    if (filter === 'disconnected') return list.filter((e) => e.status === 'disconnected');
    return list.filter((e) => e.status === 'terminated');
  }, [examinees, filter]);

  const selected = filtered.find((e) => e.sessionId === selectedId) ?? (examinees ?? []).find((e) => e.sessionId === selectedId) ?? null;

  const kpis = useMemo(() => {
    const list = examinees ?? [];
    return [
      { labelKey: 'mon.kpi.connected', dot: 'bg-emerald-500', value: list.filter((e) => e.status === 'normal' || e.status === 'warning' || e.status === 'danger').length },
      { labelKey: 'mon.kpi.submitted', dot: 'bg-blue-500', value: list.filter((e) => e.status === 'submitted').length },
      { labelKey: 'mon.kpi.warned', dot: 'bg-amber-500', value: list.reduce((s, e) => s + (e.warnings > 0 ? 1 : 0), 0) },
      { labelKey: 'mon.kpi.terminated', dot: 'bg-rose-500', value: list.filter((e) => e.status === 'terminated').length },
      { labelKey: 'mon.kpi.disconnected', dot: 'bg-slate-400', value: list.filter((e) => e.status === 'disconnected').length },
    ];
  }, [examinees]);

  const allRows = examinees ?? [];
  const filterTabs: TabItem<typeof filter>[] = [
    { id: 'all', label: t('mon.tab.all'), count: allRows.length },
    { id: 'warning', label: t('mon.tab.warning'), count: allRows.filter((e) => e.status === 'warning' || e.status === 'danger').length },
    { id: 'disconnected', label: t('mon.tab.disc'), count: allRows.filter((e) => e.status === 'disconnected').length },
    { id: 'terminated', label: t('mon.tab.term'), count: allRows.filter((e) => e.status === 'terminated').length },
  ];

  const examLabel = summary?.inProgress
    ? (summary.examName || t('mon.subtitle'))
    : t('mon.noExam');
  const liveLine = summary?.inProgress
    ? `${summary.takers} ${t('mon.kpi.connected')}`
    : t('mon.noExam');
  const wsLabel = wsConnected ? t('chrome.wsConnected') : t('mon.wsReconnecting');
  const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5 flex-wrap">
            <span className="relative inline-block w-2.5 h-2.5 rounded-full bg-[var(--red)] shrink-0">
              <span className="absolute inset-[-4px] rounded-full bg-[var(--red)] opacity-40 animate-[pulse-dot_1.6s_ease-out_infinite]" />
            </span>
            <span className="whitespace-normal break-keep">{t('mon.title')}</span>
            <span className="px-2 py-0.5 rounded-full bg-[var(--red)] text-white text-[11px] font-bold tracking-wider align-middle shrink-0">
              LIVE
            </span>
          </span>
        }
        subtitle={`${examLabel} · ${wsLabel} · ${liveLine} · ${clock}`}
        actions={
          <Chip tone={wsConnected ? 'green' : 'orange'} dot pulse={wsConnected}>
            {wsLabel}
          </Chip>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-5">
        {kpis.map((s) => (
          <SimpleKpiCard
            key={s.labelKey}
            label={
              <span className="inline-flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {t(s.labelKey)}
              </span>
            }
            value={s.value}
          />
        ))}
      </div>

      {/* Main grid: roster · inspector · feed */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Roster */}
        <Card className="xl:col-span-3">
          <CardHeader
            title={
              <>
                {t('mon.roster')}
                <span className="text-[var(--blue)] font-bold tabular-nums">{examinees?.length ?? 0}</span>
              </>
            }
            right={
              <div className="flex gap-0.5">
                {filterTabs.map((tt) => {
                  const isActive = filter === tt.id;
                  return (
                    <button
                      key={tt.id}
                      onClick={() => setFilter(tt.id)}
                      className={`axis-focus px-2 py-1 rounded-md text-[12px] whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-[var(--blue-50)] text-[var(--blue)] font-semibold'
                          : 'text-[var(--gray-500)] hover:text-[var(--gray-700)] hover:bg-[var(--gray-50)]'
                      }`}
                    >
                      {tt.label}
                    </button>
                  );
                })}
              </div>
            }
          />
          <div className="px-3 pt-2 pb-3">
            {examinees === null ? (
              <div className="py-8 text-center text-sm text-[var(--gray-400)]">{t('common.loading') || 'Loading…'}</div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--gray-400)]">{t('common.empty') || 'No active sessions'}</div>
            ) : (
              <ul className="space-y-1 max-h-[620px] overflow-y-auto pr-0.5">
              {filtered.map((e) => {
                const cfg = STATUS_CONFIG[e.status];
                const active = selectedId === e.sessionId;
                const isOffline = e.status === 'disconnected' || e.status === 'submitted' || e.status === 'terminated';
                const ageMs = e.lastSeenAt ? Date.now() - e.lastSeenAt : null;
                return (
                  <li key={e.sessionId}>
                    <button
                      onClick={() => jumpToSession(e.sessionId)}
                      className={`axis-focus w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors ${
                        active ? 'bg-[var(--blue-50)] ring-1 ring-[var(--blue)]/40' : 'hover:bg-[var(--gray-50)]'
                      } ${isOffline ? 'opacity-60' : ''}`}
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-[var(--gray-900)] truncate">{e.candidateName}</span>
                          <span className="text-[10px] text-[var(--gray-400)] shrink-0">{e.level}</span>
                          {e.status === 'disconnected' && (
                            <span className="text-[10px] text-[var(--gray-400)] inline-flex items-center gap-0.5 shrink-0">
                              <WifiOff className="w-2.5 h-2.5" />
                              {ageMs != null ? fmtAgo(t, ageMs) : t('mon.feedQuiet')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <ProgressBar value={e.progressPct} tone={cfg.bar} className="!h-1 flex-1 min-w-0" />
                          <span className="text-[10px] text-[var(--gray-500)] tabular-nums w-7 text-right">{e.progressPct}%</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className={[
                              'inline-flex items-center gap-0.5 text-[10px]',
                              e.webcamOnline && (e.webcamLastAt == null || Date.now() - e.webcamLastAt < MEDIA_FRESH_MS)
                                ? 'text-emerald-600'
                                : 'text-[var(--gray-400)]',
                            ].join(' ')}
                            title={t('mon.webcam')}
                          >
                            <Camera className="w-2.5 h-2.5" />
                            {e.webcamOnline && (e.webcamLastAt == null || Date.now() - e.webcamLastAt < MEDIA_FRESH_MS)
                              ? t('mon.media.on')
                              : t('mon.media.off')}
                          </span>
                          <span
                            className={[
                              'inline-flex items-center gap-0.5 text-[10px]',
                              e.screenOnline && (e.screenLastAt == null || Date.now() - e.screenLastAt < MEDIA_FRESH_MS)
                                ? 'text-emerald-600'
                                : 'text-[var(--gray-400)]',
                            ].join(' ')}
                            title={t('mon.screen')}
                          >
                            <Monitor className="w-2.5 h-2.5" />
                            {e.screenOnline && (e.screenLastAt == null || Date.now() - e.screenLastAt < MEDIA_FRESH_MS)
                              ? t('mon.media.on')
                              : t('mon.media.off')}
                          </span>
                        </div>
                      </div>
                      {e.warnings > 0 && (
                        <Chip tone="amber" className="!px-1.5 !text-[10px] shrink-0 tabular-nums">⚠{e.warnings}</Chip>
                      )}
                    </button>
                  </li>
                );
              })}
              </ul>
            )}
          </div>
        </Card>

        {/* Inspector */}
        <Card className="xl:col-span-6 p-5">
          {selected === null ? (
            <div className="py-16 text-center text-sm text-[var(--gray-400)]">{t('mon.selectPrompt')}</div>
          ) : (
            <>
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-[17px] font-semibold text-[var(--gray-900)] tracking-tight m-0">{selected.candidateName}</h3>
                    <StatusBadge tone={STATUS_CONFIG[selected.status].tone}>
                      {t(STATUS_CONFIG[selected.status].labelKey)}
                    </StatusBadge>
                    {selected.lastSeenAt && (
                      <span className="text-[10px] text-[var(--gray-400)] inline-flex items-center gap-1">
                        <Radio className="w-3 h-3" />
                        {t('mon.lastSeen')} · {fmtAgo(t, Date.now() - selected.lastSeenAt)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--gray-500)] mt-1 tabular-nums font-mono-axis">
                    {selected.sessionId} · ⚠{selected.warnings}
                  </div>
                  {selected.status === 'disconnected' && selected.lastSeenAt && (
                    <div className="mt-2.5 text-xs px-2.5 py-1.5 rounded-lg bg-[var(--gray-100)] text-[var(--gray-600)] inline-flex items-center gap-2">
                      <WifiOff className="w-3.5 h-3.5" />
                      {t('mon.disconnectedHint', { t: fmtAgo(t, Date.now() - selected.lastSeenAt) })}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-6">
                <FrameTile
                  label={t('mon.webcam')}
                  frame={webcamFrame}
                  fallbackIcon={<Camera className="w-6 h-6 text-[var(--gray-400)]" />}
                  emptyHint={t('mon.webcamEmpty') || 'Waiting for candidate webcam…'}
                />
                <FrameTile
                  label={t('mon.screen')}
                  frame={screenFrame}
                  fallbackIcon={<Monitor className="w-6 h-6 text-[var(--gray-400)]" />}
                  emptyHint={t('mon.screenEmpty') || 'Waiting for screen share…'}
                />
              </div>

              <div className="mb-5">
                <SectionLabel>{t('mon.timeline')}</SectionLabel>
                {detail === null ? (
                  <div className="py-4 text-sm text-[var(--gray-400)]">{t('common.loading') || 'Loading…'}</div>
                ) : detail.events.length === 0 ? (
                  <div className="py-4 text-sm text-[var(--gray-400)]">{t('common.empty') || 'No proctor events'}</div>
                ) : (
                  <ul className="space-y-1 max-h-[280px] overflow-y-auto">
                    {detail.events.map((p) => {
                      const lvl = p.severity === 'HIGH' ? 'HIGH' : p.severity === 'MED' || p.severity === 'MEDIUM' ? 'MEDIUM' : 'INFO';
                      // Prefer the signed URLs from `getAiEvidence` (loadable
                      // by `<img>`); fall back to the raw key from `detail`
                      // so the icon still appears even if the evidence fetch
                      // failed transiently.
                      const ev = evidenceById[p.id];
                      const webcamSrc = ev?.evidenceUrl ?? null;
                      const screenSrc = ev?.screenEvidenceUrl ?? null;
                      const hasWebcam = !!(webcamSrc || p.evidenceUrl);
                      const hasScreen = !!(screenSrc || p.screenEvidenceUrl);
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
                      const modeKey = p.triggerMode ? `mon.mode.${p.triggerMode}` : '';
                      const modeTr = modeKey ? t(modeKey) : '';
                      return (
                        <li key={p.id} className="flex items-start gap-3 text-sm py-1.5 px-2 rounded-lg hover:bg-[var(--gray-50)]">
                          <span className="text-xs text-[var(--gray-400)] tabular-nums w-16 mt-0.5 shrink-0 font-mono-axis">{fmtTime(new Date(p.createdAt))}</span>
                          <div className="flex flex-col gap-1 shrink-0">
                            <StatusBadge tone={lvl === 'HIGH' ? 'red' : lvl === 'MEDIUM' ? 'orange' : 'blue'}>{(() => { const k = `severity.${lvl}`; const tr = t(k); return tr === k ? lvl : tr; })()}</StatusBadge>
                            {p.triggerMode && p.triggerMode !== 'INFO' && (
                              <StatusBadge tone={p.triggerMode === 'IMMEDIATE' ? 'red' : 'orange'}>
                                {modeTr === modeKey ? p.triggerMode : modeTr}
                              </StatusBadge>
                            )}
                          </div>
                          <span className="flex flex-col gap-0.5 flex-1 text-[var(--gray-700)] min-w-0">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[var(--gray-400)] shrink-0">
                                {lvl === 'HIGH' ? <ShieldAlert className="w-3.5 h-3.5" /> : lvl === 'MEDIUM' ? <AlertTriangle className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
                              </span>
                              <span className="truncate">{typeLabel}</span>
                            </span>
                            {shown && (
                              <span className="text-[11px] text-[var(--gray-500)] truncate pl-5" title={shown}>
                                {t('mon.shownToCandidate')}: {shown}
                              </span>
                            )}
                          </span>
                          {(hasWebcam || hasScreen) && (
                            <span className="flex items-center gap-1 shrink-0">
                              {hasWebcam && (
                                <EvidenceThumb
                                  src={webcamSrc}
                                  fallbackKey={p.evidenceUrl}
                                  label={t('mon.webcam')}
                                  icon={<Camera className="w-3 h-3" />}
                                />
                              )}
                              {hasScreen && (
                                <EvidenceThumb
                                  src={screenSrc}
                                  fallbackKey={p.screenEvidenceUrl}
                                  label={t('mon.screen')}
                                  icon={<Monitor className="w-3 h-3" />}
                                />
                              )}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {detail && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-1.5">
                    <SectionLabel className="mb-0">{t('mon.progress')}</SectionLabel>
                    <span className="text-xs tabular-nums text-[var(--gray-700)]">{detail.answered} / {detail.total} ({detail.progressPct}%)</span>
                  </div>
                  <ProgressBar value={detail.progressPct} tone="blue" className="!h-2" />
                </div>
              )}

              <div className="flex flex-wrap gap-2 pt-4 border-t border-[var(--gray-border)]">
                {actionError && (
                  <p className="w-full text-xs text-rose-600 mb-1">{actionError}</p>
                )}
                <Button
                  variant="secondary"
                  disabled={!actionsEnabled || actionBusy}
                  onClick={() =>
                    runAction(async () => {
                      const msg = window.prompt(t('mon.action.warn'), '');
                      if (msg === null) return;
                      await adminApi.warnMonitorSession(selectedId!, msg.trim() ? { message: msg.trim() } : {});
                      pushFeed(detail?.candidate.name ?? '—', msg.trim() || t('mon.action.warn'), 'MEDIUM', selectedId);
                    })
                  }
                >
                  <AlertTriangle className="w-4 h-4" />
                  {actionBusy ? t('mon.action.busy') : t('mon.action.warn')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!actionsEnabled || actionBusy}
                  onClick={() =>
                    runAction(async () => {
                      const res = await adminApi.pauseMonitorSession(selectedId!);
                      await refreshDetail(selectedId!);
                      pushFeed(
                        detail?.candidate.name ?? '—',
                        res.data.action === 'resume' ? t('mon.action.resume') : t('mon.action.pause'),
                        'INFO',
                        selectedId,
                      );
                    })
                  }
                >
                  <Clock className="w-4 h-4" />
                  {detail?.timerPaused ? t('mon.action.resume') : t('mon.action.pause')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!actionsEnabled || actionBusy}
                  onClick={() => setExtendOpen(true)}
                >
                  <Timer className="w-4 h-4" />
                  {t('mon.action.extend')}
                </Button>
                <Button
                  variant="danger"
                  className="ml-auto"
                  disabled={!actionsEnabled || actionBusy}
                  onClick={() =>
                    runAction(async () => {
                      const reason = window.prompt(t('mon.action.terminate'), '');
                      if (reason === null) return;
                      if (!window.confirm(t('mon.action.terminate') + '?')) return;
                      await adminApi.terminateMonitorSession(
                        selectedId!,
                        reason.trim() ? { reason: reason.trim() } : {},
                      );
                      pushFeed(detail?.candidate.name ?? '—', t('mon.action.terminate'), 'HIGH', selectedId);
                      await refreshDetail(selectedId!);
                    })
                  }
                >
                  <Ban className="w-4 h-4" />
                  {t('mon.action.terminate')}
                </Button>
              </div>
              {extendOpen && selectedId && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
                  <div className="w-full max-w-sm rounded-xl bg-white border border-[var(--gray-border)] p-5 shadow-xl">
                    <h3 className="text-sm font-semibold mb-3">{t('mon.action.extendTitle')}</h3>
                    <div className="flex flex-wrap gap-2">
                      {([5, 10, 15] as const).map((min) => (
                        <Button
                          key={min}
                          variant="secondary"
                          disabled={actionBusy}
                          onClick={() =>
                            runAction(async () => {
                              await adminApi.extendMonitorSession(selectedId, { seconds: min * 60 });
                              await refreshDetail(selectedId);
                              pushFeed(
                                detail?.candidate.name ?? '—',
                                `+${min} min`,
                                'INFO',
                                selectedId,
                              );
                              setExtendOpen(false);
                            })
                          }
                        >
                          {t(`mon.action.extend${min}` as 'mon.action.extend5')}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      className="mt-4 w-full"
                      onClick={() => setExtendOpen(false)}
                    >
                      {t('common.cancel') || 'Cancel'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Live feed */}
        <Card className="xl:col-span-3">
          <CardHeader
            title={t('mon.feed')}
            right={<Chip tone="green" dot pulse className="!text-[10px] !px-1.5">LIVE</Chip>}
          />
          <div className="px-4 pb-4">
            {feed.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--gray-400)]">
                {(t('common.empty') || 'No alerts yet') + ' (' + (t('mon.feedHint') || 'live updates appear here') + ')'}
                <div className="mt-3 inline-flex items-center gap-1 text-[10px]"><WifiOff className="w-3 h-3" /> {(t('mon.feedQuiet') || 'quiet')}</div>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[620px] overflow-y-auto pr-0.5">
                {feed.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => f.sessionId && jumpToSession(f.sessionId)}
                      disabled={!f.sessionId}
                      className={`w-full text-left p-2.5 rounded-lg bg-[var(--gray-50)] border border-[var(--gray-border)] ${
                        f.sessionId ? 'hover:bg-[var(--blue-50)] cursor-pointer' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge tone={FEED_TONE[f.level]}>{f.level}</StatusBadge>
                        <span className="text-[10px] text-[var(--gray-400)] tabular-nums ml-auto font-mono-axis">{f.time}</span>
                      </div>
                      <div className="text-sm text-[var(--gray-700)]">
                        <span className="font-medium text-[var(--gray-900)]">{f.who}</span> · {f.msg}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Small uppercase section caption used inside the inspector panel. */
function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[11px] font-semibold uppercase tracking-wider text-[var(--gray-400)] mb-2 ${className}`}>
      {children}
    </div>
  );
}

function FrameTile({
  label,
  frame,
  fallbackIcon,
  emptyHint,
}: {
  label: string;
  frame: FrameState | null;
  fallbackIcon: React.ReactNode;
  emptyHint: string;
}) {
  const ageMs = frame ? Date.now() - frame.ts : null;
  const stale = ageMs != null && ageMs > FRAME_STALE_MS;
  const ageLabel =
    ageMs == null
      ? null
      : ageMs < 1_500
      ? 'live'
      : ageMs < 60_000
      ? `${Math.round(ageMs / 1_000)}s ago`
      : `${Math.round(ageMs / 60_000)}m ago`;
  return (
    <div className="aspect-video rounded-xl grid place-items-center relative overflow-hidden border border-[var(--gray-border)] bg-[var(--gray-100)]">
      {frame ? (
        <img
          src={frame.src}
          alt={label}
          className={`absolute inset-0 w-full h-full object-cover ${stale ? 'opacity-50 grayscale' : ''}`}
        />
      ) : (
        <div className="flex flex-col items-center gap-1.5 px-3 text-center">
          {fallbackIcon}
          <span className="text-[10px] text-[var(--gray-500)] leading-tight">{emptyHint}</span>
        </div>
      )}
      <span className="absolute top-2 left-2 text-[10px] px-1.5 py-0.5 rounded-md bg-black/55 text-white z-10">
        {label}
      </span>
      {ageLabel && (
        <span
          className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-md z-10 tabular-nums ${
            stale ? 'bg-rose-600/80 text-white' : 'bg-black/55 text-white'
          }`}
        >
          {stale ? 'stale · ' : ''}
          {ageLabel}
        </span>
      )}
    </div>
  );
}

/**
 * Compact 32×24 evidence thumbnail with hover-to-expand. When `src` is a
 * loadable signed URL we render the `<img>`; when only the raw NCP key is
 * available (evidence fetch failed transiently) we render an icon-only
 * pill that signals "evidence exists but isn't viewable right now".
 */
function EvidenceThumb({
  src,
  fallbackKey,
  label,
  icon,
}: {
  src: string | null;
  fallbackKey: string | null;
  label: string;
  icon: React.ReactNode;
}) {
  const title = `${label}${fallbackKey ? ` · ${fallbackKey.split('/').pop()}` : ''}`;
  if (src) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        title={title}
        className="group relative inline-block"
      >
        <img
          src={src}
          alt={label}
          className="w-8 h-6 object-cover rounded border border-[var(--gray-border)] group-hover:ring-2 group-hover:ring-[var(--blue)]/50"
        />
        <span className="absolute -top-1 -right-1 bg-[var(--gray-200)] border border-[var(--gray-border)] rounded-full p-0.5 text-[var(--gray-600)]">
          {icon}
        </span>
      </a>
    );
  }
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--gray-border)] bg-[var(--gray-50)] text-[10px] text-[var(--gray-500)]"
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

export default MonitoringScreen;
