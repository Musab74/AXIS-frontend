import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/i18n';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import { SiteFooter } from '@/components/marketing/SiteFooter';
import { PageHeroSolid } from '@/components/marketing/PageHeroSolid';
import { PageTabs } from '@/components/marketing/PageTabs';
import { INFO_PDF_MAP, type InfoPdfId } from '@/constants/infoPdfDocuments';
import { openPublicPdf } from '@/utils/openPublicPdf';
import ctaBg from '@/assets/cta-bg.jpg';

type CertTab = 'axis' | 'axis-c' | 'axis-h';

const CERT_LABELS: Record<CertTab, string> = {
  axis: 'AXIS',
  'axis-c': 'AXIS-C',
  'axis-h': 'AXIS-H',
};

/* ─────────────────────────────────────────────────────────────
   Design tokens — AboutPage와 동일 (콘텐츠 페이지 공통)
   ───────────────────────────────────────────────────────────── */
const INK_900 = '#191919';
const GRAY_500 = '#525252';

const H_CARD = 'text-[21px] lg:text-[26px] font-semibold leading-[1.3] tracking-[-0.02em]';
const T_BODY = 'text-[16px] lg:text-[19px] leading-[1.85] tracking-[-0.005em] whitespace-pre-line';
const T_SUB = 'text-[15px] lg:text-[17px] leading-[1.6] whitespace-pre-line';
const TABLE_WRAP =
  'w-full overflow-x-auto border-t-2 border-ink mt-4 mb-2 ' +
  '[&_th]:!text-[14px] lg:[&_th]:!text-[15px] ' +
  '[&_td]:!text-[16px] lg:[&_td]:!text-[18px] [&_td]:!leading-[1.7]';

interface LevelRow {
  level: string;
  target: string;
  questions: string;
  time: string;
  passing: string;
}

interface ScopeItem {
  title: string;
  details: string[];
}

interface FaqItem {
  q: string;
  a: string;
}

interface ExamGuide {
  title: string;
  body: string;
  rows: Array<{ id: string; label: string }>;
}

interface CertContent {
  overview: string;
  levels: LevelRow[];
  levelsFootnote?: string;
  scope: ScopeItem[];
  scopeNotice?: string;
  examGuide?: ExamGuide;
  faq: FaqItem[];
}

