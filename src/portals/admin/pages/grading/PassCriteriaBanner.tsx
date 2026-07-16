import { Scale } from 'lucide-react';
import { Card } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';

/**
 * v3.0 pass criteria — must stay aligned with backend `SCORE_MODELS_V3`
 * (exam-spec.ts) and Expert RulesPage §3.
 */
export function PassCriteriaBanner({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();

  if (compact) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-700 leading-relaxed">
        <div className="font-semibold text-slate-900 mb-0.5 inline-flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" />
          {t('grade.criteria.title')}
        </div>
        <div>{t('grade.criteria.compact')}</div>
      </div>
    );
  }

  return (
    <Card className="p-4 mb-4 border-slate-200 bg-slate-50/80">
      <div className="flex items-start gap-2.5">
        <Scale className="w-4 h-4 mt-0.5 shrink-0 text-[var(--primary)]" />
        <div className="min-w-0 text-sm text-slate-700 leading-relaxed">
          <div className="font-semibold text-slate-900 mb-1.5">{t('grade.criteria.title')}</div>
          <ul className="space-y-1 list-disc pl-4">
            <li>{t('grade.criteria.l3')}</li>
            <li>{t('grade.criteria.l2')}</li>
            <li>{t('grade.criteria.l1')}</li>
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">{t('grade.criteria.note')}</p>
        </div>
      </div>
    </Card>
  );
}
