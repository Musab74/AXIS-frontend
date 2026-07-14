/**
 * exam 흐름 전반에서 재사용되는 공용 UI 부품 + 디자인 토큰.
 *
 * 다른 exam 페이지(IdentityVerificationPage, EnvironmentCheckPage, 신규 페이지 등)에서
 * 동일한 디자인 톤을 유지하려면 여기서 import해서 쓰세요:
 *
 *   import { EXAM, ExamPageHeader, InfoRow, StepperNav } from '@/pages/exam/shared';
 *
 *   <h2 className={`${EXAM.text.sectionTitle} ${EXAM.color.ink}`}>제목</h2>
 *   <ExamPageHeader title="..." />
 *
 * 폰트 사이즈/색/박스 톤을 한 번에 바꾸려면 ./tokens.ts 한 파일만 수정.
 */
export { EXAM } from './tokens';
export { ExamPageHeader } from './ExamPageHeader';
export { ExamExitConfirmModal } from './ExamExitConfirmModal';
export { InfoRow } from './InfoRow';
export { StepperNav } from './StepperNav';
// Structured-input primitives for the v3 practical screens ("형식은 UI가 제공한다").
export { charLen } from './textLength';
export {
  Counter,
  ExamChecklist,
  ExamInput,
  ExamRowList,
  ExamSelect,
  ExamTable,
  ExamTextarea,
  FieldLabel,
  MaterialsPanel,
} from './StructuredInputs';
