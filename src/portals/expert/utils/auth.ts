export const EXPERT_ROLE = 'EXPERT';

export interface StoredExpertUser {
  id: string;
  userId: string;
  name: string;
  roles: string[];
  /** Admin reset the password — force a change before normal use. */
  mustChangePassword?: boolean;
}

export const WRONG_CREDENTIALS_MSG =
  'Wrong credentials — please check the ID and password.';

export const NOT_EXPERT_MSG =
  '채점위원(EXPERT) 권한이 아닙니다. 관리자 포털로 이동해 주세요.';

export function hasExpertRole(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes(EXPERT_ROLE));
}

/** Pure SUPER_ADMIN (no EXPERT) should be redirected to /axis_manager/. */
export function isPureSuperAdmin(roles: string[] | undefined): boolean {
  if (!roles?.length) return false;
  if (roles.includes(EXPERT_ROLE)) return false;
  return roles.includes('SUPER_ADMIN');
}

export function getStoredExpertUser(): StoredExpertUser | null {
  try {
    const raw = localStorage.getItem('expertUser');
    if (!raw) return null;
    return JSON.parse(raw) as StoredExpertUser;
  } catch {
    return null;
  }
}

export function clearExpertSession(): void {
  localStorage.removeItem('expertToken');
  localStorage.removeItem('expertRefreshToken');
  localStorage.removeItem('expertUser');
}

export function isExpertSessionValid(): boolean {
  const token = localStorage.getItem('expertToken');
  if (!token) return false;
  return hasExpertRole(getStoredExpertUser()?.roles);
}
