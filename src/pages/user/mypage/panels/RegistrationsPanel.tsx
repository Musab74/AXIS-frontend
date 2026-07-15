import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { ClipboardCheck, FileText, Megaphone, MessageCircle, ScrollText } from 'lucide-react';
import { useI18n } from '@/i18n';
import { InfoCallout } from '@/components/InfoCallout';
import { userApi } from '@/services/api';
import {
  Btn,
  EmptyState,
  KebabMenu,
  SectionTitle,
} from '../primitives';

const TABLE_WRAP = 'hidden md:block w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2';
import {
  ExamGateModal,
  ReceiptModal,
  RefundPolicyModal,
} from '../SharedModals';
import {
  certLabel,
  formatExamDate,
  formatKrw,
  formatLocalDateTime,
  regBadge,
} from '../helpers';
import type { DashboardDto, RegistrationDto } from '../types';
import { openProtectedPdf } from '@/utils/openProtectedPdf';

function registrationStatusView(
  r: RegistrationDto,
  t: ReturnType<typeof useI18n>['t'],
): { statusText: string; statusCls: string } {
  const deadlineExpired = r.examDeadlineExpired;
  const demoSuffix = r.latestPayment?.isDemo
    ? ` · ${t('sec.registrations.status.demo' as never)}`
    : '';
  if (r.status === 'PAID' && deadlineExpired && r.examDeadline) {
    return {
      statusText:
        t('sec.registrations.status.paidExpired' as never, { date: formatExamDate(r.examDeadline) }) +
        demoSuffix,
      statusCls: 'text-status-danger font-semibold',
    };
  }
  if (r.status === 'PAID' && r.examDeadline) {
    return {
      statusText:
        t('sec.registrations.status.paidUntil' as never, { date: formatExamDate(r.examDeadline) }) +
        demoSuffix,
      statusCls: 'font-medium',
    };
  }
  if (r.status === 'PAID') {
    return {
      statusText: t('sec.registrations.status.paid' as never) + demoSuffix,
      statusCls: 'text-ink font-semibold text-[14px]',
    };
  }
  if (r.status === 'PENDING_PAYMENT') {
    return {
      statusText: r.seatHeldUntil
        ? t('sec.registrations.status.pendingUntil' as never, { date: formatLocalDateTime(r.seatHeldUntil) })
        : t('sec.registrations.status.pending30' as never),
      statusCls: 'text-status-grading font-semibold text-[14px]',
    };
  }
  if (r.status === 'REFUNDED') {
    return {
      statusText: r.latestPayment?.refundAmount
        ? t('sec.registrations.status.refundedAmount' as never, { amount: formatKrw(r.latestPayment.refundAmount) })
        : t('sec.registrations.status.refunded' as never),
      statusCls: 'text-muted text-[14px]',
    };
  }
  if (r.status === 'CANCELLED') {
    return { statusText: t('sec.registrations.status.cancelled' as never), statusCls: 'text-muted' };
  }
  return { statusText: regBadge(r.status).text, statusCls: 'text-muted' };
}

