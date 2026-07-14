import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  charLen,
  Counter,
  EXAM,
  ExamInput,
  ExamRowList,
  ExamSelect,
  ExamTable,
  ExamTextarea,
  FieldLabel,
  MaterialsPanel,
} from '@/pages/exam/shared';

/**
 * L1 Part B (실행계획서) + Part C (서술형) structured views.
 *
 * Per AXIS_L1_CBT_UI_개발요구사항 (P0, 파일럿 전 구현 완료 요건):
 *   "응시자는 내용만 입력한다 — 형식(섹션·표·행)은 전부 UI가 제공한다."
 * Without it the 실행계획서 검정 becomes a "타이핑·서식 시험" and loses validity.
 * L1 has NO in-exam AI (ai_use_blocked).
 *
 * Part B: 10 fixed sections + a section-jump TOC. Narrative sections are bullet
 * rows (≤120자, 3→6). Sections 3/4/9 are TABLES (priority / roadmap / KPI).
 * Part C: 5 element-labelled boxes (≤250자), mapped 1:1 to the rubric criteria.
 */

/* ─────────────────────────── Part B — 실행계획서 ─────────────────────────── */

type PriorityRow = { 과제: string; 순위: string; 결정: string; 근거: string };
type RoadmapRow = { 기간: string; 내용: string };
type KpiRow = { 지표: string; 산식: string; 목표: string };

type L1PlanAnswer = {
  kind: 'L1_B';
  /** Narrative sections (1·2·5·6·7·8·10) — bullet rows. */
  sections: Record<string, string[]>;
  priority: PriorityRow[];
  roadmap: RoadmapRow[];
  kpi: KpiRow[];
  /** Free-text answer written before the structured UI — preserved, never overwritten. */
  legacyText?: string;
};

/** The 10 required sections, in the bank's `required_outputs` order. */
const SECTIONS = [
  { no: 1, key: 's1', label: '조직 진단', kind: 'rows' as const },
  { no: 2, key: 's2', label: '후보 과제 도출', kind: 'rows' as const },
  { no: 3, key: 's3', label: '우선순위 선정', kind: 'priority' as const },
  { no: 4, key: 's4', label: '30/90/180일 로드맵', kind: 'roadmap' as const },
  { no: 5, key: 's5', label: '운영 체계·역할·승인', kind: 'rows' as const },
  { no: 6, key: 's6', label: '데이터·도구 사용 기준', kind: 'rows' as const },
  { no: 7, key: 's7', label: '리스크·컴플라이언스 통제', kind: 'rows' as const },
  { no: 8, key: 's8', label: '교육·변화관리·확산', kind: 'rows' as const },
  { no: 9, key: 's9', label: 'KPI·성과 관리', kind: 'kpi' as const },
  { no: 10, key: 's10', label: '사후 모니터링·개선', kind: 'rows' as const },
];

const DECISIONS = ['선정', '보류', '후순위'];
const PERIODS = ['30일', '90일', '6개월'];

const emptyPriority = (): PriorityRow => ({ 과제: '', 순위: '', 결정: '', 근거: '' });
const emptyRoadmap = (): RoadmapRow => ({ 기간: '', 내용: '' });
const emptyKpi = (): KpiRow => ({ 지표: '', 산식: '', 목표: '' });

function parsePlan(text: string): L1PlanAnswer {
  const empty: L1PlanAnswer = { kind: 'L1_B', sections: {}, priority: [], roadmap: [], kpi: [] };
  const raw = (text ?? '').trim();
  // Free text from before the structured UI ⇒ preserve it, never silently drop it.
  if (!raw.startsWith('{')) return raw ? { ...empty, legacyText: raw } : empty;
  try {
    const p = JSON.parse(raw) as Partial<L1PlanAnswer>;
    return {
      kind: 'L1_B',
      sections: p.sections && typeof p.sections === 'object' ? p.sections : {},
      priority: Array.isArray(p.priority) ? p.priority : [],
      roadmap: Array.isArray(p.roadmap) ? p.roadmap : [],
      kpi: Array.isArray(p.kpi) ? p.kpi : [],
      ...(p.legacyText ? { legacyText: p.legacyText } : {}),
    };
  } catch {
    return raw ? { ...empty, legacyText: raw } : empty;
  }
}

