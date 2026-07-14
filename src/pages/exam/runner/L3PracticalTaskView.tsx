import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { charLen, EXAM } from '@/pages/exam/shared';

/**
 * L3 실습형 (practical) structured-answer UI.
 *
 * L3 tasks are graded against an answer key: the candidate makes selections from
 * fixed option pools, optionally writes a 요청문 (generation field), and always
 * writes an 80–150자 근거. There is NO in-exam AI assistant for L3.
 *
 * The paper API supplies `task.l3` — an answer-free render spec derived from the
 * bank's `response_format`. Per the v3 CBT UI requirement, the UI supplies ALL
 * the form (option lists, selection counts, character caps); the candidate only
 * supplies content.
 *
 * ── The serialization contract (must match the grader exactly) ───────────────
 *   {
 *     version: 3,
 *     selects: { <field.key>: string[] },   // ← OPTION CODES ("E1","V2"), not text
 *     shortReason: string,                  // ← TOP level
 *     writePrompt: string                   // ← TOP level (generation field)
 *   }
 * `shortReason`/`writePrompt` nested inside `selects` would be silently dropped
 * by the grader, and submitting option TEXT instead of CODES would score zero.
 */

export type L3Option = { code: string; text: string };

export type L3Field = {
  key: string;
  label: string;
  /** v3: `select` (coded option group) · `generate` (요청문). Others are legacy. */
  kind: 'select' | 'generate' | 'multi' | 'multiText' | 'single' | 'text' | 'prompt';
  /** v3 option pool — code + display text. */
  choices?: L3Option[];
  /** v3: pick exactly this many. 1 ⇒ radio, N ⇒ checkbox capped at N. */
  selectCount?: number;
  /** Legacy option pool (plain strings). */
  options?: string[];
  maxLen?: number;
};

export type L3Spec = {
  practiceType: string | null;
  fixedAiOutput: string | null;
  fields: L3Field[];
  reason: { min: number; max: number };
};

export type L3Task = {
  taskId: string;
  title: string;
  scenario: string;
  points: number;
  durationMin: number;
  l3?: L3Spec | null;
};

type SelectValue = string[] | string;
type AnswerState = {
  selects: Record<string, SelectValue>;
  shortReason: string;
  /** The generation field lives at the TOP level of the envelope, not in selects. */
  writePrompt: string;
};

function parseAnswer(text: string): AnswerState {
  const empty: AnswerState = { selects: {}, shortReason: '', writePrompt: '' };
  const raw = (text ?? '').trim();
  if (!raw.startsWith('{')) return empty;
  try {
    const p = JSON.parse(raw) as Partial<AnswerState>;
    return {
      selects: p.selects && typeof p.selects === 'object' ? p.selects : {},
      shortReason: typeof p.shortReason === 'string' ? p.shortReason : '',
      writePrompt: typeof p.writePrompt === 'string' ? p.writePrompt : '',
    };
  } catch {
    return empty;
  }
}

