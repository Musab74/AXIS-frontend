import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Pin, Plus, Loader2 } from 'lucide-react';
import {
  Button,
  FilterBar,
  Modal,
  PageHeader,
  Pagination,
  Search,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
  pushToast,
} from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import { adminApi } from '@admin/services/api';
import type { ContentNoticeRow, ContentNoticeStatus, NoticeTagType } from '@admin/services/api';
import { ContentSidePanel } from './components/ContentSidePanel';

interface NoticeForm {
  id: string;
  tag: string;
  tagType: NoticeTagType;
  title: string;
  content: string;
  status: ContentNoticeStatus;
  pinned: boolean;
}

const emptyNotice = (): NoticeForm => ({
  id: '',
  tag: '공지',
  tagType: 'NORMAL',
  title: '',
  content: '',
  status: 'DRAFT',
  pinned: false,
});

export default function NoticesPage() {
  const { t } = useI18n();
  const [notices, setNotices] = useState<ContentNoticeRow[]>([]);
  const [noticeTotal, setNoticeTotal] = useState(0);
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeSearch, setNoticeSearch] = useState('');
  const [noticeStatusFilter, setNoticeStatusFilter] = useState<ContentNoticeStatus | ''>('');
  const [noticePage, setNoticePage] = useState(1);
  const [editingNotice, setEditingNotice] = useState<NoticeForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContentNoticeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchNotices = useCallback(async () => {
    setNoticeLoading(true);
    try {
      const res = await adminApi.getNotices({
        status: noticeStatusFilter || undefined,
        search: noticeSearch || undefined,
        page: noticePage,
        limit: 20,
      });
      setNotices(res.data.notices);
      setNoticeTotal(res.data.pagination.total);
    } catch {
      pushToast(t('content.toast.error'), 'red');
    } finally {
      setNoticeLoading(false);
    }
  }, [noticePage, noticeSearch, noticeStatusFilter, t]);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  useEffect(() => {
    setNoticePage(1);
  }, [noticeSearch, noticeStatusFilter]);

  const noticeToForm = (n: ContentNoticeRow): NoticeForm => ({
    id: n.id,
    tag: n.tag,
    tagType: n.tagType,
    title: n.title,
    content: n.content,
    status: n.status,
    pinned: n.pinned,
  });

  const handleSaveNotice = async () => {
    if (!editingNotice) return;
    setSaving(true);
    try {
      if (editingNotice.id) {
        await adminApi.updateNotice(editingNotice.id, {
          tag: editingNotice.tag,
          tagType: editingNotice.tagType,
          title: editingNotice.title,
          content: editingNotice.content,
          status: editingNotice.status,
          pinned: editingNotice.pinned,
        });
      } else {
        await adminApi.createNotice({
          tag: editingNotice.tag,
          tagType: editingNotice.tagType,
          title: editingNotice.title,
          content: editingNotice.content,
          status: editingNotice.status,
          pinned: editingNotice.pinned,
        });
      }
      pushToast(t('content.toast.saved'), 'green');
      setEditingNotice(null);
      fetchNotices();
    } catch {
      pushToast(t('content.toast.error'), 'red');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminApi.deleteNotice(deleteTarget.id);
      pushToast(t('content.toast.deleted'), 'green');
      setDeleteTarget(null);
      fetchNotices();
    } catch {
      pushToast(t('content.toast.error'), 'red');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('nav.notices')}
        subtitle={t('ph.notices.sub')}
        actions={
          <Button variant="blue" onClick={() => setEditingNotice(emptyNotice())}>
            <Plus className="w-3.5 h-3.5" />
            {t('content.notice.add')}
          </Button>
        }
      />

      <FilterBar>
        <Search
          placeholder={t('content.search.title')}
          value={noticeSearch}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNoticeSearch(e.target.value)}
        />
        <Select
          value={noticeStatusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setNoticeStatusFilter(e.target.value as ContentNoticeStatus | '')
          }
        >
          <option value="">{t('content.filter.statusAll')}</option>
          <option value="PUBLISHED">{t('content.filter.public')}</option>
          <option value="DRAFT">{t('content.filter.private')}</option>
        </Select>
      </FilterBar>

      <div className="border-0">
        {noticeLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--gray-400)]" />
          </div>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t('content.col.no')}</Th>
                  <Th>{t('content.col.title')}</Th>
                  <Th>{t('content.col.regDate')}</Th>
                  <Th>{t('content.col.views')}</Th>
                  <Th>{t('content.col.status')}</Th>
                  <Th>{t('content.col.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n, idx) => (
                  <tr key={n.id} className="hover:bg-[var(--gray-50)]">
                    <Td mono>{noticeTotal - (noticePage - 1) * 20 - idx}</Td>
                    <Td className="text-left">
                      <div className="flex items-center gap-2">
                        {n.pinned && (
                          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--orange-50)] text-[var(--orange)]">
                            <Pin className="w-3 h-3" />
                          </span>
                        )}
                        <span className="font-semibold text-[var(--primary)]">{n.title}</span>
                      </div>
                    </Td>
                    <Td className="tabular-nums">{n.createdAt.slice(0, 10)}</Td>
                    <Td className="tabular-nums">{n.views.toLocaleString()}</Td>
                    <Td>
                      {n.status === 'PUBLISHED' ? (
                        <span className="text-[var(--green)]">{t('content.filter.public')}</span>
                      ) : (
                        <span className="text-[var(--gray-600)]">{t('content.filter.private')}</span>
                      )}
                    </Td>
                    <Td>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditingNotice(noticeToForm(n))}
                        className="mr-2"
                      >
                        {t('common.editBtn')}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteTarget(n)}>
                        {t('common.delete')}
                      </Button>
                    </Td>
                  </tr>
                ))}
                {notices.length === 0 && (
                  <tr>
                    <Td colSpan={6} className="py-12 text-[var(--gray-400)]">
                      {t('content.search.title')}
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </TableWrap>
        )}

        {!noticeLoading && (
          <Pagination
            page={noticePage}
            totalPages={Math.max(1, Math.ceil(noticeTotal / 20))}
            onChange={setNoticePage}
            total={noticeTotal}
          />
        )}
      </div>

      <ContentSidePanel
        open={!!editingNotice}
        onClose={() => setEditingNotice(null)}
        title={editingNotice?.id ? t('content.notice.editTitle') : t('content.notice.newTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingNotice(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="blue" onClick={handleSaveNotice} disabled={saving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editingNotice && (
          <>
            <Field label={t('content.notice.titleField')}>
              <input
                className="axis-input axis-focus w-full"
                placeholder={t('content.notice.titlePlaceholder')}
                value={editingNotice.title}
                onChange={(e) => setEditingNotice({ ...editingNotice, title: e.target.value })}
              />
            </Field>
            <Field label={t('content.notice.tagField')}>
              <div className="flex gap-2">
                <input
                  className="axis-input axis-focus flex-1"
                  placeholder={t('content.notice.tagPlaceholder')}
                  value={editingNotice.tag}
                  onChange={(e) => setEditingNotice({ ...editingNotice, tag: e.target.value })}
                />
                <select
                  className="axis-input axis-focus w-[120px]"
                  value={editingNotice.tagType}
                  onChange={(e) =>
                    setEditingNotice({ ...editingNotice, tagType: e.target.value as NoticeTagType })
                  }
                >
                  <option value="IMPORTANT">{t('content.notice.tagTypeImportant')}</option>
                  <option value="NORMAL">{t('content.notice.tagTypeNormal')}</option>
                </select>
              </div>
            </Field>
            <Field label={t('content.notice.contentField')}>
              <textarea
                className="axis-input axis-focus w-full min-h-[280px] resize-y"
                placeholder={t('content.notice.contentPlaceholder')}
                value={editingNotice.content}
                onChange={(e) => setEditingNotice({ ...editingNotice, content: e.target.value })}
              />
            </Field>
            <div className="flex gap-4">
              <ToggleField
                label={t('content.notice.publishField')}
                onLabel={
                  <span className="flex items-center gap-1 text-[var(--green)]">
                    <Eye className="w-3.5 h-3.5" /> {t('content.notice.public')}
                  </span>
                }
                offLabel={
                  <span className="flex items-center gap-1 text-[var(--gray-500)]">
                    <EyeOff className="w-3.5 h-3.5" /> {t('content.notice.private')}
                  </span>
                }
                checked={editingNotice.status === 'PUBLISHED'}
                onChange={(v) =>
                  setEditingNotice({ ...editingNotice, status: v ? 'PUBLISHED' : 'DRAFT' })
                }
              />
              <ToggleField
                label={t('content.notice.pinField')}
                onLabel={<span className="text-[var(--orange)]">{t('content.notice.pinned')}</span>}
                offLabel={<span className="text-[var(--gray-500)]">{t('content.notice.normal')}</span>}
                checked={editingNotice.pinned}
                onChange={(v) => setEditingNotice({ ...editingNotice, pinned: v })}
              />
            </div>
          </>
        )}
      </ContentSidePanel>

      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={t('content.confirm.deleteTitle')}
        width={440}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--gray-700)] m-0 leading-relaxed">
          {t('content.confirm.deleteBody')}
        </p>
        {deleteTarget && (
          <p className="mt-3 mb-0 text-sm font-semibold text-[var(--primary)] break-words">
            {deleteTarget.title}
          </p>
        )}
        <p className="mt-3 mb-0 text-xs text-[var(--gray-500)]">{t('content.confirm.deleteHint')}</p>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ToggleField({
  label,
  onLabel,
  offLabel,
  checked,
  onChange,
}: {
  label: string;
  onLabel: React.ReactNode;
  offLabel: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex-1">
      <div className="text-[12px] font-semibold text-[var(--gray-600)] mb-1.5">{label}</div>
      <button
        onClick={() => onChange(!checked)}
        className="axis-focus w-full px-3 py-2 rounded-lg border border-[var(--gray-border)] text-left flex items-center justify-between"
      >
        {checked ? onLabel : offLabel}
        <span
          className={[
            'inline-block w-9 h-5 rounded-full relative transition-colors',
            checked ? 'bg-[var(--blue)]' : 'bg-[var(--gray-300)]',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
              checked ? 'translate-x-[18px]' : 'translate-x-0.5',
            ].join(' ')}
          />
        </span>
      </button>
    </div>
  );
}
