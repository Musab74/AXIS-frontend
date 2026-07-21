import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { userApi, noticeApi, resultsApi } from '@/services/api';
import type { NoticeItem, PublicRoundRow } from '@/services/api';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import mainVisualMp4 from '@/assets/main_visual.mp4';
import mainVisualMobileMp4 from '@/assets/main_visual_mobile.mp4';
import mainVisualPoster from '@/assets/main_visual_poster.jpg';
import { useIsMobile } from '@/lib/useIsMobile';
import evaluationImage from '@/assets/ass.png';
import { HomeScheduleSection } from './HomeScheduleSection';
import { NoticeAccordion } from '@/components/marketing/NoticeAccordion';

interface Profile {
  id: string;
  userId: string;
  name: string;
  phone?: string;
  email?: string | null;
  birthDate?: string | null;
  roles?: string[];
}

/* ─────────────────────────────────────────────────────────────
   Layout / typography tokens — delight.ai reference
   (콘텐츠는 변경하지 않고 시각 토큰만 맞춤)
   ───────────────────────────────────────────────────────────── */
/* Text color hierarchy — 위계 복원 */
const INK_900 = '#191919';   /* 제목 */
const INK_700 = '#1F1F1F';   /* 강조 본문 */
const GRAY_500 = '#525252';  /* 본문 */
const GRAY_300 = '#737373';  /* 메타·부제·날짜 */

/* Surfaces */
const BORDER = '#bbbbbb';        /* 일반 카드 보더 (연한 회색) */
const ACCENT = '#3b82f6';        /* Tailwind blue-500 */
const SURFACE = '#FFFFFF';       /* 카드 / 강조 섹션 베이스 */
const SURFACE_ALT = '#F7F7F8';   /* 교차 섹션 베이스 (살짝 진한 옅은 회색) */

const SECTION = 'py-8 sm:py-[64px] lg:py-[120px] px-5 sm:px-6 lg:px-10';
const WRAP = 'mx-auto max-w-[1280px]';

/** Number of most-recent (grading/announced) rounds shown in the home section. */
const HOME_RESULTS_LIMIT = 3;

/** YYYY.MM.DD in KST — matches ResultsPage formatting. */
function formatExamDateKst(iso: string): string {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return s.replace(/-/g, '.');
}

/** e.g. "AXIS L3", "AXIS-C L3" */
function formatRoundCertTitle(certType: 'AXIS' | 'AXIS_C' | 'AXIS_H', level: string): string {
  return `${certType.replace('_', '-')} ${level}`;
}

/* Type scale — 페이지 전체 통일 (이 페이지가 다른 화면들의 기준이 됨)
   모바일은 OPIc 앱처럼 한 단계 작게, sm/lg 이상은 기존 스케일 유지 */
const H_HERO = 'text-[26px] sm:text-[40px] lg:text-[54px] font-semibold leading-[1.25] break-keep lg:break-normal';
const H_SEC = 'text-[20px] sm:text-[26px] lg:text-[34px] font-semibold leading-[1.25] sm:leading-[1.15] tracking-[-0.025em]';
const H_DISPLAY_CARD = 'text-[17px] sm:text-[22px] lg:text-[26px] font-semibold leading-[1.3] tracking-[-0.02em]'; /* 큰 카드 제목 */
const H_CARD = 'text-[15px] sm:text-[19px] lg:text-[22px] font-semibold leading-[1.35] sm:leading-[1.3] tracking-[-0.015em]';        /* 카드 제목 */
const T_LEAD = 'text-[14px] sm:text-[17px] lg:text-[20px] leading-[1.6] sm:leading-[1.55] tracking-[-0.01em]';
const T_BODY = 'text-[13px] sm:text-[15px] lg:text-[17px] leading-[1.6] sm:leading-[1.65] tracking-[-0.005em]';
const T_SMALL = 'text-[12px] sm:text-[14px] lg:text-[15px] leading-[1.5]';

