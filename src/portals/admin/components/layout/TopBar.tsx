import { Globe, Menu, User } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@admin/i18n';
import { NotificationBell } from '@admin/components/layout/NotificationBell';
import { sessionCanAccessAdminPage } from '@admin/adminRoutes';

interface ExamInfo {
  name: string;
  takers: number;
  warnings: number;
}

interface TopBarProps {
  activeId: string;
  examInProgress: boolean;
  examInfo: ExamInfo;
  onJumpToMonitoring: () => void;
  onToggleSidebar: () => void;
  onNavigate: (pageId: string) => void;
  adminName?: string;
  adminRole?: string;
}

export function TopBar({
  activeId,
  examInProgress,
  examInfo,
  onJumpToMonitoring,
  onToggleSidebar,
  onNavigate,
  adminName,
  adminRole = 'super_admin',
}: TopBarProps) {
  const { t, lang, setLang } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = (adminName ?? t('chrome.adminUser')).slice(0, 1);

  return (
    <header
      className="sticky top-0 z-10 flex h-[var(--topbar-h)] items-center gap-4 border-b border-[var(--gray-border)] bg-white px-5"
      style={{ height: 'var(--topbar-h)' }}
    >
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="axis-focus flex h-9 w-9 items-center justify-center rounded-lg text-[var(--gray-900)] transition-colors hover:bg-[var(--gray-50)] hover:text-[var(--gray-900)]"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="text-[22px] font-black tracking-[-0.04em] text-[var(--primary)]">
            AXIS 관리자
          </div>
          <div className="rounded-md bg-[var(--gray-50)] px-2.5 py-1 text-[11px] font-medium text-[var(--gray-800)]">
            {adminName ?? t('chrome.adminUser')} 님 안녕하세요.
          </div>
        </div>
      </div>

      {/* Live banner — only if this role can open monitoring */}
      {examInProgress && activeId !== 'monitoring' && sessionCanAccessAdminPage('monitoring') && (
        <button
          onClick={onJumpToMonitoring}
          className="axis-focus flex min-w-0 items-center gap-2.5 rounded-full border border-[#FECACA] bg-gradient-to-r from-[#FEF2F2] to-white px-3 py-[6px] text-[12px] font-medium text-[var(--gray-700)] transition-shadow hover:shadow-[var(--shadow-sm)]"
        >
          <span className="relative w-2 h-2 bg-[var(--red)] rounded-full">
            <span className="absolute inset-[-4px] rounded-full bg-[var(--red)] opacity-40 animate-[pulse-dot_1.6s_ease-out_infinite]" />
          </span>
          <span className="text-[var(--red)] font-bold tracking-wider text-[11px]">LIVE</span>
          <span className="truncate">
            {examInfo.name || ''} · {t('chrome.takersInProgress', { n: examInfo.takers })}
          </span>
          <span className="text-[var(--blue)] font-semibold ml-1">{t('chrome.gotoMonitor')}</span>
        </button>
      )}

      {/* Right controls */}
      <div className={`flex items-center gap-2 ${examInProgress && activeId !== 'monitoring' ? 'ml-auto' : 'ml-auto'}`}>
        <NotificationBell onNavigate={onNavigate} />

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="axis-focus flex h-9 w-9 items-center justify-center rounded-full border border-[var(--gray-border)] bg-[var(--gray-50)] text-[var(--gray-500)] transition-colors hover:bg-[var(--gray-100)] hover:text-[var(--black-900)]"
          >
            <User className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-40 min-w-[180px] bg-white border border-[var(--gray-border)] rounded-xl shadow-[var(--shadow-lg)] py-1.5">
                <div className="border-b border-[var(--gray-100)] px-3 py-2">
                  <div className="text-[13px] font-semibold text-[var(--primary)]">
                    {adminName ?? t('chrome.adminUser')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--gray-500)]">{adminRole}</div>
                </div>
                <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-[var(--gray-400)] flex items-center gap-1.5">
                  <Globe className="w-3 h-3" />
                  Language
                </div>
                {(['ko', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => {
                      setLang(l);
                      setMenuOpen(false);
                    }}
                    className={[
                      'w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2',
                      lang === l ? 'text-[var(--primary)] font-semibold' : 'text-[var(--gray-700)] hover:bg-[var(--gray-50)]',
                    ].join(' ')}
                  >
                    <span className="w-1 h-1 rounded-full" style={{ background: lang === l ? 'var(--blue)' : 'transparent' }} />
                    {l === 'ko' ? '한국어' : 'English'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