export function L3PracticalTaskView({
  task,
  text,
  setText,
  color,
}: {
  task: L3Task;
  text: string;
  setText: (v: string) => void;
  color: string;
}) {
  const { t } = useI18n();
  // Seeded once. The parent remounts on task switch (key={taskId}), so a fresh
  // mount re-reads that task's saved answer — no re-hydration effect needed.
  const [answer, setAnswer] = useState<AnswerState>(() => parseAnswer(text));

  const spec = task.l3 ?? null;
  const fields = useMemo(() => spec?.fields ?? [], [spec]);
  const reason = spec?.reason ?? { min: 80, max: 150 };

  const commit = (next: AnswerState) => {
    setAnswer(next);
    setText(
      JSON.stringify({
        version: 3,
        selects: next.selects,
        shortReason: next.shortReason,
        ...(next.writePrompt ? { writePrompt: next.writePrompt } : {}),
      }),
    );
  };
  const setValue = (key: string, value: SelectValue) =>
    commit({ ...answer, selects: { ...answer.selects, [key]: value } });

  /**
   * Toggle within a coded option group, capped at `selectCount`. Selecting past
   * the cap is BLOCKED (the spec: "select_count 초과 차단"), so a candidate can
   * never submit more answers than the item asks for.
   */
  const toggleCoded = (key: string, code: string, selectCount: number) => {
    const cur = Array.isArray(answer.selects[key]) ? (answer.selects[key] as string[]) : [];
    if (cur.includes(code)) {
      setValue(key, cur.filter((c) => c !== code));
      return;
    }
    if (selectCount === 1) {
      setValue(key, [code]); // single choice — replace
      return;
    }
    if (cur.length >= selectCount) return; // cap reached — block
    setValue(key, [...cur, code]);
  };

  const reasonLen = charLen(answer.shortReason);
  const reasonOk = reasonLen >= reason.min && reasonLen <= reason.max;

  return (
    <section className="flex-1 grid grid-cols-2 gap-[clamp(10px,0.8vw,18px)] p-[clamp(10px,0.8vw,18px)] overflow-hidden bg-[var(--exam-bg)]">
      {/* Left: scenario + fixed AI output (read-only context) */}
      <div className={`${EXAM.surface.card} p-[clamp(16px,1.4vw,32px)] overflow-y-auto`}>
        <div className={`${EXAM.text.pill} text-[#A16207] mb-2 uppercase tracking-wider font-semibold`}>
          {task.points}점 · {task.durationMin}분{task.l3?.practiceType ? ` · ${task.l3.practiceType}` : ''}
        </div>
        <h3 className={`${EXAM.text.cardHeading} ${EXAM.color.ink} mb-3`}>{task.title}</h3>
        <p className={`${EXAM.text.body} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>{task.scenario}</p>
        {task.l3?.fixedAiOutput && (
          <div className={`mt-5 ${EXAM.surface.infoBox} px-4 py-3`}>
            <div className={`${EXAM.text.pill} ${EXAM.color.brand} uppercase tracking-wider font-semibold mb-1.5`}>
              AI 산출물 (검토 대상)
            </div>
            <p className={`${EXAM.text.helper} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>
              {task.l3.fixedAiOutput}
            </p>
          </div>
        )}
        <div className={`mt-5 ${EXAM.surface.warningBox} px-4 py-3 ${EXAM.text.helper} ${EXAM.color.warning} leading-relaxed`}>
          {t('runner.l3.noAi')}
        </div>
      </div>

      {/* Right: structured answer form */}
      <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
        <div className={`px-[clamp(12px,1vw,20px)] py-[clamp(8px,0.7vw,14px)] border-b border-[var(--exam-border)] ${EXAM.text.pill} ${EXAM.color.muted} uppercase tracking-wider font-semibold`}>
          {t('runner.l3.answerPanel')}
        </div>
        <div className="flex-1 overflow-y-auto p-[clamp(12px,1vw,22px)] space-y-[clamp(14px,1.1vw,24px)]">
          {fields.map((f) => (
            <FieldBlock
              key={f.key}
              field={f}
              value={f.kind === 'generate' ? answer.writePrompt : answer.selects[f.key]}
              color={color}
              onToggleCoded={(code) => toggleCoded(f.key, code, f.selectCount ?? 1)}
              onSetValue={(v) =>
                f.kind === 'generate'
                  ? commit({ ...answer, writePrompt: typeof v === 'string' ? v : '' })
                  : setValue(f.key, v)
              }
            />
          ))}

          {/* short_reason — always present, live 80–150자 counter */}
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold`}>
                {t('runner.l3.reasonLabel')}
              </label>
              <span className={`${EXAM.text.pill} tabular-nums ${reasonOk ? EXAM.color.success : EXAM.color.muted}`}>
                {t('runner.l3.charRange', { n: reasonLen, min: reason.min, max: reason.max })}
              </span>
            </div>
            <textarea
              value={answer.shortReason}
              onChange={(e) => commit({ ...answer, shortReason: e.target.value })}
              rows={4}
              placeholder={t('runner.l3.reasonPh')}
              className={`w-full bg-[var(--exam-surface)] border rounded-lg p-3 ${EXAM.text.body} ${EXAM.color.ink} outline-none resize-none placeholder:text-[var(--exam-text-muted)] leading-relaxed transition-colors ${
                reasonOk ? 'border-[var(--exam-border)]' : 'border-[#FDE68A]'
              } focus:border-[var(--exam-accent)]`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FieldBlock({
  field,
  value,
  color,
  onToggleCoded,
  onSetValue,
}: {
  field: L3Field;
  value: SelectValue | undefined;
  color: string;
  onToggleCoded: (code: string) => void;
  onSetValue: (v: SelectValue) => void;
}) {
  const { t } = useI18n();

  // ── v3: coded option group with a hard selection cap ───────────────────────
  if (field.kind === 'select') {
    const choices = field.choices ?? [];
    const max = field.selectCount ?? 1;
    const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const full = selected.length >= max;
    return (
      <div>
        <div className="flex justify-between items-center mb-1.5 gap-3">
          <label className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold`}>{field.label}</label>
          <span
            className={`${EXAM.text.pill} tabular-nums shrink-0 ${full ? EXAM.color.success : EXAM.color.muted}`}
          >
            {t('runner.l3.selectCount', { n: selected.length, max })}
          </span>
        </div>
        <div className="space-y-1.5" role={max === 1 ? 'radiogroup' : 'group'} aria-label={field.label}>
          {choices.map((opt) => {
            const on = selected.includes(opt.code);
            // At the cap, unselected options are disabled — over-selection is blocked.
            const blocked = !on && full && max > 1;
            return (
              <button
                key={opt.code}
                type="button"
                role={max === 1 ? 'radio' : 'checkbox'}
                aria-checked={on}
                disabled={blocked}
                onClick={() => onToggleCoded(opt.code)}
                className={`w-full text-left flex items-start gap-2.5 px-3 py-2 rounded-lg border transition-colors ${EXAM.text.helper} ${
                  on
                    ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                    : blocked
                      ? 'border-[var(--exam-border)] opacity-40 cursor-not-allowed ' + EXAM.color.muted
                      : 'border-[var(--exam-border)] hover:bg-[var(--exam-surface-2)] ' + EXAM.color.body
                }`}
                style={on ? { borderColor: color } : undefined}
              >
                <span
                  className={`w-4 h-4 mt-0.5 ${max === 1 ? 'rounded-full' : 'rounded'} border flex items-center justify-center shrink-0 text-[10px] ${
                    on ? 'text-white' : 'border-[var(--exam-border)]'
                  }`}
                  style={on ? { background: color, borderColor: color } : undefined}
                >
                  {on ? '✓' : ''}
                </span>
                {/* The CODE is shown alongside the text — the grader, the expert
                    reviewer and the answer key all reason in codes. */}
                <span className="font-mono text-[0.9em] opacity-70 shrink-0">{opt.code}</span>
                <span className="flex-1">{opt.text}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── v3: generation field (요청문) with a HARD character cap ────────────────
  if (field.kind === 'generate') {
    const cur = typeof value === 'string' ? value : '';
    const maxLen = field.maxLen ?? 250;
    const len = Array.from(cur).length;
    return (
      <div>
        <div className="flex justify-between items-center mb-1.5 gap-3">
          <label className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold`}>{field.label}</label>
          <span className={`${EXAM.text.pill} tabular-nums shrink-0 ${len >= maxLen ? EXAM.color.warning : EXAM.color.muted}`}>
            {t('runner.l3.charMax', { n: len, max: maxLen })}
          </span>
        </div>
        <textarea
          value={cur}
          // Hard cap — the spec requires "limit 초과 입력 차단", not a soft warning.
          onChange={(e) => onSetValue(Array.from(e.target.value).slice(0, maxLen).join(''))}
          rows={3}
          placeholder={t('runner.l3.charMax', { n: 0, max: maxLen })}
          className={`w-full bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg p-3 ${EXAM.text.helper} ${EXAM.color.ink} outline-none resize-none placeholder:text-[var(--exam-text-muted)] leading-relaxed focus:border-[var(--exam-accent)] transition-colors`}
        />
      </div>
    );
  }

  // ── Legacy kinds (v2 bank / seed data) ────────────────────────────────────
  const label = <div className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold mb-1.5`}>{field.label}</div>;
  const options = field.options ?? [];

  if (field.kind === 'multi' || field.kind === 'single') {
    const multi = field.kind === 'multi';
    const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
    return (
      <div>
        {label}
        <div className="space-y-1.5">
          {options.map((opt) => {
            const on = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() =>
                  multi
                    ? onSetValue(
                        selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt],
                      )
                    : onSetValue(opt)
                }
                className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${EXAM.text.helper} ${
                  on
                    ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                    : 'border-[var(--exam-border)] hover:bg-[var(--exam-surface-2)] ' + EXAM.color.body
                }`}
                style={on ? { borderColor: color } : undefined}
              >
                <span
                  className={`w-4 h-4 ${multi ? 'rounded' : 'rounded-full'} border flex items-center justify-center shrink-0 ${
                    on ? 'text-white' : 'border-[var(--exam-border)]'
                  }`}
                  style={on ? { background: color, borderColor: color } : undefined}
                >
                  {on && multi ? '✓' : ''}
                </span>
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (field.kind === 'multiText') {
    const items = Array.isArray(value) ? value : [];
    return <ChipEntry label={field.label} items={items} onChange={onSetValue} color={color} />;
  }

  // text | prompt
  const cur = typeof value === 'string' ? value : '';
  const isPrompt = field.kind === 'prompt';
  const len = Array.from(cur).length;
  const maxLen = field.maxLen ?? 250;
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold`}>{field.label}</label>
        {isPrompt && (
          <span className={`${EXAM.text.pill} tabular-nums ${EXAM.color.muted}`}>
            {len} / {maxLen}자
          </span>
        )}
      </div>
      {isPrompt ? (
        <textarea
          value={cur}
          onChange={(e) => onSetValue(e.target.value)}
          rows={3}
          placeholder={`${maxLen}자 이내로 작성하세요.`}
          className={`w-full bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg p-3 ${EXAM.text.helper} ${EXAM.color.ink} outline-none resize-none placeholder:text-[var(--exam-text-muted)] leading-relaxed focus:border-[var(--exam-accent)] transition-colors`}
        />
      ) : (
        <input
          value={cur}
          onChange={(e) => onSetValue(e.target.value)}
          placeholder="입력하세요"
          className={`w-full bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg px-3 py-2 ${EXAM.text.helper} ${EXAM.color.ink} outline-none placeholder:text-[var(--exam-text-muted)] focus:border-[var(--exam-accent)] transition-colors`}
        />
      )}
    </div>
  );
}

/** Free multi-entry (chips) for legacy lists with no fixed option pool. */
function ChipEntry({
  label,
  items,
  onChange,
  color,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  color: string;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div>
      <div className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold mb-1.5`}>{label}</div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it) => (
            <span
              key={it}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--exam-border)] bg-[var(--exam-surface-2)] ${EXAM.text.pill} ${EXAM.color.body}`}
            >
              {it}
              <button
                type="button"
                onClick={() => onChange(items.filter((x) => x !== it))}
                className="opacity-60 hover:opacity-100"
                aria-label="remove"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="항목 입력 후 Enter"
          className={`flex-1 bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg px-3 py-2 ${EXAM.text.helper} ${EXAM.color.ink} outline-none placeholder:text-[var(--exam-text-muted)] focus:border-[var(--exam-accent)] transition-colors`}
        />
        <button
          type="button"
          onClick={add}
          className={`px-3 rounded-lg text-white ${EXAM.text.pill} shrink-0`}
          style={{ background: color }}
        >
          추가
        </button>
      </div>
    </div>
  );
}

/** Sidebar + active task — the L3 practical stage. */
export function L3PracticalListView({
  tasks,
  text,
  setText,
  color,
}: {
  tasks: L3Task[];
  text: Record<string, string>;
  setText: (taskId: string, v: string) => void;
  color: string;
}) {
  const [active, setActive] = useState(0);
  const current = tasks[active];
  if (!current) return null;
  return (
    <div className="flex-1 flex overflow-hidden">
      <aside className="w-[clamp(200px,14vw,280px)] shrink-0 border-r border-[var(--exam-border)] bg-[var(--exam-surface)] overflow-y-auto py-2">
        {tasks.map((t, i) => {
          const on = i === active;
          const answered = (text[t.taskId] ?? '').trim().length > 2;
          return (
            <button
              key={t.taskId}
              type="button"
              onClick={() => setActive(i)}
              className={`w-full text-left px-4 py-3 border-l-[3px] transition-colors ${EXAM.text.helper} ${
                on ? 'bg-[var(--exam-accent-bg)] ' + EXAM.color.ink : 'border-l-transparent hover:bg-[var(--exam-surface-2)] ' + EXAM.color.body
              }`}
              style={on ? { borderLeftColor: color } : undefined}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${answered ? '' : 'opacity-25'}`}
                  style={{ background: answered ? color : 'var(--exam-text-muted)' }}
                />
                <span className="font-semibold">{i + 1}. {t.l3?.practiceType ?? 'Task'}</span>
              </div>
              <div className={`${EXAM.text.pill} ${EXAM.color.muted} mt-0.5 truncate`}>{t.points}점 · {t.durationMin}분</div>
            </button>
          );
        })}
      </aside>
      <L3PracticalTaskView
        key={current.taskId}
        task={current}
        text={text[current.taskId] ?? ''}
        setText={(v) => setText(current.taskId, v)}
        color={color}
      />
    </div>
  );
}
