import { useState } from 'react';
import { useI18n } from '@/i18n';
import { FormalCertificatePrint } from '@/components/FormalCertificatePrint';
import { ResultModal, ResultModalButton, ResultModalRows } from '@/components/ResultModal';
import { CertBadge } from '@/components/CertBadge';
import { CertificateVerifyQr, buildCertificateVerifyQrUrl } from '@/components/CertificateVerifyQr';
import { MyPageModal, PrintField } from './Modal';
import { Btn } from './primitives';
import { certLabel, formatExamDate, formatExamRoundLabel, formatKrw, registrationExamEntryState } from './helpers';
import type { CertificateDto, RegistrationDto, ResultDto } from './types';

export function VoucherModal({
  open,
  reg,
  holderName,
  onClose,
}: {
  open: boolean;
  reg: RegistrationDto | null;
  holderName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <MyPageModal
      open={open && !!reg}
      title={t('mypage.voucher.title' as never)}
      onClose={onClose}
      printable
      width="md"
    >
      {reg && (
        <div>
          <div
            className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-[14px] border border-transparent px-4 py-4 sm:px-5 text-white bg-[#0A0E1A] print:border-border print:bg-white print:text-ink"
          >
            <div className="min-w-0">
              <div className="text-[11px] tracking-[0.16em] text-blue font-en">AXIS</div>
              <div className="text-[18px] font-semibold break-keep print:text-ink">{certLabel(reg.certType, reg.level)}</div>
            </div>
            <div className="sm:text-right text-[11px] text-white/60 print:text-muted">
              {t('mypage.voucher.session' as never)}{' '}
              <span className="font-semibold text-white print:text-ink">
                {reg.schedule.year}.{reg.schedule.roundNumber}
              </span>
            </div>
          </div>
          <PrintField label={t('mypage.voucher.name' as never)} value={holderName} />
          <PrintField label={t('mypage.voucher.cert' as never)} value={certLabel(reg.certType, reg.level)} />
          <PrintField
            label={t('mypage.voucher.examDate' as never)}
            value={formatExamDate(reg.schedule.examDate, reg.schedule.examStartTime)}
          />
          <PrintField label={t('mypage.voucher.venue' as never)} value={reg.schedule.venue} />
          <PrintField label={t('mypage.voucher.regNo' as never)} value={reg.registrationNumber ?? '—'} />
          <div className="mt-5 rounded-lg border border-border bg-[#F3F5F9] px-4 py-3 text-[12px] text-body">
            <div className="mb-1 font-semibold text-ink tracking-[-0.01em]">{t('mypage.voucher.notes' as never)}</div>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('mypage.voucher.note1' as never)}</li>
              <li>{t('mypage.voucher.note2' as never)}</li>
              <li>{t('mypage.voucher.note3' as never)}</li>
            </ul>
          </div>
        </div>
      )}
    </MyPageModal>
  );
}

export function ReceiptModal({
  open,
  reg,
  holderName,
  onClose,
}: {
  open: boolean;
  reg: RegistrationDto | null;
  holderName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <MyPageModal
      open={open && !!reg}
      title={t('mypage.receipt.title' as never)}
      onClose={onClose}
      printable
    >
      {reg && (
        <div>
          <PrintField label={t('mypage.voucher.name' as never)} value={holderName} />
          <PrintField label={t('mypage.voucher.cert' as never)} value={certLabel(reg.certType, reg.level)} />
          <PrintField
            label={t('mypage.receipt.orderNo' as never)}
            value={<span className="font-mono">{reg.latestPayment?.orderId ?? reg.registrationNumber ?? '—'}</span>}
          />
          <PrintField
            label={t('mypage.receipt.amount' as never)}
            value={formatKrw(reg.latestPayment?.amount ?? reg.fee ?? 0)}
          />
          <PrintField
            label={t('mypage.receipt.method' as never)}
            value={
              reg.latestPayment?.isDemo
                ? `${reg.latestPayment?.method ?? '—'} (${t('mypage.receipt.demo' as never)})`
                : (reg.latestPayment?.method ?? '—')
            }
          />
          <PrintField
            label={t('mypage.receipt.paidAt' as never)}
            value={reg.latestPayment?.approvedAt ? formatExamDate(reg.latestPayment.approvedAt) : '—'}
          />
          {reg.status === 'REFUNDED' && reg.latestPayment?.refundAmount && (
            <PrintField
              label="Refunded"
              value={<span className="text-status-danger">{formatKrw(reg.latestPayment.refundAmount)}</span>}
            />
          )}
        </div>
      )}
    </MyPageModal>
  );
}

