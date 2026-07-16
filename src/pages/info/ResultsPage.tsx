import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';
import { ResultModal, ResultModalEmpty, ResultModalRows } from '@/components/ResultModal';
import {
  resultsApi,
  type PublicPassListResponse,
  type PublicRoundPublicationState,
  type PublicRoundRow,
} from '@/services/api';
import { InfoCallout } from '@/components/InfoCallout';

/* ─────────────────────────────────────────────────────────────
   Design tokens — AboutPage / CertGuidePage / QnAPage와 동일
   ───────────────────────────────────────────────────────────── */
const INK_900 = '#191919';
const GRAY_500 = '#525252';
const H_CARD = 'text-[21px] lg:text-[26px] font-semibold leading-[1.3] tracking-[-0.02em]';
const T_BODY = 'text-[16px] lg:text-[19px] leading-[1.85] tracking-[-0.005em]';
const TABLE_WRAP = 'w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2';
const FIELD_INPUT =
  'w-full min-h-[44px] sm:min-h-[48px] rounded-md border bg-white px-3 py-2.5 sm:px-4 text-[16px] sm:text-[15px] lg:text-[18px] text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2';

type FilterTab = 'AXIS' | 'AXIS-C' | 'AXIS-H';

type ResultsTab = 'sessions' | 'lookup';

const STATUS_FILTERS: { key: 'all' | PublicRoundPublicationState; color: string }[] = [
  { key: 'all', color: 'var(--color-ink)' },
  { key: 'announced', color: 'var(--color-status-success)' },
  { key: 'grading', color: 'var(--color-status-grading)' },
  { key: 'upcoming', color: 'var(--color-blue)' },
];

const DATE_INPUT =
  'h-11 sm:h-10 rounded-md border bg-white px-3 text-[16px] sm:text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2';

function formatExamDateKst(iso: string): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return s.replace(/-/g, '.');
}

function formatRoundCertLabel(certType: 'AXIS' | 'AXIS_C' | 'AXIS_H', level: string): string {
  const track = certType.replace('_', '-');
  const tier = level === 'L3' ? 'Starter' : level === 'L2' ? 'Practitioner' : 'Leader';
  return `${track} ${level} ${tier}`;
}

function filterTabToCertType(tab: FilterTab): 'AXIS' | 'AXIS_C' | 'AXIS_H' {
  if (tab === 'AXIS') return 'AXIS';
  if (tab === 'AXIS-C') return 'AXIS_C';
  return 'AXIS_H';
}

type LookupState =
  | { step: 'idle' }
  | { step: 'checking' }
  | {
      step: 'pass' | 'fail';
      score: number | null;
      cut: number;
      roundNumber: number | null;
      certType: string;
      level: string;
      roundLabel: string;
      sections: { name: string; score: number; max: number }[];
    }
  | { step: 'not-found' }
  | { step: 'not-announced' };

type LookupModalResult = Exclude<LookupState, { step: 'idle' } | { step: 'checking' }>;

function LookupResultModalView({ result, onClose }: { result: LookupModalResult; onClose: () => void }) {
  const { t, lang } = useI18n();

  if (result.step === 'not-found') {
    return (
      <ResultModal title={t('results.modal.lookupTitle' as never)} onClose={onClose}>
        <ResultModalEmpty
          message={t('results.modal.notFound' as never)}
          helperText={
            <>
              {t('results.modal.notFoundHelpPre' as never)}
              <Link to="/qna" className="font-semibold" style={{ color: 'var(--color-blue)' }}>
                {t('results.modal.notFoundHelpLink' as never)}
              </Link>
              {t('results.modal.notFoundHelpPost' as never)}
            </>
          }
        />
      </ResultModal>
    );
  }

  if (result.step === 'not-announced') {
    return (
      <ResultModal title={t('results.modal.lookupTitle' as never)} onClose={onClose}>
        <ResultModalEmpty
          message={t('results.modal.notAnnounced' as never)}
          helperText={
            <>
              {t('results.modal.notAnnouncedHelpPre' as never)}
              <Link to="/mypage" className="font-semibold" style={{ color: 'var(--color-blue)' }}>
                {t('results.modal.notAnnouncedHelpLink' as never)}
              </Link>
              {t('results.modal.notAnnouncedHelpPost' as never)}
            </>
          }
        />
      </ResultModal>
    );
  }

  const passed = result.step === 'pass';
  // The backend roundLabel is Korean ("제3회 …"); rebuild it per-language
  // from the structured fields when we have them.
  const roundValue =
    lang === 'en' && result.roundNumber != null
      ? t('results.roundLabel' as never, {
          n: result.roundNumber,
          cert: result.certType.replace('_', '-'),
          level: result.level,
        })
      : result.roundLabel;
  return (
    <ResultModal
      title={passed ? t('results.modal.passTitle' as never) : t('results.modal.failTitle' as never)}
      headerBg={passed ? '#059669' : '#6B7280'}
      onClose={onClose}
    >
      <ResultModalRows
        description={passed ? t('results.modal.passDesc' as never) : t('results.modal.failDesc' as never)}
        descriptionColor={passed ? '#059669' : '#374151'}
        rows={[
          { label: t('results.modal.row.round' as never), value: roundValue },
          {
            label: t('results.modal.row.verdict' as never),
            value: passed ? t('results.verdict.pass' as never) : t('results.verdict.fail' as never),
            valueClass: 'font-semibold',
          },
          {
            label: t('results.modal.row.total' as never),
            value: result.score != null ? t('results.points' as never, { n: result.score }) : '—',
            valueClass: 'font-en font-semibold',
          },
          {
            label: t('results.modal.row.cut' as never),
            value: t('results.cutValue' as never, { n: result.cut }),
            valueClass: 'font-en',
          },
          ...result.sections.map((sec) => ({
            label: sec.name,
            value: `${sec.score}/${sec.max}`,
            valueClass: 'font-en',
          })),
        ]}
      />
    </ResultModal>
  );
}

