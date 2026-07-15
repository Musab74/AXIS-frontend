import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { useWizard } from '@/pages/apply/lib/WizardContext';
import { H_CARD, T_BODY, T_META, INK_900, GRAY_500, BORDER, ACCENT } from '@/pages/apply/lib/applyTokens';
import { ApplySectionHeader } from '@/pages/apply/components/ApplySectionHeader';
import { SuspendedSeriesNotice } from '@/pages/apply/components/SuspendedSeriesNotice';
import type { CertLevel, CertType, ScheduleSummary } from '@/pages/apply/lib/WizardContext';
import { schedulesApi } from '@/services/api';
import { isApplyKcpDemo } from '@/pages/apply/lib/applyKcpDemo';
import { isApplySeriesSuspended } from '@/pages/apply/lib/suspendedSeries';

function formatDate(iso: string, time?: string) {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return time ? `${yyyy}.${mm}.${dd} ${time}` : `${yyyy}.${mm}.${dd}`;
}

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function buildCalendarGrid(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const grid: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getHourFromTime(value: string): number {
  const [hh] = value.split(':');
  return Number(hh);
}

function kcpMockSchedules(
  cert: CertType,
  level: CertLevel,
): (ScheduleSummary & { registrationEnd: string })[] {
  return [
    {
      id: 'kcp-mock-1',
      certType: cert,
      level,
      roundNumber: 1,
      year: 2026,
      examDate: '2026-09-05',
      examStartTime: '14:00',
      venue: '온라인 원격',
      capacity: 500,
      remainingSeats: 142,
      registrationEnd: '2026-08-28',
    },
    {
      id: 'kcp-mock-2',
      certType: cert,
      level,
      roundNumber: 2,
      year: 2026,
      examDate: '2026-09-12',
      examStartTime: '10:00',
      venue: '온라인 원격',
      capacity: 400,
      remainingSeats: 38,
      registrationEnd: '2026-09-05',
    },
    {
      id: 'kcp-mock-3',
      certType: cert,
      level,
      roundNumber: 3,
      year: 2026,
      examDate: '2026-09-20',
      examStartTime: '15:30',
      venue: '온라인 원격',
      capacity: 350,
      remainingSeats: 201,
      registrationEnd: '2026-09-12',
    },
  ];
}

function Step2KcpStub() {
  const { t } = useI18n();
  const { selectedCert, selectedLevel, selectedSchedule, setSchedule, setRegistration, nextStep, prevStep } = useWizard();

  if (!selectedCert || !selectedLevel) {
    return (
      <div className="text-sm text-body py-8 text-center">
        {t('apply.s1.nextDisabled')}
      </div>
    );
  }

  const sessions = kcpMockSchedules(selectedCert, selectedLevel);
  const certLabel = selectedCert.replace('_', '-');

  const handleSelect = (s: ScheduleSummary & { registrationEnd: string }) => {
    setSchedule(s);
    setRegistration(
      'kcp-demo-reg',
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    nextStep();
  };

  return (
    <div>
      <ApplySectionHeader
        title={t('apply.kcp.step2.title')}
        sub={t('apply.kcp.step2.sub')}
      />
      <div className="space-y-3 mb-6">
        {sessions.map((s) => {
          const line = t('apply.kcp.step2.time')
            .replace('{date}', formatDate(s.examDate))
            .replace('{time}', s.examStartTime);
          return (
            <div
              key={s.id}
              className="border border-[#E5E5E5] rounded-xl p-4 sm:p-5 bg-white hover:border-[#93C5FD] transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className={`${H_CARD} mb-1 break-keep`} style={{ color: INK_900 }}>
                    {t('apply.s2.session')
                      .replace('{cert}', certLabel)
                      .replace('{level}', selectedLevel)
                      .replace('{n}', String(s.roundNumber))}
                  </div>
                  <div className={`${T_BODY} mb-0.5`} style={{ color: GRAY_500 }}>{line}</div>
                  <div className={`${T_META} font-medium`} style={{ color: ACCENT }}>
                    {t('apply.kcp.step2.seats').replace('{n}', String(s.remainingSeats))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelect(s)}
                  className="w-full sm:w-auto shrink-0 px-5 py-3 sm:py-2.5 rounded-lg text-[14px] lg:text-[15px] font-semibold bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors cursor-pointer"
                >
                  {t('apply.s2.select')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="sticky bottom-0 sm:static bg-white py-4 sm:py-0 flex gap-2">
        <button
          type="button"
          onClick={prevStep}
          className="flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium border bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          style={{ borderColor: BORDER, color: GRAY_500 }}
        >
          {t('apply.nav.prev')}
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!selectedSchedule}
          className="flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
          style={{ background: ACCENT }}
        >
          {t('apply.nav.next')}
        </button>
      </div>
    </div>
  );
}

// ─── L2/L1 — Session cards ────────────────────────────────

function SessionCards() {
  const { t } = useI18n();
  const {
    selectedCert,
    selectedLevel,
    selectedSchedule,
    setSchedule,
    prevStep,
    nextStep,
  } = useWizard();
  const [sessions, setSessions] = useState<(ScheduleSummary & { registrationEnd: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  const certLabel = selectedCert?.replace('_', '-') ?? '';

  useEffect(() => {
    if (!selectedCert || !selectedLevel) return;
    setLoading(true);
    schedulesApi.available({ certType: selectedCert, level: selectedLevel })
      .then((r) => setSessions(r.data))
      .catch(() => setError(t('apply.step2.loadFailed' as never)))
      .finally(() => setLoading(false));
  }, [selectedCert, selectedLevel, t]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  const handleSelect = (s: ScheduleSummary & { registrationEnd: string }) => {
    setSchedule(s);
  };

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center text-sm text-body">
        <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mb-2" />
        {t('apply.s2.loading')}
      </div>
    );
  }

  return (
    <div>
      <ApplySectionHeader
        title={t('apply.s2.title')}
        sub={t('apply.s2.sub').replace('{cert}', certLabel).replace('{level}', selectedLevel ?? '')}
      />

      {error && (
        <div
          ref={errorRef}
          role="alert"
          className={`mb-4 px-4 py-3 bg-[#FEE2E2] border border-[#FECACA] rounded-xl ${T_BODY} text-status-danger`}
        >
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <div className={`py-12 text-center ${T_BODY} bg-[#F8FAFC] rounded-xl`} style={{ color: GRAY_500 }}>
          {t('apply.s2.empty')}
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {sessions.map((s) => {
            const seats = s.remainingSeats;
            const days = daysUntil(s.examDate);
            const almostFull = seats <= 10;
            return (
              <div
                key={s.id}
                className="border rounded-xl p-4 bg-white hover:border-[#93C5FD] transition-colors"
                style={{ borderColor: BORDER }}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className={H_CARD} style={{ color: INK_900 }}>
                        {t('apply.s2.session')
                          .replace('{cert}', certLabel)
                          .replace('{level}', selectedLevel ?? '')
                          .replace('{n}', String(s.roundNumber))}
                      </span>
                      <span className={`${T_META} bg-[#EFF6FF] text-[#2563EB] px-2 py-0.5 rounded-full`}>
                        D-{Math.max(0, days)}
                      </span>
                      {almostFull && (
                        <span className={`${T_META} bg-[#FEE2E2] text-status-danger px-2 py-0.5 rounded-full font-medium`}>
                          {t('apply.s2.almostFull')}
                        </span>
                      )}
                    </div>
                    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 ${T_BODY} mb-2.5`} style={{ color: GRAY_500 }}>
                      <span>📅 {formatDate(s.examDate, s.examStartTime)}</span>
                      <span>🏛 {s.venue}</span>
                      <span className={almostFull ? 'text-status-danger font-medium' : ''}>
                        👥 {t('apply.s2.seatsLeft').replace('{n}', String(seats))}
                      </span>
                      <span>{t('apply.s2.regCloses')} {formatDate(s.registrationEnd)}</span>
                    </div>
                    <div className="h-1 bg-[#E5E5E5] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${almostFull ? 'bg-[#EF4444]' : 'bg-[#2563EB]'}`}
                        style={{ width: `${Math.min(100, ((s.capacity - seats) / s.capacity) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleSelect(s)}
                    disabled={seats === 0}
                    className="w-full sm:w-auto shrink-0 px-4 py-3 sm:py-2 rounded-lg text-[13px] lg:text-[14px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    style={{ background: ACCENT }}
                  >
                    {seats === 0 ? t('apply.s2.full') : t('apply.s2.select')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-0 sm:static bg-white py-4 sm:py-0 flex gap-2">
        <button
          type="button"
          onClick={prevStep}
          className="flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium border bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          style={{ borderColor: BORDER, color: GRAY_500 }}
        >
          {t('apply.nav.prev')}
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!selectedSchedule}
          className="flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
          style={{ background: ACCENT }}
        >
          {t('apply.nav.next')}
        </button>
      </div>
    </div>
  );
}

// ─── L3 — Date + time-slot picker ─────────────────────────

interface CalendarDay {
  date: string;
  sessionCount: number;
  hasOpen: boolean;
}

const KO_DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KO_MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function L3SlotPicker() {
  const { t, lang } = useI18n();
  const { selectedCert, selectedLevel, selectedSchedule, setSchedule, prevStep, nextStep } = useWizard();

  const DAYS_OF_WEEK = lang === 'ko' ? KO_DAYS : EN_DAYS;
  const MONTH_NAMES = lang === 'ko' ? KO_MONTHS : EN_MONTHS;

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);
  const [calDays, setCalDays] = useState<CalendarDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<ScheduleSummary[]>([]);
  const [loadingCal, setLoadingCal] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedCert) return;
    setLoadingCal(true);
    setError('');
    schedulesApi
      .calendar(calYear, calMonth, selectedCert, selectedLevel ?? 'L3')
      .then((r) => setCalDays(r.data))
      .catch(() => setError(t('apply.step2.loadFailed' as never)))
      .finally(() => setLoadingCal(false));
  }, [calYear, calMonth, selectedCert, selectedLevel, t]);

  useEffect(() => {
    if (!selectedDate || !selectedCert) return;
    let cancelled = false;
    let first = true;
    const load = () => {
      if (first) setLoadingSlots(true);
      setError('');
      schedulesApi
        .slots(selectedCert, selectedDate, selectedLevel ?? 'L3')
        .then((r) => {
          if (!cancelled) setSlots(r.data);
        })
        .catch(() => {
          if (!cancelled) setError(t('apply.step2.slotsLoadFailed' as never));
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingSlots(false);
            first = false;
          }
        });
    };
    load();
    const timer = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedDate, selectedCert, selectedLevel, t]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  const grid = buildCalendarGrid(calYear, calMonth);
  const calMap = new Map(calDays.map((d) => [d.date, d]));

  const prevMonth = () => {
    if (calMonth === 1) { setCalYear(y => y - 1); setCalMonth(12); }
    else setCalMonth(m => m - 1);
    setSelectedDate(null);
  };
  const nextMonth = () => {
    if (calMonth === 12) { setCalYear(y => y + 1); setCalMonth(1); }
    else setCalMonth(m => m + 1);
    setSelectedDate(null);
  };

  const handleSelectSlot = (s: ScheduleSummary) => {
    setSchedule(s);
  };

  const today = isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());

  return (
    <div>
      <ApplySectionHeader
        title={t('apply.s2.l3Title')}
        sub={t('apply.s2.l3Sub')}
      />

      {error && (
        <div
          ref={errorRef}
          role="alert"
          className={`mb-4 px-4 py-3 bg-[#FEE2E2] border border-[#FECACA] rounded-xl ${T_BODY} text-status-danger`}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        {/* Calendar */}
        <div className="bg-white border rounded-xl overflow-hidden max-h-[430px]" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between px-4 py-3 bg-[#2563EB]">
            <button
              onClick={prevMonth}
              type="button"
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
              aria-label="prev month"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className={`${H_CARD} text-white`}>
              {lang === 'ko' ? `${calYear}년 ${MONTH_NAMES[calMonth - 1]}` : `${MONTH_NAMES[calMonth - 1]} ${calYear}`}
            </span>
            <button
              onClick={nextMonth}
              type="button"
              className="p-1.5 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
              aria-label="next month"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>

          <div className="grid grid-cols-7 px-3 pt-3">
            {DAYS_OF_WEEK.map((d, idx) => (
              <div
                key={d}
                className={`text-center ${T_META} font-semibold py-1.5`}
                style={{ color: idx === 0 ? '#DC2626' : idx === 6 ? '#2563EB' : GRAY_500 }}
              >
                {d}
              </div>
            ))}
          </div>

          {loadingCal ? (
            <div className={`py-10 text-center ${T_BODY}`} style={{ color: '#9CA3AF' }}>{t('apply.s2.calLoading')}</div>
          ) : (
            <div className="grid grid-cols-7 gap-1 px-3 pb-3">
              {grid.map((day, i) => {
                const col = i % 7;
                if (!day) {
                  return <div key={`empty-${i}`} className="aspect-square" />;
                }
                const dateStr = isoDate(calYear, calMonth, day);
                const info = calMap.get(dateStr);
                const isPast = dateStr < today;
                const isSelected = selectedDate === dateStr;
                const hasOpen = info?.hasOpen ?? false;
                const dayTextColor = isSelected
                  ? '#FFFFFF'
                  : isPast || !hasOpen
                  ? '#CBD5E1'
                  : col === 0
                  ? '#F87171'
                  : col === 6
                  ? '#60A5FA'
                  : INK_900;

                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => !isPast && hasOpen && setSelectedDate(dateStr)}
                    disabled={isPast || !hasOpen}
                    className={`relative aspect-square rounded-lg flex flex-col items-center justify-center text-[13px] lg:text-[14px] transition-colors cursor-pointer disabled:cursor-default ${
                      isSelected
                        ? 'bg-[#2563EB] font-semibold shadow-sm'
                        : hasOpen && !isPast
                        ? 'hover:bg-[#EFF6FF] font-medium'
                        : ''
                    }`}
                    style={{ color: dayTextColor }}
                  >
                    <span>{day}</span>
                    {hasOpen && !isPast && (
                      <span className={`w-1 h-1 rounded-full mt-0.5 ${isSelected ? 'bg-white' : 'bg-[#2563EB]'}`} />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className={`flex items-center gap-3 px-4 py-2.5 ${T_META}`} style={{ color: GRAY_500 }}>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#2563EB] inline-block" />
              {t('apply.s2.available')}
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#E5E7EB] inline-block" />
              {t('apply.s2.unavailable')}
            </div>
          </div>
        </div>

        {/* Time slots */}
        <div className="flex h-full flex-col">
          <div className={`font-semibold text-[16px] sm:text-[18px]`} style={{ color: INK_900 }}>
            {selectedDate
              ? t('apply.s2.slotsOn').replace('{date}', formatDate(selectedDate))
              : ''}
          </div>
          {!selectedDate ? (
            <div className="flex-1 min-h-[220px] md:min-h-0 py-8 md:py-0 rounded-xl flex flex-col items-center justify-center text-center" style={{ backgroundColor: '#f7f8fa' }}>
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: '#E5E7EB' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M4 4L20 11L13 13L11 20L4 4Z" fill="#FFFFFF" />
                </svg>
              </div>
              <p className="text-[15px] sm:text-[17px] leading-[1.5] font-medium whitespace-pre-line break-keep px-4" style={{ color: '#9CA3AF' }}>
                {'시험 날짜를 선택하면\n시간을 선택할 수 있습니다.'}
              </p>
            </div>
          ) : (
            <div className="relative min-h-[144px]">
              {slots.length === 0 ? (
                <div className={`py-4 text-center ${T_META}`} style={{ backgroundColor: '#9CA3AF' }}>
                  {loadingSlots ? t('apply.s2.slotsLoading') : t('apply.s2.slotsEmpty')}
                </div>
              ) : (
                <div className="space-y-4">
                  {(['am', 'pm'] as const).map((period) => {
                    const grouped = slots.filter((s) => {
                      const hour = getHourFromTime(s.examStartTime);
                      return period === 'am' ? hour < 12 : hour >= 12;
                    });
                    if (grouped.length === 0) return null;
                    return (
                      <div key={period}>
                        <div className="mb-2 text-[15px] font-semibold" style={{ color: INK_900 }}>
                          {period === 'am' ? '오전' : '오후'}
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          {grouped.map((s) => {
                            const available = s.remainingSeats > 0;
                            const isSelected = selectedSchedule?.id === s.id;
                            return (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => {
                                  if (available) handleSelectSlot(s);
                                }}
                                disabled={!available}
                                className={`relative px-4 sm:px-7 py-3 rounded-xl border text-left transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                                    : available
                                    ? 'border-gray-300 hover:border-[#2563EB] hover:bg-[#EFF6FF]'
                                    : 'border-[#F8FAFC] bg-[#F8FAFC] cursor-not-allowed opacity-60'
                                } disabled:opacity-50`}
                              >
                                <div className="text-[13px] lg:text-[14px] font-semibold" style={{ color: INK_900 }}>
                                  {s.examStartTime}
                                <div className={`${T_META} ${s.remainingSeats <= 5 ? 'text-status-danger' : ''}`} style={s.remainingSeats <= 5 ? undefined : { color: '#5389ff' }}>
                                  {available
                                    ? t('apply.s2.seatsLeftN').replace('{n}', String(s.remainingSeats))
                                    : t('apply.s2.full')}
                                </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {loadingSlots && slots.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/70 backdrop-blur-[1px]">
                  <div className="w-5 h-5 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 sm:static bg-white py-4 sm:py-0 flex gap-2">
        <button
          type="button"
          onClick={prevStep}
          className="flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium border bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          style={{ borderColor: BORDER, color: GRAY_500 }}
        >
          {t('apply.nav.prev')}
        </button>
        <button
          type="button"
          onClick={nextStep}
          disabled={!selectedSchedule}
          className="flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
          style={{ background: ACCENT }}
        >
          {t('apply.nav.next')}
        </button>
      </div>
    </div>
  );
}

function SuspendedSeriesStep() {
  const { t } = useI18n();
  const { selectedCert, prevStep } = useWizard();
  if (!selectedCert) return null;
  return (
    <div>
      <ApplySectionHeader
        title={t('apply.s2.l3Title')}
        sub={t('apply.s2.suspendedSub')}
      />
      <SuspendedSeriesNotice cert={selectedCert} />
      <div className="sticky bottom-0 sm:static bg-white py-4 sm:py-0">
        <button
          type="button"
          onClick={prevStep}
          className="w-full h-12 rounded-xl text-[13px] lg:text-[14px] font-medium border bg-white hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          style={{ borderColor: BORDER, color: GRAY_500 }}
        >
          {t('apply.nav.prev')}
        </button>
      </div>
    </div>
  );
}

export default function Step2Session() {
  const { selectedCert } = useWizard();
  if (isApplySeriesSuspended(selectedCert)) {
    return <SuspendedSeriesStep />;
  }
  if (isApplyKcpDemo()) {
    return <Step2KcpStub />;
  }
  // L1/L2/L3 are all on-demand online exams — use the same date + time-slot
  // picker for every level. (SessionCards is kept for any future scheduled-round
  // mode but is no longer on the on-demand apply path.)
  return <L3SlotPicker />;
}