export function RefundPolicyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <ResultModal title={t('mypage.refund.title' as never)} onClose={onClose}>
      <ul className="space-y-3 text-[14px] leading-relaxed text-body">
        {(['row1', 'row2', 'row3', 'row4'] as const).map((k) => (
          <li key={k} className="flex gap-2.5">
            <span className="mt-[8px] inline-block h-1.5 w-1.5 rounded-full bg-blue flex-shrink-0" />
            <span>{t(`mypage.refund.${k}` as never)}</span>
          </li>
        ))}
      </ul>
    </ResultModal>
  );
}

export function ExamGateModal({
  open,
  reg,
  onClose,
  onEnvCheck,
}: {
  open: boolean;
  reg: RegistrationDto | null;
  onClose: () => void;
  onEnvCheck: () => void;
}) {
  const { t } = useI18n();
  if (!open || !reg) return null;
  const gate = registrationExamEntryState(reg);
  const examStr = formatExamDate(reg.schedule.examDate, reg.schedule.examStartTime);

  let body: string;
  if (gate.gate === 'too_early' && gate.entryOpensAt && gate.entryClosesAt) {
    const fromStr = formatExamDate(
      gate.entryOpensAt.toISOString(),
      `${String(gate.entryOpensAt.getHours()).padStart(2, '0')}:${String(
        gate.entryOpensAt.getMinutes(),
      ).padStart(2, '0')}`,
    );
    const untilStr = formatExamDate(
      gate.entryClosesAt.toISOString(),
      `${String(gate.entryClosesAt.getHours()).padStart(2, '0')}:${String(
        gate.entryClosesAt.getMinutes(),
      ).padStart(2, '0')}`,
    );
    body = t('mypage.examGate.tooEarly', { exam: examStr, from: fromStr, until: untilStr });
  } else if (gate.gate === 'too_late') {
    body = t('mypage.examGate.tooLate', { exam: examStr });
  } else {
    body = t('mypage.examGate.blocked', { reason: gate.hint });
  }

  return (
    <MyPageModal
      open
      title={t('mypage.examGate.title')}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-2 w-full sm:flex-row sm:flex-wrap sm:justify-end">
          <Btn
            variant="green"
            type="button"
            className="w-full min-h-[44px] sm:w-auto sm:min-h-0"
            onClick={() => { onEnvCheck(); onClose(); }}
          >
            {t('mypage.examGate.envCta')}
          </Btn>
        </div>
      }
    >
      <p className="text-[14px] leading-relaxed text-body whitespace-pre-line">{body}</p>
    </MyPageModal>
  );
}

