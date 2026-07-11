export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'EXAM_ADMIN',
  'GRADING_ADMIN',
  'PROCTOR',
  'EXPERT',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface StoredAdminUser {
  id: string;
  userId: string;
  name: string;
  roles: string[];
}

export const WRONG_CREDENTIALS_MSG =
  'Wrong credentials — please check the ID and password.';

export function hasAdminRole(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  return roles.some((role) => ADMIN_ROLES.includes(role as AdminRole));
}

/** PII reveal / password reset are SUPER_ADMIN-only actions. */
export function isSuperAdmin(): boolean {
  return getStoredAdminUser()?.roles.includes('SUPER_ADMIN') ?? false;
}

export function getStoredAdminUser(): StoredAdminUser | null {
  try {
    const raw = localStorage.getItem('adminUser');
    if (!raw) return null;
    return JSON.parse(raw) as StoredAdminUser;
  } catch {
    return null;
  }
}

export function clearAdminSession(): void {
  localStorage.removeItem('adminToken');
  localStorage.removeItem('adminRefreshToken');
  localStorage.removeItem('adminUser');
}

export function isAdminSessionValid(): boolean {
  const token = localStorage.getItem('adminToken');
  if (!token) return false;
  return hasAdminRole(getStoredAdminUser()?.roles);
}
