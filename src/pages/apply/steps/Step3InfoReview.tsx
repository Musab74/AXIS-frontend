import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Info, Lock } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useWizard } from '@/pages/apply/lib/WizardContext';
import { userApi, registrationsApi } from '@/services/api';
import { createOrResumeRegistration, formatRegisterError } from '@/pages/apply/lib/applyRegisterSession';
import { isApplyKcpDemo } from '@/pages/apply/lib/applyKcpDemo';
import {
  H_CARD,
  T_BODY,
  T_INPUT,
  T_META,
  INK_900,
  GRAY_500,
  ACCENT,
  SUCCESS,
} from '@/pages/apply/lib/applyTokens';
import { ApplySectionHeader } from '@/pages/apply/components/ApplySectionHeader';

/* ─── Shared primitives ────────────────────────────────────────── */

function CardSection({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white mb-4 ${className}`}>
      <header className="py-4">
        <h3 className={H_CARD} style={{ color: INK_900 }}>
          {title}
        </h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row border-b first:border-t"
      style={{ borderColor: '#E5E5E5' }}
    >
      <div
        className="w-full sm:w-27.5 lg:w-32.5 shrink-0 flex items-center px-4 py-3 sm:py-4 bg-[#F8FAFC]"
      >
        <span className={`${T_BODY} font-semibold`} style={{ color: INK_900 }}>
          {label}
        </span>
        {required && <span className="text-status-danger ml-1">*</span>}
      </div>
      <div className="flex-1 min-w-0 px-4 py-3 sm:py-4">
        {children}
        {help && (
          <p className={`mt-2 ${T_META}`} style={{ color: GRAY_500 }}>
            {help}
          </p>
        )}
      </div>
    </div>
  );
}

const INPUT_CLASS = `w-full max-w-[420px] h-11 px-3.5 rounded-md text-[16px] sm:text-[14px] lg:text-[15px] bg-white border border-[#E0E4ED] transition-colors focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#2563EB]/30`;

const LOCKED_INPUT_CLASS = `w-full h-11 pl-3.5 pr-10 rounded-md text-[16px] sm:text-[14px] lg:text-[15px] bg-[#F8FAFC] border border-[#E0E4ED] cursor-not-allowed focus:outline-none`;

/**
 * Identity fields (name / birth / phone) come from the verified profile and
 * must not be edited during registration — only an admin can change them.
 * The input is read-only with a lock icon; any edit attempt flashes a hint
 * explaining how to request a change.
 */
function LockedInput({ value, hint }: { value: string; hint: string }) {
  const [hintVisible, setHintVisible] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const flashHint = () => {
    setHintVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setHintVisible(false), 5000);
  };

  useEffect(
    () => () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <div className="w-full max-w-[420px]">
      <div className="relative" onClick={flashHint}>
        <input
          type="text"
          value={value}
          readOnly
          aria-readonly="true"
          onKeyDown={(e) => {
            if (e.key !== 'Tab' && e.key !== 'Shift') {
              e.preventDefault();
              flashHint();
            }
          }}
          className={LOCKED_INPUT_CLASS}
          style={{ color: INK_900 }}
        />
        <Lock
          aria-hidden="true"
          className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
          style={{ color: '#94A3B8' }}
          strokeWidth={2.2}
        />
      </div>
      {hintVisible && (
        <p
          role="status"
          className={`mt-2 flex items-start gap-1.5 px-3 py-2 rounded-md ${T_META} break-keep`}
          style={{ background: '#FFFBEB', color: '#B45309' }}
        >
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" strokeWidth={2.2} />
          <span>{hint}</span>
        </p>
      )}
    </div>
  );
}

function ConsentItem({
  text,
  checked,
  onToggle,
}: {
  text: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-start gap-3 text-left p-5 rounded-xl transition-all cursor-pointer min-h-13 ${
        checked ? 'bg-[#ffffff] border border-blue-500' : 'border border-[#E0E4ED] hover:bg-[#EFF6FF]/60'
      }`}
    >
      <div
        className={`shrink-0 w-5 h-5 mt-0.5 rounded-[5px] flex items-center justify-center transition-all ${
          checked ? 'bg-[#2563EB]' : 'border border-[#E0E4ED] bg-white'
        }`}
      >
        {checked && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <span className={`${T_BODY} break-keep`} style={{ color: INK_900 }}>
        {text}
      </span>
    </button>
  );
}

function NavButtons({
  onPrev,
  onNext,
  nextDisabled,
}: {
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="sticky bottom-0 sm:static bg-white pt-2 pb-4 sm:pb-0">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev}
          className="flex-1 h-12 rounded-xl text-[13px] lg:text-[14px] font-medium bg-[#F4F6F8] hover:bg-[#E9EDF1] transition-colors cursor-pointer"
          style={{ color: GRAY_500 }}
        >
          {t('apply.nav.prev')}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={nextDisabled}
          className="flex-1 h-12 rounded-xl text-[14px] lg:text-[15px] font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer shadow-sm"
          style={{ background: ACCENT }}
        >
          {t('apply.nav.next')}
        </button>
      </div>
    </div>
  );
}

/* ─── KCP Demo Stub ────────────────────────────────────────────── */

function Step3KcpStub() {
  const { t } = useI18n();
  const { consents, setConsent, nextStep, prevStep } = useWizard();

  const CONSENTS = [t('apply.s3.consent0'), t('apply.s3.consent1'), t('apply.s3.consent2')];
  const allConsents = consents.every(Boolean);

  const STUB = [
    { label: t('apply.s3.name'), value: '홍길동' },
    { label: t('apply.s3.birth'), value: '1990-01-01' },
    { label: t('apply.s3.phone'), value: '010-1234-5678' },
    { label: t('apply.s3.email'), value: 'hong@example.com' },
  ];

  return (
    <div>
      <ApplySectionHeader title={t('apply.kcp.step3.title')} sub={t('apply.kcp.step3.sub')} />

      <CardSection title={t('apply.kcp.step3.infoTitle')}>
        {STUB.map((f) => (
          <FieldRow key={f.label} label={f.label} required>
            <div
              className={`max-w-[420px] h-10 px-3.5 flex items-center rounded-md bg-white border border-[#F4F6F8] ${T_INPUT}`}
              style={{ color: INK_900 }}
            >
              {f.value}
            </div>
          </FieldRow>
        ))}
      </CardSection>

      <CardSection title={t('apply.kcp.step3.consentTitle')} className="mb-6">
        <div className="py-3 space-y-2.5">
          {CONSENTS.map((text, i) => (
            <ConsentItem
              key={i}
              text={text}
              checked={consents[i as 0 | 1 | 2]}
              onToggle={() => setConsent(i as 0 | 1 | 2, !consents[i as 0 | 1 | 2])}
            />
          ))}
        </div>
      </CardSection>

      <NavButtons onPrev={prevStep} onNext={nextStep} nextDisabled={!allConsents} />
    </div>
  );
}