export function CertificateModal({
  open,
  cert,
  result,
  holderName,
  birthDate,
  onClose,
}: {
  open: boolean;
  cert: CertificateDto | null;
  result: ResultDto | null;
  holderName: string;
  birthDate: string | null;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const certNo =
    cert?.certNumber ??
    (result ? `AXIS-${new Date(result.submittedAt ?? Date.now()).getFullYear()}-${result.level}-PENDING` : '—');
  const issuedAt = cert?.issuedAt ?? result?.submittedAt;
  const validUntil = cert?.validUntil;
  const displayName = (cert?.holderName && cert.holderName.trim()) || holderName;
  const displayBirthIso = cert?.holderBirthDate ?? birthDate;
  const verifyPageUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/verify-cert` : 'https://axisexam.com/verify-cert';

  return (
    <MyPageModal
      open={open && !!result}
      title={t('mypage.cert.title' as never)}
      onClose={onClose}
      printable
      width="lg"
    >
      {result && (
        <>
          <p className="text-[12px] text-muted mb-4 print:hidden">
            {lang === 'ko'
              ? '「인쇄 / PDF 저장」을 누른 뒤 프린터 목록에서 PDF로 저장하세요.'
              : 'Click Print / Save as PDF, then choose Save as PDF in the print dialog.'}
          </p>
          <FormalCertificatePrint
            certType={result.certType}
            level={result.level}
            holderName={displayName}
            birthDateIso={displayBirthIso}
            certNumber={certNo}
            issuedAtIso={issuedAt ?? null}
            validUntilIso={validUntil ?? null}
            verifyPageUrl={verifyPageUrl}
          />
        </>
      )}
    </MyPageModal>
  );
}

export function ConfirmationModal({
  open,
  result,
  holderName,
  onClose,
}: {
  open: boolean;
  result: ResultDto | null;
  holderName: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <MyPageModal
      open={open && !!result}
      title={t('mypage.act.confirmationPdf' as never)}
      onClose={onClose}
      printable
    >
      {result && (
        <div>
          <PrintField label={t('mypage.voucher.name' as never)} value={holderName} />
          <PrintField label={t('mypage.voucher.cert' as never)} value={certLabel(result.certType, result.level)} />
          <PrintField
            label={t('mypage.receipt.paidAt' as never)}
            value={result.submittedAt ? formatExamDate(result.submittedAt) : '—'}
          />
          {result.totalScore != null && <PrintField label="Total Score" value={`${result.totalScore} / 100`} />}
          {result.writtenScore != null && <PrintField label="Written" value={`${result.writtenScore} / 100`} />}
          {result.practicalScore != null && <PrintField label="Practical" value={`${result.practicalScore} / 100`} />}
          <PrintField
            label="Status"
            value={result.passed ? 'PASS' : result.partialPass ? 'PARTIAL PASS' : 'FAIL'}
          />
        </div>
      )}
    </MyPageModal>
  );
}

export function ScoreDetailModal({
  open,
  result,
  onClose,
}: {
  open: boolean;
  result: ResultDto | null;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  if (!open || !result) return null;

  const rows = [
    { label: t('mypage.scores.detailCert'), value: certLabel(result.certType, result.level) },
    {
      label: t('mypage.scores.detailRound'),
      value: formatExamRoundLabel(result.roundNumber, result.scheduleYear, lang),
    },
    {
      label: t('mypage.scores.detailAttempt'),
      value: result.attemptNo <= 1 ? '1' : String(result.attemptNo),
    },
    {
      label: t('mypage.scores.detailExamDate'),
      value: result.submittedAt ? formatExamDate(result.submittedAt) : '—',
    },
    {
      label: t('mypage.scores.detailAnnounced'),
      value: result.gradedAt
        ? formatExamDate(result.gradedAt)
        : result.status === 'SUBMITTED'
          ? t('mypage.scores.pending')
          : '—',
    },
    ...(result.totalScore != null
      ? [{ label: t('score.detail.total' as never), value: `${result.totalScore} / 100` }]
      : []),
    ...(result.writtenScore != null
      ? [{
          label: t('score.detail.written' as never),
          value: `${result.writtenScore} / 100 · ${result.writtenScore >= 60 ? t('score.detail.pass' as never) : t('score.detail.failThreshold' as never)}`,
        }]
      : []),
    ...(result.practicalScore != null
      ? [{
          label: t('score.detail.practical' as never),
          value: `${result.practicalScore} / 100 · ${result.practicalScore >= 60 ? t('score.detail.pass' as never) : t('score.detail.failThreshold' as never)}`,
        }]
      : []),
  ];

  return (
    <ResultModal title={t('mypage.scores.detailTitle')} onClose={onClose}>
      <ResultModalRows rows={rows} />
      {result.breakdown.length > 0 && (
        <div className="mt-5">
          <div className="text-[13px] font-semibold text-ink mb-2">{t('score.detail.subjectBreakdown' as never)}</div>
          <div className="md:hidden space-y-2">
            {result.breakdown.map((b) => (
              <div key={`${b.part}-${b.subjectIndex}`} className="rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted">{b.part}</div>
                    <div className="text-[13px] font-medium text-ink break-keep">{b.subjectName}</div>
                  </div>
                  {b.subjectFailed && (
                    <span className="inline-flex flex-shrink-0 text-[12px] font-semibold text-status-danger">
                      {t('score.detail.subjectFail' as never)}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-baseline gap-2 text-[13px]">
                  <span className="font-en font-semibold text-ink">{b.earned}/{b.total}</span>
                  <span className="font-en text-muted">{b.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
          <table className="data-table w-full">
            <thead>
              <tr>
                <th style={{ width: 90 }}>{t('score.detail.col.section' as never)}</th>
                <th>{t('score.detail.col.subject' as never)}</th>
                <th style={{ width: 90 }} className="text-right">{t('score.detail.col.score' as never)}</th>
                <th style={{ width: 70 }} className="text-right">{t('score.detail.col.ratio' as never)}</th>
                <th style={{ width: 80 }} className="text-center">{t('score.detail.col.result' as never)}</th>
              </tr>
            </thead>
            <tbody>
              {result.breakdown.map((b) => (
                <tr key={`${b.part}-${b.subjectIndex}`}>
                  <td className="text-muted">{b.part}</td>
                  <td className="text-ink">{b.subjectName}</td>
                  <td className="text-right font-en">{b.earned}/{b.total}</td>
                  <td className="text-right font-en text-muted">{b.percentage}%</td>
                  <td className="text-center">
                    {b.subjectFailed ? (
                      <span className="text-[12px] font-semibold text-status-danger">{t('score.detail.subjectFail' as never)}</span>
                    ) : (
                      <span className="text-[12px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {result.failReason && (
        <div className="mt-4 rounded-lg border border-status-danger bg-red-50 p-3">
          <div className="text-[12px] font-semibold text-status-danger mb-1">{t('score.detail.failReason' as never)}</div>
          <div className="text-[13px] text-ink">{result.failReason}</div>
        </div>
      )}
    </ResultModal>
  );
}

export function DigitalBadgeModal({
  open,
  cert,
  onClose,
}: {
  open: boolean;
  cert: CertificateDto | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!open || !cert) return null;

  // QR과 입력창이 동일한 검증 URL을 쓰도록 한 곳에서 생성한다.
  const verifyUrl = buildCertificateVerifyQrUrl(
    `${window.location.origin}/verify-cert`,
    cert.certNumber,
    cert.holderName ?? '',
  );

  // 헤더/배지 색상은 자격 유형을 따른다 (AXIS=파랑, AXIS-C=초록, AXIS-H=보라).
  const accent =
    cert.certType === 'AXIS_C' ? '#16A34A' : cert.certType === 'AXIS_H' ? '#7C3AED' : '#2563EB';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard might be unavailable in insecure contexts
    }
  };

  return (
    <ResultModal
      title={t('mypage.badge.title' as never)}
      headerBg={accent}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
          <ResultModalButton onClick={onClose}>{t('mypage.modal.close' as never)}</ResultModalButton>
          <ResultModalButton variant={copied ? 'success' : 'primary'} onClick={handleCopy}>
            {copied ? t('mypage.modal.copied' as never) : t('mypage.modal.copyLink' as never)}
          </ResultModalButton>
        </div>
      }
    >
      <div className="w-full max-w-[440px]">
        {/* 디지털 배지 히어로 카드 — 모달 톤에 맞춘 라이트 카드 */}
        <div className="mb-5 rounded-2xl">
          <div className="mt-3 text-[18px] font-semibold tracking-[-0.01em] text-ink">
            {certLabel(cert.certType, cert.level)}
          </div>
          <div className="mt-0.5 font-mono text-[13px] text-muted">{cert.certNumber}</div>
        </div>

        <p className="mb-4 text-[14px] leading-relaxed text-body">{t('mypage.badge.sub' as never)}</p>

        {/* QR + 검증 링크 / 자격증 번호 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="mx-auto shrink-0 sm:mx-0">
            <CertificateVerifyQr payloadUrl={verifyUrl} size={120} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">URL</div>
            <input
              readOnly
              value={verifyUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-blue"
            />
            <div className="mt-3 rounded-lg border border-border bg-[#F3F5F9] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">
                {t('mypage.cert.no' as never)}
              </div>
              <div className="font-mono text-[14px] font-semibold text-ink tracking-[-0.01em]">
                {cert.certNumber}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ResultModal>
  );
}

export function PhysicalCopyModal({
  open,
  onClose,
  onOpenInquiry,
}: {
  open: boolean;
  onClose: () => void;
  onOpenInquiry: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <ResultModal title={t('mypage.physical.title' as never)} onClose={onClose}>
      <p className="text-[14px] leading-relaxed text-body">{t('mypage.physical.body' as never)}</p>
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenInquiry();
        }}
        className="mt-5 w-full rounded-lg bg-blue px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-blue-hover"
      >
        {t('mypage.physical.go' as never)}
      </button>
    </ResultModal>
  );
}
