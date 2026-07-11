import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { EXAM } from './tokens';

/* ─────────────────────────────────────────────────────────────
   StepperNav — 멀티스텝 페이지 하단의 "이전 / 다음" 네비게이션.
   - 사이즈/색은 EXAM.button.* 토큰을 사용 (한 곳에서 일괄 관리)
   - prev/next 모두 disabled + 로딩 스피너 지원
   - 마지막 스텝에서는 nextLabel을 "시험시작" / "완료" 등으로 바꿔서 사용

   사용 예:
     <StepperNav
       nextLabel="다음"
       onPrev={() => setStep(s => s - 1)}
       onNext={() => setStep(s => s + 1)}
       nextDisabled={!canAdvance}
     />
   ───────────────────────────────────────────────────────────── */

interface StepperNavProps {
  onPrev: () => void;
  onNext: () => void;
  prevLabel?: string;
  nextLabel: ReactNode;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** next 버튼에 로딩 스피너 + 라벨을 함께 표시 */
  isLoading?: boolean;
  loadingLabel?: ReactNode;
  className?: string;
}

export function StepperNav({
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  prevDisabled,
  nextDisabled,
  isLoading,
  loadingLabel,
  className = '',
}: StepperNavProps) {
  // 기본 라벨은 UI 언어를 따른다 — 명시적으로 넘긴 라벨이 항상 우선.
  const { lang } = useI18n();
  const prevText = prevLabel ?? (lang === 'ko' ? '이전' : 'Previous');
  const loadingText = loadingLabel ?? (lang === 'ko' ? '진행 중...' : 'Working...');
  return (
    <div className={`flex justify-center gap-3 ${className}`}>
      <button
        type="button"
        onClick={onPrev}
        disabled={prevDisabled || isLoading}
        className={`${EXAM.button.outlineLg} ${EXAM.text.buttonLg}`}
      >
        {prevText}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || isLoading}
        className={`${EXAM.button.primaryLg} ${EXAM.text.buttonLg} inline-flex items-center justify-center gap-2`}
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
            {loadingText}
          </>
        ) : (
          nextLabel
        )}
      </button>
    </div>
  );
}