/* ─── Main ─────────────────────────────────────────────────────── */

interface Profile {
  name?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
}

const ELIG_OPTIONS = [
  { id: 'L2_CERT', key: 'apply.step3.elig.L2_CERT' },
  { id: 'MGMT_2Y', key: 'apply.step3.elig.MGMT_2Y' },
  { id: 'AX_LEADER_COURSE', key: 'apply.step3.elig.AX_LEADER_COURSE' },
] as const;

export default function Step3InfoReview() {
  if (isApplyKcpDemo()) {
    return <Step3KcpStub />;
  }
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    selectedCert,
    selectedLevel,
    selectedSchedule,
    regId,
    docUrl,
    consents,
    setDocUrl,
    setConsent,
    setRegistration,
    nextStep,
    prevStep,
  } = useWizard();

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  // The email the server currently holds. This step used to keep the typed email
  // in local state only and never persist it, so Step 4 re-fetched the profile,
  // got null back, and handed PortOne no address — the candidate was forced to
  // type an email that was then thrown away, and no receipt could ever be sent.
  // We diff against this to avoid a pointless PATCH when nothing changed.
  const [savedEmail, setSavedEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState('');
  // Identity fields are locked only when the profile already provides them —
  // an empty field stays editable so an incomplete profile can't block the wizard.
  const [locked, setLocked] = useState({ name: false, birth: false, phone: false });
  const [docFile, setDocFile] = useState<File | null>(null);
  const [eligibilityType, setEligibilityType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [regLoading, setRegLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [docPreview, setDocPreview] = useState(docUrl ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedSchedule || regId) return;
    let cancelled = false;
    setRegLoading(true);
    setUploadError('');
    void (async () => {
      try {
        const ensured = await createOrResumeRegistration(selectedSchedule);
        if (cancelled) return;
        setRegistration(ensured.id, ensured.seatHeldUntil);
      } catch (err: unknown) {
        if (cancelled) return;
        if (isAxiosError(err) && err.response?.status === 401) {
          navigate('/login', { replace: true, state: { from: '/apply' } });
          return;
        }
        setUploadError(formatRegisterError(err, t('apply.step3.noReg' as never)));
      } finally {
        if (!cancelled) setRegLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSchedule, regId, setRegistration, navigate, t]);

  useEffect(() => {
    userApi
      .getProfile()
      .then((r) => {
        const p = r.data as Profile;
        setName(p.name ?? '');
        setBirthDate(p.birthDate ?? '');
        setPhone(p.phone ?? '');
        setEmail(p.email ?? '');
        setSavedEmail(p.email ?? '');
        setLocked({ name: !!p.name, birth: !!p.birthDate, phone: !!p.phone });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!regId || !eligibilityType || !docUrl) return;
    if (selectedCert !== 'AXIS_C' || selectedLevel !== 'L1') return;
    registrationsApi.setEligibilityBasis(regId, eligibilityType).catch(() => {});
  }, [regId, eligibilityType, docUrl, selectedCert, selectedLevel]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocFile(file);
    setUploadError('');
    if (regLoading) {
      setUploadError(t('apply.s3.docRegPreparing' as never));
      return;
    }
    if (!regId) {
      setUploadError(t('apply.step3.noReg' as never));
      return;
    }
    setUploading(true);
    try {
      const res = await registrationsApi.uploadDocument(regId, file, eligibilityType || undefined);
      const { docUrl: url } = res.data as { docUrl: string };
      setDocUrl(url);
      setDocPreview(file.name);
    } catch {
      setUploadError(t('apply.step3.uploadFailed' as never));
      setDocFile(null);
    } finally {
      setUploading(false);
    }
  };

  const CONSENTS = [t('apply.s3.consent0'), t('apply.s3.consent1'), t('apply.s3.consent2')];

  const allConsents = consents.every(Boolean);
  const docOk = selectedLevel !== 'L1' || selectedCert !== 'AXIS_C' || (!!docUrl && !!eligibilityType);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canProceed = Boolean(
    name && birthDate && phone && emailValid && allConsents && docOk && !emailSaving,
  );

  /**
   * Persist the email BEFORE advancing to payment. Step 4 re-reads the profile from
   * the server and PortOne is called with whatever is stored there, so an email that
   * only ever lived in this component's state never reaches the payment gateway —
   * and the backend now hard-rejects a payment request for an account with no email
   * (EMAIL_REQUIRED). Advancing on a failed save would strand the candidate on a
   * payment screen that cannot succeed, so a failure here blocks the step.
   */
  const handleNext = async () => {
    const next = email.trim().toLowerCase();
    if (next === savedEmail.trim().toLowerCase()) {
      nextStep();
      return;
    }
    setEmailSaving(true);
    setEmailError('');
    try {
      await userApi.updateProfile({ email: next });
      setSavedEmail(next);
      nextStep();
    } catch (err: unknown) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const msg = isAxiosError(err)
        ? (err.response?.data as { message?: string | string[] } | undefined)?.message
        : undefined;
      setEmailError(
        status === 409
          ? t('apply.s3.emailTaken' as never)
          : (Array.isArray(msg) ? msg.join(', ') : msg) || t('apply.s3.emailSaveFailed' as never),
      );
    } finally {
      setEmailSaving(false);
    }
  };

  return (
    <div>
      <ApplySectionHeader title={t('apply.s3.title')} sub={t('apply.s3.sub')} />

      {/* 수험자 정보 */}
      <CardSection title={t('apply.s3.infoTitle')}>
        <FieldRow label={t('apply.s3.name')} required>
          {locked.name ? (
            <LockedInput value={name} hint={t('apply.s3.lockedHint' as never)} />
          ) : (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('apply.s3.namePlaceholder')}
              className={INPUT_CLASS}
            />
          )}
        </FieldRow>
        <FieldRow label={t('apply.s3.birth')} required>
          {locked.birth ? (
            <LockedInput value={birthDate} hint={t('apply.s3.lockedHint' as never)} />
          ) : (
            <input
              type="text"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              placeholder={t('apply.s3.birthPlaceholder')}
              className={INPUT_CLASS}
            />
          )}
        </FieldRow>
        <FieldRow label={t('apply.s3.phone')} required>
          {locked.phone ? (
            <LockedInput value={phone} hint={t('apply.s3.lockedHint' as never)} />
          ) : (
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('apply.s3.phonePlaceholder')}
              className={INPUT_CLASS}
            />
          )}
        </FieldRow>
        <FieldRow
          label={t('apply.s3.email')}
          required
        >
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError('');
            }}
            placeholder={t('apply.s3.emailPlaceholder')}
            className={INPUT_CLASS}
          />
          {/* The receipt, the exam-deadline warning and the PortOne payment
              confirmation all go to this address — say so, because it is the only
              channel the candidate has once they leave this screen. */}
          <p className={`mt-1.5 ${T_META} text-text-muted break-keep`}>
            {t('apply.s3.emailHint' as never)}
          </p>
          {emailError && (
            <div
              role="alert"
              className={`mt-1.5 flex items-center gap-1.5 ${T_META} text-status-danger`}
            >
              <Info className="w-4 h-4 shrink-0" strokeWidth={2.2} />
              <span>{emailError}</span>
            </div>
          )}
        </FieldRow>
      </CardSection>

      {/* 응시 자격 서류 — AXIS-C L1 only */}
      {selectedLevel === 'L1' && selectedCert === 'AXIS_C' && (
        <CardSection title={t('apply.s3.docTitle')}>
          <FieldRow label={t('apply.step3.eligLabel' as never)} required>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-[640px]">
              {ELIG_OPTIONS.map((opt) => {
                const selected = eligibilityType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      const next = selected ? '' : opt.id;
                      setEligibilityType(next);
                    }}
                    className={`relative px-3 py-3 sm:py-2.5 rounded-md text-left transition-all cursor-pointer ${
                      selected ? 'bg-white border border-blue-500' : 'bg-white border border-[#E5E5E5] hover:bg-[#EFF6FF]/60'
                    }`}
                  >
                    <div className={`${T_BODY} font-medium pr-5`} style={{ color: INK_900 }}>
                      {t(opt.key as never)}
                    </div>
                    {selected && (
                      <div
                        className="absolute top-2.5 right-2.5 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: ACCENT }}
                      >
                        <svg
                          width="9"
                          height="9"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </FieldRow>

          <FieldRow label={t('apply.s3.docUploadLabel')} required help={t('apply.s3.docSub')}>
            {uploadError && (
              <div
                role="alert"
                className={`mb-3 px-3 py-2 bg-[#FEE2E2] rounded-md ${T_META} text-status-danger`}
              >
                {uploadError}
              </div>
            )}

            {docUrl || docPreview ? (
              <div
                className="flex items-center gap-3 p-3 rounded-md max-w-130"
                style={{ background: '#ECFDF5' }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={SUCCESS}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span
                  className={`${T_BODY} font-medium flex-1 truncate`}
                  style={{ color: SUCCESS }}
                >
                  {docFile?.name ?? t('apply.step3.docDone' as never)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDocUrl('');
                    setDocPreview('');
                    setDocFile(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                  className={`${T_META} hover:text-status-danger transition-colors cursor-pointer`}
                  style={{ color: GRAY_500 }}
                >
                  {t('apply.s3.docRemove')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || regLoading || !regId}
                className="w-full max-w-130 rounded-md py-6 text-center transition-colors cursor-pointer disabled:opacity-60 bg-[#F4F6F8] hover:bg-[#EFF6FF]"
              >
                {uploading || regLoading ? (
                  <div
                    className={`flex items-center justify-center gap-2 ${T_BODY}`}
                    style={{ color: GRAY_500 }}
                  >
                    <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                    {regLoading ? t('apply.s3.docRegPreparing' as never) : t('apply.s3.docUploading')}
                  </div>
                ) : (
                  <>
                    <div className={`${T_BODY} font-semibold`} style={{ color: ACCENT }}>
                      {t('apply.s3.docUploadLabel')}
                    </div>
                    <div className={`${T_META} mt-1`} style={{ color: GRAY_500 }}>
                      {t('apply.s3.docHint')}
                    </div>
                  </>
                )}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
            />
          </FieldRow>
        </CardSection>
      )}

      {/* 동의 사항 */}
      <CardSection title={t('apply.s3.consentTitle')} className="mb-6">
        <div className="py-3 space-y-3">
          {CONSENTS.map((text, i) => (
            <ConsentItem
              key={i}
              text={text}
              checked={consents[i as 0 | 1 | 2]}
              onToggle={() => setConsent(i as 0 | 1 | 2, !consents[i as 0 | 1 | 2])}
            />
          ))}
          {!allConsents && (
            <div
              role="alert"
              className={`mt-3 flex items-center gap-1.5 ${T_META} text-status-danger`}
            >
              <Info className="w-4 h-4 shrink-0" strokeWidth={2.2} />
              <span>{t('apply.s3.consentHint')}</span>
            </div>
          )}
        </div>
      </CardSection>

      <NavButtons onPrev={prevStep} onNext={() => void handleNext()} nextDisabled={!canProceed} />
    </div>
  );
}
