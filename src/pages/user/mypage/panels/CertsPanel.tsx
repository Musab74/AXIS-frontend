import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n';
import type { InquiryCategory } from '@/services/api';
import {
  Btn,
  SectionTitle,
} from '../primitives';
import { DigitalBadgeModal } from '../SharedModals';
import { certLabel, formatExamDate } from '../helpers';
import type { CertificateDto, DashboardDto } from '../types';
import { InfoCallout } from '@/components/InfoCallout';

const TABLE_WRAP = 'hidden md:block w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2';

export function CertsPanel({ data }: { data: DashboardDto }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [badgeFor, setBadgeFor] = useState<CertificateDto | null>(null);

  const openCertificate = (cert: CertificateDto) => {
    navigate(`/mypage/certificate/${encodeURIComponent(cert.certNumber)}`);
  };

  const requestPhysicalCopy = () =>
    navigate('/qna', {
      state: {
        prefill: {
          category: 'CERTIFICATE' as InquiryCategory,
          title: '[Physical Cert] Shipping request',
        },
      },
    });

  return (
    <>
      <SectionTitle title={t('sec.certs.title')} sub="" />

       <InfoCallout tone="blue" className="">
          <p>{t('sec.certs.info.verify')}</p>
      </InfoCallout>
      <InfoCallout tone="blue" className="">
          <p>
            {t('sec.certs.info.physical')}{' '}
            <button
              type="button"
              onClick={requestPhysicalCopy}
              className="text-blue-500 font-semibold underline underline-offset-2 bg-transparent border-none cursor-pointer hover:text-blue-700 p-0"
              style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
            >
              {t('sec.certs.info.physicalCta')}
            </button>
          </p>
      </InfoCallout>
      <InfoCallout tone="red" className="mb-6">
          <p>{t('sec.certs.info.validity')}</p>
      </InfoCallout>

      <div className={TABLE_WRAP}>
        <table className="data-table" style={{ minWidth: 940 }}>
          <thead>
            <tr>
              <th style={{ width: 200 }}>{t('sec.certs.col.name')}</th>
              <th style={{ width: 240 }}>{t('sec.certs.col.number')}</th>
              <th style={{ width: 140 }}>{t('sec.certs.col.issued')}</th>
              <th style={{ width: 250 }}>{t('sec.certs.col.validity')}</th>
              <th style={{ width: 200 }}>{t('sec.certs.col.issue')}</th>
            </tr>
          </thead>
          <tbody>
            {data.certificates.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-muted py-8">
                  {t('sec.certs.empty')}
                </td>
              </tr>
            ) : (
              data.certificates.map((c) => (
                <tr key={c.sessionId}>
                  <td>
                    <span className="text-ink font-semibold">{certLabel(c.certType, c.level)}</span>
                  </td>
                  <td className="text-muted font-en">{c.certNumber}</td>
                  <td className="text-muted">{formatExamDate(c.issuedAt)}</td>
                  <td className="text-muted">
                    {formatExamDate(c.issuedAt)} ~ {formatExamDate(c.validUntil)}
                    <span className="text-light ml-1">{t('sec.certs.validity.years')}</span>
                  </td>
                  <td>
                    <div className="inline-flex items-center gap-1.5 flex-wrap">
                      <Btn variant="primary" className="btn-sm bg-blue-500" onClick={() => openCertificate(c)}>
                        {t('mypage.act.pdfDownload' as never)}
                      </Btn>
                      <Btn variant="blue" className="btn-sm" onClick={() => setBadgeFor(c)}>
                        {t('mypage.act.digitalBadge' as never)}
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden mt-4 border-t-2 border-ink">
        {data.certificates.length === 0 ? (
          <div className="py-10 px-4 text-center text-muted text-[14px] break-keep">
            {t('sec.certs.empty')}
          </div>
        ) : (
          data.certificates.map((c) => (
            <div key={c.sessionId} className="border-b border-border py-4">
              <div className="min-w-0">
                <div className="text-[16px] font-semibold text-ink break-keep">
                  {certLabel(c.certType, c.level)}
                </div>
                <div className="mt-0.5 text-[13px] text-muted font-en break-all">{c.certNumber}</div>
              </div>
              <div className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="text-light flex-shrink-0">{t('sec.certs.col.issued')}</span>
                  <span className="text-ink text-right">{formatExamDate(c.issuedAt)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-light flex-shrink-0">{t('sec.certs.col.validity')}</span>
                  <span className="text-ink text-right break-keep">
                    {formatExamDate(c.issuedAt)} ~ {formatExamDate(c.validUntil)}
                    <span className="text-light ml-1">{t('sec.certs.validity.years')}</span>
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Btn variant="primary" className="w-full min-h-[44px] bg-blue-500" onClick={() => openCertificate(c)}>
                  {t('mypage.act.pdfDownload' as never)}
                </Btn>
                <Btn variant="blue" className="w-full min-h-[44px]" onClick={() => setBadgeFor(c)}>
                  {t('mypage.act.digitalBadge' as never)}
                </Btn>
              </div>
            </div>
          ))
        )}
      </div>

      <DigitalBadgeModal
        open={!!badgeFor}
        cert={badgeFor}
        onClose={() => setBadgeFor(null)}
      />
    </>
  );
}
