/**
 * Exam-native structured-input primitives.
 *
 * The v3 CBT UI specs (L1/L2/L3) all state the same rule:
 *   "응시자는 내용만 입력한다 — 형식(표·행·번호)은 전부 UI가 제공한다"
 *   (the candidate types only content; the UI provides all the form)
 * and warn that without these the practical exam degenerates into a
 * "표 그리기 시험" / "타이핑 시험" and loses its validity.
 *
 * These are deliberately NOT the admin/expert `ui-kit` components: that kit is
 * fixed-px, `--gray-*` themed and has no dark mode, whereas the CBT runs
 * fullscreen from 1366px to 4K and must swap themes. Everything here is
 * clamp()-sized and driven by the --exam-* vars.
 */
import { type ReactNode } from 'react';
import { EXAM } from './tokens';

const INPUT_CLS =
  'w-full bg-[var(--exam-surface)] border border-[var(--exam-border)] rounded-lg px-3 py-2 ' +
  `${EXAM.text.helper} ${EXAM.color.ink} outline-none ` +
  'placeholder:text-[var(--exam-text-muted)] focus:border-[var(--exam-accent)] transition-colors';

/* ─────────────────────────── Labels & counters ─────────────────────────── */

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex justify-between items-center mb-1.5 gap-3">
      <label className={`${EXAM.text.helper} ${EXAM.color.ink} font-semibold`}>{children}</label>
      {hint}
    </div>
  );
}

/** Live counter. `ok` drives the colour; it never blocks input. */
export function Counter({ children, ok }: { children: ReactNode; ok?: boolean }) {
  return (
    <span className={`${EXAM.text.pill} tabular-nums shrink-0 ${ok ? EXAM.color.success : EXAM.color.muted}`}>
      {children}
    </span>
  );
}

/* ─────────────────────────────── Text inputs ───────────────────────────── */

export function ExamTextarea({
  value,
  onChange,
  rows = 3,
  maxLen,
  placeholder,
  warn,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  /** Hard cap — input beyond this is blocked, per the spec ("초과 입력 차단"). */
  maxLen?: number;
  placeholder?: string;
  warn?: boolean;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(maxLen ? Array.from(e.target.value).slice(0, maxLen).join('') : e.target.value)
      }
      className={`${INPUT_CLS} resize-none leading-relaxed ${warn ? 'border-[#FDE68A]' : ''}`}
    />
  );
}

export function ExamInput({
  value,
  onChange,
  maxLen,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLen?: number;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(maxLen ? Array.from(e.target.value).slice(0, maxLen).join('') : e.target.value)
      }
      className={INPUT_CLS}
    />
  );
}

/** Dropdown with an optional free-text escape ("직접입력"), as the L2 spec requires. */
export function ExamSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <select
      value={options.includes(value) ? value : value ? '__custom' : ''}
      onChange={(e) => onChange(e.target.value === '__custom' ? '' : e.target.value)}
      className={`${INPUT_CLS} cursor-pointer`}
    >
      <option value="" disabled>
        {placeholder ?? '선택'}
      </option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/* ──────────────────────────────── Row list ─────────────────────────────── */

/**
 * A numbered list of rows with [add]/[remove], bounded by min/max.
 * `renderRow` supplies the row body; the component owns numbering + the buttons.
 */
