import { Card, Pagination, Table, TableWrap, Th, Td } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import type { ExamineeListResult } from '@admin/services/api';
import { ExamineeRow } from './ExamineeRow';
import type { DetailTab } from './ExamineeDetailContent';

interface ExamineesListProps {
  list: ExamineeListResult | null;
  listError: string | null;
  expandedId: string | null;
  onToggleExpand: (registrationId: string) => void;
  detail?: never;
  detailError?: never;
  activeTab?: DetailTab;
  onTabChange?: never;
  onRefund?: never;
  onViewEvidence?: never;
  page: number;
  onPageChange: (page: number) => void;
}

const TOTAL_COLS = 7;

export function ExamineesList({
  list,
  listError,
  expandedId,
  onToggleExpand,
  page,
  onPageChange,
}: ExamineesListProps) {
  const { t } = useI18n();
  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;

  return (
    <div className="p-0 overflow-hidden border-0">
      <TableWrap>
        <Table className="text-sm">
          <thead>
            <tr>
              <Th>{t('exm.col.regNo')}</Th>
              <Th>{t('exm.col.name')}</Th>
              <Th>{t('exm.col.phone')}</Th>
              <Th>{t('exm.col.exam')}</Th>
              <Th>{t('exm.col.examDate')}</Th>
              <Th>{t('exm.col.status')}</Th>
              <Th className="w-8">{t('exm.col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {list === null && !listError && (
              <tr>
                <Td colSpan={TOTAL_COLS} className="py-10 text-[var(--gray-400)]">
                  {t('common.loading')}
                </Td>
              </tr>
            )}
            {listError && (
              <tr>
                <Td colSpan={TOTAL_COLS} className="py-10 text-rose-600">
                  {listError}
                </Td>
              </tr>
            )}
            {list && list.items.length === 0 && !listError && (
              <tr>
                <Td colSpan={TOTAL_COLS} className="py-10 text-[var(--gray-400)]">
                  {t('exm.empty')}
                </Td>
              </tr>
            )}
            {list?.items.map((row) => {
              const isOpen = expandedId === row.registrationId;
              return (
                <ExamineeRow
                  key={row.registrationId}
                  row={row}
                  expanded={isOpen}
                  onToggle={() => onToggleExpand(row.registrationId)}
                />
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      {list && list.total > 0 && (
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} total={list.total} />
      )}
    </div>
  );
}
