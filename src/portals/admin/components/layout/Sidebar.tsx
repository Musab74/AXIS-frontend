import {
  LayoutDashboard,
  Calendar,
  FileText,
  CreditCard,
  Users,
  UserCircle,
  Monitor,
  CheckSquare,
  Trophy,
  Megaphone,
  MessageCircle,
  BarChart3,
  UserCog,
  FileCheck,
  RotateCcw,
  LogOut,
  Bell,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useI18n } from '@admin/i18n';
import { hasAnyAdminRole } from '@admin/utils/auth';

type NavItem = {
  id: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number;
  live?: boolean;
};

type NavGroup = {
  id: string;
  titleKey?: string;
  railLabelKey: string;
  railIcon: ComponentType<{ className?: string }>;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'dashboard',
    railLabelKey: 'nav.dashboard',
    railIcon: LayoutDashboard,
    items: [{ id: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard }],
  },
  {
    id: 'exam',
    titleKey: 'side.group.exam',
    railLabelKey: 'side.group.exam',
    railIcon: Calendar,
    items: [
      { id: 'schedule', labelKey: 'nav.schedule', icon: Calendar },
      { id: 'question-bank', labelKey: 'nav.questionBank', icon: FileText },
    ],
  },
  {
    id: 'registration',
    titleKey: 'side.group.registration',
    railLabelKey: 'side.group.registration',
    railIcon: CreditCard,
    items: [
      { id: 'registrations', labelKey: 'nav.registrations', icon: CreditCard },
      { id: 'refund-requests', labelKey: 'nav.refundRequests', icon: RotateCcw },
    ],
  },
  {
    id: 'taking',
    titleKey: 'side.group.taking',
    railLabelKey: 'side.group.taking',
    railIcon: Users,
    items: [
      { id: 'members', labelKey: 'nav.members', icon: UserCircle },
      { id: 'examinee', labelKey: 'nav.examinee', icon: Users },
      { id: 'monitoring', labelKey: 'nav.monitoring', icon: Monitor, live: true },
    ],
  },
  {
    id: 'grading',
    titleKey: 'side.group.grading',
    railLabelKey: 'side.group.grading',
    railIcon: CheckSquare,
    items: [
      { id: 'grading', labelKey: 'nav.grading', icon: CheckSquare },
      { id: 'results', labelKey: 'nav.results', icon: Trophy },
      { id: 'experts', labelKey: 'nav.experts', icon: UserCog },
      { id: 'eligibility', labelKey: 'nav.eligibility', icon: FileCheck },
      { id: 'eligibility-refunds', labelKey: 'nav.eligibilityRefunds', icon: RotateCcw },
    ],
  },
  {
    id: 'content',
    titleKey: 'side.group.content',
    railLabelKey: 'side.group.content',
    railIcon: Megaphone,
    items: [
      { id: 'notices', labelKey: 'nav.notices', icon: Megaphone },
      { id: 'faq', labelKey: 'nav.faq', icon: FileText },
      { id: 'qna', labelKey: 'nav.qna', icon: MessageCircle },
    ],
  },
  {
    id: 'analytics',
    titleKey: 'side.group.analytics',
    railLabelKey: 'side.group.analytics',
    railIcon: BarChart3,
    items: [
      { id: 'stats', labelKey: 'nav.stats', icon: BarChart3 },
      { id: 'notification-settings', labelKey: 'nav.notificationSettings', icon: Bell },
    ],
  },
];

interface SidebarProps {
  activeId: string;
  onNavigate: (id: string) => void;
  onRailSelect: (id: string, isActiveGroup: boolean) => void;
  onLogout: () => void;
  examInProgress: boolean;
  isPanelOpen: boolean;
  adminName?: string;
  adminRole?: string;
}

export function Sidebar({
  activeId,
  onNavigate,
  onRailSelect,
  onLogout,
  examInProgress,
  isPanelOpen,
  adminName,
  adminRole = 'super_admin',
}: SidebarProps) {
  const { t } = useI18n();
  const canSeeEligibilityRefunds = hasAnyAdminRole('SUPER_ADMIN', 'EXAM_ADMIN');

  const activeGroup =
    NAV_GROUPS.find((group) => group.items.some((item) => item.id === activeId)) ?? NAV_GROUPS[0];

  const visibleItems = activeGroup.items.filter((item) => {
    if (item.id === 'eligibility-refunds') return canSeeEligibilityRefunds;
    return true;
  });

  return (
    <aside
      className={[
        'relative z-20 shrink-0 bg-white flex h-full overflow-visible transition-[width] duration-300 ease-out',
        isPanelOpen ? 'w-[280px]' : 'w-[72px]',
      ].join(' ')}
    >
      <div className="w-[80px] shrink-0 bg-[var(--primary)] text-white flex flex-col items-center py-4 rounded-tr-3xl">
        <nav className="flex flex-col items-center gap-2 w-full">
          {NAV_GROUPS.map((group) => {
            const RailIcon = group.railIcon;
            const isActive = group.id === activeGroup.id;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onRailSelect(group.items[0].id, isActive)}
                aria-label={t(group.railLabelKey)}
                className={[
                  'axis-focus flex flex-col items-center justify-center gap-1.5 rounded-2xl px-2.5 py-2 transition-colors transform-gpu',
                  isActive
                    ? 'bg-[#3B82F6] text-white shadow-sm animate-[axisRailPop_220ms_cubic-bezier(0.22,1,0.36,1)]'
                    : 'text-white/75 hover:bg-white/10 hover:text-white',
                ].join(' ')}
              >
                <RailIcon className="h-[18px] w-[18px] mt-0.5" />
                <span className="text-[10px] font-light leading-[1.2] tracking-[-0.01em] text-center break-keep">
                  {t(group.railLabelKey)}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={onLogout}
            aria-label="Logout"
            className="axis-focus flex h-11 w-11 items-center justify-center rounded-lg text-white/75 transition-colors hover:bg-white/10 hover:text-[var(--red-100,#FEE2E2)]"
          >
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      <div
        className={[
          'min-w-0  flex flex-col overflow-hidden transition-all duration-300 ease-out',
          isPanelOpen ? 'w-[200px] opacity-100' : 'w-0 opacity-0 border-l-0',
        ].join(' ')}
      >

        <nav className="flex-1 overflow-y-auto pl-3 pr-2 py-3 border-r border-[var(--gray-border)] ">
          <ul className="space-y-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeId === item.id;
              const showLive = item.live && examInProgress;

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={[
                      'axis-focus w-full flex items-center gap-2.5 rounded-md pl-4 pr-2 py-2.5 text-[14px] font-medium transition-colors relative',
                      isActive
                        ? 'bg-[var(--blue-50)] text-[var(--gray-900)]'
                        : 'text-[var(--gray-700)] hover:bg-[var(--gray-50)]',
                    ].join(' ')}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-[var(--primary)]' : 'text-[var(--gray-500)]'
                      }`}
                    />
                    <span className="flex-1 text-left truncate">{t(item.labelKey)}</span>
                    {showLive ? (
                      <span className="relative h-[7px] w-[7px] rounded-full bg-[var(--red)]">
                        <span className="absolute inset-[-3px] rounded-full bg-[var(--red)] opacity-35 animate-[pulse-dot_1.6s_ease-out_infinite]" />
                      </span>
                    ) : item.badge ? (
                      <span className="rounded-full bg-[var(--red)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}