export function ExamRowList<T>({
  rows,
  onChange,
  makeEmpty,
  min,
  max,
  addLabel,
  renderRow,
}: {
  rows: T[];
  onChange: (rows: T[]) => void;
  makeEmpty: () => T;
  min: number;
  max: number;
  addLabel: string;
  renderRow: (row: T, set: (row: T) => void, index: number) => ReactNode;
}) {
  // Always show at least `min` rows — the form is provided, not drawn.
  const shown = rows.length >= min ? rows : [...rows, ...Array.from({ length: min - rows.length }, makeEmpty)];
  const setRow = (i: number, row: T) => onChange(shown.map((r, idx) => (idx === i ? row : r)));

  return (
    <div className="space-y-1.5">
      {shown.map((row, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`${EXAM.text.pill} ${EXAM.color.muted} tabular-nums w-5 shrink-0 pt-2 text-right`}>
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">{renderRow(row, (r) => setRow(i, r), i)}</div>
          <button
            type="button"
            aria-label="remove row"
            disabled={shown.length <= min}
            onClick={() => onChange(shown.filter((_, idx) => idx !== i))}
            className={`shrink-0 w-7 h-7 mt-1 rounded-md border border-[var(--exam-border)] ${EXAM.color.muted} hover:bg-[var(--exam-surface-2)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors`}
          >
            ✕
          </button>
        </div>
      ))}
      {shown.length < max && (
        <button
          type="button"
          onClick={() => onChange([...shown, makeEmpty()])}
          className={`ml-7 px-3 py-1.5 rounded-lg border border-dashed border-[var(--exam-border)] ${EXAM.text.pill} ${EXAM.color.brand} hover:bg-[var(--exam-surface-2)] transition-colors`}
        >
          + {addLabel} ({shown.length}/{max})
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────────── Table ───────────────────────────────── */

/**
 * Fixed-column table with add/remove rows — the L2 verification-memo component
 * and the L1 priority/roadmap/KPI tables. The candidate never draws a table.
 */
export function ExamTable<T>({
  columns,
  rows,
  onChange,
  makeEmpty,
  min,
  max,
  addLabel,
  renderCell,
}: {
  columns: { key: string; label: string; width?: string }[];
  rows: T[];
  onChange: (rows: T[]) => void;
  makeEmpty: () => T;
  min: number;
  max: number;
  addLabel: string;
  renderCell: (col: string, row: T, set: (row: T) => void) => ReactNode;
}) {
  const shown = rows.length >= min ? rows : [...rows, ...Array.from({ length: min - rows.length }, makeEmpty)];
  const setRow = (i: number, row: T) => onChange(shown.map((r, idx) => (idx === i ? row : r)));

  return (
    <div className="border border-[var(--exam-border)] rounded-lg overflow-hidden">
      <div
        className="grid bg-[var(--exam-surface-2)] border-b border-[var(--exam-border)]"
        style={{ gridTemplateColumns: `2rem ${columns.map((c) => c.width ?? '1fr').join(' ')} 2rem` }}
      >
        <span />
        {columns.map((c) => (
          <span
            key={c.key}
            className={`px-2 py-1.5 ${EXAM.text.pill} ${EXAM.color.muted} font-semibold uppercase tracking-wider`}
          >
            {c.label}
          </span>
        ))}
        <span />
      </div>
      {shown.map((row, i) => (
        <div
          key={i}
          className="grid items-start gap-1 px-1 py-1 border-b border-[var(--exam-border)] last:border-b-0"
          style={{ gridTemplateColumns: `2rem ${columns.map((c) => c.width ?? '1fr').join(' ')} 2rem` }}
        >
          <span className={`${EXAM.text.pill} ${EXAM.color.muted} tabular-nums pt-2 text-center`}>{i + 1}</span>
          {columns.map((c) => (
            <div key={c.key} className="min-w-0">
              {renderCell(c.key, row, (r) => setRow(i, r))}
            </div>
          ))}
          <button
            type="button"
            aria-label="remove row"
            disabled={shown.length <= min}
            onClick={() => onChange(shown.filter((_, idx) => idx !== i))}
            className={`w-7 h-7 mt-1 rounded-md ${EXAM.color.muted} hover:bg-[var(--exam-surface-2)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors`}
          >
            ✕
          </button>
        </div>
      ))}
      {shown.length < max && (
        <button
          type="button"
          onClick={() => onChange([...shown, makeEmpty()])}
          className={`w-full px-3 py-2 ${EXAM.text.pill} ${EXAM.color.brand} hover:bg-[var(--exam-surface-2)] border-t border-dashed border-[var(--exam-border)] transition-colors`}
        >
          + {addLabel} ({shown.length}/{max})
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────── Checklist ─────────────────────────────── */

/** "없음 확인" toggles — the L2 risk-check component. */
export function ExamChecklist({
  items,
  checked,
  onChange,
  color,
}: {
  items: { key: string; label: string }[];
  checked: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  color: string;
}) {
  return (
    <div className="space-y-1">
      {items.map((it) => {
        const on = !!checked[it.key];
        return (
          <button
            key={it.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange({ ...checked, [it.key]: !on })}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-1.5 rounded-lg border transition-colors ${EXAM.text.helper} ${
              on
                ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                : 'border-[var(--exam-border)] hover:bg-[var(--exam-surface-2)] ' + EXAM.color.body
            }`}
            style={on ? { borderColor: color } : undefined}
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[10px] ${
                on ? 'text-white' : 'border-[var(--exam-border)]'
              }`}
              style={on ? { background: color, borderColor: color } : undefined}
            >
              {on ? '✓' : ''}
            </span>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────── Materials panel ──────────────────────────── */

/**
 * The provided-materials panel (left column of the L2/L1 practical screens).
 *
 * `sampleData` / `requiredStructure` / `forbiddenRules` were already being sent
 * by the paper API and rendered NOWHERE — the candidate's entire source data was
 * invisible. Tabs, always readable, collapsible.
 */
export function MaterialsPanel({
  tabs,
  active,
  onSelect,
}: {
  tabs: { key: string; label: string; body: string }[];
  active: string;
  onSelect: (key: string) => void;
}) {
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  if (!current) return null;
  return (
    <div className={`${EXAM.surface.card} flex flex-col overflow-hidden`}>
      <div className="flex items-stretch gap-0.5 px-1.5 pt-1.5 border-b border-[var(--exam-border)] overflow-x-auto">
        {tabs.map((tb) => {
          const on = tb.key === current.key;
          return (
            <button
              key={tb.key}
              type="button"
              onClick={() => onSelect(tb.key)}
              className={`px-3 py-1.5 rounded-t-lg whitespace-nowrap transition-colors ${EXAM.text.pill} font-semibold ${
                on
                  ? 'bg-[var(--exam-accent-bg)] text-[var(--exam-accent-text)]'
                  : `${EXAM.color.muted} hover:bg-[var(--exam-surface-2)]`
              }`}
            >
              {tb.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto p-[clamp(12px,1.2vw,26px)]">
        <p className={`${EXAM.text.body} ${EXAM.color.body} whitespace-pre-wrap leading-relaxed`}>
          {current.body}
        </p>
      </div>
    </div>
  );
}
