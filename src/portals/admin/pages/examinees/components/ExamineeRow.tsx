import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Td } from '@admin/components/shared/ui-kit';
import { MaskedPii } from '@admin/components/shared/MaskedPii';
import { useI18n } from '@admin/i18n';
import type { ExamineeListRow } from '@admin/services/api';
import { certLabel, statusBadgeTone } from '../lib/status';
import { fmtDate } from '../lib/format';
import type { DetailTab } from './ExamineeDetailContent';

interface ExamineeRowProps {
  row: ExamineeListRow;
  expanded: boolean;
  onToggle: () => void;
  detail?: never;
  detailError?: never;
  activeTab?: DetailTab;
  onTabChange?: never;
  onRefund?: never;
  onViewEvidence?: never;
}

export function ExamineeRow({
  row,
  expanded,
  onToggle,
}: ExamineeRowProps) {
  const { t } = useI18n();
  const Chevron = expanded ? ChevronUp : ChevronDown;
  const statusTone = statusBadgeTone(row.examineeStatus);

  return (
    <tr
      onClick={onToggle}
      className={`cursor-pointer transition-colors ${
        expanded ? 'bg-[var(--blue-50)]' : 'hover:bg-[var(--gray-50)]'
      }`}
    >
      <Td mono className="whitespace-nowrap text-[11px]">
        {row.registrationNumber ?? '—'}
      </Td>
      <Td strong className="whitespace-nowrap">
        {row.user.name}
      </Td>
      <Td className="whitespace-nowrap tabular-nums">
        <MaskedPii userDbId={row.user.id} field="phone" value={row.user.phone} />
      </Td>
      <Td className="whitespace-nowrap">
        {certLabel(row.schedule.certType)} {row.schedule.level} ·{' '}
        {t('common.round')} {row.schedule.roundNumber}
      </Td>
      <Td className="whitespace-nowrap tabular-nums">
        {fmtDate(row.session?.startedAt ?? row.registrationCreatedAt)}
      </Td>
      <Td
        className={
          statusTone === 'red'
            ? 'text-[var(--red)]'
            : statusTone === 'blue' || statusTone === 'indigo'
            ? 'text-[var(--blue)]'
            : statusTone === 'green'
            ? 'text-[var(--green)]'
            : statusTone === 'orange' || statusTone === 'amber'
            ? 'text-[var(--orange)]'
            : statusTone === 'purple'
            ? 'text-[var(--purple)]'
            : 'text-[var(--gray-600)]'
        }
      >
        {t(`exm.status.${row.examineeStatus}`)}
      </Td>
      <Td className="w-30">
          <Button size="sm" variant="blue" >
              상세보기
          </Button>
      </Td>
    </tr>
  );
}
