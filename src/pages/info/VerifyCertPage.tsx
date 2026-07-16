import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PdfPreviewModal } from '@/components/PdfPreviewModal';
import { ResultModal, ResultModalEmpty, ResultModalRows } from '@/components/ResultModal';
import { INFO_PDF_MAP, type InfoPdfId } from '@/constants/infoPdfDocuments';
import { isAxiosError } from 'axios';
import { certificatesApi } from '@/services/api';
import { InfoCallout } from '@/components/InfoCallout';
import ctaBg from '@/assets/cta-bg.jpg';

/* ─────────────────────────────────────────────────────────────
   Design tokens — AboutPage / CertGuidePage 등과 동일
   ───────────────────────────────────────────────────────────── */
const INK_900 = '#191919';
const GRAY_500 = '#525252';
const H_SEC = 'text-[22px] sm:text-[26px] lg:text-[34px] font-semibold leading-[1.3] tracking-[-0.025em]';
const H_CARD = 'text-[18px] sm:text-[21px] lg:text-[26px] font-semibold leading-[1.3] tracking-[-0.02em]';
const T_BODY = 'text-[15px] sm:text-[16px] lg:text-[19px] leading-[1.75] sm:leading-[1.85] tracking-[-0.005em]';
const FIELD_INPUT =
  'w-full min-h-[44px] sm:min-h-[48px] rounded-md border bg-white px-3 py-2.5 sm:px-4 text-[16px] sm:text-[15px] lg:text-[18px] text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-blue focus-visible:outline-offset-2';

type VerifyResult =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'valid'; certNo: string; holder: string; track: string; level: string; issuedAt: string; validUntil: string; org: string }
  | { status: 'expired'; certNo: string; holder: string; track: string; level: string; issuedAt: string; expiredAt: string }
  | { status: 'suspended'; certNo: string; holder: string; reason: string }
  | { status: 'revoked'; certNo: string; holder: string; reason: string }
  | { status: 'demo'; certNo: string; holder: string; track: string; level: string; org: string }
  | { status: 'invalid' };

function decodeQueryParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCertNumberInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeHolderInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function readVerifyQueryParams(searchParams: URLSearchParams): { certNo: string; holderName: string } | null {
  const certRaw = searchParams.get('certNo') ?? searchParams.get('certNumber');
  const holderRaw = searchParams.get('holderName') ?? searchParams.get('holder');
  if (!certRaw?.trim() || !holderRaw?.trim()) return null;
  return {
    certNo: normalizeCertNumberInput(certRaw),
    holderName: normalizeHolderInput(decodeQueryParam(holderRaw)),
  };
}

function isCertNumberFormatOk(certNumber: string): boolean {
  return (
    certNumber.length >= 8 &&
    certNumber.length <= 64 &&
    /^[A-Z0-9-]+$/.test(certNumber) &&
    /[A-Z]/.test(certNumber) &&
    /\d/.test(certNumber)
  );
}

function isHolderFormatOk(holder: string): boolean {
  if (holder.length < 2 || holder.length > 100) return false;
  // Block control chars only — printed names may include (), digits, ·, etc.
  return !/[\u0000-\u001F\u007F]/.test(holder);
}

type VerifyRunOutcome = {
  result: VerifyResult;
  modalOpen: boolean;
  toast: string | null;
};

