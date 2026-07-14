import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import {
  charLen,
  Counter,
  EXAM,
  ExamChecklist,
  ExamInput,
  ExamRowList,
  ExamSelect,
  ExamTable,
  ExamTextarea,
  FieldLabel,
  MaterialsPanel,
} from '@/pages/exam/shared';

/**
 * L2 실습형 — structured 4-panel practical screen.
 *
 * Per AXIS_L2_CBT_UI_개발요구사항 (P0, 파일럿 전 구현 완료 요건):
 *   "응시자는 내용만 입력한다 — 형식(표·행·번호)은 전부 UI가 제공한다."
 * Without this the exam becomes a "표 그리기 시험" and loses validity, so every
 * required_submission item gets its OWN input — never one free-text blob.
 *
 * Layout: 좌 제공자료 · 중 과제+구조화 입력 · 우 내장 AI · 상단 타이머/탭.
 *
 * The answer serializes to the task's contentText as a versioned envelope; the
 * backend renders it to readable Korean for the AI grader and for the expert
 * reviewer (renderStructuredAnswer).
 */

/* ────────────────────────────── answer shapes ───────────────────────────── */

type MemoRow = { 주장: string; 판정: string; 근거: string; 조치: string };
type StepRow = { 단계명: string; 수행주체: string; 내용: string };
type RiskCheck = Record<string, boolean> & { note?: never };

type L2Answer = {
  kind: 'L2_A' | 'L2_B' | 'L2_C';
  // Task A — 산출물 작성·개선
  aiInstruction?: string;
  reportDraft?: string;
  revisionGrounds?: string[];
  // Task B — 요약·분석·검증
  summary?: string;
  memos?: MemoRow[];
  corrections?: string[];
  // Task C — 업무흐름 설계
  steps?: StepRow[];
  aiPlan?: string;
  // A & C
  riskCheck?: Record<string, boolean>;
  riskNote?: string;
  /**
   * A free-text answer written BEFORE the structured UI shipped (or on a legacy
   * bank). It is carried through the envelope untouched so a mid-exam deploy can
   * never destroy work: it is shown read-only for the candidate to copy from, and
   * renderStructuredAnswer passes it to the grader.
   */
  legacyText?: string;
};

/** 판정 dropdown — the controlled vocabulary from the spec (+ 직접입력). */
const VERDICTS = ['오류', '사용 보류', '기각', '위반'];
/** 수행 주체 dropdown. */
const ACTORS = ['AI', '사람', 'AI+사람'];
/** 리스크 체크 — the 4 items the spec names. */
const RISK_ITEMS = [
  { key: 'realName', label: '실명·식별정보 없음 확인' },
  { key: 'unsourced', label: '출처불명 수치 없음 확인' },
  { key: 'causal', label: '인과 단정 표현 없음 확인' },
  { key: 'violation', label: '기준 위반 제안 없음 확인' },
];

const emptyMemo = (): MemoRow => ({ 주장: '', 판정: '', 근거: '', 조치: '' });
const emptyStep = (): StepRow => ({ 단계명: '', 수행주체: '', 내용: '' });

/** Which task is this? The bank names them 산출물…/요약…/업무흐름… */
function kindOf(taskType: string | null | undefined, orderIndex: number): L2Answer['kind'] {
  const t = (taskType ?? '').replace(/[·\s]/g, '');
  if (t.includes('요약') || t.includes('분석') || t.includes('검증')) return 'L2_B';
  if (t.includes('업무흐름') || t.includes('자동화') || t.includes('설계')) return 'L2_C';
  if (t.includes('산출물') || t.includes('작성') || t.includes('개선')) return 'L2_A';
  return (['L2_A', 'L2_B', 'L2_C'] as const)[Math.min(orderIndex, 2)];
}

function parseAnswer(text: string, kind: L2Answer['kind']): L2Answer {
  const raw = (text ?? '').trim();
  // Not JSON but not empty ⇒ a free-text answer from before the structured UI.
  // NEVER discard it: carry it in the envelope so the first keystroke in the new
  // form cannot overwrite the candidate's existing work.
  if (!raw.startsWith('{')) return raw ? { kind, legacyText: raw } : { kind };
  try {
    const p = JSON.parse(raw) as L2Answer;
    return { ...p, kind: p.kind ?? kind };
  } catch {
    return raw ? { kind, legacyText: raw } : { kind };
  }
}

/** Rough sentence count for the "5~7문장" guidance (warning only, never blocks). */
const countSentences = (s: string) =>
  (s ?? '')
    .split(/[.!?。！？\n]+/)
    .map((x) => x.trim())
    .filter(Boolean).length;

export type L2Task = {
  taskId: string;
  title: string;
  scenario: string;
  points: number;
  durationMin: number;
  taskType?: string | null;
  orderIndex?: number;
  sampleData?: string | null;
  requiredStructure?: string | null;
  forbiddenRules?: string | null;
  aiToolAllowed?: string | null;
};