export type L1Task = {
  taskId: string;
  title: string;
  scenario: string;
  points: number;
  durationMin: number;
  sampleData?: string | null;
  requiredStructure?: string | null;
  forbiddenRules?: string | null;
};

export function L1PlanTaskView({
  task,
  text,
  setText,
  color,
}: {
  task: L1Task;
  text: string;
  setText: (v: string) => void;
  color: string;
}) {
  const { t } = useI18n();
  const [ans, setAns] = useState<L1PlanAnswer>(() => parsePlan(text));
  const [tab, setTab] = useState('scenario');
  const [jump, setJump] = useState<string | null>(null);

  const commit = (next: L1PlanAnswer) => {
    setAns(next);
    setText(JSON.stringify({ version: 3, ...next }));
  };
  const setRows = (key: string, rows: string[]) =>
    commit({ ...ans, sections: { ...ans.sections, [key]: rows } });

  const tabs = [
    { key: 'scenario', label: t('runner.materials.scenario'), body: task.scenario },
    ...(task.sampleData ? [{ key: 'data', label: t('runner.materials.data'), body: task.sampleData }] : []),
    ...(task.requiredStructure
      ? [{ key: 'structure', label: t('runner.materials.structure'), body: task.requiredStructure }]
      : []),
  ];

  /** Candidate projects for the §3 dropdown, pulled from the scenario text. */
  const projects = useMemo(() => {
    const block = task.scenario.split('[AI 적용 후보 과제]')[1] ?? '';
    const lines = block
      .split('\n')
      .map((l) => l.replace(/^[-•\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 8);
    return lines.length ? lines.map((l) => l.split(/[|:/]/)[0].trim().slice(0, 40)) : [];
  }, [task.scenario]);

  const filled = (key: string) => (ans.sections[key] ?? []).some((r) => r.trim());
  const done = (s: (typeof SECTIONS)[number]) =>
    s.kind === 'rows'
      ? filled(s.key)
      : s.kind === 'priority'
        ? ans.priority.some((r) => r.과제.trim())
        : s.kind === 'roadmap'
          ? ans.roadmap.some((r) => r.내용.trim())
          : ans.kpi.some((r) => r.지표.trim());

  return (
    <section className="flex-1 grid grid-cols-[1fr_1.4fr] gap-[clamp(8px,0.6vw,14px)] p-[clamp(8px,0.6vw,14px)] overflow-hidden bg-[var(--exam-bg)]">
      {/* ── 좌: 제공 자료 ── */}
      <MaterialsPanel tabs={tabs} active={tab} onSelect={setTab} />

      {/* ── 우: 10개 섹션 입력 + 섹션 점프 목차 ── */}
      <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
        <div className="px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)]">
          <div className={`${EXAM.text.pill} text-[#A16207] uppercase tracking-wider font-semibold`}>
            {task.points}점 · {task.durationMin}분 · 실행계획서
          </div>
          <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mt-0.5`}>{task.title}</h3>
        </div>

        {/* 섹션 점프 목차 — 10 sections, filled ones marked */}
        <div className="flex flex-wrap gap-1 px-[clamp(10px,0.9vw,18px)] py-2 border-b border-[var(--exam-border)]">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setJump(s.key);
                document.getElementById(`sec-${s.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`px-2 py-0.5 rounded-md border ${EXAM.text.pill} transition-colors ${
                done(s)
                  ? 'text-white'
                  : jump === s.key
                    ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)] border-[var(--exam-border)]'
                    : `border-[var(--exam-border)] ${EXAM.color.muted} hover:bg-[var(--exam-surface-2)]`
              }`}
              style={done(s) ? { background: color, borderColor: color } : undefined}
              title={s.label}
            >
              {s.no}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-[clamp(12px,1vw,22px)] space-y-[clamp(16px,1.3vw,26px)]">
          {ans.legacyText && (
            <div className={`${EXAM.surface.infoBox} px-3 py-2.5`}>
              <div className={`${EXAM.text.pill} ${EXAM.color.brand} font-semibold mb-1`}>
                이전에 작성한 답안 (보존됨 — 아래 섹션으로 옮겨 적으세요)
              </div>
              <p className={`${EXAM.text.helper} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto`}>
                {ans.legacyText}
              </p>
            </div>
          )}
          {SECTIONS.map((s) => (
            <div key={s.key} id={`sec-${s.key}`}>
              <FieldLabel>
                {s.no}. {s.label}
              </FieldLabel>

              {/* 서술 섹션 — 불릿 행 (행당 120자, 기본 3행 · 최대 6행) */}
              {s.kind === 'rows' && (
                <ExamRowList
                  rows={ans.sections[s.key] ?? []}
                  onChange={(rows) => setRows(s.key, rows)}
                  makeEmpty={() => ''}
                  min={3}
                  max={6}
                  addLabel="행 추가"
                  renderRow={(row, setRow) => (
                    <ExamInput value={row} onChange={setRow} maxLen={120} placeholder="한 줄로 (최대 120자)" />
                  )}
                />
              )}

              {/* §3 우선순위 — P0 핵심 표 */}
              {s.kind === 'priority' && (
                <ExamTable<PriorityRow>
                  columns={[
                    { key: '과제', label: '과제', width: '1.4fr' },
                    { key: '순위', label: '순위', width: '0.5fr' },
                    { key: '결정', label: '선정/보류/후순위', width: '0.9fr' },
                    { key: '근거', label: '근거 (100자)', width: '1.6fr' },
                  ]}
                  rows={ans.priority}
                  onChange={(rows) => commit({ ...ans, priority: rows })}
                  makeEmpty={emptyPriority}
                  min={2}
                  max={6}
                  addLabel="과제 추가"
                  renderCell={(col, row, setRow) =>
                    col === '과제' && projects.length ? (
                      <ExamSelect
                        value={row.과제}
                        onChange={(v) => setRow({ ...row, 과제: v })}
                        options={projects}
                        placeholder="후보 과제"
                      />
                    ) : col === '결정' ? (
                      <ExamSelect
                        value={row.결정}
                        onChange={(v) => setRow({ ...row, 결정: v })}
                        options={DECISIONS}
                        placeholder="결정"
                      />
                    ) : (
                      <ExamInput
                        value={row[col as keyof PriorityRow]}
                        onChange={(v) => setRow({ ...row, [col]: v })}
                        maxLen={col === '근거' ? 100 : undefined}
                      />
                    )
                  }
                />
              )}

              {/* §4 로드맵 — 30/90/180일 */}
              {s.kind === 'roadmap' && (
                <ExamTable<RoadmapRow>
                  columns={[
                    { key: '기간', label: '기간', width: '0.7fr' },
                    { key: '내용', label: '내용 (80자)', width: '3fr' },
                  ]}
                  rows={ans.roadmap}
                  onChange={(rows) => commit({ ...ans, roadmap: rows })}
                  makeEmpty={emptyRoadmap}
                  min={3}
                  max={15}
                  addLabel="항목 추가"
                  renderCell={(col, row, setRow) =>
                    col === '기간' ? (
                      <ExamSelect
                        value={row.기간}
                        onChange={(v) => setRow({ ...row, 기간: v })}
                        options={PERIODS}
                        placeholder="기간"
                      />
                    ) : (
                      <ExamInput value={row.내용} onChange={(v) => setRow({ ...row, 내용: v })} maxLen={80} />
                    )
                  }
                />
              )}

              {/* §9 KPI */}
              {s.kind === 'kpi' && (
                <ExamTable<KpiRow>
                  columns={[
                    { key: '지표', label: '지표명', width: '1fr' },
                    { key: '산식', label: '산식·측정 방법', width: '1.6fr' },
                    { key: '목표', label: '목표', width: '0.8fr' },
                  ]}
                  rows={ans.kpi}
                  onChange={(rows) => commit({ ...ans, kpi: rows })}
                  makeEmpty={emptyKpi}
                  min={3}
                  max={6}
                  addLabel="지표 추가"
                  renderCell={(col, row, setRow) => (
                    <ExamInput
                      value={row[col as keyof KpiRow]}
                      onChange={(v) => setRow({ ...row, [col]: v })}
                    />
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────── Part C — 서술형 ──────────────────────────── */

type L1EssayAnswer = { kind: 'L1_C'; elements: Record<string, string>; legacyText?: string };

/** The 5 elements every 상황 대응형 essay must cover (rubric 1:1). */
const ELEMENTS = [
  { key: 'e1', label: '① 즉시 조치' },
  { key: 'e2', label: '② 영향 범위 확인' },
  { key: 'e3', label: '③ 보고 체계' },
  { key: 'e4', label: '④ 재발 방지·제도 개선' },
  { key: 'e5', label: '⑤ 대외·내부 커뮤니케이션' },
];
const ELEMENT_MAX = 250;

function parseEssay(text: string): L1EssayAnswer {
  const empty: L1EssayAnswer = { kind: 'L1_C', elements: {} };
  const raw = (text ?? '').trim();
  if (!raw.startsWith('{')) return raw ? { ...empty, legacyText: raw } : empty;
  try {
    const p = JSON.parse(raw) as Partial<L1EssayAnswer>;
    return {
      kind: 'L1_C',
      elements: p.elements && typeof p.elements === 'object' ? p.elements : {},
      ...(p.legacyText ? { legacyText: p.legacyText } : {}),
    };
  } catch {
    return raw ? { ...empty, legacyText: raw } : empty;
  }
}

export function L1EssayTaskView({
  task,
  text,
  setText,
}: {
  task: L1Task;
  text: string;
  setText: (v: string) => void;
}) {
  const [ans, setAns] = useState<L1EssayAnswer>(() => parseEssay(text));

  const commit = (next: L1EssayAnswer) => {
    setAns(next);
    setText(JSON.stringify({ version: 3, ...next }));
  };

  return (
    <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
      {/* 시나리오 상단 고정 */}
      <div className="px-[clamp(14px,1.2vw,26px)] py-[clamp(10px,0.9vw,18px)] border-b border-[var(--exam-border)] max-h-[38%] overflow-y-auto shrink-0">
        <div className={`${EXAM.text.pill} text-[#A16207] uppercase tracking-wider font-semibold`}>
          {task.points}점 · {task.durationMin}분
        </div>
        <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mt-0.5 mb-2`}>{task.title}</h3>
        <p className={`${EXAM.text.body} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>
          {task.scenario}
        </p>
      </div>

      {/* 요소별 라벨 입력박스 5개 — 루브릭 기준과 1:1 */}
      <div className="flex-1 overflow-y-auto p-[clamp(12px,1vw,22px)] space-y-[clamp(12px,1vw,20px)]">
        {ans.legacyText && (
          <div className={`${EXAM.surface.infoBox} px-3 py-2.5`}>
            <div className={`${EXAM.text.pill} ${EXAM.color.brand} font-semibold mb-1`}>
              이전에 작성한 답안 (보존됨 — 아래 요소로 옮겨 적으세요)
            </div>
            <p className={`${EXAM.text.helper} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto`}>
              {ans.legacyText}
            </p>
          </div>
        )}
        {ELEMENTS.map((el) => {
          const v = ans.elements[el.key] ?? '';
          const len = charLen(v);
          return (
            <div key={el.key}>
              <FieldLabel hint={<Counter ok={len > 0 && len <= ELEMENT_MAX}>{len} / {ELEMENT_MAX}자</Counter>}>
                {el.label}
              </FieldLabel>
              <ExamTextarea
                value={v}
                onChange={(nv) => commit({ ...ans, elements: { ...ans.elements, [el.key]: nv } })}
                rows={3}
                maxLen={ELEMENT_MAX}
                placeholder="핵심 조치를 개조식으로"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { L1PlanAnswer, L1EssayAnswer };
