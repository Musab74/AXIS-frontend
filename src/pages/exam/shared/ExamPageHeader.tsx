import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { EXAM } from './tokens';

/* ─────────────────────────────────────────────────────────────
   ExamPageHeader — exam 흐름 전반에서 공용으로 사용하는 상단 헤더.
   - 좌측: 파란 배경 + 페이지 타이틀
   - 우측: 다크네이비 cutout 영역 + 현재날짜 + 남은시간(라이브 클럭)
   - 다른 exam 페이지(IdentityVerification, EnvironmentCheck 등)에서도
     동일한 톤을 유지하기 위해 이 컴포넌트만 import해서 사용

   사용 예:
     <ExamPageHeader title="시험 전 안내사항" />
     <ExamPageHeader title="본인 인증" remainingTimeLabel="제한시간" remainingTime="04:32" />
   ───────────────────────────────────────────────────────────── */

interface ExamPageHeaderProps {
  title: string;
  /** 우측 두 번째 항목 라벨. 기본 "남은시간". */
  remainingTimeLabel?: string;
  /** 직접 시간을 컨트롤하고 싶을 때 (예: 카운트다운). 비우면 라이브 시계가 표시됨. */
  remainingTime?: string;
  /**
   * 우측 첫 번째 줄을 "현재날짜" 대신 시험 제한시간으로 표시하고 싶을 때 사용.
   * `limitTime` 이 주어지면 날짜 라이브 클럭 대신 이 값을 고정 표시한다.
   * Runner 페이지에서 "제한시간 / 남은시간" 2줄을 만들기 위해 사용. 비우면 기존
   * "현재날짜" 줄이 그대로 표시되어 다른 exam 페이지는 영향받지 않는다.
   */
  limitTimeLabel?: string;
  limitTime?: string;
  /**
   * 남은시간 값의 색. 기본은 흰색(헤더 배경 파랑 위). Runner 페이지에서 5분/10분
   * 미만일 때 amber/red 로 강조하기 위해 사용. CSS color 값 그대로 전달.
   */
  remainingTimeColor?: string;
  /** 우측 시계/날짜 영역 자체를 숨김. 기본 false. */
  hideClock?: boolean;
}

function formatDateYYMMDD(d: Date): string {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

function formatTimeHHMMSS(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return { date: formatDateYYMMDD(now), time: formatTimeHHMMSS(now) };
}

export function ExamPageHeader({
  title,
  remainingTimeLabel,
  remainingTime,
  remainingTimeColor,
  limitTimeLabel,
  limitTime,
  hideClock = false,
}: ExamPageHeaderProps) {
  // 라벨 기본값은 UI 언어를 따른다 — 명시적으로 넘긴 라벨이 항상 우선.
  const { lang } = useI18n();
  const ko = lang === 'ko';
  const remainingLabel = remainingTimeLabel ?? (ko ? '남은시간' : 'Time left');
  const limitLabel = limitTimeLabel ?? (ko ? '제한시간' : 'Time limit');
  const dateLabel = ko ? '현재날짜' : 'Current date';
  const clock = useLiveClock();
  const timeText = remainingTime ?? clock.time;

  return (
    <header className="h-[clamp(68px,5.5vw,130px)] flex shrink-0 border-b border-[var(--exam-border,transparent)]">
      <div className="flex-1 bg-[var(--exam-header,#2563EB)] flex items-center px-[clamp(20px,2vw,56px)]">
        <h1 className={`text-white ${EXAM.text.pageTitle}`}>{title}</h1>
      </div>
      {!hideClock && (
        <div className="flex bg-[var(--exam-header,#2563EB)] flex-col items-center justify-center pr-[clamp(20px,1.8vw,48px)] gap-[clamp(2px,0.2vw,8px)]">
          {limitTime != null ? (
            <ClockLine label={limitLabel} value={limitTime} />
          ) : (
            <ClockLine label={dateLabel} value={clock.date} />
          )}
          <ClockLine label={remainingLabel} value={timeText} valueColor={remainingTimeColor} />
        </div>
      )}
    </header>
  );
}

function ClockLine({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="text-white leading-tight flex items-center font-semibold">
      <div className={`${EXAM.text.caption} text-slate-300`}>{label}</div>
      <div
        className="text-[clamp(15px,1.2vw,28px)] font-en text-right tabular-nums w-[clamp(80px,6.5vw,160px)]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
