import type { CertType } from '@/pages/apply/lib/WizardContext';

/**
 * AXIS-C / AXIS-H are closed until the September reopening (v3 cutover —
 * question banks purged). Keep in sync with backend `SUSPENDED_SERIES`.
 */
export const APPLY_SUSPENDED_SERIES: ReadonlySet<CertType> = new Set([
  'AXIS_C',
  'AXIS_H',
]);

export function isApplySeriesSuspended(cert: CertType | null | undefined): boolean {
  return !!cert && APPLY_SUSPENDED_SERIES.has(cert);
}

/** Always bilingual — shown regardless of UI language toggle. */
export function suspendedSeriesNotice(cert: CertType): { ko: string; en: string } {
  const label = cert.replace('_', '-');
  return {
    ko: `${label} 시험은 현재 접수가 중단되었습니다. 9월부터 재개될 예정입니다.`,
    en: `${label} registration is currently closed. It reopens in September.`,
  };
}
