import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getApiMessageOrigin } from '@/services/api';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';

type Step = 'verify' | 'register';

interface NiceResult {
  sessionId: string;
  name: string;
  phone: string;
  birthDate: string;
  gender: string;
}

const INPUT_CLASS =
  'login-autofill-input h-[46px] w-full rounded-md border border-[#E0E4ED] bg-white px-[14px] text-[16px] text-[#0A0E1A] outline-none';

export default function SignupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  // Step control
  const [step, setStep] = useState<Step>('verify');

  // Step 1: NICE verification
  const [phone, setPhone] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [niceResult, setNiceResult] = useState<NiceResult | null>(null);
  const verifyMethod: 'CHECKPLUS' | 'IPIN' = 'CHECKPLUS';

  // Step 2: Account creation
  const [userId, setUserId] = useState('');
  const [userIdChecked, setUserIdChecked] = useState<boolean | null>(null);
  const [userIdChecking, setUserIdChecking] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [agreeAll, setAgreeAll] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);

  // Phone formatting
  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 11);
    if (numbers.length <= 3) return numbers;
    if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
    return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7)}`;
  };

  // Step 1: Start NICE verification
  const handleVerify = async () => {
    setVerifyError('');
    const cleanPhone = phone.replace(/-/g, '');

    if (!cleanPhone || cleanPhone.length < 10) {
      setVerifyError(t('signup.error.invalidPhone'));
      return;
    }

    setVerifying(true);

    const applyVerified = (
      data: { verified?: boolean; alreadyRegistered?: boolean; existingUserId?: string;
        sessionId: string; name: string; phone?: string; birthDate: string; gender: string },
    ): 'ok' | 'duplicate' | 'invalid' => {
      if (!data?.verified) return 'invalid';
      if (data.alreadyRegistered) {
        setVerifyError(t('signup.error.duplicate', { userId: data.existingUserId ?? '' }));
        return 'duplicate';
      }
      setNiceResult({
        sessionId: data.sessionId,
        name: data.name,
        phone: data.phone || cleanPhone,
        birthDate: data.birthDate,
        gender: data.gender,
      });
      setStep('register');
      return 'ok';
    };

    void getApiMessageOrigin();

    const popup = window.open(
      '',
      'nicePopup',
      'width=460,height=640,scrollbars=yes,resizable=yes',
    );

    if (!popup) {
      setVerifyError(t('signup.error.popupBlocked'));
      setVerifying(false);
      return;
    }

    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let popupCloseTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (popupCloseTimer !== undefined) clearInterval(popupCloseTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    };

    try {
      const reqRes = await authApi.requestNiceVerification(verifyMethod);
      const { encData, actionUrl, sessionId } = reqRes.data;

      const form = popup.document.createElement('form');
      form.method = 'POST';
      form.action = actionUrl;

      const mInput = popup.document.createElement('input');
      mInput.type = 'hidden';
      mInput.name = 'm';
      mInput.value = 'checkplusSerivce';
      form.appendChild(mInput);

      const input = popup.document.createElement('input');
      input.type = 'hidden';
      input.name = 'EncodeData';
      input.value = encData;
      form.appendChild(input);

      popup.document.body.appendChild(form);
      form.submit();

      pollTimer = setInterval(async () => {
        if (stopped) return;
        try {
          const res = await authApi.getNiceSession(sessionId);
          const data = res.data as {
            status: 'PENDING' | 'SUCCESS' | 'FAILED';
            verified?: boolean;
            alreadyRegistered?: boolean;
            existingUserId?: string;
            sessionId?: string;
            name?: string;
            phone?: string;
            birthDate?: string;
            gender?: string;
            message?: string;
          };
          if (data.status === 'PENDING') return;
          cleanup();
          try { popup.close(); } catch { /* noop */ }
          if (data.status === 'FAILED') {
            setVerifyError(data.message || t('signup.error.verifyFailed'));
            setVerifying(false);
            return;
          }
          const outcome = applyVerified({
            verified: true,
            alreadyRegistered: data.alreadyRegistered,
            existingUserId: data.existingUserId,
            sessionId: data.sessionId || sessionId,
            name: data.name || '',
            phone: data.phone,
            birthDate: data.birthDate || '',
            gender: data.gender || '',
          });
          if (outcome === 'invalid') {
            setVerifyError(t('signup.error.invalidVerify'));
          }
          setVerifying(false);
        } catch {
          // Transient network errors during polling are non-fatal; keep polling until timeout.
        }
      }, 1500);

      let openSeenAt = Date.now();
      popupCloseTimer = setInterval(() => {
        if (stopped) return;
        if (!popup.closed) { openSeenAt = Date.now(); return; }
        if (Date.now() - openSeenAt < 5000) return;
      }, 500);

      timeoutTimer = setTimeout(() => {
        if (stopped) return;
        cleanup();
        try { popup.close(); } catch { /* noop */ }
        setVerifyError(t('signup.error.timeout'));
        setVerifying(false);
      }, 5 * 60 * 1000);
    } catch {
      cleanup();
      try { popup.close(); } catch { /* noop */ }
      setVerifyError(t('signup.error.requestFailed'));
      setVerifying(false);
    }
  };

  // Check user ID availability
  const handleCheckUserId = async () => {
    if (!userId || userId.length < 4) return;
    setUserIdChecking(true);
    try {
      const res = await authApi.checkUserId(userId);
      setUserIdChecked(res.data.available);
    } catch {
      setUserIdChecked(null);
    } finally {
      setUserIdChecking(false);
    }
  };

  // Password validation
  const passwordValid =
    password.length >= 8 &&
    /[a-zA-Z]/.test(password) &&
    /\d/.test(password) &&
    /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

  const passwordsMatch = password === passwordConfirm && passwordConfirm.length > 0;

  // Agree all
  const handleAgreeAll = (checked: boolean) => {
    setAgreeAll(checked);
    setAgreeTerms(checked);
    setAgreePrivacy(checked);
    setAgreeMarketing(checked);
  };

  // Step 2: Submit signup
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError('');

    if (!niceResult) {
      setSignupError(t('signup.error.verifyFirst'));
      return;
    }
    if (!userId || userId.length < 4) {
      setSignupError(t('signup.error.userIdLen'));
      return;
    }
    if (userIdChecked !== true) {
      setSignupError(userIdChecked === false ? t('signup.error.userIdTaken') : t('signup.error.checkUserId'));
      return;
    }
    if (!passwordValid) {
      setSignupError(t('signup.error.weakPwd'));
      return;
    }
    if (!passwordsMatch) {
      setSignupError(t('signup.error.pwdMismatch'));
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setSignupError(t('signup.error.requiredAgree'));
      return;
    }

    setSignupLoading(true);
    try {
      const res = await authApi.signup({
        userId,
        password,
        niceSessionId: niceResult.sessionId,
        email: email || undefined,
        agreePrivacy,
        agreeTerms,
        agreeMarketing,
      });
      localStorage.setItem('accessToken', res.data.accessToken);
      localStorage.setItem('refreshToken', res.data.refreshToken);
      navigate('/');
    } catch (err: any) {
      const msg = err.response?.data?.message || t('signup.error.signupFailed');
      setSignupError(msg);
    } finally {
      setSignupLoading(false);
    }
  };

  // Format birth date for display
  const formatBirthDate = (bd: string) => {
    if (!bd || bd.length !== 8) return bd;
    return `${bd.slice(0, 4)}.${bd.slice(4, 6)}.${bd.slice(6, 8)}`;
  };

  return (
    <div className="min-h-screen bg-white text-[var(--color-body)]">
      <SiteHeader active="login" />
      <PageHeroSolid
        title={t('signup.title')}
        subtitle={t('signup.heroSub')}
      />
      <PageTabs
        tabs={[
          { key: 'login', label: t('login.tab.login') },
          { key: 'signup', label: t('login.tab.signup') },
          { key: 'forgot', label: t('login.tab.forgot') },
        ]}
        active="signup"
        onChange={(key) => {
          if (key === 'signup') navigate('/signup');
          if (key === 'login') navigate('/login');
          if (key === 'forgot') navigate('/forgot-password');
        }}
      />

      <main className="mx-auto w-full max-w-[var(--spacing-content-w)] px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-8 rounded-xl border border-[#E0E4ED] p-6 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:p-10">
          <section className="bg-white p-2 sm:p-4">
            <h2 className="mb-8 text-[30px] font-semibold tracking-[-0.02em] text-gray-800">{t('signup.title')}</h2>

        
            {/* ═══ STEP 1: NICE Verification ═══ */}
            {step === 'verify' && (
              <div>
                <div className="mb-4">
                  <label htmlFor="phone" className="form-label">
                    {t('signup.phone')} <span className="text-[#DC2626]">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(formatPhone(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !verifying) {
                          e.preventDefault();
                          handleVerify();
                        }
                      }}
                      placeholder={t('signup.phonePh')}
                      aria-required="true"
                      disabled={verifying}
                      className={`${INPUT_CLASS} flex-1`}
                      style={{ opacity: verifying ? 0.6 : 1 }}
                    />
                    <button
                      type="button"
                      onClick={handleVerify}
                      disabled={verifying || !phone || phone.replace(/-/g, '').length < 10}
                      className={`flex h-[46px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border-none px-[18px] text-[14px] font-bold ${
                        verifying || !phone || phone.replace(/-/g, '').length < 10
                          ? 'cursor-not-allowed bg-[#E0E4ED] text-[#8B95B0]'
                          : 'cursor-pointer bg-[#2B7FFF] text-white'
                      }`}
                    >
                      {verifying ? (
                        <>
                          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          {t('signup.verifying')}
                        </>
                      ) : (
                        t('signup.verify')
                      )}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[12px] text-[#8B95B0]">{t('signup.phoneHint')}</p>
                </div>

                {verifyError && (
                  <p role="alert" className="mb-6 mt-4 text-[15px] font-medium leading-[1.4] text-[#FF3B30]">
                    ① {verifyError}
                  </p>
                )}

                <div className="mt-4 rounded-md">
                  <div className="mb-2 flex items-center gap-1.5">
                    <svg className="h-4 w-4 text-[#2B7FFF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-[13px] font-bold text-[#0A0E1A]">{t('signup.infoTitle')}</span>
                  </div>
                  <ul className="m-0 pl-[18px] text-[12px] leading-[1.5] text-gray-600">
                    <li>{t('signup.info1')}</li>
                    <li>{t('signup.info3')}</li>
                    <li>{t('signup.info4')}</li>
                  </ul>
                </div>
              </div>
            )}

            {/* ═══ STEP 2: Registration Form ═══ */}
            {step === 'register' && niceResult && (
              <form onSubmit={handleSignup}>
                {/* Verified identity summary */}
                <div className="mb-6 rounded-md border border-[#E0E4ED] bg-[#F9FAFB] p-4">
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <svg className="h-[18px] w-[18px] text-[#059669]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="text-[13px] font-bold text-[#059669]">{t('signup.verified')}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <span className="text-[11px] text-[#8B95B0]">{t('signup.name')}</span>
                      <p className="mt-0.5 text-[13px] font-semibold text-[#0A0E1A]">{niceResult.name}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#8B95B0]">{t('signup.phoneShort')}</span>
                      <p className="mt-0.5 text-[13px] font-semibold text-[#0A0E1A]">{formatPhone(niceResult.phone)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#8B95B0]">{t('signup.birth')}</span>
                      <p className="mt-0.5 text-[13px] font-semibold text-[#0A0E1A]">{formatBirthDate(niceResult.birthDate)}</p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#8B95B0]">{t('signup.gender')}</span>
                      <p className="mt-0.5 text-[13px] font-semibold text-[#0A0E1A]">
                        {niceResult.gender === '1' ? t('signup.male') : t('signup.female')}
                      </p>
                    </div>
                  </div>
                </div>

                {/* User ID */}
                <div className="mb-4">
                  <label htmlFor="userId" className="form-label">
                    {t('signup.userId')} <span className="text-[#DC2626]">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="userId"
                      type="text"
                      value={userId}
                      onChange={(e) => {
                        setUserId(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''));
                        setUserIdChecked(null);
                      }}
                      placeholder={t('signup.userIdPh')}
                      maxLength={20}
                      aria-required="true"
                      aria-describedby="userId-status"
                      className={`${INPUT_CLASS} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleCheckUserId}
                      disabled={!userId || userId.length < 4 || userIdChecking}
                      className={`h-[46px] flex-shrink-0 whitespace-nowrap rounded-md border border-[#E0E4ED] bg-white px-[14px] text-[14px] font-semibold ${
                        !userId || userId.length < 4 ? 'cursor-not-allowed text-[#8B95B0]' : 'cursor-pointer text-[#0A0E1A]'
                      }`}
                    >
                      {userIdChecking ? t('signup.checking') : t('signup.checkDup')}
                    </button>
                  </div>
                  <div id="userId-status" aria-live="polite" className="mt-1">
                    {userIdChecked === true && (
                      <p className="m-0 text-[12px] font-medium text-[#059669]">{t('signup.userIdAvail')}</p>
                    )}
                    {userIdChecked === false && (
                      <p className="m-0 text-[12px] font-medium text-[#DC2626]">{t('signup.userIdTaken')}</p>
                    )}
                  </div>
                </div>

                {/* Password */}
                <div className="mb-4">
                  <label htmlFor="signup-password" className="form-label">
                    {t('signup.password')} <span className="text-[#DC2626]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('signup.passwordPh')}
                      aria-required="true"
                      aria-describedby="password-requirements"
                      className={`${INPUT_CLASS} pr-11`}
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
                  {password.length > 0 && (
                    <div id="password-requirements" className="mt-2 flex flex-col gap-1">
                      {[
                        { ok: password.length >= 8, label: t('signup.pwd.minLen') },
                        { ok: /[a-zA-Z]/.test(password), label: t('signup.pwd.alpha') },
                        { ok: /\d/.test(password), label: t('signup.pwd.digit') },
                        { ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password), label: t('signup.pwd.special') },
                      ].map((rule, i) => (
                        <div key={i} className="flex items-center gap-1.5">
                          <div
                            className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
                            style={{ backgroundColor: rule.ok ? '#059669' : '#E0E4ED' }}
                          >
                            {rule.ok && (
                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="white">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          <span className="text-[12px]" style={{ color: rule.ok ? '#059669' : '#8B95B0' }}>{rule.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Password confirm */}
                <div className="mb-4">
                  <label htmlFor="password-confirm" className="form-label">
                    {t('signup.pwdConfirm')} <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    id="password-confirm"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder={t('signup.pwdConfirmPh')}
                    aria-required="true"
                    className={INPUT_CLASS}
                  />
                  {passwordConfirm.length > 0 && (
                    <p className="mt-1 text-[12px] font-medium" style={{ color: passwordsMatch ? '#059669' : '#DC2626' }}>
                      {passwordsMatch ? t('signup.pwdMatch') : t('signup.pwdMismatch')}
                    </p>
                  )}
                </div>

                {/* Email (optional) */}
                <div className="mb-5">
                  <label htmlFor="email" className="form-label">
                    {t('signup.email')} <span className="text-[11px] font-normal text-[#8B95B0]">{t('signup.emailOptional')}</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Consent checkboxes */}
                <div className="mb-5 overflow-hidden rounded-md border border-[#E0E4ED]">
                  <label className="flex cursor-pointer items-center gap-2.5 border-b border-[#E0E4ED] bg-[#F9FAFB] px-4 py-3.5">
                    <input
                      type="checkbox"
                      checked={agreeAll}
                      onChange={(e) => handleAgreeAll(e.target.checked)}
                      className="h-[18px] w-[18px] accent-[#2B7FFF]"
                    />
                    <span className="text-[14px] font-bold text-[#0A0E1A]">{t('signup.agreeAll')}</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2.5 border-b border-[#E0E4ED] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => {
                        setAgreeTerms(e.target.checked);
                        if (!e.target.checked) setAgreeAll(false);
                        else if (agreePrivacy) setAgreeAll(true);
                      }}
                      aria-required="true"
                      className="h-[18px] w-[18px] accent-[#2B7FFF]"
                    />
                    <span className="text-[13px] text-[#0A0E1A]">
                      <span className="font-semibold text-[#DC2626]">{t('signup.required')}</span>{' '}
                      {t('signup.agreeTerms')}
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2.5 border-b border-[#E0E4ED] px-4 py-3">
                    <input
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={(e) => {
                        setAgreePrivacy(e.target.checked);
                        if (!e.target.checked) setAgreeAll(false);
                        else if (agreeTerms) setAgreeAll(true);
                      }}
                      aria-required="true"
                      className="h-[18px] w-[18px] accent-[#2B7FFF]"
                    />
                    <span className="text-[13px] text-[#0A0E1A]">
                      <span className="font-semibold text-[#DC2626]">{t('signup.required')}</span>{' '}
                      {t('signup.agreePrivacy')}
                    </span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-2.5 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={agreeMarketing}
                      onChange={(e) => {
                        setAgreeMarketing(e.target.checked);
                        if (!e.target.checked) setAgreeAll(false);
                        else if (agreeTerms && agreePrivacy) setAgreeAll(true);
                      }}
                      className="h-[18px] w-[18px] accent-[#2B7FFF]"
                    />
                    <span className="text-[13px] text-[#0A0E1A]">
                      <span className="font-semibold text-[#8B95B0]">{t('signup.optional')}</span>{' '}
                      {t('signup.agreeMarketing')}
                    </span>
                  </label>
                </div>

                {signupError && (
                  <p role="alert" className="mb-6 mt-4 text-[15px] font-medium leading-[1.4] text-[#FF3B30]">
                    ① {signupError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={signupLoading || !agreeTerms || !agreePrivacy}
                  className={`flex h-14 w-full items-center justify-center gap-2 rounded-lg border-none text-[18px] font-semibold text-white ${
                    signupLoading || !agreeTerms || !agreePrivacy
                      ? 'cursor-not-allowed bg-[#8B95B0]'
                      : 'cursor-pointer bg-[#2B7FFF]'
                  }`}
                >
                  {signupLoading ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t('signup.submitting')}
                    </>
                  ) : (
                    t('signup.submit')
                  )}
                </button>
              </form>
            )}
          </section>

          <section className="flex flex-col justify-between rounded-xl border border-[#E0E4ED] bg-white px-10 py-4 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l-[#D0D5DD]">
            <p className="mb-8 text-[27px] leading-[1.35] tracking-[-0.02em] text-gray-800">
              {t('signup.rightPanelPrompt')}
            </p>
            <div className="space-y-5">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="h-14 w-full rounded-lg border-none bg-blue-900 text-[18px] font-semibold text-white"
              >
                {t('signup.cta.login')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="h-14 w-full rounded-lg border border-[#9CA3AF] bg-white text-[18px] font-medium text-[#0A0E1A]"
              >
                {t('signup.cta.forgot')}
              </button>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