export function L2PracticalTaskView({
  task,
  text,
  setText,
  color,
  aiPanel,
}: {
  task: L2Task;
  text: string;
  setText: (v: string) => void;
  color: string;
  /** The embedded-AI panel (right column) — supplied by the runner. */
  aiPanel?: React.ReactNode;
}) {
  const { t } = useI18n();
  const kind = useMemo(() => kindOf(task.taskType, task.orderIndex ?? 0), [task.taskType, task.orderIndex]);
  // Seeded once; the parent remounts on task switch (key={taskId}).
  const [ans, setAns] = useState<L2Answer>(() => parseAnswer(text, kind));
  const [tab, setTab] = useState('scenario');

  const commit = (next: L2Answer) => {
    setAns(next);
    setText(JSON.stringify({ version: 3, ...next }));
  };
  const set = <K extends keyof L2Answer>(k: K, v: L2Answer[K]) => commit({ ...ans, [k]: v });

  // Left panel: everything the paper actually sends — previously rendered nowhere.
  const tabs = [
    { key: 'scenario', label: t('runner.materials.scenario'), body: task.scenario },
    ...(task.sampleData ? [{ key: 'data', label: t('runner.materials.data'), body: task.sampleData }] : []),
    ...(task.requiredStructure
      ? [{ key: 'structure', label: t('runner.materials.structure'), body: task.requiredStructure }]
      : []),
    ...(task.forbiddenRules
      ? [{ key: 'rules', label: t('runner.materials.rules'), body: task.forbiddenRules }]
      : []),
  ];

  const sentences = countSentences(ans.reportDraft ?? '');
  const sentencesOk = sentences >= 5 && sentences <= 7;

  return (
    <section className="flex-1 grid grid-cols-[1fr_1.15fr_0.9fr] gap-[clamp(8px,0.6vw,14px)] p-[clamp(8px,0.6vw,14px)] overflow-hidden bg-[var(--exam-bg)]">
      {/* ── 좌: 제공 자료 ── */}
      <MaterialsPanel tabs={tabs} active={tab} onSelect={setTab} />

      {/* ── 중: 과제 지시 + 구조화 입력 ── */}
      <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
        <div className="px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)]">
          <div className={`${EXAM.text.pill} text-[#A16207] uppercase tracking-wider font-semibold`}>
            {task.points}점 · {task.durationMin}분{task.taskType ? ` · ${task.taskType}` : ''}
          </div>
          <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mt-0.5`}>{task.title}</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-[clamp(12px,1vw,22px)] space-y-[clamp(14px,1.1vw,22px)]">
          {/* 이전에 자유서술로 작성한 답안이 있으면 보존해 보여준다 (덮어쓰기 방지). */}
          {ans.legacyText && (
            <div className={`${EXAM.surface.infoBox} px-3 py-2.5`}>
              <div className={`${EXAM.text.pill} ${EXAM.color.brand} font-semibold mb-1`}>
                이전에 작성한 답안 (보존됨 — 아래 항목으로 옮겨 적으세요)
              </div>
              <p className={`${EXAM.text.helper} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto`}>
                {ans.legacyText}
              </p>
            </div>
          )}

          {/* ─────────────── Task A — 산출물 작성·개선 ─────────────── */}
          {kind === 'L2_A' && (
            <>
              <div>
                <FieldLabel hint={<Counter>{charLen(ans.aiInstruction ?? '')}자</Counter>}>
                  ① AI 지시문
                </FieldLabel>
                <ExamTextarea
                  value={ans.aiInstruction ?? ''}
                  onChange={(v) => set('aiInstruction', v)}
                  rows={3}
                  placeholder="내장 AI에게 보낼 지시문을 작성하세요."
                />
              </div>

              <div>
                <FieldLabel
                  hint={
                    <Counter ok={sentencesOk}>
                      {sentences}문장 / 5–7문장
                    </Counter>
                  }
                >
                  ② 최종 보고서 초안
                </FieldLabel>
                <ExamTextarea
                  value={ans.reportDraft ?? ''}
                  onChange={(v) => set('reportDraft', v)}
                  rows={7}
                  warn={!!ans.reportDraft && !sentencesOk}
                  placeholder="5~7문장으로 작성하세요. (문장 수는 권고이며 제출을 막지 않습니다)"
                />
              </div>

              <div>
                <FieldLabel>③ 수정 근거</FieldLabel>
                <ExamRowList
                  rows={ans.revisionGrounds ?? []}
                  onChange={(rows) => set('revisionGrounds', rows)}
                  makeEmpty={() => ''}
                  min={3}
                  max={6}
                  addLabel="근거 추가"
                  renderRow={(row, setRow) => (
                    <ExamInput value={row} onChange={setRow} placeholder="AI 초안을 고친 근거" />
                  )}
                />
              </div>

              <RiskCheckBlock ans={ans} set={set} color={color} />
            </>
          )}

          {/* ─────────────── Task B — 요약·분석·검증 ─────────────── */}
          {kind === 'L2_B' && (
            <>
              <div>
                <FieldLabel hint={<Counter>{charLen(ans.summary ?? '')}자</Counter>}>① 핵심 요약</FieldLabel>
                <ExamTextarea
                  value={ans.summary ?? ''}
                  onChange={(v) => set('summary', v)}
                  rows={4}
                  placeholder="자료의 핵심을 요약하세요."
                />
              </div>

              {/* P0 핵심 — 검증 메모 표. 응시자가 표를 그리지 않는다. */}
              <div>
                <FieldLabel>② 검증 메모</FieldLabel>
                <ExamTable<MemoRow>
                  columns={[
                    { key: '주장', label: '주장', width: '1.2fr' },
                    { key: '판정', label: '판정', width: '0.9fr' },
                    { key: '근거', label: '근거', width: '1.2fr' },
                    { key: '조치', label: '조치', width: '1fr' },
                  ]}
                  rows={ans.memos ?? []}
                  onChange={(rows) => set('memos', rows)}
                  makeEmpty={emptyMemo}
                  min={3}
                  max={8}
                  addLabel="행 추가"
                  renderCell={(col, row, setRow) =>
                    col === '판정' ? (
                      <ExamSelect
                        value={row.판정}
                        onChange={(v) => setRow({ ...row, 판정: v })}
                        options={VERDICTS}
                        placeholder="판정"
                      />
                    ) : (
                      <ExamInput
                        value={row[col as keyof MemoRow]}
                        onChange={(v) => setRow({ ...row, [col]: v })}
                      />
                    )
                  }
                />
              </div>

              <div>
                <FieldLabel>③ 수정 대상 목록</FieldLabel>
                <ExamRowList
                  rows={ans.corrections ?? []}
                  onChange={(rows) => set('corrections', rows)}
                  makeEmpty={() => ''}
                  min={2}
                  max={8}
                  addLabel="항목 추가"
                  renderRow={(row, setRow) => (
                    <ExamInput value={row} onChange={setRow} placeholder="수정해야 할 항목" />
                  )}
                />
              </div>
            </>
          )}

          {/* ─────────────── Task C — 업무흐름 개선·자동화 설계 ─────────────── */}
          {kind === 'L2_C' && (
            <>
              <div>
                <FieldLabel>① 업무흐름 단계</FieldLabel>
                <ExamTable<StepRow>
                  columns={[
                    { key: '단계명', label: '단계명', width: '1fr' },
                    { key: '수행주체', label: '수행 주체', width: '0.8fr' },
                    { key: '내용', label: '내용', width: '1.8fr' },
                  ]}
                  rows={ans.steps ?? []}
                  onChange={(rows) => set('steps', rows)}
                  makeEmpty={emptyStep}
                  min={5}
                  max={8}
                  addLabel="단계 추가"
                  renderCell={(col, row, setRow) =>
                    col === '수행주체' ? (
                      <ExamSelect
                        value={row.수행주체}
                        onChange={(v) => setRow({ ...row, 수행주체: v })}
                        options={ACTORS}
                        placeholder="주체"
                      />
                    ) : (
                      <ExamInput
                        value={row[col as keyof StepRow]}
                        onChange={(v) => setRow({ ...row, [col]: v })}
                      />
                    )
                  }
                />
              </div>

              <div>
                <FieldLabel hint={<Counter>{charLen(ans.aiPlan ?? '')}자</Counter>}>
                  ② 단계별 AI 사용계획
                </FieldLabel>
                <ExamTextarea
                  value={ans.aiPlan ?? ''}
                  onChange={(v) => set('aiPlan', v)}
                  rows={4}
                  placeholder="어느 단계에서 어떤 AI를 어떻게 쓸지, 사람 검토 지점은 어디인지 서술하세요."
                />
              </div>

              <RiskCheckBlock ans={ans} set={set} color={color} />
            </>
          )}
        </div>
      </div>

      {/* ── 우: 내장 AI ── */}
      <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>{aiPanel}</div>
    </section>
  );
}

function RiskCheckBlock({
  ans,
  set,
  color,
}: {
  ans: L2Answer;
  set: <K extends keyof L2Answer>(k: K, v: L2Answer[K]) => void;
  color: string;
}) {
  return (
    <div>
      <FieldLabel>④ 리스크 체크</FieldLabel>
      <ExamChecklist
        items={RISK_ITEMS}
        checked={ans.riskCheck ?? {}}
        onChange={(next) => set('riskCheck', next)}
        color={color}
      />
      <div className="mt-1.5">
        <ExamTextarea
          value={ans.riskNote ?? ''}
          onChange={(v) => set('riskNote', v)}
          rows={2}
          placeholder="추가로 통제한 리스크가 있으면 서술하세요."
        />
      </div>
    </div>
  );
}

export type { L2Answer, RiskCheck };