async function runCertificateVerify(certNoRaw: string, holderRaw: string): Promise<VerifyRunOutcome> {
  const certNoTrim = normalizeCertNumberInput(certNoRaw);
  const holderTrim = normalizeHolderInput(holderRaw);

  if (!certNoTrim || !holderTrim) {
    return { result: { status: 'idle' }, modalOpen: false, toast: '자격증 번호와 이름을 모두 입력해주세요.' };
  }

  if (!isCertNumberFormatOk(certNoTrim) || !isHolderFormatOk(holderTrim)) {
    return {
      result: { status: 'invalid' },
      modalOpen: true,
      toast: '자격증 번호와 이름을 자격증에 기재된 그대로 입력해주세요.',
    };
  }

  try {
    const { data } = await certificatesApi.verify(certNoTrim, holderTrim);
    if (!data.ok) {
      return { result: { status: 'invalid' }, modalOpen: true, toast: null };
    }
    if (data.status === 'valid') {
      return {
        result: {
          status: 'valid',
          certNo: data.certNo,
          holder: data.holder,
          track: data.track,
          level: data.level,
          issuedAt: data.issuedAt,
          validUntil: data.validUntil,
          org: data.org,
        },
        modalOpen: true,
        toast: null,
      };
    }
    if (data.status === 'demo') {
      return {
        result: {
          status: 'demo',
          certNo: data.certNo,
          holder: data.holder,
          track: data.track,
          level: data.level,
          org: data.org,
        },
        modalOpen: true,
        toast: null,
      };
    }
    if (data.status === 'suspended') {
      return {
        result: {
          status: 'suspended',
          certNo: data.certNo,
          holder: data.holder,
          reason: data.reason,
        },
        modalOpen: true,
        toast: null,
      };
    }
    if (data.status === 'revoked') {
      return {
        result: {
          status: 'revoked',
          certNo: data.certNo,
          holder: data.holder,
          reason: data.reason,
        },
        modalOpen: true,
        toast: null,
      };
    }
    if (data.status === 'expired') {
      return {
        result: {
          status: 'expired',
          certNo: data.certNo,
          holder: data.holder,
          track: data.track,
          level: data.level,
          issuedAt: data.issuedAt,
          expiredAt: data.expiredAt ?? data.validUntil,
        },
        modalOpen: true,
        toast: null,
      };
    }
    return { result: { status: 'invalid' }, modalOpen: true, toast: null };
  } catch (err: unknown) {
    let toast: string | null = '검증 요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
    if (isAxiosError(err) && err.response?.status === 400) {
      toast = '입력값을 확인해주세요. (이름 2자 이상)';
    } else if (isAxiosError(err) && err.response?.status === 503) {
      toast = '서버가 준비 중입니다. 잠시 후 다시 시도해주세요.';
    }
    return { result: { status: 'invalid' }, modalOpen: true, toast };
  }
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className="fixed z-50 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-md bottom-[max(1.25rem,env(safe-area-inset-bottom))] px-4 py-3 rounded-lg text-[14px] font-medium text-center shadow-lg"
      style={{ background: 'var(--color-ink)', color: '#fff' }}
    >
      {message}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   VerifyResultModalView — VerifyResult status 별로 공용 모달에 매핑
   ───────────────────────────────────────────────────────────── */
type ModalResult = Exclude<VerifyResult, { status: 'idle' } | { status: 'checking' }>;

function VerifyResultModalView({ result, onClose }: { result: ModalResult; onClose: () => void }) {
  if (result.status === 'valid') {
    return (
      <ResultModal title="유효한 자격" headerBg="#059669" onClose={onClose}>
        <ResultModalRows
          description="이 자격증은 AiNex Inc.에서 발급한 공식 자격증이며 현재 유효합니다."
          descriptionColor="#059669"
          rows={[
            { label: '자격증 번호', value: result.certNo, valueClass: 'font-en font-semibold break-all' },
            { label: '소지자', value: result.holder, valueClass: 'font-semibold' },
            { label: '자격 종류', value: `${result.track} · ${result.level}` },
            { label: '취득일', value: result.issuedAt, valueClass: 'font-en' },
            { label: '유효기간', value: `${result.validUntil}까지`, valueClass: 'font-en' },
            { label: '발급기관', value: result.org },
          ]}
        />
      </ResultModal>
    );
  }

  if (result.status === 'demo') {
    return (
      <ResultModal title="체험용 자격증" headerBg="#DC2626" onClose={onClose}>
        <ResultModalRows
          description="체험용 자격증입니다 (실제 자격 아님). 데모 시험 후 발급된 미리보기로, 인증 효력이 없습니다."
          descriptionColor="#DC2626"
          rows={[
            { label: '자격증 번호', value: result.certNo, valueClass: 'font-en font-semibold break-all' },
            { label: '소지자', value: result.holder, valueClass: 'font-semibold' },
            { label: '자격 종류', value: `${result.track} · ${result.level}` },
            { label: '상태', value: '체험용 · 효력 없음' },
            { label: '발급기관', value: result.org },
          ]}
        />
      </ResultModal>
    );
  }

  if (result.status === 'invalid') {
    return (
      <ResultModal title="조회 결과" onClose={onClose}>
        <ResultModalEmpty
          message="검색된 결과가 없습니다."
          helperText={
            <>
              문의사항은{' '}
              <Link to="/qna" className="font-semibold" style={{ color: 'var(--color-blue)' }}>1:1 문의</Link>를 이용해주세요.
            </>
          }
        />
      </ResultModal>
    );
  }

  if (result.status === 'expired') {
    return (
      <ResultModal title="만료된 자격" onClose={onClose}>
        <ResultModalRows
          description="이 자격증은 유효기간이 만료되었습니다. 갱신을 통해 자격을 유지할 수 있습니다."
          descriptionColor="#D97706"
          rows={[
            { label: '자격증 번호', value: result.certNo, valueClass: 'font-en font-semibold break-all' },
            { label: '소지자', value: result.holder, valueClass: 'font-semibold' },
            { label: '자격 종류', value: `${result.track} · ${result.level}` },
            { label: '취득일', value: result.issuedAt, valueClass: 'font-en' },
            { label: '만료일', value: result.expiredAt, valueClass: 'font-en font-semibold' },
          ]}
        />
      </ResultModal>
    );
  }

  if (result.status === 'suspended') {
    return (
      <ResultModal title="정지된 자격" onClose={onClose}>
        <ResultModalRows
          description="이 자격증은 현재 정지 상태입니다. 공식 자격으로 인정되지 않습니다."
          descriptionColor="#D97706"
          rows={[
            { label: '자격증 번호', value: result.certNo, valueClass: 'font-en font-semibold break-all' },
            { label: '소지자', value: result.holder, valueClass: 'font-semibold' },
            { label: '사유', value: result.reason },
          ]}
        />
      </ResultModal>
    );
  }

  // revoked
  return (
    <ResultModal title="취소된 자격" onClose={onClose}>
      <ResultModalRows
        description="이 자격증은 취소(Revoked) 처리되었습니다. 공식 자격으로 인정되지 않습니다."
        descriptionColor="#DC2626"
        rows={[
          { label: '자격증 번호', value: result.certNo, valueClass: 'font-en font-semibold break-all' },
          { label: '소지자', value: result.holder, valueClass: 'font-semibold' },
          { label: '사유', value: result.reason },
        ]}
      />
    </ResultModal>
  );
}

export default function VerifyCertPage() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();

  const [certNo, setCertNo] = useState('');
  const [holderName, setHolderName] = useState('');
  const [result, setResult] = useState<VerifyResult>({ status: 'idle' });
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [previewPdfId, setPreviewPdfId] = useState<InfoPdfId | null>(null);
  const autoVerifyKeyRef = useRef<string | null>(null);
  const previewPdf = previewPdfId ? INFO_PDF_MAP[previewPdfId] : null;

  const applyVerifyOutcome = useCallback((outcome: VerifyRunOutcome) => {
    setResult(outcome.result);
    setModalOpen(outcome.modalOpen);
    setToast(outcome.toast);
  }, []);

  const performVerify = useCallback(
    async (certNoTrim: string, holderTrim: string) => {
      setResult({ status: 'checking' });
      setModalOpen(false);
      applyVerifyOutcome(await runCertificateVerify(certNoTrim, holderTrim));
    },
    [applyVerifyOutcome],
  );

  useEffect(() => {
    const q = searchParams.get('certNo') ?? searchParams.get('certNumber');
    if (q) setCertNo((prev) => (prev.trim() === '' ? q.trim() : prev));
    const h = searchParams.get('holderName') ?? searchParams.get('holder');
    if (h) {
      const decoded = decodeQueryParam(h.trim());
      setHolderName((prev) => (prev.trim() === '' ? decoded : prev));
    }

    const fromQr = readVerifyQueryParams(searchParams);
    if (!fromQr) return;

    const key = `${fromQr.certNo}\0${fromQr.holderName}`;
    if (autoVerifyKeyRef.current === key) return;
    autoVerifyKeyRef.current = key;

    setCertNo(fromQr.certNo);
    setHolderName(fromQr.holderName);
    void performVerify(fromQr.certNo, fromQr.holderName);
  }, [searchParams, performVerify]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    const container = mainRef.current;
    if (container) {
      container.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
    }
    return () => obs.disconnect();
  }, [result.status]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    autoVerifyKeyRef.current = null;
    await performVerify(certNo.trim(), holderName.trim());
  };

  return (
    <div
      className="min-h-screen flex flex-col overflow-x-hidden"
      style={{ color: 'var(--color-body)' }}
    >
      <SiteHeader active="verify" />

      <PageHeroSolid
        title="자격 검증"
        subtitle="AXIS 자격증의 진위 여부와 유효 상태를 확인할 수 있습니다."
      />

      <main
        ref={mainRef}
        className="mx-auto flex-1 w-full min-w-0 py-6 sm:py-12 lg:py-16 px-5 sm:px-6 lg:px-8 max-lg:break-keep"
        style={{ maxWidth: 'var(--spacing-content-w)' }}
      >

        <h2 className={`${H_CARD} text-black mb-6`} >자격증 조회</h2>
        <section className="mb-10 sm:mb-16 lg:mb-24 reveal py-5 px-4 sm:py-8 sm:px-6 lg:py-10 lg:px-12 rounded-md border border-[#e5e7eb]" style={{ background: '#f3f4f5' }}>

            <form onSubmit={handleVerify} className="min-w-0">
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-5">
                <label className="block flex-1 min-w-0">
                  <span className="mb-2 block text-[14px] sm:text-[15px] lg:text-[16px] font-semibold tracking-[-0.005em] text-black">
                    접수번호
                  </span>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    value={certNo}
                    onChange={e => setCertNo(e.target.value)}
                    placeholder="예: AXIS-2026-L3-0142"
                    className={`${FIELD_INPUT} font-en`}
                    style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                  />
                </label>

                <label className="block flex-1 min-w-0">
                  <span className="mb-2 block text-[14px] sm:text-[15px] lg:text-[16px] font-semibold tracking-[-0.005em] text-black">
                    이름
                  </span>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="name"
                    value={holderName}
                    onChange={e => setHolderName(e.target.value)}
                    placeholder="홍길동"
                    className={FIELD_INPUT}
                    style={{ borderColor: '#e5e7eb', background: '#ffffff' }}
                  />
                </label>
              </div>

              <div className="flex items-center justify-center px-1 sm:px-10 pt-5 sm:pt-8">
                <button
                  type="submit"
                  className="btn-primary !bg-blue-500 w-full sm:max-w-[200px] min-h-[48px] !text-[16px] sm:!text-[18px] touch-manipulation"
                  disabled={result.status === 'checking'}
                >
                  {result.status === 'checking' ? '조회 중...' : '조회하기'}
                </button>
              </div>
            </form>

        </section>

        <section className="mb-8 sm:mb-10 reveal">
          <h2 className={`${H_CARD} mb-3 sm:mb-4`} style={{ color: INK_900 }}>자격검증이란</h2>
          <div className={`${T_BODY} space-y-3`} style={{ color: GRAY_500 }}>
            <p>
              기업 인사담당자, 교육기관, 또는 제3자가 AXIS 자격증 소지자의 자격 상태를 확인할 수 있는 서비스입니다.
            </p>
            <p>
              자격증 번호와 소지자 이름을 입력하면 해당 자격의 유효 여부, 취득일, 만료일 등을 즉시 확인할 수 있고
              자격 상태는 <strong className="text-ink font-semibold">유효, 만료, 정지, 취소</strong> 네 가지로 표시됩니다.
            </p>
          </div>
        </section>

        <section className="mb-10 sm:mb-14 reveal">
          <InfoCallout
            tone="blue"
            title="개인정보 보호 안내"
            className="gap-2.5 sm:gap-3"
            iconClassName="mt-0.5"
            iconSizeClassName="w-[18px] h-[18px] sm:w-5 sm:h-5"
          >
            <p>검증 결과에는 자격 상태와 최소한의 정보만 표시되고 소지자의 생년월일·연락처·성적 등 민감 정보는 제공되지 않습니다.</p>
            <p className="mt-2">조회 기록은 부정 이용 방지를 위해 90일간 보관되며, 이후 자동으로 삭제됩니다.</p>
          </InfoCallout>
        </section>

        <div className="w-10 h-px bg-border my-8 sm:my-10" />

        <section className="mb-10 sm:mb-16 reveal space-y-5 sm:space-y-6">
          <div>
            <h2 className={`${H_CARD} mb-3 sm:mb-4`} style={{ color: INK_900 }}>기업·기관 검증</h2>
            <div className={`${T_BODY} space-y-3`} style={{ color: GRAY_500 }}>
              <p>
                대량 검증이 필요한 기업·기관은 <strong className="text-ink font-semibold">API 또는 일괄 검증 서비스</strong>를 이용할 수 있습니다.
              </p>
              <p>채용 절차나 사내 역량 관리에 AXIS 자격 검증을 연동하고 싶으시면 문의해주세요.</p>
            </div>
          </div>

          <InfoCallout
            tone="blue"
            title="QR 코드 검증"
            className="gap-2.5 sm:gap-3"
            iconClassName="mt-0.5"
            iconSizeClassName="w-[18px] h-[18px] sm:w-5 sm:h-5"
          >
            <p>
              AXIS 자격증(PDF/실물)의 QR 코드를 스캔하면 이 페이지로 이동한 뒤 자격증 번호와 성명이 자동 입력되고, 조회가 바로 실행됩니다.
            </p>
            <p className="mt-2">별도의 앱 설치 없이 모바일 브라우저에서 바로 검증할 수 있습니다.</p>
          </InfoCallout>

          <InfoCallout
            tone="red"
            title="위·변조 주의"
            className="gap-2.5 sm:gap-3"
            iconClassName="mt-0.5"
            iconSizeClassName="w-[18px] h-[18px] sm:w-5 sm:h-5"
          >
            <p>
              AXIS 자격증의 위조·변조는 관련 법령에 따라 처벌될 수 있습니다. 자격 소지 여부가 의심되는 경우 반드시 이 페이지를 통해 공식 검증을 진행해주세요.
            </p>
            <p className="mt-2">검증 결과와 실물 자격증의 정보가 일치하지 않는 경우 신고해주세요.</p>
          </InfoCallout>
        </section>

        <section className="reveal mt-10 sm:mt-14">
          <div
            className="relative overflow-hidden rounded-2xl px-5 py-8 sm:rounded-[20px] sm:px-7 sm:py-9 lg:px-12 lg:py-12"
            style={{
              backgroundImage: `url(${ctaBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute inset-0 bg-blue-800/50" aria-hidden="true" />
            <div className="relative mx-auto max-w-2xl text-center">
              <p className="text-[19px] sm:text-[26px] lg:text-[34px] font-semibold leading-[1.4] sm:leading-[1.3] tracking-[-0.02em] text-white break-keep">
                <span className="block sm:inline">기업·기관 단위로 자격 검증이 필요하신가요?</span>
              </p>
              <p className="mt-2.5 sm:mt-4 text-[14px] sm:text-[16px] lg:text-[19px] leading-[1.6] sm:leading-[1.85] tracking-[-0.005em] text-blue-100 break-keep">
                API·일괄 검증 연동부터 채용 시스템 통합까지, 규모에 맞게 상담해드립니다.
              </p>
              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setPreviewPdfId('axis-intro-b2b')}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-white px-6 sm:px-7 text-[15px] sm:text-[16px] font-semibold text-blue-700 transition-colors hover:bg-blue-50 touch-manipulation"
                >
                  AXIS 도입제안
                </button>
               
              </div>
            </div>
          </div>
        </section>

      </main>

      <SiteFooter />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {modalOpen && result.status !== 'idle' && result.status !== 'checking' && (
        <VerifyResultModalView result={result} onClose={() => setModalOpen(false)} />
      )}

      {previewPdf ? (
        <PdfPreviewModal
          title={previewPdf.title}
          url={previewPdf.url}
          downloadName={previewPdf.downloadName}
          onClose={() => setPreviewPdfId(null)}
        />
      ) : null}
    </div>
  );
}
