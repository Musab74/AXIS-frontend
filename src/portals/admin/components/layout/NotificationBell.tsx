import { Bell, CheckCheck, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@admin/i18n';
import { useAdminNotifications } from '@admin/hooks/useAdminNotifications';
import { AdminNotificationRow } from '@admin/services/api';
import { IconBtn } from '@admin/components/shared/ui-kit';
import { adminPathForPage } from '@admin/adminRoutes';

function formatRelative(ts: number, lang: 'ko' | 'en', t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t('common.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('common.minutesAgo', { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('common.hoursAgo', { n: hr });
  const d = new Date(ts);
  if (lang === 'ko') {
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function severityClass(severity: AdminNotificationRow['severity']): string {
  if (severity === 'HIGH') return 'bg-[#FEE2E2] text-[#B91C1C]';
  if (severity === 'MEDIUM') return 'bg-[#FEF3C7] text-[#B45309]';
  return 'bg-[var(--gray-100)] text-[var(--gray-600)]';
}

interface NotificationBellProps {
  onNavigate: (pageId: string) => void;
}

export function NotificationBell({ onNavigate: _onNavigate }: NotificationBellProps) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { items, unreadCount, markRead, markAllRead } = useAdminNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handleItemClick = (item: AdminNotificationRow) => {
    void markRead(item.id);
    setOpen(false);
    const inquiryId =
      typeof item.meta?.inquiryId === 'string' ? item.meta.inquiryId : null;
    const href = item.href?.replace(/^\//, '') ?? 'dashboard';
    const pageId = href === 'monitoring' ? 'monitoring' : href === 'qna' ? 'qna' : href;

    if (pageId === 'qna' && inquiryId) {
      navigate(`${adminPathForPage('qna')}?inquiryId=${encodeURIComponent(inquiryId)}`);
      return;
    }

    const sessionId =
      typeof item.meta?.sessionId === 'string' ? item.meta.sessionId : null;
    if (pageId === 'monitoring' && sessionId) {
      navigate(
        `${adminPathForPage('monitoring')}?sessionId=${encodeURIComponent(sessionId)}`,
      );
      return;
    }

    navigate(adminPathForPage(pageId));
  };

  return (
    <div className="relative" ref={rootRef}>
      <IconBtn
        title={t('notif.bell')}
        aria-label={t('notif.bell')}
        hasDot={unreadCount > 0}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="w-4 h-4" />
      </IconBtn>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[380px] max-h-[480px] overflow-hidden rounded-xl border border-[var(--gray-border)] bg-white shadow-[var(--shadow-lg)]">
          <div className="flex items-center justify-between border-b border-[var(--gray-100)] px-4 py-3">
            <div>
              <div className="text-[14px] font-semibold text-[var(--primary)]">{t('notif.title')}</div>
              {unreadCount > 0 && (
                <div className="text-[11px] text-[var(--gray-500)]">
                  {t('notif.unread', { n: unreadCount })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="axis-focus rounded-md p-1.5 text-[var(--gray-500)] hover:bg-[var(--gray-50)]"
                  title={t('notif.markAllRead')}
                >
                  <CheckCheck className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  navigate(adminPathForPage('notification-settings'));
                }}
                className="axis-focus rounded-md p-1.5 text-[var(--gray-500)] hover:bg-[var(--gray-50)]"
                title={t('notif.settings')}
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-[13px] text-[var(--gray-400)]">
                {t('notif.empty')}
              </div>
            ) : (
              items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className="w-full border-b border-[var(--gray-50)] px-4 py-3 text-left transition-colors hover:bg-[var(--gray-50)] bg-[#FAFBFF]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${severityClass(item.severity)}`}>
                          {t(`notif.cat.${item.category}`)}
                        </span>
                        {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--blue)]" />}
                      </div>
                      <div className="mt-1 truncate text-[13px] font-semibold text-[var(--gray-800)]">
                        {lang === 'ko' ? item.titleKo : item.titleEn}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[12px] text-[var(--gray-600)]">
                        {lang === 'ko' ? item.bodyKo : item.bodyEn}
                      </div>
                    </div>
                    <span className="shrink-0 text-[10px] text-[var(--gray-400)]">
                      {formatRelative(item.ts, lang, t)}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
