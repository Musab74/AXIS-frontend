import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { expertApi } from '@expert/services/api';
import { PW_CHANGED_FLAG } from '@expert/components/shared/ForcePasswordChangeModal';
import {
  clearExpertSession,
  hasExpertRole,
  isExpertSessionValid,
  isPureSuperAdmin,
  NOT_EXPERT_MSG,
  WRONG_CREDENTIALS_MSG,
} from '@expert/utils/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (isExpertSessionValid()) navigate('/', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (sessionStorage.getItem(PW_CHANGED_FLAG) === '1') {
      sessionStorage.removeItem(PW_CHANGED_FLAG);
      setNotice('비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.');
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    clearExpertSession();
    setLoading(true);
    try {
      const res = await expertApi.login(userId.trim(), password);
      const { accessToken, refreshToken, user } = res.data;

      if (!hasExpertRole(user.roles)) {
        clearExpertSession();
        if (isPureSuperAdmin(user.roles)) {
          window.location.href = '/axis_manager/';
          return;
        }
        setError(NOT_EXPERT_MSG);
        return;
      }

      localStorage.setItem('expertToken', accessToken);
      localStorage.setItem('expertRefreshToken', refreshToken);
      localStorage.setItem('expertUser', JSON.stringify(user));
      navigate('/');
    } catch (err: unknown) {
      clearExpertSession();
      const backendMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(backendMsg || WRONG_CREDENTIALS_MSG);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-500 grid place-items-center">
            <ShieldCheck className="w-5 h-5 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <div className="text-slate-900 font-semibold tracking-tight">AXIS Expert</div>
            <div className="text-[11px] text-slate-400">채점위원 포털</div>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-slate-900 mb-1">로그인</h1>
        <p className="text-sm text-slate-500 mb-6">채점위원(EXPERT) 계정으로 로그인하세요</p>

        {notice && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm">
            {notice}
          </div>
        )}

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">아이디</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoComplete="username"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="채점위원 아이디"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="비밀번호"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            로그인
          </button>
        </form>

        <p className="mt-6 text-[11px] text-slate-400 text-center">
          관리자(SUPER/EXAM/GRADING)는{' '}
          <a href="/axis_manager/" className="text-indigo-600 hover:underline">
            /axis_manager/
          </a>{' '}
          로 이동해 주세요.
        </p>
      </div>
    </div>
  );
}