// Content is structured (tables, card grids, accordions), so it lives here as a
// per-language data map instead of ~200 flat i18n keys; UI chrome labels still
// go through the i18n dictionaries.
const CERT_DATA: Record<'ko' | 'en', Record<CertTab, CertContent>> = {
  ko: {
  axis: {
    overview:
      'AXIS(AI eXecution & Integrity Standard)는 AI로 실제 업무를 수행하고(eXecution), 그 결과를 검증·통제하는(Integrity) 역량을 평가하는 표준 자격입니다.\n프롬프트 엔지니어링, 데이터 분석, AI 도구 활용 등 현업에서 요구되는 핵심 역량을 검증합니다.',
    levels: [
      { level: 'L3 (Starter)', target: 'AI 입문자·대학생', questions: '객관식 40 + 실습 4', time: '70분', passing: '70점 이상' },
      { level: 'L2 (Practitioner)', target: '실무 2년 이상', questions: '사례형 객관식 30 + 실습 3과제', time: '90분', passing: '70점 이상' },
      { level: 'L1 (Leader)', target: '리더·아키텍트', questions: '객관식 25 + 실행계획서 + 서술형 2', time: '120분', passing: '70점 이상' },
    ],
    levelsFootnote: '※ 합격은 총점 70점 이상이며 영역별 최저기준(객관식·실습형)을 모두 충족해야 합니다. 경계 점수는 전문가 검수를 거쳐 확정됩니다.',
    scope: [
      { title: 'AI 현실 이해와 한계 판단', details: ['할루시네이션, 최신성 한계, 검증 필요성', '5문항'] },
      { title: '업무문제 정의와 AI 적용·도구 선택', details: ['AI 적용 여부, 입력자료, 도구 선택', '6문항'] },
      { title: 'AI 지시·맥락·대화 설계', details: ['역할·목적·조건·출력형식 프롬프트 설계', '7문항'] },
      { title: 'AI 산출물 검증과 품질관리', details: ['오류·누락·논리비약·과장 식별', '8문항'] },
      { title: '업무 산출물 수정·적용', details: ['보고서·회의록·안내문 개선', '6문항'] },
      { title: '보안·개인정보·저작권·윤리', details: ['입력 금지 정보, 저작권, 책임 소재 판단', '8문항'] },
    ],
    examGuide: {
      title: 'AXIS 수험 가이드',
      body: '시험 범위와 출제 유형, 준비 방향을 담은 공식 수험 가이드입니다. 등급별로 확인하세요.',
      rows: [
        { id: 'axis-l3', label: 'AXIS L3 수험 가이드' },
        { id: 'axis-l2', label: 'AXIS L2 수험 가이드' },
        { id: 'axis-l1', label: 'AXIS L1 수험 가이드' },
      ],
    },
    faq: [
      { q: 'AXIS 자격증의 유효기간은 어떻게 되나요?', a: '취득일로부터 3년 유효하며, 무상 보수교육 이수 또는 상위 등급 취득으로 갱신할 수 있습니다.' },
      { q: '시험 결과는 언제 확인할 수 있나요?', a: '시험 종료 직후 가채점 확인. 공식 성적은 L3 1시간·L2 3일·L1 7일 이내 공개. 합격자 발표 페이지에서 접수번호로 조회하거나 마이페이지에서 확인.' },
      { q: '재시험 응시 제한이 있나요?', a: '동일 레벨 재응시는 이전 시험일로부터 14일 이후 가능합니다.' },
      { q: 'L3 없이 바로 L2를 응시할 수 있나요?', a: '네, 각 레벨은 독립적으로 응시 가능합니다. 다만 L1은 L2 취득 후 응시를 권장합니다.' },
    ],
  },
  'axis-c': {
    overview:
      'AXIS-C는 코딩 전문가가 아니어도 AI 도구로 업무를 자동화하고, AI가 생성한 코드를 이해·검증·관리하는 역량을 검증하는 자격입니다.\n복잡한 프로그래밍이 아니라, 반복 업무를 자동화 과제로 구조화하고 AI 코드의 오류와 위험을 판단하는 실무 능력을 평가합니다.',
    levels: [
      { level: 'L3 (Starter)', target: '자동화에 입문하는 현업 실무자', questions: '객관식 40 + 실습 4', time: '70분', passing: '70점 이상' },
      { level: 'L2 (Practitioner)', target: '업무 자동화를 구현하는 실무자', questions: '사례형 객관식 30 + 실습 3과제', time: '120분', passing: '70점 이상' },
      { level: 'L1 (Leader)', target: '자동화 운영·거버넌스 담당자', questions: '객관식 25 + 실행계획서 + 서술형 2', time: '120분', passing: '70점 이상' },
    ],
    levelsFootnote: '※ 합격은 총점 70점 이상, 실습형 최소기준 미달 시 별도 검토. (L2 시험시간은 AXIS-C만 120분)',
    scope: [
      { title: 'AI 코딩 현실 이해와 한계 판단', details: ['코드 생성 한계, 라이브러리 오류, 할루시네이션 코드', '5문항'] },
      { title: '자동화 업무문제 정의와 도구·환경 선택', details: ['노코드·스크립트·API 사용 판단', '6문항'] },
      { title: '코드 요청·프롬프트 설계', details: ['요구사항·입출력·제약·테스트 조건을 AI에 지시', '6문항'] },
      { title: '코드 읽기와 실행흐름 이해', details: ['코드 목적·변수·함수 역할·구조 이해', '8문항'] },
      { title: '오류·테스트·검증 판단', details: ['오류 메시지·테스트 결과 해석', '7문항'] },
      { title: '보안·라이선스·데이터 리스크 관리', details: ['비밀키 노출·개인정보·권한 초과 판단', '8문항'] },
    ],
    examGuide: {
      title: 'AXIS-C 수험 가이드',
      body: '코딩·자동화 실무 검정의 출제 범위와 준비 방향을 담은 공식 수험 가이드입니다. 등급별로 확인하세요.',
      rows: [
        { id: 'axis-c-l3', label: 'AXIS-C L3 수험 가이드' },
        { id: 'axis-c-l2', label: 'AXIS-C L2 수험 가이드' },
        { id: 'axis-c-l1', label: 'AXIS-C L1 수험 가이드' },
      ],
    },
    faq: [
      { q: '개발자가 아니어도 응시할 수 있나요?', a: '네. AXIS-C는 개발자를 위한 코딩 시험이 아닙니다. 코딩 전문가가 아니어도 AI 도구로 업무를 자동화하고, AI가 만든 코드를 읽고 검증하는 역량을 평가합니다. 복잡한 프로그래밍이나 개발 경력 없이도 응시할 수 있습니다.' },
      { q: '특정 프로그래밍 언어를 알아야 하나요?', a: '문법 암기를 요구하지 않습니다. 문제는 언어에 구애받지 않는 코드 읽기와 판단 위주로 출제되며, 일부 실습은 Python 등의 짧은 코드를 읽고 오류·위험을 판단하는 형태입니다.' },
      { q: 'AXIS 자격 없이 AXIS-C만 응시할 수 있나요?', a: '네, AXIS-C는 독립 자격으로 별도 응시 가능합니다.' },
      { q: '실습 환경이 제공되나요?', a: 'L2 이상은 브라우저 기반 환경에서 실습형 문항이 일부 포함됩니다. 코드를 처음부터 작성하기보다, 주어진 코드를 분석·수정·검증하는 방식입니다.' },
    ],
  },
  'axis-h': {
    overview:
      'AXIS-H는 의료기관 종사자가 원무·CS·감염안전·홍보 같은 비임상 업무에 AI를 활용하는 역량을 검증하는 자격입니다.\n진단·치료·처방·검사 판단 같은 임상 의료행위는 평가하지 않으며, 환자정보 보호와 의료행위 오인 차단을 핵심으로 봅니다.',
    levels: [
      { level: 'L3 (Starter)', target: '비임상 실무 입문자', questions: '객관식 40 + 실습 4', time: '70분', passing: '70점 이상' },
      { level: 'L2 (Practitioner)', target: '비임상 실무자', questions: '사례형 객관식 30 + 실습 3과제', time: '90분', passing: '70점 이상' },
      { level: 'L1 (Leader)', target: '의료기관 AI 도입 리더', questions: '객관식 25 + 실행계획서 + 서술형 2', time: '120분', passing: '70점 이상' },
    ],
    scope: [
      { title: '의료기관 AI 현실 이해와 한계 판단', details: ['기관 지침과 AI 답변의 차이, 검증 필요성', '5문항'] },
      { title: '비임상 업무문제 정의와 AI 적용·도구 선택', details: ['환자 안내·원무 문의·교육자료 적용 판단', '6문항'] },
      { title: '의료기관 AI 지시·맥락·대화 설계', details: ['환자정보 제외·진단 판단 금지를 명시한 지시', '7문항'] },
      { title: '의료기관 AI 산출물 검증과 품질관리', details: ['허위안심·과장·진료 안내 오류·지침 불일치 식별', '8문항'] },
      { title: '비임상 산출물 수정·적용', details: ['원무 안내문·CS 스크립트·감염안전 캠페인 개선', '6문항'] },
      { title: '환자정보·의료윤리·보안·저작권 리스크', details: ['개인식별정보·진단 오인·의료광고성 표현 금지', '8문항'] },
    ],
    scopeNotice:
      '⛔ AXIS-H에 나오지 않는 것 : 진단·치료·처방·검사 판단 등 임상 의료행위는 어떤 문항·실습에서도 출제되지 않습니다. 환자 문의에 증상이 등장해도 정답은 항상 "의료진 상담 안내"로 귀결됩니다.',
    examGuide: {
      title: 'AXIS-H 수험 가이드',
      body: '의료기관 비임상 업무 검정의 출제 범위와 준비 방향을 담은 공식 수험 가이드입니다. 등급별로 확인하세요.',
      rows: [
        { id: 'axis-h-l3', label: 'AXIS-H L3 수험 가이드' },
        { id: 'axis-h-l2', label: 'AXIS-H L2 수험 가이드' },
        { id: 'axis-h-l1', label: 'AXIS-H L1 수험 가이드' },
      ],
    },
    faq: [
      { q: '진단이나 처방 같은 임상 내용이 시험에 나오나요?', a: '아니요. AXIS-H는 진단·치료·처방·검사 판단 같은 임상 의료행위를 어떤 문항에서도 다루지 않습니다. 환자 문의에 증상이 등장하더라도 정답은 항상 "의료진 상담으로 안전하게 안내"하는 방향이며, 환자정보 보호와 의료행위 오인 차단을 평가합니다.' },
      { q: '의료인이 아니어도 응시할 수 있나요?', a: '네, 의료 정보 전공자, 헬스테크 종사자 등 의료 AI에 관심 있는 분이면 누구나 응시 가능합니다.' },
      { q: '임상 경험이 필수인가요?', a: 'L3는 임상 경험 불요, L2 이상은 헬스케어 도메인 지식이 필요하나 반드시 임상 경력일 필요는 없습니다.' },
      { q: 'AXIS-H는 의료 자격증인가요?', a: '아닙니다. AXIS-H는 의료 행위 자격이 아닌 AI 활용 역량 인증입니다.' },
    ],
  },
  },
  en: {
  axis: {
    overview:
      'AXIS (AI eXecution & Integrity Standard) is a standard certification that assesses your ability to execute real work with AI (eXecution) and to verify and control the results (Integrity).\nIt validates the core competencies today’s workplace demands, including prompt engineering, data analysis, and effective use of AI tools.',
    levels: [
      { level: 'L3 (Starter)', target: 'AI beginners & university students', questions: '40 MCQ + 4 practical', time: '70 min', passing: '70 or above' },
      { level: 'L2 (Practitioner)', target: '2+ years of work experience', questions: '30 case-based MCQ + 3 practical tasks', time: '90 min', passing: '70 or above' },
      { level: 'L1 (Leader)', target: 'Leaders & architects', questions: '25 MCQ + action plan + 2 essays', time: '120 min', passing: '70 or above' },
    ],
    levelsFootnote: '※ Passing requires a total score of 70 or above; practical work below the minimum standard is reviewed separately.',
    scope: [
      { title: 'Understanding AI realities and limits', details: ['Hallucination, recency limits, need for verification', '5 questions'] },
      { title: 'Defining work problems, choosing AI & tools', details: ['When to apply AI, input data, tool selection', '6 questions'] },
      { title: 'Designing AI instructions, context & dialogue', details: ['Prompts with role, goal, constraints, output format', '7 questions'] },
      { title: 'Verifying AI output & quality control', details: ['Spotting errors, omissions, logical leaps, exaggeration', '8 questions'] },
      { title: 'Revising & applying work deliverables', details: ['Improving reports, minutes, and notices', '6 questions'] },
      { title: 'Security, privacy, copyright & ethics', details: ['Prohibited inputs, copyright, accountability', '8 questions'] },
    ],
    examGuide: {
      title: 'AXIS Exam Guide',
      body: 'The official exam guide covering scope, question types, and how to prepare. Check the guide for your level.',
      rows: [
        { id: 'axis-l3', label: 'AXIS L3 Exam Guide' },
        { id: 'axis-l2', label: 'AXIS L2 Exam Guide' },
        { id: 'axis-l1', label: 'AXIS L1 Exam Guide' },
      ],
    },
    faq: [
      { q: 'How long is an AXIS certificate valid?', a: 'It is valid for 3 years from the issue date, renewable through free refresher training or by earning a higher level.' },
      { q: 'When can I see my exam results?', a: 'A provisional score appears right after the exam. Official results are released within 1 hour (L3), 3 days (L2), or 7 days (L1). Look them up with your registration number on the Results page, or in My Page.' },
      { q: 'Is there a limit on retakes?', a: 'You can retake the same level 14 days after your previous exam date.' },
      { q: 'Can I take L2 without L3?', a: 'Yes — each level can be taken independently. For L1, we recommend earning L2 first.' },
    ],
  },
  'axis-c': {
    overview:
      'AXIS-C certifies your ability to automate work with AI tools and to understand, verify, and manage AI-generated code — no professional coding background required.\nRather than complex programming, it assesses the practical skills of structuring repetitive work into automation tasks and judging the errors and risks in AI-written code.',
    levels: [
      { level: 'L3 (Starter)', target: 'Practitioners new to automation', questions: '40 MCQ + 4 practical', time: '70 min', passing: '70 or above' },
      { level: 'L2 (Practitioner)', target: 'Practitioners building work automation', questions: '30 case-based MCQ + 3 practical tasks', time: '120 min', passing: '70 or above' },
      { level: 'L1 (Leader)', target: 'Automation operations & governance leads', questions: '25 MCQ + action plan + 2 essays', time: '120 min', passing: '70 or above' },
    ],
    levelsFootnote: '※ Passing requires a total score of 70 or above; practical work below the minimum standard is reviewed separately. (The L2 exam is 120 min for AXIS-C only.)',
    scope: [
      { title: 'Understanding AI coding realities and limits', details: ['Code-generation limits, library errors, hallucinated code', '5 questions'] },
      { title: 'Defining automation problems, choosing tools & environments', details: ['Judging when to use no-code, scripts, or APIs', '6 questions'] },
      { title: 'Designing code requests & prompts', details: ['Instructing AI with requirements, I/O, constraints, test conditions', '6 questions'] },
      { title: 'Reading code & understanding execution flow', details: ['Purpose, variables, function roles, structure', '8 questions'] },
      { title: 'Judging errors, tests & verification', details: ['Interpreting error messages and test results', '7 questions'] },
      { title: 'Managing security, license & data risks', details: ['Exposed secrets, personal data, excess permissions', '8 questions'] },
    ],
    examGuide: {
      title: 'AXIS-C Exam Guide',
      body: 'The official exam guide for the coding & automation track — scope, question types, and preparation tips by level.',
      rows: [
        { id: 'axis-c-l3', label: 'AXIS-C L3 Exam Guide' },
        { id: 'axis-c-l2', label: 'AXIS-C L2 Exam Guide' },
        { id: 'axis-c-l1', label: 'AXIS-C L1 Exam Guide' },
      ],
    },
    faq: [
      { q: 'Can I take it without being a developer?', a: 'Yes. AXIS-C is not a coding exam for developers. It assesses automating work with AI tools and reading and verifying AI-written code — no programming career or complex coding required.' },
      { q: 'Do I need to know a specific programming language?', a: 'No syntax memorization is required. Questions focus on language-agnostic code reading and judgment; some practical items involve reading short code (e.g. Python) to spot errors and risks.' },
      { q: 'Can I take AXIS-C without the AXIS certificate?', a: 'Yes — AXIS-C is an independent certification you can take on its own.' },
      { q: 'Is a practice environment provided?', a: 'L2 and above include some browser-based practical items. You analyze, fix, and verify given code rather than writing it from scratch.' },
    ],
  },
  'axis-h': {
    overview:
      'AXIS-H certifies healthcare staff in using AI for non-clinical work such as administration, customer service, infection safety, and communications.\nIt never assesses clinical acts like diagnosis, treatment, prescription, or test interpretation — protecting patient data and preventing anything being mistaken for medical practice are at its core.',
    levels: [
      { level: 'L3 (Starter)', target: 'Newcomers to non-clinical work', questions: '40 MCQ + 4 practical', time: '70 min', passing: '70 or above' },
      { level: 'L2 (Practitioner)', target: 'Non-clinical practitioners', questions: '30 case-based MCQ + 3 practical tasks', time: '90 min', passing: '70 or above' },
      { level: 'L1 (Leader)', target: 'Leaders driving AI adoption in healthcare', questions: '25 MCQ + action plan + 2 essays', time: '120 min', passing: '70 or above' },
    ],
    scope: [
      { title: 'Understanding AI realities and limits in healthcare', details: ['Gaps between institutional policy and AI answers, need for verification', '5 questions'] },
      { title: 'Defining non-clinical problems, choosing AI & tools', details: ['Patient guidance, admin inquiries, training materials', '6 questions'] },
      { title: 'Designing AI instructions & dialogue for healthcare', details: ['Instructions that exclude patient data and forbid diagnostic judgment', '7 questions'] },
      { title: 'Verifying AI output & quality control', details: ['Spotting false reassurance, exaggeration, care-guidance errors, policy mismatches', '8 questions'] },
      { title: 'Revising & applying non-clinical deliverables', details: ['Improving admin notices, CS scripts, infection-safety campaigns', '6 questions'] },
      { title: 'Patient data, medical ethics, security & copyright risks', details: ['No personally identifiable info, diagnosis confusion, or medical-ad wording', '8 questions'] },
    ],
    scopeNotice:
      '⛔ Not on AXIS-H: clinical acts such as diagnosis, treatment, prescription, or test interpretation never appear in any question or practical task. Even when symptoms come up in a patient inquiry, the correct answer always resolves to referring the patient to medical staff.',
    examGuide: {
      title: 'AXIS-H Exam Guide',
      body: 'The official exam guide for the non-clinical healthcare track — scope, question types, and preparation tips by level.',
      rows: [
        { id: 'axis-h-l3', label: 'AXIS-H L3 Exam Guide' },
        { id: 'axis-h-l2', label: 'AXIS-H L2 Exam Guide' },
        { id: 'axis-h-l1', label: 'AXIS-H L1 Exam Guide' },
      ],
    },
    faq: [
      { q: 'Does the exam include clinical content like diagnosis or prescriptions?', a: 'No. AXIS-H never covers clinical acts such as diagnosis, treatment, prescription, or test interpretation in any question. Even when symptoms appear in a patient inquiry, the correct answer always routes the patient safely to medical staff — the exam assesses patient-data protection and preventing confusion with medical practice.' },
      { q: 'Can non-medical professionals take it?', a: 'Yes — anyone interested in healthcare AI can take it, including health-informatics majors and healthtech workers.' },
      { q: 'Is clinical experience required?', a: 'L3 requires none. L2 and above call for healthcare-domain knowledge, but not necessarily clinical experience.' },
      { q: 'Is AXIS-H a medical license?', a: 'No. AXIS-H certifies AI competency — it is not a license to practice medicine.' },
    ],
  },
  },
};