function PublicationBadge({ state }: { state: 'announced' | 'grading' | 'upcoming' }) {
  const { t } = useI18n();
  const style =
    state === 'announced'
      ? { background: 'rgba(5, 150, 105, 0.1)', color: 'var(--color-status-success)' }
      : state === 'grading'
        ? { background: 'rgba(217, 119, 6, 0.1)', color: 'var(--color-status-grading)' }
        : { background: 'rgba(0, 102, 255, 0.08)', color: 'var(--color-blue)' };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap"
      style={style}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
      {t(`results.status.${state}` as never)}
    </span>
  );
}

function EmptyRounds() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 py-10">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-faint" aria-hidden>
        <path d="M6 5h12l2 8v6H4v-6l2-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M4 13h4l2 3h4l2-3h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-[14px] text-muted">{t('results.empty' as never)}</p>
    </div>
  );
}

function RoundsErrorState({ kind, onRetry }: { kind: 'server' | 'generic'; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="border-t-2 border-ink mt-4 mb-2">
      <div className="flex flex-col items-center gap-3 border-b border-border px-4 py-12 text-center">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="text-faint" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 7.5V12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="12" cy="16" r="1" fill="currentColor" />
        </svg>
        <p className="max-w-[420px] break-keep text-[14px] text-muted">{t(`results.error.${kind}` as never)}</p>
        <button type="button" className="btn-secondary btn-sm mt-1" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-8 left-4 right-4 text-center sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:text-left z-50 px-6 py-3 rounded-lg text-[14px] font-medium"
      style={{ background: 'var(--color-ink)', color: '#fff' }}>
      {message}
    </div>
  );
}

const ROUNDS_PAGE_SIZE = 10;
const MODAL_ENTRY_PAGE_SIZE = 12;

