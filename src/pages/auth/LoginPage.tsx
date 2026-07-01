import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authApi, consumeSessionSupersededMessage } from '@/services/api';
import { useI18n } from '@/i18n';
import { safeRedirectPath } from '@/utils/authNavigate';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';

export default function LoginPage() {
  const SAVED_USER_ID_KEY = 'savedUserId';
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const redirectTo = safeRedirectPath((location.state as { from?: string } | null)?.from);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saveUserId, setSaveUserId] = useState(false);

  useEffect(() => {
    const savedUserId = localStorage.getItem(SAVED_USER_ID_KEY);
    if (!savedUserId) return;
    setUserId(savedUserId);
    setSaveUserId(true);
  }, []);

  useEffect(() => {
    const superseded = consumeSessionSupersededMessage();
    if (superseded) setError(superseded);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!userId.trim() || !password) {
      setError(t('login.error.required'));
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.login(userId, password);
      if (saveUserId) {
        localStorage.setItem(SAVED_USER_ID_KEY, userId.trim());
      } else {
        localStorage.removeItem(SAVED_USER_ID_KEY);
      }
      localStorage.setItem('accessToken', res.data.accessToken);
      localStorage.setItem('refreshToken', res.data.refreshToken);
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        t('login.error.failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-[var(--color-body)]">
      <SiteHeader active="login" />
      <PageHeroSolid
        title={t('login.title')}
        subtitle={t('login.heroSub')}
      />
      <PageTabs
        tabs={[
          { key: 'login', label: t('login.tab.login') },
          { key: 'signup', label: t('login.tab.signup') },
          { key: 'forgot', label: t('login.tab.forgot') },
        ]}
        active="login"
        onChange={(key) => {
          if (key === 'signup') navigate('/signup');
          if (key === 'login') navigate('/login');
          if (key === 'forgot') navigate('/forgot-password');
        }}
      />

      <main className="mx-auto w-full max-w-[var(--spacing-content-w)] px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-8 rounded-xl border border-[#E0E4ED] p-6 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:p-10">
          <section className="bg-white p-2 sm:p-4">
            <h2 className="mb-8 text-[30px] font-semibold tracking-[-0.02em] text-gray-800">{t('login.title')}</h2>

            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <label htmlFor="userId" className="form-label">
                  {t('login.userId')}
                </label>
                <input
                  id="userId"
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder={t('login.userIdPh')}
                  autoComplete="username"
                  aria-required="true"
                  className="login-autofill-input h-[46px] w-full rounded-md border border-[#E0E4ED] bg-white px-[14px] text-[18px] text-[#0A0E1A] outline-none"
                />
              </div>

              <div className="mb-5">
                <label htmlFor="password" className="form-label">
                  {t('login.password')}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.passwordPh')}
                    autoComplete="current-password"
                    aria-required="true"
                    className="login-autofill-input h-[46px] w-full rounded-md border border-[#E0E4ED] bg-white px-[14px] pr-11 text-[18px] text-[#0A0E1A] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('login.hidePwd') : t('login.showPwd')}
                    className="absolute right-3 top-1/2 flex -translate-y-1/2 cursor-pointer items-center border-none bg-transparent p-1 text-[#8B95B0]"
                  >
                    {showPassword ? (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className=" flex justify-end mb-4">
                <label className="inline-flex items-center gap-2 text-[16px] text-[#0A0E1A]">
                  <input
                    type="checkbox"
                    checked={saveUserId}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSaveUserId(checked);
                      if (!checked) {
                        localStorage.removeItem(SAVED_USER_ID_KEY);
                      }
                    }}
                  />
                  {t('login.saveId')}
                </label>
              </div>

              {error && (
                <p role="alert" className="mb-6 mt-4 text-[15px] font-medium leading-[1.4] text-[#FF3B30]">
                  ① {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`flex h-14 w-full ml-auto items-center justify-center gap-2 rounded-lg border-none text-[18px] font-semibold text-white ${
                  loading ? 'cursor-not-allowed bg-[#8B95B0]' : 'cursor-pointer bg-[#2B7FFF]'
                }`}
              >
                {loading ? t('login.submitting') : t('login.submit')}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-[#E0E4ED] bg-white px-10 py-4 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l-[#D0D5DD] flex flex-col justify-between">
            <p className="mb-8 text-[27px] leading-[1.35] tracking-[-0.02em] text-gray-800 whitespace-pre-line">
              {t('login.rightPanelPrompt')}
            </p>
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => navigate('/signup')}
                className="h-14 w-full rounded-lg border-none bg-blue-900 text-[18px] font-semisemibold text-white"
              >
                {t('login.cta.signup')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="h-14 w-full rounded-lg border border-[#9CA3AF] bg-white text-[18px] font-medium text-[#0A0E1A]"
              >
                {t('login.cta.forgot')}
              </button>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