export default function CertGuidePage() {
  const { t, lang } = useI18n();
  const [searchParams] = useSearchParams();
  const initialCert = (searchParams.get('cert') as CertTab) || 'axis';
  const [activeTab, setActiveTab] = useState<CertTab>(
    ['axis', 'axis-c', 'axis-h'].includes(initialCert) ? initialCert : 'axis',
  );
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 },
    );

    const container = revealRef.current;
    if (container) {
      container.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
    }

    return () => observer.disconnect();
  }, [activeTab]);

  useEffect(() => {
    setOpenFaq(null);
  }, [activeTab]);

  const data = CERT_DATA[lang][activeTab];
  const openInfoPdf = (pdfId: InfoPdfId) => openPublicPdf(INFO_PDF_MAP[pdfId].url);

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'var(--font-sans)' }}>
      <SiteHeader active="guide" />

      <PageHeroSolid
        title={t('gnb.guide')}
        subtitle={t('certGuide.hero.subtitle' as never)}
      />

      <PageTabs
        tabs={(['axis', 'axis-c', 'axis-h'] as CertTab[]).map((c) => ({ key: c, label: CERT_LABELS[c] }))}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
      />

      <main ref={revealRef} className="mx-auto py-16 px-5 sm:px-6 lg:px-8" style={{ maxWidth: 'var(--spacing-content-w)' }}>

        {/* Overview */}
        <section className="mb-14 reveal">
          <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>
            {t('certGuide.overviewTitle' as never, { cert: CERT_LABELS[activeTab] })}
          </h2>
          <p className={T_BODY} style={{ color: GRAY_500 }}>{data.overview}</p>
        </section>
        <div className="w-10 h-px bg-border mb-14" />

        {/* Exam guide — 등급별 수험 가이드 (바로보기 / 다운로드받기) */}
        {data.examGuide && (
          <>
            <section className="mb-14 reveal">
              <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{data.examGuide.title}</h2>
              <p className={`${T_BODY} mb-6`} style={{ color: GRAY_500 }}>{data.examGuide.body}</p>
              <div className="border-t-2 border-ink mt-4">
                {data.examGuide.rows.map((row) => {
                  const pdf = INFO_PDF_MAP[row.id as InfoPdfId];
                  return (
                  <div
                    key={row.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-5"
                    style={{ borderBottom: '1px solid #1B1B1B' }}
                  >
                    <span
                      className="text-[16px] lg:text-[18px] font-semibold tracking-[-0.015em]"
                      style={{ color: INK_900 }}
                    >
                      {row.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openInfoPdf(row.id as InfoPdfId)}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-blue-600 bg-white px-5 text-[14px] font-semibold text-blue-700 transition-colors hover:bg-blue-50"
                      >
                        {t('certGuide.view' as never)}
                      </button>
                      <a
                        href={pdf.url}
                        download={pdf.downloadName}
                        className="inline-flex h-10 items-center justify-center rounded-full border border-[#D1D5DB] bg-white px-5 text-[14px] font-semibold text-[#374151] no-underline transition-colors hover:bg-[#F9FAFB]"
                      >
                        {t('certGuide.download' as never)}
                      </a>
                    </div>
                  </div>
                  );
                })}
              </div>
            </section>
            <div className="w-10 h-px  mb-14" />
          </>
        )}

        {/* Level table */}
        <section className="mb-14 reveal">
          <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{t('certGuide.levels.title' as never)}</h2>
          <div className={`${TABLE_WRAP} hidden md:block`}>
            <table className="data-table" style={{ minWidth: 500 }}>
              <thead>
                <tr>
                  <th>{t('certGuide.levels.th.level' as never)}</th>
                  <th>{t('certGuide.levels.th.target' as never)}</th>
                  <th>{t('certGuide.levels.th.questions' as never)}</th>
                  <th>{t('certGuide.levels.th.time' as never)}</th>
                  <th>{t('certGuide.levels.th.passing' as never)}</th>
                </tr>
              </thead>
              <tbody>
                {data.levels.map((row) => (
                  <tr key={row.level}>
                    <td><strong>{row.level}</strong></td>
                    <td>{row.target}</td>
                    <td>{row.questions}</td>
                    <td>{row.time}</td>
                    <td>{row.passing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden mt-4 flex flex-col gap-3 break-keep">
            {data.levels.map((row) => (
              <div key={row.level} className="rounded-lg border border-[#e5e7eb] p-4">
                <strong
                  className="block text-[17px] font-semibold mb-3 pb-2 border-b border-[#f0f0f0]"
                  style={{ color: INK_900 }}
                >
                  {row.level}
                </strong>
                <dl className="flex flex-col gap-2">
                  {[
                    { k: t('certGuide.levels.th.target' as never), v: row.target },
                    { k: t('certGuide.levels.th.questions' as never), v: row.questions },
                    { k: t('certGuide.levels.th.time' as never), v: row.time },
                    { k: t('certGuide.levels.th.passing' as never), v: row.passing },
                  ].map((field) => (
                    <div key={field.k} className="flex gap-3">
                      <dt className="shrink-0 w-[78px] text-[13px] font-medium pt-0.5" style={{ color: '#737373' }}>
                        {field.k}
                      </dt>
                      <dd className="flex-1 min-w-0 text-[15px] leading-[1.6] m-0" style={{ color: GRAY_500 }}>
                        {field.v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          {data.levelsFootnote && (
            <p className={`mt-3 ${T_SUB}`} style={{ color: GRAY_500 }}>{data.levelsFootnote}</p>
          )}
        </section>
        <div className="w-10 h-px bg-border mb-14" />


        {/* Scope */}
        <section className="mb-14 reveal">
          <h2 className={`${H_CARD} mb-4`} style={{ color: INK_900 }}>{t('certGuide.scope.title' as never)}</h2>
          <p className={`${T_BODY} mb-8 lg:mb-10`} style={{ color: GRAY_500 }}>
            {t('certGuide.scope.desc' as never, { n: data.scope.length })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10 lg:gap-y-12">
            {data.scope.map((item, idx) => (
              <div key={item.title}>
                <div style={{ color: INK_900 }}>
                  <ScopeIcon index={idx} />
                </div>
                <h3
                  className="mt-5 text-[18px] lg:text-[20px] font-semibold leading-[1.3] tracking-[-0.015em]"
                  style={{ color: INK_900 }}
                >
                  {item.title}
                </h3>
                <p className={`mt-3 ${T_SUB}`} style={{ color: GRAY_500 }}>
                  {item.details.join('\n')}
                </p>
              </div>
            ))}
          </div>
          {data.scopeNotice && (
            <div
              className="mt-10 rounded-2xl px-6 py-5 lg:px-8 lg:py-6"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
              }}
            >
              <p
                className="text-[15px] lg:text-[17px] leading-[1.7] font-medium whitespace-pre-line m-0"
                style={{ color: '#B91C1C' }}
              >
                {data.scopeNotice}
              </p>
            </div>
          )}
        </section>
        <div className="w-10 h-px  mb-14" />


        {/* FAQ accordion */}
        <section className="mb-14 reveal">
          <h2 className={`${H_CARD} mb-10`} style={{ color: INK_900 }}>{t('certGuide.faq.title' as never)}</h2>
          <div className="mt-2" style={{ borderTop: `2px solid #1B1B1B` }}>
            {data.faq.map((item, idx) => (
              <div key={idx} style={{ borderBottom: `1px solid #1B1B1B` }}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                  className="flex w-full items-start justify-between gap-6 py-6 lg:py-7 text-left transition-colors bg-transparent border-none cursor-pointer"
                  style={{ fontFamily: 'inherit' }}
                  aria-expanded={openFaq === idx}
                >
                  <span className={`${T_SUB} font-semibold`} style={{ color: INK_900, fontSize: '18px' }}>
                    Q. {item.q}
                  </span>
                  <span
                    className="shrink-0 inline-flex items-center justify-center mt-1"
                    style={{ width: 28, height: 28, color: openFaq === idx ? INK_900 : GRAY_500 }}
                    aria-hidden="true"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <line
                        x1="12" y1="5" x2="12" y2="19"
                        style={{
                          transformOrigin: '12px 12px',
                          transform: openFaq === idx ? 'scaleY(0)' : 'scaleY(1)',
                          transition: 'transform .3s cubic-bezier(.16,1,.3,1)',
                        }}
                      />
                    </svg>
                  </span>
                </button>
                <div
                  className="overflow-hidden"
                  style={{
                    maxHeight: openFaq === idx ? 400 : 0,
                    opacity: openFaq === idx ? 1 : 0,
                    transition: 'max-height .35s cubic-bezier(.16,1,.3,1), opacity .25s ease',
                  }}
                >
                  <p className={`m-0 pb-6 lg:pb-8 ${T_BODY}`} style={{ color: GRAY_500 }}>
                    {item.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <div className="w-10 h-px  mb-14" />

        {/* CTA banner */}
        <section className="reveal">
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
              <p className="text-[19px] sm:text-[26px] lg:text-[34px] font-semibold leading-[1.4] sm:leading-[1.3] tracking-[-0.025em] text-white break-keep">
                {t('certGuide.cta.line1' as never)}<br />
                {t('certGuide.cta.line2' as never)}
              </p>
              <p className="mt-2.5 sm:mt-4 text-[14px] sm:text-[16px] lg:text-[19px] leading-[1.6] sm:leading-[1.85] tracking-[-0.005em] text-blue-100 break-keep">
                {t('certGuide.cta.sub' as never)}
              </p>
              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 sm:gap-3">
                <Link
                  to="/apply"
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-full bg-white px-6 sm:px-7 text-[15px] sm:text-[16px] font-semibold text-blue-700 transition-colors hover:bg-blue-50 touch-manipulation"
                >
                  {t('certGuide.cta.apply' as never)}
                </Link>
                <button
                  type="button"
                  onClick={() => openInfoPdf('axis-exam-info-b2c')}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-full border border-white/85 bg-transparent px-6 sm:px-7 text-[15px] sm:text-[16px] font-semibold !text-white hover:!text-white touch-manipulation"
                >
                  {t('certGuide.cta.info' as never)} · {t('certGuide.view' as never)}
                </button>
                <a
                  href={INFO_PDF_MAP['axis-exam-info-b2c'].url}
                  download={INFO_PDF_MAP['axis-exam-info-b2c'].downloadName}
                  className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center rounded-full border border-white/65 bg-white/10 px-6 sm:px-7 text-[15px] sm:text-[16px] font-semibold !text-white no-underline hover:bg-white/15 touch-manipulation"
                >
                  {t('certGuide.cta.info' as never)} · {t('certGuide.download' as never)}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Scope icons — 출제 범위 영역별 라인 아이콘
   ───────────────────────────────────────────────────────────── */
function ScopeIcon({ index }: { index: number }) {
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
  switch (index) {
    case 0:
      /* AI 기초 이론 — chip / 두뇌 노드 */
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="2" />
          <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 1:
      /* 프롬프트 엔지니어링 — 채팅+커서 */
      return (
        <svg {...common}>
          <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z" />
          <path d="M9 11h.01M12 11h.01M15 11h.01" />
        </svg>
      );
    case 2:
      /* AI 도구 활용 — 도구 + 톱니 */
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 1 0 5 5L21 13l-2 2-6-6 1.7-2.7z" />
          <path d="M13 9 4.7 17.3a2 2 0 1 0 2.8 2.8L16 12" />
          <circle cx="6" cy="18" r=".6" fill="currentColor" />
        </svg>
      );
    case 3:
      /* 데이터 리터러시 — 막대 차트 */
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="6" />
          <rect x="12" y="8" width="3" height="10" />
          <rect x="17" y="5" width="3" height="13" />
        </svg>
      );
    case 4:
      /* 업무 산출물 수정·적용 — 문서 + 펜 */
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M18.4 12.6a1.6 1.6 0 0 1 2.3 2.3L16 19.5l-3 .8.8-3 4.6-4.7z" />
        </svg>
      );
    case 5:
      /* 보안·개인정보·저작권·윤리 — 방패 + 잠금 */
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          <rect x="9.5" y="11" width="5" height="4" rx="1" />
          <path d="M10.5 11v-1a1.5 1.5 0 0 1 3 0v1" />
        </svg>
      );
    default:
      return null;
  }
}