export default function HomePage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const heroVideoSrc = isMobile ? mainVisualMobileMp4 : mainVisualMp4;
  const [, setProfile] = useState<Profile | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [homeNotices, setHomeNotices] = useState<NoticeItem[]>([]);
  const [openNoticeIds, setOpenNoticeIds] = useState<Set<string>>(new Set());
  const [openCert, setOpenCert] = useState<string | null>(null);
  const [passRounds, setPassRounds] = useState<PublicRoundRow[]>([]);
  const [passRoundsLoaded, setPassRoundsLoaded] = useState(false);

  const toggleHomeNotice = (id: string) => {
    setOpenNoticeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await noticeApi.getAll(1, 4);
        if (!cancelled) {
          setHomeNotices(res.data.notices);
          const firstImportant = res.data.notices.find((n) => n.tagType === 'IMPORTANT');
          if (firstImportant) {
            setOpenNoticeIds(new Set([firstImportant.id]));
          }
        }
      } catch {
        /* silently ignore on home page */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // No status filter → API returns upcoming + past; keep the most recent
        // graded/announced rounds (the actual "합격자 발표" content).
        const res = await resultsApi.publicRounds({ pageSize: 50 });
        if (cancelled) return;
        const recent = res.data.items
          .filter((r) => r.publicationState !== 'upcoming')
          .slice(0, HOME_RESULTS_LIMIT);
        setPassRounds(recent);
      } catch {
        /* silently ignore on home page */
      } finally {
        if (!cancelled) setPassRoundsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('accessToken');
    if (!token) return;
    (async () => {
      try {
        const res = await userApi.getProfile();
        if (!cancelled) setProfile(res.data);
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    // Re-run when async content (e.g. notices) mounts — initial pass only sees static sections.
    mainRef.current?.querySelectorAll('.reveal:not(.visible)').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [homeNotices, passRounds]);

  return (
    <div style={{ background: SURFACE, color: INK_700 }} className="min-h-screen">
      <SiteHeader />

      {/* ── Hero ── */}
      <section
        className="relative w-full flex items-center justify-center overflow-hidden min-h-[78svh] sm:min-h-screen py-10 sm:py-0"
      >
        <div className="absolute inset-0">
          <video
            key={heroVideoSrc}
            className="w-full h-full"
            style={{ objectFit: 'cover' }}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster={mainVisualPoster}
            aria-hidden="true"
          >
            <source src={heroVideoSrc} type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 bg-black/30" aria-hidden="true" />

        <div className="relative z-10 text-center px-6 max-w-full">
          <h1
            className={`${H_HERO} text-white mb-4 sm:mb-6`}
            style={{ animation: 'fadeUp .8s cubic-bezier(.16,1,.3,1) .2s both' }}
          >
            {t('home.hero.title1')}<br />
            <span
              className="px-1.5"
              style={{
                background: 'linear-gradient(180deg, transparent 70%, #3b82f6 70%)',
                boxDecorationBreak: 'clone',
                WebkitBoxDecorationBreak: 'clone',
                color: '#ffffff',
              }}
            >
              {t('home.hero.title2')}
            </span>
          </h1>
          <p
            className={`${T_LEAD} mb-6 sm:mb-10 text-gray-300`}
            style={{ animation: 'fadeUp .8s cubic-bezier(.16,1,.3,1) .5s both' }}
          >
            {t('home.hero.sub')}
          </p>
          <div
            data-tour="home-hero"
            className="flex flex-col items-center gap-4"
            style={{ animation: 'fadeUp .8s cubic-bezier(.16,1,.3,1) .8s both' }}
          >
            <div className="flex flex-col sm:flex-row gap-3 justify-center w-full max-w-[320px] sm:max-w-none">
              <PillButton onClick={() => navigate('/apply')} tone="light" className="w-full sm:w-auto">
                {t('home.hero.ctaApply')}
              </PillButton>
              <PillButton onClick={() => navigate('/guide')} tone="ghost-light" className="w-full sm:w-auto">
                {t('home.hero.ctaGuide')} →
              </PillButton>
            </div>
          </div>
        </div>

        <a href="#main" className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden sm:flex flex-col items-center gap-1.5 no-underline">
          <div className="w-px h-5 bg-faint" />
          <span className="text-[9px] font-medium tracking-[4px] text-faint uppercase font-en">SCROLL</span>
        </a>
      </section>

      <div id="main" ref={mainRef}>

        {/* ── Quick Links ── */}
        <section data-tour="home-quick" className={SECTION}>
          <div className={WRAP}>
            <div className="max-w-205 reveal">
              <h2 className={`${H_SEC} mt-0 sm:mt-4`} style={{ color: INK_900 }}>바로가기</h2>
            </div>

            <div className="mt-6 sm:mt-10 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {[
                { title: t('gnb.guide'), desc: t('home.quick.guideDesc'), to: '/guide', icon: 'guide' as const },
                { title: t('gnb.applyNav'), desc: t('home.quick.applyDesc'), to: '/apply', icon: 'apply' as const },
                { title: t('gnb.announce'), desc: t('home.quick.announceDesc'), to: '/results', icon: 'announce' as const },
                { title: t('gnb.verify'), desc: t('home.quick.verifyDesc'), to: '/verify-cert', icon: 'verify' as const },
              ].map(q => (
                <Link
                  key={q.to}
                  to={q.to}
                  className="group flex flex-col p-4 sm:p-6 lg:p-8 no-underline transition-all hover:shadow-sm reveal rounded-2xl sm:rounded-[20px]"
                  style={{ background: '#F1F5FF' }}
                >
                  <span
                    className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-[10px] sm:rounded-xl"
                    style={{ background: '#2563EB', color: '#fff' }}
                    aria-hidden="true"
                  >
                    <QuickLinkIcon name={q.icon} />
                  </span>
                  <div className={`mt-3 sm:mt-5 ${H_CARD}`} style={{ color: INK_900 }}>{q.title}</div>
                  {/* 모바일: 아이콘+제목만 노출(앱 숏컷 스타일). 설명·CTA는 sm 이상에서만. */}
                  <p className={`hidden sm:block sm:mt-2 sm:h-16 ${T_BODY}`} style={{ color: GRAY_500 }}>{q.desc}</p>
                  <span
                    className="hidden sm:mt-6 sm:inline-flex w-fit text-[13px] sm:text-[14px] font-semibold underline underline-offset-4 transition-colors group-hover:text-blue-700"
                    style={{ color: INK_900 }}
                  >
                    자세히 보기
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <HomeScheduleSection />

        {/* ── Security Process (뒤로 이동 + 아이콘+텍스트 레이아웃) ── */}
        <section className={SECTION}>
          <div className={WRAP}>
            <div className="max-w-205 reveal">
              <h2 className={`${H_SEC} mt-0 sm:mt-4`} style={{ color: INK_900 }}>
                {t('home.security.title') || '공정한 원격검정을 위한 다중 본인확인 체계'}
              </h2>
              <p className={`${T_LEAD} mt-3 sm:mt-5`} style={{ color: GRAY_500 }}>
                {t('home.security.sub') || 'AXIS는 다음 절차로 응시자 본인 확인과 시험 공정성을 확보합니다.'}
              </p>
            </div>

            <div className="mt-8 sm:mt-12 lg:mt-16 grid grid-cols-2 lg:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-8 sm:gap-y-10 lg:gap-y-12 whitespace-pre-line">
              {[
                { icon: 'nice' as const,    title: t('home.security.card.nice.title' as never),    desc: t('home.security.card.nice.desc' as never) },
                { icon: 'idcard' as const,  title: t('home.security.card.idcard.title' as never),  desc: t('home.security.card.idcard.desc' as never) },
                { icon: 'face' as const,    title: t('home.security.card.face.title' as never),    desc: t('home.security.card.face.desc' as never) },
                { icon: 'monitor' as const, title: t('home.security.card.monitor.title' as never), desc: t('home.security.card.monitor.desc' as never) },
                { icon: 'alert' as const,   title: t('home.security.card.alert.title' as never),   desc: t('home.security.card.alert.desc' as never) },
              ].map(s => (
                <div key={s.title} className="reveal">
                  <div style={{ color: INK_900 }}>
                    <SecurityIcon name={s.icon} />
                  </div>
                  <h3 className={`mt-3 sm:mt-5 ${H_CARD}`} style={{ color: INK_900 }}>{s.title}</h3>
                  <p className={`mt-2 sm:mt-3 ${T_BODY}`} style={{ color: GRAY_500 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={SECTION} style={{ background: SURFACE_ALT }}>
          <div className={WRAP}>
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-8 sm:gap-12 lg:gap-20">

              {/* 좌측: 타이틀 + 설명 */}
              <div className="reveal">
                <h2 className={`${H_SEC} mt-0 sm:mt-4`} style={{ color: INK_900 }}>{t('home.cert.title')}</h2>
                <p className={`${T_LEAD} mt-4`} style={{ color: GRAY_500 }}>
                  {t('home.cert.leadSub' as never)}
                </p>
                <div className="mt-6">
                  <MoreLink to="/about">{t('home.cert.seeAll' as never)}</MoreLink>
                </div>
              </div>

              {/* 우측: 아코디언 */}
              <div className="reveal">
                {[
                  { code: 'AXIS', name: t('home.cert.axis.name' as never), target: t('home.cert.axis.target' as never), levels: [{ l: 'L3', d: t('home.cert.axis.l3' as never) }, { l: 'L2', d: t('home.cert.axis.l2' as never) }, { l: 'L1', d: t('home.cert.axis.l1' as never) }] },
                  { code: 'AXIS-C', name: t('home.cert.axisc.name' as never), target: t('home.cert.axisc.target' as never), levels: [{ l: 'L3', d: t('home.cert.axisc.l3' as never) }, { l: 'L2', d: t('home.cert.axisc.l2' as never) }, { l: 'L1', d: t('home.cert.axisc.l1' as never) }] },
                  { code: 'AXIS-H', name: t('home.cert.axish.name' as never), target: t('home.cert.axish.target' as never), levels: [{ l: 'L3', d: t('home.cert.axish.l3' as never) }, { l: 'L2', d: t('home.cert.axish.l2' as never) }, { l: 'L1', d: t('home.cert.axish.l1' as never) }] },
                ].map((c, idx) => {
                  const open = openCert === c.code;
                  return (
                    <div
                      key={c.code}
                      style={{ borderTop: idx === 0 ? `2px solid #1B1B1B` : 'none', borderBottom: `1px solid #1B1B1B` }}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenCert(open ? null : c.code)}
                        className="w-full flex items-center justify-between gap-4 lg:gap-6 py-6 lg:py-10 text-left transition-colors"
                        aria-expanded={open}
                      >
                        <div className="flex-1 min-w-0 flex flex-col lg:flex-row lg:items-baseline gap-1.5 lg:gap-5">
                          <span className="shrink-0 whitespace-nowrap text-[13px] lg:text-[15px] font-semibold tracking-[0.06em] font-en" style={{ color: ACCENT }}>{c.code}</span>
                          <span className={H_DISPLAY_CARD} style={{ color: INK_900 }}>{c.name}</span>
                          <span className={T_SMALL} style={{ color: GRAY_500 }}>{c.target}</span>
                        </div>
                        <span
                          className="shrink-0 inline-flex items-center justify-center"
                          style={{ width: 32, height: 32, color: open ? ACCENT : INK_900, transition: 'color .3s ease' }}
                          aria-hidden="true"
                        >
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <line
                              x1="12" y1="5" x2="12" y2="19"
                              style={{
                                transformOrigin: '12px 12px',
                                transform: open ? 'scaleY(0)' : 'scaleY(1)',
                                transition: 'transform .35s cubic-bezier(.16,1,.3,1)',
                              }}
                            />
                          </svg>
                        </span>
                      </button>
                      <div
                        className="overflow-hidden"
                        style={{
                          maxHeight: open ? 640 : 0,
                          opacity: open ? 1 : 0,
                          transition: 'max-height .4s cubic-bezier(.16,1,.3,1), opacity .3s ease',
                        }}
                      >
                        <div className="pb-6 px-1 sm:pb-10 sm:px-8">
                          <div>
                            {c.levels.map(lv => (
                              <div key={lv.l} className="flex items-center justify-between gap-4 sm:gap-6 py-3 sm:py-4" style={{ borderColor: BORDER }}>
                                <strong className={`${H_CARD} font-en`} style={{ color: INK_900 }}>{lv.l}</strong>
                                <span className={`${T_LEAD} text-right`} style={{ color: GRAY_500 }}>{lv.d}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </section>

        {/* ── Evaluation (좌측 텍스트 + 우측 이미지) ── */}
        <section className={SECTION}>
          <div className={WRAP}>
            <div
              className="reveal overflow-hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6 sm:gap-8 lg:gap-10">

                <div className="flex flex-col">
                  <div>
                    <h2 className={`mb-5 sm:mb-10 ${H_SEC}`}>
                      {t('home.eval.title' as never)}
                    </h2>
                  </div>

                  <div className="mt-0 sm:mt-6 lg:mt-8 space-y-4 sm:space-y-5 lg:space-y-6">
                    {[
                      { level: 'L3', title: t('home.eval.l3.title' as never), desc: t('home.eval.l3.desc' as never) },
                      { level: 'L2', title: t('home.eval.l2.title' as never), desc: t('home.eval.l2.desc' as never) },
                      { level: 'L1', title: t('home.eval.l1.title' as never), desc: t('home.eval.l1.desc' as never) },
                    ].map(e => (
                      <div key={e.level}>
                        <div className={H_CARD} style={{ color: INK_900 }}>
                          {e.title}<span className="ml-1">({e.level})</span>
                        </div>
                        <p className={`mt-1 ${T_BODY} whitespace-normal lg:whitespace-pre-line`} style={{ color: GRAY_500 }}>{e.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 우측: 이미지 */}
                <div className="flex items-end justify-center">
                  <img
                    src={evaluationImage}
                    alt={t('home.eval.diagram.alt' as never)}
                    className="w-full h-auto max-w-[540px]"
                    style={{ objectFit: 'contain' }}
                  />
                </div>

              </div>
            </div>
          </div>
        </section>

        {/* ── Pass Announcements ── */}
        <section className={SECTION} style={{ background: SURFACE_ALT }}>
          <div className={WRAP}>
            <div className="flex flex-wrap items-end justify-between gap-6 reveal">
              <div className="max-w-205">
                <h2 className={`${H_SEC} mt-0 sm:mt-4`} style={{ color: INK_900 }}>{t('home.results.title')}</h2>
                <p className={`${T_LEAD} mt-3 sm:mt-5`} style={{ color: GRAY_500 }}>{t('home.results.sub' as never)}</p>
              </div>
              <MoreLink to="/results">{t('home.results.more' as never)}</MoreLink>
            </div>

            <div className="mt-5 sm:mt-10 space-y-2.5 sm:space-y-3">
              {passRounds.length === 0 ? (
                passRoundsLoaded && (
                  <p className={`${T_BODY} text-center py-10`} style={{ color: GRAY_300 }}>
                    {t('home.results.empty' as never)}
                  </p>
                )
              ) : (
                passRounds.map((r) => {
                  const announced = r.publicationState === 'announced';
                  const round = t('results.round' as never, { n: r.roundNumber });
                  return (
                    <ScheduleRow
                      key={r.scheduleId}
                      status={announced ? t('home.results.status.done' as never) : t('home.results.status.grading' as never)}
                      statusColor={announced ? '#059669' : '#D97706'}
                      title={formatRoundCertTitle(r.certType, r.level)}
                      meta={
                        announced
                          ? t('home.results.meta.done' as never, { round, date: formatExamDateKst(r.examDate) })
                          : t('home.results.meta.grading' as never, { round })
                      }
                      sub=""
                      cta={
                        announced ? (
                          <Link to="/results" className="inline-flex items-center justify-center h-10 sm:h-12 min-w-0 sm:min-w-29.5 px-5 sm:px-6 rounded-[10px] text-[14px] sm:text-[16px] lg:text-[17px] font-semibold bg-blue-700" style={{ color: '#fff' }}>{t('home.results.cta.view' as never)}</Link>
                        ) : (
                          <span className="inline-flex items-center justify-center h-10 sm:h-12 min-w-0 sm:min-w-29.5 px-5 sm:px-6 rounded-[10px] text-[14px] sm:text-[16px] lg:text-[17px] font-semibold bg-gray-200 text-gray-500" style={{ color: '#fff' }}>{t('home.results.cta.pending' as never)}</span>
                        )
                      }
                    />
                  );
                })
              )}
            </div>

          </div>
        </section>

        {/* ── Notices ── */}
        <section className={SECTION}>
          <div className={WRAP}>
            <div className="flex flex-wrap items-end justify-between gap-6 reveal">
              <div>
                <h2 className={`${H_SEC} mt-0 sm:mt-4`} style={{ color: INK_900 }}>{t('home.notices.title' as never)}</h2>
              </div>
              <MoreLink to="/qna?tab=notice">{t('home.notices.more' as never)}</MoreLink>
            </div>

            <div className="mt-6 sm:mt-12 lg:mt-16">
              {homeNotices.length === 0 ? (
                <p className={`${T_BODY} text-center py-10`} style={{ color: GRAY_300 }}>
                  {t('home.notices.empty' as never)}
                </p>
              ) : (
                <NoticeAccordion
                  notices={homeNotices}
                  openIds={openNoticeIds}
                  onToggle={toggleHomeNotice}
                  variant="home"
                />
              )}
            </div>
          </div>
        </section>

      </div>

      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   More link — outlined pill 버튼 ("전체 X 보기 →")
   호버 시 검정 배경 + 흰 글자로 invert. 화살표는 살짝 우측 이동.
   ───────────────────────────────────────────────────────────── */
function MoreLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1.5 sm:gap-2 h-9 sm:h-11 lg:h-12 px-3.5 sm:px-5 lg:px-6 rounded-full text-[13px] sm:text-[14px] lg:text-[15px] font-semibold border-2 transition-colors border-[#191919] text-[#191919] bg-white hover:bg-black hover:!text-white"
    >
      <span className="group-hover:text-white">{children}</span>
      <svg
        className="transition-transform group-hover:translate-x-0.5 group-hover:text-white"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────
   Pill button (50px radius)
   ───────────────────────────────────────────────────────────── */
function PillButton({
  children,
  onClick,
  tone,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: 'dark' | 'ghost' | 'light' | 'ghost-light' | 'demo';
  className?: string;
}) {
  const styles: Record<typeof tone, React.CSSProperties> = {
    dark: { background: INK_900, color: '#fff', border: `1px solid ${INK_900}` },
    ghost: { background: 'transparent', color: INK_900, border: `1px solid ${INK_900}` },
    light: { background: '#fff', color: INK_900, border: '1px solid #fff' },
    'ghost-light': { background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)' },
    demo: {
      background: 'rgba(37, 99, 235, 0.22)',
      color: '#fff',
      border: '1px solid rgba(147, 197, 253, 0.55)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      boxShadow: '0 8px 28px rgba(37, 99, 235, 0.18)',
    },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 h-13 px-7 text-[16px] font-semibold transition-all touch-manipulation ${
        tone === 'demo' ? 'hover:bg-[rgba(37,99,235,0.34)] hover:border-[rgba(191,219,254,0.75)]' : 'hover:opacity-90'
      } ${className}`}
      style={{ borderRadius: 50, ...styles[tone] }}
    >
      {children}
    </button>
  );
}

/** Small play-circle icon for the hero demo CTA. */
function HeroDemoIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────
   Schedule row (사용처: 시험 일정 / 합격 발표)
   ───────────────────────────────────────────────────────────── */
function ScheduleRow({
  status, statusColor, title, meta, sub, cta,
}: {
  status: string; statusColor: string; title: string; meta: string; sub: string; cta: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 p-4 sm:p-6 lg:p-8 reveal"
      style={{ background: SURFACE, borderRadius: 20, border: `1px solid ${BORDER}` }}
    >
      <span className={`shrink-0 sm:min-w-24 ${T_SMALL} font-semibold`} style={{ color: statusColor }}>{status}</span>
      <div className="flex-1 min-w-0">
        <div className={H_CARD} style={{ color: INK_900 }}>
          {title}{' '}
          <span className="font-normal break-keep" style={{ color: GRAY_500 }}>· {meta}</span>
        </div>
        {sub && <div className={`${T_SMALL} mt-1.5 sm:mt-2`} style={{ color: GRAY_300 }}>{sub}</div>}
      </div>
      <div className="shrink-0">{cta}</div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   QuickLink icons — 검정 배경 위 흰 라인 아이콘
   ───────────────────────────────────────────────────────────── */
type QuickLinkIconName = 'guide' | 'apply' | 'announce' | 'verify';

function QuickLinkIcon({ name }: { name: QuickLinkIconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'guide':
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
          <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
          <path d="M8 7h8M8 10h6" />
        </svg>
      );
    case 'apply':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case 'announce':
      return (
        <svg {...common}>
          <path d="M6 9a3 3 0 0 0 0 6h2l5 4V5L8 9H6z" />
          <path d="M16 8a4.5 4.5 0 0 1 0 8" />
        </svg>
      );
    case 'verify':
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
  }
}

/* ─────────────────────────────────────────────────────────────
   Security Process icons — 검정 라인 아이콘 (배경 없음)
   ───────────────────────────────────────────────────────────── */
type SecurityIconName = 'nice' | 'idcard' | 'face' | 'monitor' | 'alert';

function SecurityIcon({ name }: { name: SecurityIconName }) {
  const common = {
    width: 36,
    height: 36,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'nice':
      return (
        <svg {...common}>
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18h2" />
          <path d="M9 7h6M9 10h6M9 13h4" />
        </svg>
      );
    case 'idcard':
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <circle cx="8" cy="11.5" r="2" />
          <path d="M6 16.5c.5-1.4 1.8-2.2 2.5-2.2s2 .8 2.5 2.2" />
          <path d="M14 10h5M14 13h4M14 16h3" />
        </svg>
      );
    case 'face':
      return (
        <svg {...common}>
          <path d="M5 8V6.5A1.5 1.5 0 0 1 6.5 5H8" />
          <path d="M16 5h1.5A1.5 1.5 0 0 1 19 6.5V8" />
          <path d="M5 16v1.5A1.5 1.5 0 0 0 6.5 19H8" />
          <path d="M16 19h1.5a1.5 1.5 0 0 0 1.5-1.5V16" />
          <circle cx="9.5" cy="11" r="0.6" fill="currentColor" />
          <circle cx="14.5" cy="11" r="0.6" fill="currentColor" />
          <path d="M9.5 15c.7.7 1.6 1 2.5 1s1.8-.3 2.5-1" />
        </svg>
      );
    case 'monitor':
      return (
        <svg {...common}>
          <path d="M1.5 12s3.5-7 10.5-7 10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}