function RegistrationsHero({ data }: { data: DashboardDto }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const completedExams = data.registrations.filter(
    (registration) => registration.status === 'EXAM_COMPLETED',
  ).length;

  const summaryItems = [
    {
      key: 'requested',
      icon: ScrollText,
      label: t('sec.registrations.summary.applied' as never),
      value: data.registrationStats.total,
    },
    {
      key: 'attended',
      icon: ClipboardCheck,
      label: t('sec.registrations.summary.attended' as never),
      value: completedExams,
    },
    {
      key: 'scores',
      icon: FileText,
      label: t('sec.registrations.summary.scores' as never),
      value: data.results.length,
    },
  ];

  return (
    <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,2.35fr)_minmax(280px,1fr)]">
      <div className="relative overflow-hidden rounded-[22px] bg-[#DDEAFE] px-6 py-6 sm:px-8 sm:py-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-[-0.03em] text-black break-keep sm:text-[28px]">
              {t('sec.registrations.summary.greeting' as never, { name: data.profile.name })}
            </h2>
            <p className="text-[14px] sm:text-[15px] text-[#475467] break-keep">
              {t('sec.registrations.summary.caption' as never)}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:gap-8 lg:min-w-[360px]">
            {summaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.key} className="text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-white text-[#2F67DA]">
                    <Icon className="h-6 w-6" strokeWidth={2.1} />
                  </div>
                  <div className="text-[13px] sm:text-[15px] font-medium text-[#344054] break-keep">{item.label}</div>
                  <div className="mt-3 mb-3 font-en text-[32px] sm:text-[40px] font-semibold leading-none tracking-[-0.03em] text-black">
                    {item.value}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        role="link"
        tabIndex={0}
        onClick={() => navigate('/qna?tab=notice')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigate('/qna?tab=notice');
          }
        }}
        className="relative overflow-hidden rounded-[22px] bg-[#D8F3E6] px-6 pt-6 pb-12 transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-[#60CDB0] cursor-pointer sm:px-8 sm:py-7"
      >
        <div className="max-w-[240px]">
          <h3 className="text-[22px] font-semibold tracking-[-0.03em] text-black break-keep sm:text-[28px]">
            {t('sec.registrations.notice.title' as never)}
          </h3>
          <p className="mt-2 text-[14px] sm:text-[15px] leading-[1.7] text-[#375166] break-keep">
            {t('sec.registrations.notice.body' as never)}
          </p>
        </div>
        <Megaphone className="pointer-events-none absolute bottom-5 right-5 h-12 w-12 sm:bottom-7 sm:right-7 sm:h-16 sm:w-16 text-[#60CDB0]" strokeWidth={1.9} />
      </div>
    </section>
  );
}

