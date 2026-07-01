import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';
import ctaBg from '@/assets/cta-bg.jpg';

type AboutTab = 'about' | 'grading' | 'operation';

/* ─────────────────────────────────────────────────────────────
   Design tokens — HomePage와 동일 스케일
   ───────────────────────────────────────────────────────────── */
const INK_900 = '#191919';
const GRAY_500 = '#525252';
const GRAY_300 = '#737373';

/* 콘텐츠 페이지 (긴 본문 위주) — Hero/Tabs는 PageHero/PageTabs 컴포넌트가 담당 */
const H_SEC = 'text-[26px] lg:text-[34px] font-semibold leading-[1.3] tracking-[-0.025em]';
const H_CARD = 'text-[21px] lg:text-[26px] font-semibold leading-[1.3] tracking-[-0.02em]';
const T_BODY = 'text-[16px] lg:text-[19px] leading-[1.85] tracking-[-0.005em]';
const T_SUB = 'text-[15px] lg:text-[17px] leading-[1.6]';
/* 표 전용 — .data-table 기본 14.5px가 작으므로 override */
const TABLE_WRAP =
  'w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2 ' +
  '[&_th]:!text-[14px] lg:[&_th]:!text-[15px] ' +
  '[&_td]:!text-[16px] lg:[&_td]:!text-[18px] [&_td]:!leading-[1.7]';

