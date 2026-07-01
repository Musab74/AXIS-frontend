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
import { openPrintPopup } from '@/utils/openPrintPopup';

const TABLE_WRAP = 'w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2';

export function CertsPanel({ data }: { data: DashboardDto }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [badgeFor, setBadgeFor] = useState<CertificateDto | null>(null);

  const openCertificate = (cert: CertificateDto) =>
    openPrintPopup(`/mypage/certificate/${encodeURIComponent(cert.certNumber)}`, `axis-cert-${cert.certNumber}`);

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

      <DigitalBadgeModal
        open={!!badgeFor}
        cert={badgeFor}
        onClose={() => setBadgeFor(null)}
      />
    </>
  );
}