function RegistrationsSection({
  data,
  onCancel,
  onRefresh,
  onPayNow,
}: {
  data: DashboardDto;
  onCancel: (id: string) => Promise<void>;
  onRefresh: () => void;
  onPayNow: (reg: RegistrationDto) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receiptReg, setReceiptReg] = useState<RegistrationDto | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const [gateReg, setGateReg] = useState<RegistrationDto | null>(null);

  const handleCancel = async (id: string) => {
    const reg = data.registrations.find((x) => x.id === id);
    const confirmMsg =
      reg?.status === 'PAID' && !reg.latestPayment?.isDemo
        ? t('sec.registrations.confirmCancelRefund' as never)
        : t('sec.registrations.confirmCancel' as never);
    if (!confirm(confirmMsg)) return;
    setBusyId(id);
    try {
      await onCancel(id);
      onRefresh();
    } catch (e: unknown) {
      const msg = isAxiosError(e) ? e.response?.data?.message : undefined;
      window.alert(
        typeof msg === 'string' && msg
          ? msg
          : t('sec.registrations.cancelFail' as never),
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <RegistrationsHero data={data} />
      <SectionTitle title={t('sec.registrations.title')} sub="" />

    <InfoCallout tone="blue" >
      <p>{t('sec.registrations.info.voucher' as never)}</p>
    </InfoCallout>
    <InfoCallout tone="red" className="mb-6">
      <p>{t('sec.registrations.info.refund' as never)}</p>
    </InfoCallout>
    {/* 
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-6">
        <StatCard label="Total Registered" value={String(stats.total)} suffix="exams" />
        <StatCard label="Awaiting Payment" value={String(stats.awaitingPayment)} suffix="pending" />
        <StatCard label="Confirmed" value={String(stats.confirmed)} suffix={stats.confirmed === 1 ? 'exam' : 'exams'} />
        <StatCard label="Cancelled" value={String(stats.cancelled)} suffix="refunded" />
      </div>
     */}

      <div className={TABLE_WRAP}>
        <table className="data-table" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              <th style={{ width: 100 }}>{t('sec.registrations.col.round' as never)}</th>
              <th style={{ width: 220 }}>{t('sec.registrations.col.cert' as never)}</th>
              <th style={{ width: 180 }}>{t('sec.registrations.col.status' as never)}</th>
              <th style={{ width: 160 }}>{t('sec.registrations.col.examDate' as never)}</th>
              <th style={{ width: 170 }} className="text-right"></th>
            </tr>
          </thead>
          <tbody>
            {data.registrations.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <EmptyState description={t('sec.registrations.empty.hint' as never)}>
                    {t('sec.registrations.empty.title' as never)}
                  </EmptyState>
                </td>
              </tr>
            ) : (
              data.registrations.map((r) => {
                const deadlineExpired = r.examDeadlineExpired;
                const { statusText, statusCls } = registrationStatusView(r, t);
                return (
                  <tr key={r.id}>
                    <td className="text-muted font-en">
                      {t('sec.registrations.roundSuffix' as never, { n: r.schedule.roundNumber })}
                    </td>
                    <td>
                      <span className="text-ink text-center font-semibold">
                        {certLabel(r.certType, r.level)}
                      </span>
                    </td>
                    <td>
                      <span className={`text-[14px] text-center ${statusCls}`}>{statusText}</span>
                    </td>
                    <td className="text-muted ">
                      {formatExamDate(r.schedule.examDate, r.schedule.examStartTime)}
                    </td>
                    <td>
                      <div className="inline-flex gap-1.5 items-center justify-end w-full">
                        {r.status === 'PAID' && !deadlineExpired && (
                          <Btn
                            variant="blue"
                            className="btn-sm bg-blue-500"
                            onClick={() =>
                              openProtectedPdf(
                                async () => (await userApi.downloadVoucherPdf(r.id)).data,
                                `AXIS_voucher_${r.id}.pdf`,
                              )
                            }
                          >
                            {t('mypage.act.printVoucher' as never)}
                          </Btn>
                        )}
                        {r.status === 'PENDING_PAYMENT' && (
                          <Btn variant="orange" className="btn-sm" onClick={() => onPayNow(r)}>{t('sec.registrations.act.pay' as never)}</Btn>
                        )}
                        {(r.status === 'CANCELLED' || r.status === 'REFUNDED') && (
                          <Btn variant="blue" className="btn-sm" onClick={() => setReceiptReg(r)}>
                            {t('mypage.act.receipt' as never)}
                          </Btn>
                        )}

                        {r.status === 'PAID' && (
                          <>
                            <Btn
                              variant="danger"
                              className="btn-sm"
                              onClick={() => handleCancel(r.id)}
                              disabled={busyId === r.id}
                            >
                              {busyId === r.id
                                ? t('sec.registrations.act.cancelling' as never)
                                : r.latestPayment?.isDemo
                                  ? t('sec.registrations.act.cancel' as never)
                                  : t('sec.registrations.act.cancelRefund' as never)}
                            </Btn>
                            <KebabMenu
                              items={[
                                { label: t('sec.registrations.act.receiptView' as never), onClick: () => setReceiptReg(r) },
                                { label: t('sec.registrations.act.refundPolicy' as never), onClick: () => setRefundOpen(true) },
                              ]}
                            />
                          </>
                        )}
                        {r.status === 'PENDING_PAYMENT' && (
                          <Btn
                            variant="danger"
                            className="btn-sm"
                            onClick={() => handleCancel(r.id)}
                            disabled={busyId === r.id}
                          >
                            {busyId === r.id ? t('sec.registrations.act.cancelling' as never) : t('sec.registrations.act.cancel' as never)}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden mt-4 border-t-2 border-ink">
        {data.registrations.length === 0 ? (
          <EmptyState description={t('sec.registrations.empty.hint' as never)}>
            {t('sec.registrations.empty.title' as never)}
          </EmptyState>
        ) : (
          data.registrations.map((r) => {
            const deadlineExpired = r.examDeadlineExpired;
            const { statusText, statusCls } = registrationStatusView(r, t);
            return (
              <div key={r.id} className="border-b border-border py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted font-en mb-0.5">
                      {t('sec.registrations.roundSuffix' as never, { n: r.schedule.roundNumber })}
                    </div>
                    <div className="text-[16px] font-semibold text-ink break-keep">
                      {certLabel(r.certType, r.level)}
                    </div>
                  </div>
                  {r.status === 'PAID' && (
                    <KebabMenu
                      items={[
                        { label: t('sec.registrations.act.receiptView' as never), onClick: () => setReceiptReg(r) },
                        { label: t('sec.registrations.act.refundPolicy' as never), onClick: () => setRefundOpen(true) },
                      ]}
                    />
                  )}
                </div>
                <div className="mt-3 space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <span className="text-light flex-shrink-0">{t('sec.registrations.col.status' as never)}</span>
                    <span className={`text-right break-keep ${statusCls}`}>{statusText}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-light flex-shrink-0">{t('sec.registrations.col.examDate' as never)}</span>
                    <span className="text-ink text-right break-keep">
                      {formatExamDate(r.schedule.examDate, r.schedule.examStartTime)}
                    </span>
                  </div>
                </div>
                {((r.status === 'PAID' && !deadlineExpired) ||
                  r.status === 'PAID' ||
                  r.status === 'PENDING_PAYMENT' ||
                  r.status === 'CANCELLED' ||
                  r.status === 'REFUNDED') && (
                  <div className="mt-3 flex flex-col gap-2">
                    {r.status === 'PAID' && !deadlineExpired && (
                      <Btn
                        variant="blue"
                        className="w-full min-h-[44px]"
                        onClick={() =>
                          openProtectedPdf(
                            async () => (await userApi.downloadVoucherPdf(r.id)).data,
                            `AXIS_voucher_${r.id}.pdf`,
                          )
                        }
                      >
                        {t('mypage.act.printVoucher' as never)}
                      </Btn>
                    )}
                    {r.status === 'PAID' && (
                      <Btn
                        variant="danger"
                        className="w-full min-h-[44px]"
                        onClick={() => handleCancel(r.id)}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id
                          ? t('sec.registrations.act.cancelling' as never)
                          : r.latestPayment?.isDemo
                            ? t('sec.registrations.act.cancel' as never)
                            : t('sec.registrations.act.cancelRefund' as never)}
                      </Btn>
                    )}
                    {r.status === 'PENDING_PAYMENT' && (
                      <>
                        <Btn variant="orange" className="w-full min-h-[44px]" onClick={() => onPayNow(r)}>
                          {t('sec.registrations.act.pay' as never)}
                        </Btn>
                        <Btn
                          variant="danger"
                          className="w-full min-h-[44px]"
                          onClick={() => handleCancel(r.id)}
                          disabled={busyId === r.id}
                        >
                          {busyId === r.id ? t('sec.registrations.act.cancelling' as never) : t('sec.registrations.act.cancel' as never)}
                        </Btn>
                      </>
                    )}
                    {(r.status === 'CANCELLED' || r.status === 'REFUNDED') && (
                      <Btn variant="blue" className="w-full min-h-[44px]" onClick={() => setReceiptReg(r)}>
                        {t('mypage.act.receipt' as never)}
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <ReceiptModal
        open={!!receiptReg}
        reg={receiptReg}
        holderName={data.profile.name}
        onClose={() => setReceiptReg(null)}
      />
      <RefundPolicyModal open={refundOpen} onClose={() => setRefundOpen(false)} />
      <ExamGateModal
        open={!!gateReg}
        reg={gateReg}
        onClose={() => setGateReg(null)}
        onEnvCheck={() => navigate('/env-check')}
      />
    </>
  );
}

export function RegistrationsPanel({
  data,
  onCancel,
  onRefresh,
  onPayNow,
}: {
  data: DashboardDto;
  onCancel: (id: string) => Promise<void>;
  onRefresh: () => void;
  onPayNow: (reg: RegistrationDto) => void;
}) {
  return (
    <RegistrationsSection
      data={data}
      onCancel={onCancel}
      onRefresh={onRefresh}
      onPayNow={onPayNow}
    />
  );
}
