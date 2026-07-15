import { CSSProperties, useEffect, useMemo, useState } from 'react';
import {
  addMinutes,
  differenceInCalendarWeeks,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  parse,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { enUS, ko } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Calendar,
  dateFnsLocalizer,
  DateLocalizer,
  EventPropGetter,
  EventProps,
  Formats,
  SlotInfo,
  ToolbarProps,
  View,
} from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './schedule-calendar.css';
import { Card, certCodeOf } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { CertType, ScheduleRow } from '@admin/services/api';

type ScheduleCalendarEvent = {
  title: string;
  start: Date;
  end: Date;
  resource: ScheduleRow;
};

const locales = {
  en: enUS,
  ko,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 0 }),
  getDay,
  locales,
});

function certLabel(c: CertType): string {
  return c === 'AXIS_C' ? 'AXIS-C' : c === 'AXIS_H' ? 'AXIS-H' : 'AXIS';
}

function buildDateTime(dateText: string, timeText: string): Date {
  const base = new Date(dateText);
  const [hoursText = '0', minutesText = '0', secondsText = '0'] = timeText.split(':');
  const next = new Date(base);
  next.setHours(Number(hoursText), Number(minutesText), Number(secondsText), 0);
  return next;
}

function eventPalette(certType: CertType): { bg: string; border: string; text: string } {
  const code = certCodeOf(certType);
  if (code === 'axisc') {
    return { bg: 'var(--green-50)', border: '1px solid var(--green)', text: 'var(--green)' };
  }
  if (code === 'axish') {
    return { bg: 'var(--purple-50)',  border: '1px solid var(--purple)', text: 'var(--purple)' };
  }
  return { bg: 'var(--blue-50)',  border: '1px solid var(--blue-0)', text: 'var(--blue)' };
}

function EventCard({ event }: EventProps<ScheduleCalendarEvent>) {
  const { t } = useI18n();
  const row = event.resource;

  return (
    <div className="axis-schedule-event">
      <strong className="axis-schedule-event__title">
        {certLabel(row.certType)} {row.level}
      </strong>
      <span className="axis-schedule-event__meta">
        {t('common.roundLabel', { n: row.roundNumber })} · {row.examStartTime.slice(0, 5)}
      </span>
    </div>
  );
}

function CalendarToolbar({
  label,
  onNavigate,
}: ToolbarProps<ScheduleCalendarEvent>) {
  const { lang } = useI18n();

  return (
    <div className="axis-schedule-toolbar border-0">
      <div className="axis-schedule-toolbar__title">
        <strong>{label}</strong>
      </div>
      <div className="axis-schedule-toolbar__actions">
        <button
          type="button"
          className="axis-schedule-toolbar__btn"
          onClick={() => onNavigate('TODAY')}
        >
          {lang === 'ko' ? '오늘' : 'Today'}
        </button>
        <div className="axis-schedule-toolbar__nav">
          <button
            type="button"
            className="axis-schedule-toolbar__icon-btn"
            onClick={() => onNavigate('PREV')}
            aria-label={lang === 'ko' ? '이전 달' : 'Previous month'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="axis-schedule-toolbar__icon-btn"
            onClick={() => onNavigate('NEXT')}
            aria-label={lang === 'ko' ? '다음 달' : 'Next month'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduleCalendarView({
  rows,
  focusDate,
  onSelectSchedule,
}: {
  rows: ScheduleRow[];
  focusDate: Date;
  onSelectSchedule?: (row: ScheduleRow) => void;
}) {
  const { lang } = useI18n();
  const [currentDate, setCurrentDate] = useState(focusDate);

  useEffect(() => {
    setCurrentDate(focusDate);
  }, [focusDate]);

  const locale = lang === 'ko' ? 'ko' : 'en';
  const monthViews: View[] = ['month'];
  const visibleWeekCount = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 0 });

    return differenceInCalendarWeeks(calendarEnd, calendarStart, { weekStartsOn: 0 }) + 1;
  }, [currentDate]);

  const events = useMemo<ScheduleCalendarEvent[]>(() => {
    return rows.map((row) => {
      const start = buildDateTime(row.examDate, row.examStartTime);
      return {
        title: `${certLabel(row.certType)} ${row.level}`,
        start,
        end: addMinutes(start, 90),
        resource: row,
      };
    });
  }, [rows]);

  const eventStyleGetter: EventPropGetter<ScheduleCalendarEvent> = (event) => {
    const palette = eventPalette(event.resource.certType);
    return {
      className: 'axis-schedule-calendar__event-shell',
      style: {
        backgroundColor: palette.bg,
        color: palette.text,
        border: palette.border
      },
    };
  };

  const messages = useMemo(
    () =>
      lang === 'ko'
        ? {
            today: '오늘',
            previous: '이전', 
            next: '다음',
            month: '월',
            noEventsInRange: '해당 기간에 시험 일정이 없습니다.',
            showMore: (count: number) => `+${count}개 더보기`,
          }
        : {
            today: 'Today',
            previous: 'Back',
            next: 'Next',
            month: 'Month',
            noEventsInRange: 'No scheduled exams in this range.',
            showMore: (count: number) => `+${count} more`,
          },
    [lang],
  );

  const formats = useMemo<Formats>(
    () => ({
      weekdayFormat: (date: Date, culture?: string, nextLocalizer?: DateLocalizer) =>
        nextLocalizer?.format(date, 'EEE', culture) ?? '',
      dayFormat: (date: Date, culture?: string, nextLocalizer?: DateLocalizer) =>
        nextLocalizer?.format(date, 'd', culture) ?? '',
      dayHeaderFormat: (date: Date, culture?: string, nextLocalizer?: DateLocalizer) =>
        nextLocalizer?.format(date, lang === 'ko' ? 'M월 d일 EEE' : 'MMM d EEE', culture) ?? '',
      monthHeaderFormat: (date: Date, culture?: string, nextLocalizer?: DateLocalizer) =>
        nextLocalizer?.format(date, lang === 'ko' ? 'yyyy년 M월' : 'MMMM yyyy', culture) ?? '',
    }),
    [lang],
  );

  const calendarStyle = useMemo(
    () =>
      ({
        '--axis-schedule-week-count': visibleWeekCount,
      }) as CSSProperties,
    [visibleWeekCount],
  );

  return (
    <div className="overflow-visible">
      <div className="axis-schedule-calendar" style={calendarStyle}>
        <Calendar<ScheduleCalendarEvent>
          components={{ event: EventCard, toolbar: CalendarToolbar }}
          culture={locale}
          date={currentDate}
          defaultView="month"
          events={events}
          formats={formats}
          localizer={localizer}
          messages={messages}
          onDrillDown={(date: Date, _view: View) => setCurrentDate(date)}
          onNavigate={(date: Date) => setCurrentDate(date)}
          onSelectEvent={(event) => onSelectSchedule?.(event.resource)}
          onSelectSlot={(slot: SlotInfo) => setCurrentDate(slot.start)}
          popup
          selectable
          toolbar
          views={monthViews}
          eventPropGetter={eventStyleGetter}
        />
      </div>
    </div>
  );
}
