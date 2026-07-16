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

export function adminPageIdFromPath(pathname: string): AdminPageId {
  const segment = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)[0] ?? '';
  if (!segment || segment === 'login') return 'dashboard';
  return PAGE_ID_SET.has(segment) ? (segment as AdminPageId) : 'dashboard';
}

export function adminPathForPage(id: string): string {
  return id === 'dashboard' ? '/' : `/${id}`;
}
