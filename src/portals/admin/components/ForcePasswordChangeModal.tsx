import { useState, FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { isStrongPassword } from '@/lib/niceVerification';
import { adminApi } from '@admin/services/api';
import { clearAdminSession } from '@admin/utils/auth';

export const ADMIN_PW_CHANGED_FLAG = 'adminPwChanged';

/**
 * Blocking dialog when an admin account was reset (mustChangePassword).
 * Mirrors the expert portal flow — cannot be dismissed; on success the
 * backend revokes the session so we clear local tokens and return to login.
 */
export function ForcePasswordChangeModal() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const newValid = isStrongPassword(newPassword);
  const match = newPassword === confirmPassword;
  const canSubmit =
    currentPassword.length > 0 && newValid && match && confirmPassword.length > 0 && !busy;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setBusy(true);
    try {
      await adminApi.changePassword(currentPassword, newPassword);
      sessionStorage.setItem(ADMIN_PW_CHANGED_FLAG, '1');
      clearAdminSession();
      window.location.href = '/axis_manager/login';
    } catch (err: unknown) {
      const backendMsg = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      setError(
        Array.isArray(backendMsg)
          ? backendMsg.join(', ')
          : backendMsg || '비밀번호 변경에 실패했습니다. 다시 시도해주세요.',
      );
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-[rgba(15,23,42,0.55)] z-40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-force-pw-title"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[95vw] bg-white rounded-2xl border border-slate-200 shadow-xl p-7"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-amber-100 grid place-items-center">
            <KeyRound className="w-5 h-5 text-amber-600" strokeWidth={1.5} />
          </div>
          <div>
            <h2 id="admin-force-pw-title" className="text-lg font-semibold text-slate-900">
              비밀번호 변경 필요
            </h2>
            <p className="text-[12px] text-slate-500">관리자가 비밀번호를 초기화했습니다</p>
          </div>
        </div>

        <p className="text-sm text-slate-600 mb-5">
          임시 비밀번호로 로그인하셨습니다. 계속하려면 새 비밀번호를 설정해야 합니다.
        </p>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              현재 비밀번호 (임시 비밀번호)
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="임시 비밀번호 입력"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="영문+숫자+특수문자 8자 이상"
            />
            {newPassword.length > 0 && !newValid && (
              <p className="mt-1 text-[12px] text-rose-600">
                영문, 숫자, 특수문자를 포함해 8자 이상이어야 합니다.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="새 비밀번호 재입력"
            />
            {confirmPassword.length > 0 && !match && (
              <p className="mt-1 text-[12px] text-rose-600">새 비밀번호가 일치하지 않습니다.</p>
            )}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full h-10 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            비밀번호 변경
          </button>
        </form>

        <p className="mt-4 text-[11px] text-slate-400 text-center">
          변경 후 새 비밀번호로 다시 로그인하게 됩니다.
        </p>
      </div>
    </>
  );
}