function RoundsPaginationBar({
  meta,
  onPageChange,
  disabled,
}: {
  meta: { total: number; page: number; pageSize: number; totalPages: number };
  onPageChange: (p: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const { page, totalPages } = meta;
  if (totalPages <= 0) return null;

  const btnBase =
    'min-w-[2.25rem] h-8.5 px-3 rounded-full text-[13px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const btnIdle = 'border-none text-ink hover:bg-[#F8FAFC]';
  const btnActive = 'bg-blue-500 text-white';

  const windowPages = (): number[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set<number>();
    pages.add(1);
    pages.add(totalPages);
    for (let d = -2; d <= 2; d++) {
      const p = page + d;
      if (p >= 1 && p <= totalPages) pages.add(p);
    }
    return [...pages].sort((a, b) => a - b);
  };

  const nums = windowPages();
  const segments: (number | '…')[] = [];
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i];
    const prev = nums[i - 1];
    if (i > 0 && prev !== undefined && n > prev + 1) segments.push('…');
    segments.push(n);
  }

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1 pt-4" aria-label={t('results.pagination.aria' as never)}>
      <button
        type="button"
        disabled={disabled || page <= 1}
        className={`${btnBase} ${btnIdle}`}
        onClick={() => onPageChange(1)}
      >
        «
      </button>
      {segments.map((seg, idx) =>
        seg === '…' ? (
          <span key={`e-${idx}`} className="px-1 text-muted text-[13px]">
            …
          </span>
        ) : (
          <button
            key={seg}
            type="button"
            disabled={disabled}
            className={`${btnBase} ${seg === page ? btnActive : btnIdle}`}
            onClick={() => onPageChange(seg)}
          >
            {seg}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        className={`${btnBase} ${btnIdle}`}
        onClick={() => onPageChange(totalPages)}
      >
        »
      </button>
    </nav>
  );
}

export default function ResultsPage() {
  const { t, lang } = useI18n();
  const mainRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<ResultsTab>('sessions');
  const [filterTrack, setFilterTrack] = useState<FilterTab>('AXIS');
  const [filterStatus, setFilterStatus] = useState<'all' | PublicRoundPublicationState>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [roundsPage, setRoundsPage] = useState(1);
  const [roundRows, setRoundRows] = useState<PublicRoundRow[]>([]);
  const [roundsMeta, setRoundsMeta] = useState<{
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  } | null>(null);
  const [roundsLoading, setRoundsLoading] = useState(false);
  // Stored as an error *kind* so the message re-translates on language switch.
  const [roundsError, setRoundsError] = useState<'server' | 'generic' | null>(null);
  const [roundsReloadTick, setRoundsReloadTick] = useState(0);
  const [modalEntryPage, setModalEntryPage] = useState(1);
  const [passModal, setPassModal] = useState<
    | { scheduleId: string; loading: true }
    | { scheduleId: string; loading: false; data: PublicPassListResponse }
    | { scheduleId: string; loading: false; error: string }
    | null
  >(null);
  const [regNo, setRegNo] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ step: 'idle' });
  const [lookupModalOpen, setLookupModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    const container = mainRef.current;
    if (container) {
      container.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    }
    return () => obs.disconnect();
  }, [activeTab, roundRows.length]);

  const filterTabs: FilterTab[] = ['AXIS', 'AXIS-C', 'AXIS-H'];

  useEffect(() => {
    if (activeTab !== 'sessions') return;
    let cancelled = false;
    setRoundsLoading(true);
    setRoundsError(null);
    resultsApi
      .publicRounds({
        certType: filterTabToCertType(filterTrack),
        ...(filterStatus !== 'all' ? { status: filterStatus } : {}),
        ...(filterDateFrom ? { from: filterDateFrom } : {}),
        ...(filterDateTo ? { to: filterDateTo } : {}),
        page: roundsPage,
        pageSize: ROUNDS_PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        if (d.total > 0 && d.items.length === 0 && d.page > 1) {
          setRoundsPage(1);
          return;
        }
        setRoundRows(d.items);
        setRoundsMeta({
          total: d.total,
          page: d.page,
          pageSize: d.pageSize,
          totalPages: d.totalPages,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const code =
            err && typeof err === 'object' && 'response' in err
              ? (err as { response?: { status?: number } }).response?.status
              : undefined;
          setRoundsError(code === 500 ? 'server' : 'generic');
          setRoundRows([]);
          setRoundsMeta(null);
        }
      })
      .finally(() => {
        if (!cancelled) setRoundsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, filterTrack, filterStatus, filterDateFrom, filterDateTo, roundsPage, roundsReloadTick]);

  const openPassList = (scheduleId: string) => {
    setModalEntryPage(1);
    setPassModal({ scheduleId, loading: true });
    resultsApi
      .publicPassList(scheduleId)
      .then((res) => {
        setPassModal({ scheduleId, loading: false, data: res.data });
      })
      .catch(() => {
        setPassModal({
          scheduleId,
          loading: false,
          error: t('results.passModal.error' as never),
        });
      });
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const birthDigits = birthDate.replace(/\D/g, '');
    if (!regNo.trim() || !name.trim() || !birthDigits) {
      setToast(t('results.toast.missing' as never));
      return;
    }
    if (birthDigits.length !== 8) {
      setToast(t('results.toast.birth8' as never));
      return;
    }
    setLookup({ step: 'checking' });
    resultsApi
      .publicLookup({
        registrationNumber: regNo.trim(),
        name: name.trim(),
        birthDate: birthDigits,
      })
      .then((res) => {
        const d = res.data;
        if (d.status === 'RESULT') {
          setLookup({
            step: d.passed ? 'pass' : 'fail',
            score: d.totalScore,
            cut: d.cutScore,
            roundNumber: d.roundNumber ?? null,
            certType: d.certType,
            level: d.level,
            roundLabel: d.roundLabel,
            sections: d.sections,
          });
        } else if (d.status === 'NOT_ANNOUNCED') {
          setLookup({ step: 'not-announced' });
        } else {
          setLookup({ step: 'not-found' });
        }
        setLookupModalOpen(true);
      })
      .catch((err: unknown) => {
        setLookup({ step: 'idle' });
        const status =
          err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 429) {
          setToast(t('results.toast.throttled' as never));
        } else if (status === 400) {
          setToast(t('results.toast.badInput' as never));
        } else {
          setToast(t('results.toast.error' as never));
        }
      });
  };

  return (
    <div className="min-h-screen " style={{ color: 'var(--color-body)' }}>
      <SiteHeader active="announce" />

      <PageHeroSolid
        title={t('results.hero.title' as never)}
        subtitle={t('results.hero.subtitle' as never)}
      />

      <PageTabs
        tabs={(['sessions', 'lookup'] as ResultsTab[]).map((k) => ({
          key: k,
          label: t(`results.tab.${k}` as never),
        }))}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
      />

      <main ref={mainRef} className="mx-auto py-8 sm:py-12 lg:py-16 px-5 sm:px-6 lg:px-8 max-lg:break-keep" style={{ maxWidth: 'var(--spacing-content-w)' }}>

        {activeTab === 'sessions' && (
          <>
            {/* Filter Chips + Session List */}
            <section className="mb-10 sm:mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{t('results.sessions.title' as never)}</h2>
              <p className={`${T_BODY} mb-2`} style={{ color: GRAY_500 }}>
                {t('results.sessions.descPre' as never)}
                <strong className="text-ink">{t('results.sessions.descBold1' as never)}</strong>
                {t('results.sessions.descMid' as never)}
                <strong className="text-ink">{t('results.sessions.descBold2' as never)}</strong>
                {t('results.sessions.descPost' as never)}
              </p>

              <div className="mb-10 rounded-lg border border-[#DBEAFE] bg-[#F5F9FF] px-4 py-4 sm:px-5 sm:py-5 space-y-2.5">
                <InfoCallout tone="blue">
                  <p>{t('results.callout1' as never)}</p>
                </InfoCallout>
                <InfoCallout tone="blue">
                  <p>{t('results.callout2' as never)}</p>
                </InfoCallout>
                <InfoCallout tone="blue">
                  <p>{t('results.callout3' as never)}</p>
                </InfoCallout>
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {filterTabs.map((tab) => {
                  const active = filterTrack === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setFilterTrack(tab);
                        setRoundsPage(1);
                      }}
                      className={`inline-flex items-center h-10 sm:h-11 px-5 sm:px-6 rounded-full border text-[14.5px] sm:text-[15.5px] font-semibold font-en whitespace-nowrap transition-colors cursor-pointer ${
                        active
                          ? 'bg-blue-500 border-blue-500 text-white'
                          : 'bg-white border-gray-300 text-gray-500 hover:text-ink hover:border-gray-400'
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              <div className="mb-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('results.filter.statusAria' as never)}>
                  {STATUS_FILTERS.map((f) => {
                    const active = filterStatus === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => {
                          setFilterStatus(f.key);
                          setRoundsPage(1);
                        }}
                        className="inline-flex items-center gap-1.5 h-10 sm:h-9 px-4 rounded-full border text-[14px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
                        style={
                          active
                            ? { background: f.color, borderColor: f.color, color: '#fff' }
                            : { background: '#fff', borderColor: 'var(--color-border)', color: 'var(--color-muted)' }
                        }
                      >
                        {f.key !== 'all' && (
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: active ? '#fff' : f.color }}
                            aria-hidden
                          />
                        )}
                        {f.key === 'all'
                          ? t('results.filter.all' as never)
                          : t(`results.status.${f.key}` as never)}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-muted whitespace-nowrap">
                    {t('results.filter.period' as never)}
                  </span>
                  <input
                    type="date"
                    value={filterDateFrom}
                    max={filterDateTo || undefined}
                    onChange={(e) => {
                      setFilterDateFrom(e.target.value);
                      setRoundsPage(1);
                    }}
                    aria-label={t('results.filter.from' as never)}
                    className={DATE_INPUT}
                    style={{ borderColor: '#e5e7eb' }}
                  />
                  <span className="text-faint" aria-hidden>–</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    min={filterDateFrom || undefined}
                    onChange={(e) => {
                      setFilterDateTo(e.target.value);
                      setRoundsPage(1);
                    }}
                    aria-label={t('results.filter.to' as never)}
                    className={DATE_INPUT}
                    style={{ borderColor: '#e5e7eb' }}
                  />
                  {(filterDateFrom || filterDateTo) && (
                    <button
                      type="button"
                      className="btn-text btn-sm"
                      onClick={() => {
                        setFilterDateFrom('');
                        setFilterDateTo('');
                        setRoundsPage(1);
                      }}
                    >
                      {t('results.filter.reset' as never)}
                    </button>
                  )}
                </div>
              </div>

              {roundsError && roundRows.length === 0 && !roundsLoading ? (
                <RoundsErrorState
                  kind={roundsError}
                  onRetry={() => setRoundsReloadTick((n) => n + 1)}
                />
              ) : (
                <>
              {roundsError && roundRows.length > 0 && (
                <p className="text-[14px] text-red-600 mb-4">{t(`results.error.${roundsError}` as never)}</p>
              )}

              <div className={`${TABLE_WRAP} hidden md:block`} aria-busy={roundsLoading}>
                <table className="data-table" style={{ minWidth: 940 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 100 }}>{t('results.table.round' as never)}</th>
                      <th style={{ width: 220 }}>{t('results.table.cert' as never)}</th>
                      <th style={{ width: 160 }}>{t('results.table.examDate' as never)}</th>
                      <th style={{ width: 100 }}>{t('results.table.status' as never)}</th>
                      <th style={{ width: 120 }} className="text-center">
                        {t('results.table.registered' as never)}
                      </th>
                      <th style={{ width: 88 }} className="text-right">
                        {t('results.table.pass' as never)}
                      </th>
                      <th style={{ width: 88 }} className="text-right">
                        {t('results.table.fail' as never)}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundRows.map((s) => {
                      const announced = s.publicationState === 'announced';
                      const graded = announced && s.passCount != null && s.failCount != null;
                      const pending =
                        announced && s.passCount != null && s.failCount != null
                          ? Math.max(0, s.registeredCount - (s.passCount + s.failCount))
                          : 0;
                      return (
                        <tr key={s.scheduleId}>
                          <td className="text-muted font-en">
                            {t('results.round' as never, { n: s.roundNumber })}
                          </td>
                          <td>
                            <span className="text-ink text-center font-semibold">
                              {formatRoundCertLabel(s.certType, s.level)}
                            </span>
                          </td>
                          <td className="text-muted">{formatExamDateKst(s.examDate)}</td>
                          <td>
                            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                              <PublicationBadge state={s.publicationState} />
                              {announced && (
                                <button
                                  type="button"
                                  className="btn-text btn-sm"
                                  onClick={() => openPassList(s.scheduleId)}
                                >
                                  {t('results.detail' as never)}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="text-center">
                            <span style={{ fontFamily: 'var(--font-en)' }}>
                              {s.registeredCount}
                              {lang === 'ko' && <span className="text-faint text-[13px]">명</span>}
                            </span>
                            {pending > 0 && (
                              <div className="text-[11px] text-muted mt-0.5 leading-tight">
                                {t('results.ungraded' as never, { n: pending })}
                              </div>
                            )}
                          </td>
                          <td className="text-right">
                            {graded ? (
                              <span
                                className="inline-block min-w-[2.5rem] rounded-md px-2 py-1 text-[13px] font-semibold font-en"
                                style={{
                                  background: 'rgba(5, 150, 105, 0.12)',
                                  color: 'var(--color-status-success)',
                                }}
                              >
                                {s.passCount}
                              </span>
                            ) : (
                              <span className="inline-block min-w-[2.5rem] text-center text-faint" aria-hidden>
                                —
                              </span>
                            )}
                          </td>
                          <td className="text-right">
                            {graded ? (
                              <span
                                className="inline-block min-w-[2.5rem] rounded-md px-2 py-1 text-[13px] font-semibold font-en"
                                style={{
                                  background: 'rgba(148, 163, 184, 0.2)',
                                  color: 'var(--color-muted)',
                                }}
                              >
                                {s.failCount}
                              </span>
                            ) : (
                              <span className="inline-block min-w-[2.5rem] text-center text-faint" aria-hidden>
                                —
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {roundsLoading && roundRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="text-center text-muted py-8">
                          {t('results.loading' as never)}
                        </td>
                      </tr>
                    )}
                    {!roundsLoading && roundRows.length === 0 && !roundsError && (
                      <tr>
                        <td colSpan={7}>
                          <EmptyRounds />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: stacked cards (same data as the table) */}
              <div className="md:hidden border-t-2 border-ink mt-4 mb-2" aria-busy={roundsLoading}>
                {roundRows.map((s) => {
                  const announced = s.publicationState === 'announced';
                  const graded = announced && s.passCount != null && s.failCount != null;
                  const pending =
                    announced && s.passCount != null && s.failCount != null
                      ? Math.max(0, s.registeredCount - (s.passCount + s.failCount))
                      : 0;
                  return (
                    <div key={s.scheduleId} className="border-b border-border py-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-muted font-en">{t('results.round' as never, { n: s.roundNumber })}</span>
                        <span className="text-[13px] text-muted">{formatExamDateKst(s.examDate)}</span>
                      </div>
                      <div className="mt-1 text-[15.5px] font-semibold text-ink">
                        {formatRoundCertLabel(s.certType, s.level)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <PublicationBadge state={s.publicationState} />
                        {announced && (
                          <button
                            type="button"
                            className="btn-text btn-sm"
                            onClick={() => openPassList(s.scheduleId)}
                          >
                            {t('results.detail' as never)}
                          </button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 bg-[#F8FAFC]">
                          <span className="text-muted">{t('results.mobileReg' as never)}</span>
                          <strong className="font-en text-ink">{s.registeredCount}</strong>
                          {lang === 'ko' && <span className="text-faint">명</span>}
                        </span>
                        {graded && (
                          <>
                            <span
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold font-en"
                              style={{
                                background: 'rgba(5, 150, 105, 0.12)',
                                color: 'var(--color-status-success)',
                              }}
                            >
                              {t('results.verdict.pass' as never)} {s.passCount}
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold font-en"
                              style={{
                                background: 'rgba(148, 163, 184, 0.2)',
                                color: 'var(--color-muted)',
                              }}
                            >
                              {t('results.verdict.fail' as never)} {s.failCount}
                            </span>
                          </>
                        )}
                        {pending > 0 && (
                          <span className="text-[12px] text-muted">{t('results.ungraded' as never, { n: pending })}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {roundsLoading && roundRows.length === 0 && (
                  <p className="text-center text-muted py-8 text-[14px]">{t('results.loading' as never)}</p>
                )}
                {!roundsLoading && roundRows.length === 0 && !roundsError && <EmptyRounds />}
              </div>
                </>
              )}

              {roundsLoading && roundRows.length > 0 && (
                <p className="text-[14px] text-muted mt-3">{t('results.loading' as never)}</p>
              )}

              {roundsMeta != null && roundsMeta.totalPages > 0 && (
                <RoundsPaginationBar
                  meta={roundsMeta}
                  disabled={roundsLoading}
                  onPageChange={setRoundsPage}
                />
              )}
            </section>
          </>
        )}

        {activeTab === 'lookup' && (
          <section className="mb-10 sm:mb-14 reveal">
            <h2 className={`${H_CARD} text-black mb-4`} >{t('results.lookup.title' as never)}</h2>
            <p className={`${T_BODY} mb-6`} style={{ color: GRAY_500 }}>
              {t('results.lookup.desc' as never)}{' '}
              {t('results.lookup.mypagePre' as never)}
              <Link to="/mypage" className="font-semibold text-ink underline underline-offset-4">
                {t('results.lookup.mypageLink' as never)}
              </Link>
              {t('results.lookup.mypagePost' as never)}
            </p>

            <section className="mb-10 sm:mb-16 lg:mb-24 reveal py-5 px-4 sm:py-8 sm:px-6 lg:py-10 lg:px-12 rounded-md border border-[#e5e7eb]" style={{ background: '#f3f4f5' }}>
              <form onSubmit={handleLookup} className="min-w-0">
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                  <label className="block flex-1 min-w-0">
                    <span className="mb-2 block text-[14px] sm:text-[15px] lg:text-[16px] font-semibold tracking-[-0.005em] text-black">
                      {t('results.lookup.field.regNo' as never)}
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      value={regNo}
                      onChange={e => setRegNo(e.target.value)}
                      placeholder={t('results.lookup.ph.regNo' as never)}
                      className={`${FIELD_INPUT} font-en`}
                      style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                    />
                  </label>
                  <label className="block flex-1 min-w-0">
                    <span className="mb-2 block text-[14px] sm:text-[15px] lg:text-[16px] font-semibold tracking-[-0.005em] text-black">
                      {t('results.lookup.field.name' as never)}
                    </span>
                    <input
                      type="text"
                      inputMode="text"
                      autoComplete="name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder={t('results.lookup.ph.name' as never)}
                      className={FIELD_INPUT}
                      style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                    />
                  </label>
                  <label className="block flex-1 min-w-0">
                    <span className="mb-2 block text-[14px] sm:text-[15px] lg:text-[16px] font-semibold tracking-[-0.005em] text-black">
                      {t('results.lookup.field.birth' as never)}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="bday"
                      maxLength={10}
                      value={birthDate}
                      onChange={e => setBirthDate(e.target.value)}
                      placeholder={t('results.lookup.ph.birth' as never)}
                      className={`${FIELD_INPUT} font-en`}
                      style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                    />
                  </label>
                </div>
                <div className="flex items-center justify-center px-1 sm:px-10 pt-5 sm:pt-8">
                  <button
                    type="submit"
                    className="btn-primary !bg-blue-500 w-full sm:max-w-[200px] min-h-[48px] !text-[16px] sm:!text-[18px] touch-manipulation"
                    disabled={lookup.step === 'checking'}
                  >
                    {lookup.step === 'checking' ? t('results.lookup.checking' as never) : t('results.lookup.submit' as never)}
                  </button>
                </div>
              </form>
            </section>

            <section className="mb-10 sm:mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{t('results.criteria.title' as never)}</h2>
              <p className={`${T_BODY} mb-5`} style={{ color: GRAY_500 }}>
                {t('results.criteria.desc' as never)}
              </p>
              {(() => {
                // One data source drives both the desktop table and mobile cards.
                const criteriaRows = (['l3', 'l2', 'l1'] as const).map((k) => ({
                  level: k.toUpperCase(),
                  tier: k === 'l3' ? 'Starter' : k === 'l2' ? 'Practitioner' : 'Leader',
                  comp: t(`results.criteria.${k}.comp` as never),
                  cut: t('results.criteria.cut70' as never),
                  method: t(`results.criteria.${k}.method` as never),
                }));
                return (
                  <>
                    <div className="hidden md:block w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2">
                      <table className="data-table" style={{ minWidth: 600 }}>
                        <thead>
                          <tr>
                            <th style={{ width: 160 }}>{t('results.criteria.th.level' as never)}</th>
                            <th>{t('results.criteria.th.comp' as never)}</th>
                            <th>{t('results.criteria.th.cut' as never)}</th>
                            <th>{t('results.criteria.th.method' as never)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {criteriaRows.map((row) => (
                            <tr key={row.level}>
                              <td>
                                <strong>{row.level}</strong>
                                <div className="text-[12.5px] text-light mt-0.5">({row.tier})</div>
                              </td>
                              <td>{row.comp}</td>
                              <td>{row.cut}</td>
                              <td>{row.method}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: stacked cards (same data as the table) */}
                    <div className="md:hidden border-t-2 border-ink mt-4 mb-2">
                      {criteriaRows.map((row) => (
                        <div key={row.level} className="border-b border-border py-4">
                          <div className="text-[15.5px] text-ink">
                            <strong>{row.level}</strong>{' '}
                            <span className="text-[12.5px] text-light">({row.tier})</span>
                          </div>
                          <div className="mt-2 space-y-1.5 text-[14px]">
                            <div className="flex gap-2">
                              <span className="w-[70px] shrink-0 text-[12.5px] text-muted pt-0.5">{t('results.criteria.th.comp' as never)}</span>
                              <span>{row.comp}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="w-[70px] shrink-0 text-[12.5px] text-muted pt-0.5">{t('results.criteria.th.cut' as never)}</span>
                              <span>{row.cut}</span>
                            </div>
                            <div className="flex gap-2">
                              <span className="w-[70px] shrink-0 text-[12.5px] text-muted pt-0.5">{t('results.criteria.th.method' as never)}</span>
                              <span>{row.method}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
              <p className="text-[13px] text-light mt-3">{t('results.criteria.note' as never)}</p>
            </section>
            <div className="w-10 h-px bg-border mb-10 sm:mb-14" />

            <section className="mb-10 sm:mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{t('results.appeal.title' as never)}</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                {t('results.appeal.p1Pre' as never)}
                <strong className="text-ink font-semibold">{t('results.appeal.p1Bold' as never)}</strong>
                {t('results.appeal.p1Post' as never)}
              </p>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                {t('results.appeal.p2Pre' as never)}
                <strong className="text-ink font-semibold">{t('results.appeal.p2Bold' as never)}</strong>
                {t('results.appeal.p2Post' as never)}
              </p>
              <p className={`${T_BODY} mb-5`} style={{ color: GRAY_500 }}>
                {t('results.appeal.p3' as never)}
              </p>
              <div className="flex gap-3 flex-wrap">
                <Link to="/mypage" className="btn-primary">{t('results.appeal.cta' as never)}</Link>
                <Link to="/guide" className="btn-secondary">{t('results.appeal.criteria' as never)}</Link>
              </div>
            </section>
          </section>
        )}

      </main>

      {passModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pass-modal-title"
          onClick={() => setPassModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h2 id="pass-modal-title" className="text-[17px] font-extrabold text-ink">
                {t('results.passModal.title' as never)}
              </h2>
              <button
                type="button"
                className="text-faint hover:text-ink text-[22px] leading-none px-2"
                onClick={() => setPassModal(null)}
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 text-[14px]">
              {passModal.loading && <p className="text-muted">{t('results.loading' as never)}</p>}
              {!passModal.loading && 'error' in passModal && (
                <p className="text-red-600">{passModal.error}</p>
              )}
              {!passModal.loading && 'data' in passModal && (() => {
                const entries = passModal.data.entries;
                const modalTotalPages = Math.max(1, Math.ceil(entries.length / MODAL_ENTRY_PAGE_SIZE));
                const safeModalPage = Math.min(modalEntryPage, modalTotalPages);
                const start = (safeModalPage - 1) * MODAL_ENTRY_PAGE_SIZE;
                const pageEntries = entries.slice(start, start + MODAL_ENTRY_PAGE_SIZE);
                const sched = passModal.data.schedule;
                const roundLabel =
                  lang === 'en'
                    ? t('results.roundLabel' as never, {
                        n: sched.roundNumber,
                        cert: sched.certType.replace('_', '-'),
                        level: sched.level,
                      })
                    : sched.labelRound;
                return (
                <>
                  <p className="font-semibold text-ink mb-1">{roundLabel}</p>
                  <p className="text-muted text-[13px] mb-3">
                    {t('results.passModal.examDate' as never, { date: formatExamDateKst(sched.examDate) })}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4 text-[12px]">
                    <span
                      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 bg-[#F8FAFC]"
                      title={t('results.passModal.confirmedTitle' as never)}
                    >
                      <span className="text-muted">{t('results.passModal.confirmed' as never)}</span>
                      <strong className="font-en text-ink">{passModal.data.summary.registeredCount}</strong>
                      {lang === 'ko' && <span className="text-muted">명</span>}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5"
                      style={{ background: 'rgba(5, 150, 105, 0.12)', color: 'var(--color-status-success)' }}
                    >
                      <span className="font-medium">{t('results.verdict.pass' as never)}</span>
                      <strong className="font-en">{passModal.data.summary.passCount}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-muted" style={{ background: '#F1F5F9' }}>
                      <span className="font-medium">{t('results.verdict.fail' as never)}</span>
                      <strong className="font-en text-ink">{passModal.data.summary.failCount}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-muted">
                      {t('results.passModal.graded' as never, { n: passModal.data.summary.gradedCount })}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted mb-3">
                    {t('results.passModal.maskNotice' as never)}
                  </p>
                  <table className="data-table w-full text-[13px]">
                    <thead>
                      <tr>
                        <th>{t('results.passModal.th.regNo' as never)}</th>
                        <th className="text-right">{t('results.passModal.th.result' as never)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.length === 0 ? (
                        <tr>
                          <td colSpan={2} className="text-center text-muted py-6">
                            {t('results.passModal.empty' as never)}
                          </td>
                        </tr>
                      ) : (
                        pageEntries.map((row, idx) => (
                          <tr key={`${row.registrationNumberMasked}-${start + idx}`}>
                            <td className="font-mono">{row.registrationNumberMasked}</td>
                            <td className="text-right font-semibold">
                              {row.passed ? (
                                <span style={{ color: 'var(--color-status-success)' }}>{t('results.verdict.pass' as never)}</span>
                              ) : (
                                <span className="text-muted">{t('results.verdict.fail' as never)}</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  {entries.length > MODAL_ENTRY_PAGE_SIZE && (
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-3">
                      <p className="text-[12px] text-muted">
                        {t('results.passModal.range' as never, {
                          total: entries.length,
                          from: start + 1,
                          to: Math.min(start + MODAL_ENTRY_PAGE_SIZE, entries.length),
                          page: safeModalPage,
                          pages: modalTotalPages,
                        })}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink disabled:opacity-40"
                          disabled={safeModalPage <= 1}
                          onClick={() => setModalEntryPage((p) => Math.max(1, p - 1))}
                        >
                          {t('common.prev')}
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-[12px] font-medium text-ink disabled:opacity-40"
                          disabled={safeModalPage >= modalTotalPages}
                          onClick={() => setModalEntryPage((p) => Math.min(modalTotalPages, p + 1))}
                        >
                          {t('common.next')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <SiteFooter />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      {lookupModalOpen && lookup.step !== 'idle' && lookup.step !== 'checking' && (
        <LookupResultModalView result={lookup} onClose={() => setLookupModalOpen(false)} />
      )}
    </div>
  );
}
