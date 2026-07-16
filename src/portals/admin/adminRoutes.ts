import type { AdminRole } from '@admin/utils/auth';
import { hasAnyAdminRole } from '@admin/utils/auth';

/** Admin sidebar page ids — keep in sync with Sidebar NAV_GROUPS. */
export const ADMIN_PAGE_IDS = [
  'dashboard',
  'schedule',
  'question-bank',
  'registrations',
  'refund-requests',
  'members',
  'examinee',
  'monitoring',
  'grading',
  'results',
  'experts',
  'eligibility',
  'eligibility-refunds',
  'notices',
  'faq',
  'qna',
  'stats',
  'notification-settings',
] as const;

export type AdminPageId = (typeof ADMIN_PAGE_IDS)[number];

const PAGE_ID_SET = new Set<string>(ADMIN_PAGE_IDS);

/**
 * Roles that may use each page for its primary job.
 * Derived from backend `@Roles` on the page's main adminApi endpoints
 * (not incidental calls). Keep in sync with Nest controllers.
 */
export const ADMIN_PAGE_ROLES: Record<AdminPageId, readonly AdminRole[]> = {
  dashboard: ['SUPER_ADMIN', 'EXAM_ADMIN', 'GRADING_ADMIN'],
  schedule: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  'question-bank': ['SUPER_ADMIN', 'EXAM_ADMIN', 'GRADING_ADMIN'],
  registrations: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  'refund-requests': ['SUPER_ADMIN', 'EXAM_ADMIN'],
  members: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  examinee: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  // View live roster; warn/terminate further gated in MonitoringPage / API.
  monitoring: ['SUPER_ADMIN', 'EXAM_ADMIN', 'GRADING_ADMIN', 'PROCTOR', 'EXPERT'],
  // Queue/score: EXAM_ADMIN is not on grading-queue class roles.
  grading: ['SUPER_ADMIN', 'GRADING_ADMIN', 'EXPERT'],
  results: ['SUPER_ADMIN', 'GRADING_ADMIN', 'EXPERT'],
  experts: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  eligibility: ['SUPER_ADMIN', 'EXAM_ADMIN', 'GRADING_ADMIN', 'EXPERT'],
  'eligibility-refunds': ['SUPER_ADMIN', 'EXAM_ADMIN'],
  notices: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  faq: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  qna: ['SUPER_ADMIN', 'EXAM_ADMIN'],
  stats: ['SUPER_ADMIN', 'EXAM_ADMIN', 'GRADING_ADMIN'],
  // Preference PATCH is SUPER/EXAM only.
  'notification-settings': ['SUPER_ADMIN', 'EXAM_ADMIN'],
};

export function canAccessAdminPage(pageId: string, roles: string[] | undefined): boolean {
  if (!PAGE_ID_SET.has(pageId)) return false;
  const allowed = ADMIN_PAGE_ROLES[pageId as AdminPageId];
  if (!roles?.length) return false;
  return roles.some((r) => allowed.includes(r as AdminRole));
}

/** True when the stored session may open this page. */
export function sessionCanAccessAdminPage(pageId: string): boolean {
  if (!PAGE_ID_SET.has(pageId)) return false;
  return hasAnyAdminRole(...ADMIN_PAGE_ROLES[pageId as AdminPageId]);
}

/** First page the current session is allowed to open. */
export function firstAccessibleAdminPage(): AdminPageId {
  for (const id of ADMIN_PAGE_IDS) {
    if (sessionCanAccessAdminPage(id)) return id;
  }
  return 'dashboard';
}

export function adminPageIdFromPath(pathname: string): AdminPageId {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)[0] ?? '';
  if (!segment || segment === 'login') return 'dashboard';
  return PAGE_ID_SET.has(segment) ? (segment as AdminPageId) : 'dashboard';
}

export function adminPathForPage(id: string): string {
  return id === 'dashboard' ? '/' : `/${id}`;
}