export default function AboutPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AboutTab>('about');
  const mainRef = useRef<HTMLDivElement>(null);
  const ABOUT_LABELS: Record<AboutTab, string> = {
    about: t('about.tab.about'),
    grading: t('about.tab.grading'),
    operation: t('about.tab.operation'),
  };

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    const container = mainRef.current;
    if (container) {
      container.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    }
    return () => obs.disconnect();
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-white" style={{ color: 'var(--color-body)' }}>
      <SiteHeader active="about" />

      <PageHeroSolid
        title={t('about.hero.title')}
        subtitle={t('about.hero.sub')}
      />

      <PageTabs
        tabs={(['about', 'grading', 'operation'] as AboutTab[]).map((k) => ({ key: k, label: ABOUT_LABELS[k] }))}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
      />

      <main ref={mainRef} className="mx-auto py-16 " style={{ maxWidth: 'var(--spacing-content-w)' }}>

        {activeTab === 'about' && (
          <>
            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>AI를 다루는 사람</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                GPT, Gemini, Claude 같은 생성형 AI는 이미 수많은 직장인의 업무 도구가 되었습니다. <br />
                하지만 &quot;AI를 다룰 줄 안다&quot;는 것을 객관적으로 증명할 방법은 아직 마땅하지 않습니다.
              </p>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                기존 AI 자격은 대부분 두 가지 중 하나입니다.  <br /> AI 개념을 이해하는 상식 시험이거나,
                Python 코딩으로 모델을 만드는 개발자 시험입니다. <br /> 
                실제로 대부분의 직장인에게 필요한 것은 그 사이에 있습니다. <br/>
                <strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">코딩 없이, 생성형 AI를 자기 업무에 적용해서 실제 성과를 내는 능력</strong>입니다.
              </p>
              <p className={T_BODY} style={{ color: GRAY_500 }}>
                AXIS(AI 실무역량검정)는 바로 이 능력을 검증합니다. <br/>
                &quot;AI를 만드는 사람&quot;이 아니라 &quot;AI로 성과 내는 사람&quot;을 위한 자격입니다.
              </p>
            </section>
            <div className="w-10 h-px bg-border mb-14" />

            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>AXIS 시리즈</h2>
              <p className={`${T_BODY} mb-5`} style={{ color: GRAY_500 }}>AXIS는 단일 자격이 아니라, 직무와 산업에 맞게 설계된 시리즈입니다.</p>
              <div className={TABLE_WRAP}>
                <table className="data-table" style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>자격</th>
                      <th>검정 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>AXIS</strong>
                        <div className={`${T_SUB} mt-0.5`} style={{ color: GRAY_300 }}>AI 실무역량검정</div>
                      </td>
                      <td>전 직종 재직자를 위한 범용 AI 실무역량검정. 코딩 없이 AI로 업무 성과를 내는 능력을 검증합니다.</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>AXIS-C</strong>
                        <div className={`${T_SUB} mt-0.5`} style={{ color: GRAY_300 }}>AI 코딩자동화</div>
                      </td>
                      <td>현업 자동화 담당자·비개발 실무자를 위한 AI 코딩·자동화 실무역량검정. 코딩 전문가가 아니어도 AI 도구로 업무를 자동화하고 검증하는 역량을 평가합니다.</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>AXIS-H</strong>
                        <div className={`${T_SUB} mt-0.5`} style={{ color: GRAY_300 }}>의료기관 AI</div>
                      </td>
                      <td>원무·행정·간호 등 의료기관 종사자를 위한 AI 실무역량검정. 진단·치료를 제외한 비임상 업무에 AI를 적용하는 역량을 평가합니다.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'grading' && (
          <>
            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>3단계로 증명합니다</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                AXIS는 <strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">L3 Starter, L2 Practitioner, L1 Leader</strong> 세 단계로 구성됩니다.
                등급 체계는 3개 자격 공통입니다.
              </p>
              <div className={TABLE_WRAP}>
                <table className="data-table" style={{ minWidth: 500 }}>
                  <thead>
                    <tr>
                      <th>등급</th><th>대상</th><th>평가 방식</th><th>핵심 역량</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td><strong>L3 Starter</strong></td><td>AI 입문자</td><td>객관식 40 + 실습 4</td><td>AI 기초 이해, 기초 프롬프트, 윤리</td></tr>
                    <tr><td><strong>L2 Practitioner</strong></td><td>실무 활용자</td><td>사례형 객관식 30 + 실습 3과제</td><td>AI 도구 선택, 고급 프롬프트, 산출물 검증</td></tr>
                    <tr><td><strong>L1 Leader</strong></td><td>AX 리더</td><td>객관식 25 + 실행계획서 + 서술형 2</td><td>AI 도입 실행계획, 변화관리, 거버넌스</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
            <div className="w-10 h-px bg-border mb-14" />

            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>검정 철학</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>AXIS는 세 가지 원칙 위에 서 있습니다.</p>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}><strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">실무성.</strong> 단순 암기가 아니라 실제 업무 상황에서의 판단과 활용 능력을 평가합니다. L2 이상은 실제 AI 도구를 사용해 과제를 수행하는 실습형 시험입니다.</p>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}><strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">공정성.</strong> NICE 인증, 신분증 OCR, 얼굴 대조, AI 실시간 모니터링으로 응시자 본인 확인과 시험 공정성을 확보합니다.</p>
              <p className={T_BODY} style={{ color: GRAY_500 }}><strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">신뢰성.</strong> AI 채점을 기본으로 하되, L2·L1의 실습·서술형은 전문가 검수와 관리자 확정을 거쳐 최종 점수를 결정합니다.</p>
            </section>
          </>
        )}

        {activeTab === 'operation' && (
          <>
            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>운영기관</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                AXIS는 <strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">㈜아이넥스</strong>가 직접 운영합니다. <br />
                아이넥스는 LMS, 서버 인프라, 콘텐츠, 실시간 교육 플랫폼을 자체 개발하는 에듀테크 기업이며, <br/>
                고용노동부 인증 원격훈련기관으로서 AI 기업교육을 직접 운영하고 있습니다.
              </p>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                시험 시스템(CBT), 문제은행, 채점 엔진, AI 감독 시스템을 모두 자체 개발하여, <br/>
                교육 현장에서 발견한 문제를 즉시 검정 시스템에 반영할 수 있는 구조입니다.
              </p>
            </section>
            <div className="w-10 h-px bg-border mb-14" />

            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>자격의 유효기간</h2>
              <p className={`${T_BODY} mb-4`} style={{ color: GRAY_500 }}>
                AXIS 자격의 유효기간은 취득일로부터 <strong className="text-ink font-semibold px-1 rounded-sm bg-sky-100">3년</strong>입니다. <br/>
                AI 기술과 도구는 빠르게 변화하므로, 자격의 실효성을 유지하기 위해 갱신 제도를 운영합니다.
              </p>
              <p className={T_BODY} style={{ color: GRAY_500 }}>
                갱신은 상위 등급 취득 또는 무상 보수교육 이수로 가능합니다.
              </p>
            </section>
          </>
        )}

        <div className="w-10 h-px bg-border mb-14" />

        <section className="reveal">
          <div
            className="relative overflow-hidden rounded-[20px] px-7 py-9 lg:px-12 lg:py-12"
            style={{
              backgroundImage: `url(${ctaBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <div className="absolute inset-0 bg-blue-800/50" aria-hidden="true" />
            <div className="relative mx-auto text-center">
              <p className={`${H_SEC} text-white`}>
                AXIS와 함께<br />
                AI 실무역량을 업그레이드하세요.
              </p>
              <p className={`mt-4 ${T_BODY} text-blue-100`}>
                시험 일정 확인부터 단체 응시 상담까지, 필요한 경로를 바로 선택해보세요.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  to="/apply"
                  className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-[16px] font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                >
                  시험접수 시작하기
                </Link>
                <Link
                  to="/qna"
                  className="inline-flex h-12 items-center justify-center rounded-full border border-white/85 bg-transparent px-7 text-[16px] font-semibold !text-white hover:!text-white"
                >
                  기업/단체 응시 문의
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
