import type { CertType } from '@/pages/apply/lib/WizardContext';
import { suspendedSeriesNotice } from '@/pages/apply/lib/suspendedSeries';
import { T_BODY } from '@/pages/apply/lib/applyTokens';

export function SuspendedSeriesNotice({ cert }: { cert: CertType }) {
  const { ko, en } = suspendedSeriesNotice(cert);
  return (
    <div
      role="status"
      className={`mb-6 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl ${T_BODY} text-amber-800 break-keep`}
    >
      <p className="font-semibold">{ko}</p>
      <p className="mt-1 text-amber-700">{en}</p>
    </div>
  );
}
