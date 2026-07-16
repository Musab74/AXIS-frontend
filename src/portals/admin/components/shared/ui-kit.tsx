import { ArrowDown, ArrowUp, Search as SearchIcon, X as XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
 * AXIS Admin — UI Kit
 * Lifted from design_handoff_axis_admin/styles.css
 *
 * Class names prefixed with `axis-*` so the dark CBT theme scope (`.mon-shell`)
 * in index.css can override them globally without per-component branching.
 * Backwards-compatible exports kept (Card, KpiCard, StatusBadge, Button,
 * SectionHeader, PageHeader, FilterPill).
 * ──────────────────────────────────────────────────────────────────────────── */

/* ─── Card ─── */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`axis-card bg-white  ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  right,
  className = "",
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`axis-card-header flex items-center justify-between px-[20px] py-[16px] ${className}`}>
      <h3 className="axis-card-title text-[18px] font-semibold text-gray-800 tracking-[-0.01em] m-0 flex items-center gap-2">
        {title}
      </h3>
      {right}
    </div>
  );
}

/* ─── KPI Card ─── */
export type KpiTone = "blue" | "green" | "orange" | "red" | "purple" | "teal";

const KPI_BAR: Record<KpiTone, string> = {
  blue: "bg-[var(--blue)]",
  green: "bg-[var(--green)]",
  orange: "bg-[var(--orange)]",
  red: "bg-[var(--red)]",
  purple: "bg-[var(--purple)]",
  teal: "bg-[var(--teal)]",
};

export function KpiCard({
  label,
  value,
  unit,
  icon,
  delta,
  deltaLabel,
  progress,
  tone,
  sub,
  onClick,
}: {
  label: React.ReactNode;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
  delta?: number;
  deltaLabel?: string;
  progress?: number;
  tone?: KpiTone;
  sub?: React.ReactNode;
  onClick?: () => void;
}) {
  const positive = (delta ?? 0) >= 0;
  return (
    <div
      onClick={onClick}
      className={[
        "relative overflow-hidden bg-white border border-[var(--gray-border)] rounded-xl px-[18px] py-[16px]",
        onClick ? "cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]" : "",
      ].join(" ")}
    >
      {tone && (
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${KPI_BAR[tone]}`} />
      )}
      <div className="flex items-center gap-1.5 text-[13px] text-[var(--gray-500)] font-medium">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-[30px] font-extrabold tracking-[-0.03em] text-[var(--primary)] mt-1 mb-0.5 tabular-nums leading-tight">
        {value}
        {unit && <span className="text-[14px] font-semibold text-[var(--gray-500)] ml-0.5">{unit}</span>}
      </div>
      {sub ? (
        <div className="text-[13px] text-[var(--gray-500)] flex items-center gap-1.5">{sub}</div>
      ) : progress !== undefined ? (
        <div className="mt-2">
          <div className="h-1.5 bg-[var(--gray-100)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--blue)] rounded-full" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--gray-500)] tabular-nums">{progress}%</div>
        </div>
      ) : delta !== undefined ? (
        <div className={`mt-2 inline-flex items-center gap-1 text-[13px] ${positive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
          {positive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
          <span className="tabular-nums font-semibold">
            {positive ? "+" : ""}
            {delta}%
          </span>
          {deltaLabel && <span className="text-[var(--gray-400)]">{deltaLabel}</span>}
        </div>
      ) : null}
    </div>
  );
}

export function SimpleKpiCard({
  label,
  value,
  unit,
  meta,
  onClick,
  className = "",
}: {
  label: React.ReactNode;
  value: string | number;
  unit?: string;
  meta?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Card
      className={[
        "px-5 py-4",
        onClick ? "cursor-pointer transition-shadow hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)]" : "",
        className,
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="w-full text-left disabled:cursor-default"
      >
        <div className="text-[13px] font-medium text-[var(--gray-500)]">
          <span>{label}</span>
        </div>
        <div className="mt-3 flex items-end gap-1.5">
          <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--gray-900)] tabular-nums">
            {value}
          </span>
          {unit ? (
            <span className="pb-0.5 text-[14px] font-medium text-[var(--gray-500)]">{unit}</span>
          ) : null}
        </div>
        {meta ? (
          <div className="mt-3 text-[13px] leading-5 text-[var(--gray-500)]">{meta}</div>
        ) : null}
      </button>
    </Card>
  );
}

/* ─── Chip / StatusBadge ─── */
export type ChipTone = "green" | "blue" | "orange" | "red" | "gray" | "purple" | "amber" | "indigo" | "teal";

const CHIP_MAP: Record<ChipTone, string> = {
  blue: "bg-[var(--blue-50)] text-[var(--blue)]",
  green: "bg-[var(--green-50)] text-[var(--green)]",
  orange: "bg-[var(--orange-50)] text-[var(--orange)]",
  red: "bg-[var(--red-50)] text-[var(--red)]",
  purple: "bg-[var(--purple-50)] text-[var(--purple)]",
  teal: "bg-[var(--teal-50)] text-[var(--teal)]",
  gray: "bg-[var(--gray-100)] text-[var(--gray-600)]",
  amber: "bg-amber-50 text-amber-800",
  indigo: "bg-indigo-50 text-indigo-700",
};

export function Chip({
  tone,
  children,
  dot = false,
  pulse = false,
  className = "",
}: {
  tone: ChipTone;
  children: React.ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11.5px] font-semibold whitespace-nowrap ${CHIP_MAP[tone]} ${className}`}
    >
      {(dot || pulse) && (
        <span className="relative inline-flex items-center justify-center">
          {pulse && (
            <span className="absolute inline-flex h-2 w-2 rounded-full opacity-75 animate-ping" style={{ background: "currentColor" }} />
          )}
        </span>
      )}
      {children}
    </span>
  );
}

/* Backwards-compat: old usages call <StatusBadge tone .../> without dot
 * but the original kit always rendered a dot — keep that behavior here. */
export function StatusBadge({
  tone,
  children,
  pulse,
  className,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <Chip tone={tone} dot pulse={pulse} className={className}>
      {children}
    </Chip>
  );
}

/* ─── Cert Tag ─── */
export type CertCode = "axis" | "axisc" | "axish";

const CERT_MAP: Record<CertCode, string> = {
  axis: "bg-[var(--blue-50)] text-[var(--blue)]",
  axisc: "bg-[var(--green-50)] text-[var(--green)]",
  axish: "bg-[var(--purple-50)] text-[var(--purple)]",
};

const CERT_LABEL: Record<CertCode, string> = {
  axis: "AXIS",
  axisc: "AXIS-C",
  axish: "AXIS-H",
};

export function CertTag({
  code,
  children,
  className = "",
}: {
  code: CertCode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-[2px] rounded text-[11.5px] font-bold tracking-wide ${CERT_MAP[code]} ${className}`}
    >
      {children ?? CERT_LABEL[code]}
    </span>
  );
}

/* ─── Cert tag from API CertType (helper) ─── */
export function certCodeOf(certType: string): CertCode {
  if (certType === "AXIS_C" || certType === "AXISC" || certType === "AXIS-C") return "axisc";
  if (certType === "AXIS_H" || certType === "AXISH" || certType === "AXIS-H") return "axish";
  return "axis";
}

/* ─── Button ─── */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "blue" | "ghost" | "danger";
  size?: "sm" | "md";
}) {
  const styles = {
    primary: "bg-[var(--primary)] text-white border-[var(--primary)] hover:bg-[#1E293B]",
    blue: "bg-blue-500 text-white border-blue-500 hover:bg-blue-600",
    secondary: "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200",
    ghost: "bg-transparent text-[var(--gray-700)] border-transparent hover:bg-[var(--gray-100)]",
    danger: "bg-red-700 text-white hover:bg-red-600",
  }[variant];
  const sizes = size === "sm" ? "px-2 py-1 text-[13px]" : "px-3 py-[7px] text-[14px]";
  return (
    <button
      className={`axis-focus inline-flex items-center gap-1.5 border rounded-lg font-medium transition-all disabled:opacity-45 disabled:cursor-not-allowed ${styles} ${sizes} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ─── Icon Button (square) ─── */
export function IconBtn({
  children,
  hasDot = false,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { hasDot?: boolean }) {
  return (
    <button
      className={`axis-focus relative w-[34px] h-[34px] place-items-center text-[var(--gray-600)] hover:bg-[var(--gray-50)] transition-colors ${className}`}
      {...rest}
    >
      {children}
      {hasDot && <span className="absolute top-[7px] right-[7px] w-[7px] h-[7px] rounded-full bg-[var(--red)] border-[1.5px] border-white" />}
    </button>
  );
}

/* ─── Section / Page Header ─── */
export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <h2 className="text-[18px] font-bold text-[var(--primary)] tracking-[-0.01em] m-0">{title}</h2>
        {subtitle && <p className="text-[13px] text-[var(--gray-500)] mt-0.5 m-0">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-6 gap-6">
      <div>
        <h1 className="axis-page-title text-[24px] font-semibold tracking-[-0.02em] text-[var(--primary)] m-0 mb-1">
          {title}
        </h1>
        {subtitle && <p className="axis-page-sub text-[14px] text-[var(--gray-500)] m-0">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ─── Tabs (underline style) ─── */
export interface TabItem<T extends string = string> {
  id: T;
  label: React.ReactNode;
  count?: number | null;
  warn?: boolean;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1 border-b border-[var(--gray-border)] mb-4 ${className}`}>
      {tabs.map((tt) => {
        const isActive = active === tt.id;
        return (
          <button
            key={tt.id}
            onClick={() => onChange(tt.id)}
            className={[
              "axis-focus relative px-3.5 py-2.5 text-[14px] whitespace-nowrap rounded-t-md transition-colors",
              isActive ? "text-blue-600 font-semibold" : "text-[var(--gray-500)] hover:text-[var(--primary)] font-medium",
              tt.warn && !isActive ? "text-[var(--red)]" : "",
            ].join(" ")}
          >
            <span>{tt.label}</span>
            {tt.count != null && (
              <span
                className={[
                  "ml-1.5 inline-flex items-center justify-center min-w-[18px] px-1.5 py-[1px] rounded-full text-[11.5px] font-semibold tabular-nums",
                  isActive ? "bg-blue-600 text-white" : "bg-[var(--gray-100)] text-[var(--gray-500)]",
                ].join(" ")}
              >
                {tt.count}
              </span>
            )}
            {isActive && (
              <span className="absolute left-2 right-2 -bottom-px h-[3px] bg-blue-500 rounded-t" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Filter Bar primitives ─── */
export function FilterBar({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 bg-white mb-4 ${className}`}
    >
      {children}
    </div>
  );
}

export function Select({
  className = "",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`axis-select axis-focus border border-[var(--gray-border)] rounded-sm text-[14px] px-2.5 py-[7px] bg-white text-[var(--gray-700)] outline-none transition-shadow focus:border-[var(--blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] ${className}`}
      {...rest}
    />
  );
}

export function Input({
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`axis-input axis-focus border border-[var(--gray-border)] rounded-lg text-[14px] px-2.5 py-[7px] bg-white text-[var(--gray-700)] outline-none min-w-[220px] transition-shadow focus:border-[var(--blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)] ${className}`}
      {...rest}
    />
  );
}

export function Search({
  placeholder = "검색",
  value,
  onChange,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--gray-400)]" />
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="axis-input axis-focus pl-8 pr-3 py-[7px] rounded-md border border-[var(--gray-border)] bg-white text-[14px] min-w-[240px] text-[var(--gray-700)] outline-none focus:border-[var(--blue)] focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
        {...rest}
      />
    </div>
  );
}

/* Legacy filter pill (kept for back-compat with pages still using it) */
export function FilterPill({ children }: { children: React.ReactNode }) {
  return (
    <button className="axis-focus inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[var(--gray-border)] bg-white hover:bg-[var(--gray-50)] text-[14px] text-[var(--gray-700)]">
      {children}
      <svg width="10" height="10" viewBox="0 0 10 10" className="text-[var(--gray-400)]">
        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/* ─── Progress Bar ─── */
export function Bar({
  value,
  tone = "blue",
  className = "",
}: {
  value: number;
  tone?: "blue" | "green" | "orange" | "red" | "gray";
  className?: string;
}) {
  const fill = {
    blue: "bg-[var(--blue)]",
    green: "bg-[var(--green)]",
    orange: "bg-[var(--orange)]",
    red: "bg-[var(--red)]",
    gray: "bg-[var(--gray-400)]",
  }[tone];
  return (
    <div className={`h-1.5 bg-[var(--gray-100)] rounded-full overflow-hidden min-w-[60px] ${className}`}>
      <div className={`h-full ${fill} rounded-full`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

/* ─── Drawer (right-side slide-in) ─── */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  /* Parents often pass inline `() => setX(null)`; must not be an effect dep or
   * every keystroke re-runs cleanup and steals focus from inputs. */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    /* Move focus into the drawer for accessibility. */
    const tid = window.setTimeout(() => {
      const firstFocusable = ref.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(tid);
      /* Restore focus to the element that opened the drawer. */
      const t = triggerRef.current;
      if (t instanceof HTMLElement) t.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 bg-[rgba(15,23,42,0.3)] z-20"
        style={{ animation: "axisFadeIn 180ms ease" }}
        onClick={onClose}
      />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="fixed right-0 z-30 bg-white border-l border-[var(--gray-border)] flex flex-col"
        style={{
          top: "var(--topbar-h)",
          bottom: 0,
          width,
          boxShadow: "-8px 0 24px rgba(15,23,42,0.08)",
          animation: "axisSlideIn 220ms ease",
        }}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-border)]">
            <h3 className="text-[18px] font-bold text-[var(--primary)] m-0">{title}</h3>
            <button onClick={onClose} className="axis-focus w-8 h-8 grid place-items-center rounded-md hover:bg-[var(--gray-100)] text-[var(--gray-500)]">
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-border)]">{footer}</div>}
      </aside>
    </>
  );
}

/* ─── Modal (centered) ─── */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 bg-[rgba(15,23,42,0.4)] z-40"
        style={{ animation: "axisFadeIn 150ms ease" }}
        onClick={() => onCloseRef.current()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl border border-[var(--gray-border)] shadow-[var(--shadow-lg)] flex flex-col max-h-[90vh]"
        style={{ width, maxWidth: "95vw", animation: "axisFadeIn 150ms ease" }}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--gray-border)]">
            <h3 className="text-[18px] font-bold text-[var(--primary)] m-0">{title}</h3>
            <button onClick={onClose} className="axis-focus w-8 h-8 grid place-items-center rounded-md hover:bg-[var(--gray-100)] text-[var(--gray-500)]">
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--gray-border)]">{footer}</div>}
      </div>
    </>
  );
}

/* ─── Pagination ─── */
export function Pagination({
  page,
  totalPages,
  onChange,
  total,
  pageSize,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
  total?: number;
  pageSize?: number;
  onPageSizeChange?: (n: number) => void;
}) {
  if (totalPages <= 1 && !total) return null;

  const visible = pagesAround(page, totalPages);

  return (
    <div className="flex justify-between items-center px-[18px] py-3 border-t border-[var(--gray-border)] text-[13px] text-[var(--gray-500)]">
      <div>
        {total !== undefined ? <>총 <b className="text-[var(--primary)] tabular-nums">{total.toLocaleString()}</b>건</> : null}
        {pageSize && onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="ml-2 border border-[var(--gray-border)] rounded-md px-1.5 py-0.5 text-[13px] bg-white"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}/page
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex gap-1">
        <PagerBtn disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</PagerBtn>
        {visible.map((p, i) =>
          p === -1 ? (
            <span key={i} className="w-7 h-7 grid place-items-center text-[var(--gray-400)]">…</span>
          ) : (
            <PagerBtn key={i} active={p === page} onClick={() => onChange(p)}>
              {p}
            </PagerBtn>
          ),
        )}
        <PagerBtn disabled={page >= totalPages} onClick={() => onChange(page + 1)}>›</PagerBtn>
      </div>
    </div>
  );
}

function PagerBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={[
        "axis-focus w-7 h-7 grid place-items-center border rounded-md text-[13px] tabular-nums",
        active
          ? "bg-[var(--primary)] text-white border-[var(--primary)]"
          : "bg-white text-[var(--gray-600)] border-[var(--gray-border)] hover:bg-[var(--gray-50)]",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function pagesAround(page: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const result: number[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) result.push(-1);
  for (let i = start; i <= end; i++) result.push(i);
  if (end < total - 1) result.push(-1);
  result.push(total);
  return result;
}

/* ─── Table primitives (className helpers + components) ─── */
export function TableWrap({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`overflow-x-auto ${className}`}>{children}</div>;
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <table
      className={[
        "axis-tbl w-full border-collapse text-[14px]",
        "[&_thead]:border-t-2 [&_thead]:border-[#9aa4b2]",
        "[&_thead_th]:border-t-0",
        "[&_tr>*:first-child]:border-l border-[#e7ebf1]",
        className,
      ].join(" ")}
    >
      {children}
    </table>
  );
}

export function Th({
  children,
  className = "",
  align = "center",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
  colSpan?: number;
}) {
  return (
    <th
      colSpan={colSpan}
      className={[
        "bg-[var(--gray-100)] px-3.5 py-2.5 text-[13px] font-semibold tracking-[0.03em] text-[var(--gray-500)] whitespace-nowrap text-center",
        "border-b border-r border-gray-300",
        className,
      ].join(" ")}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className = "",
  strong,
  mono,
  muted,
  align = "center",
  colSpan,
  onClick,
}: {
  children?: React.ReactNode;
  className?: string;
  strong?: boolean;
  mono?: boolean;
  muted?: boolean;
  align?: "left" | "right" | "center";
  colSpan?: number;
  onClick?: React.MouseEventHandler<HTMLTableCellElement>;
}) {
  return (
    <td
      colSpan={colSpan}
      onClick={onClick}
      className={[
        "px-3.5 py-3 align-middle border-b border-r border-[#e7ebf1] text-center",
        strong ? "font-medium text-[15px]" : "text-[var(--gray-700)]",
        mono ? "font-mono-axis text-[15px]" : "",
        muted ? "text-[var(--gray-500)]" : "",
        className,
      ].join(" ")}
    >
      {children}
    </td>
  );
}

/* ─── Toast (top-right; lightweight imperative store) ─── */
type Toast = { id: number; tone: ChipTone; message: string };
let toastId = 0;
const toastListeners = new Set<(toasts: Toast[]) => void>();
let toastList: Toast[] = [];

export function pushToast(message: string, tone: ChipTone = "green", ttl = 4000) {
  const id = ++toastId;
  toastList = [...toastList, { id, tone, message }];
  toastListeners.forEach((l) => l(toastList));
  setTimeout(() => {
    toastList = toastList.filter((t) => t.id !== id);
    toastListeners.forEach((l) => l(toastList));
  }, ttl);
}

export function ToastHost() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    toastListeners.add(setList);
    return () => {
      toastListeners.delete(setList);
    };
  }, []);
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {list.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-[var(--shadow-lg)] border text-[14px] font-medium ${CHIP_MAP[t.tone]} bg-white`}
          style={{ animation: "axisSlideIn 200ms ease" }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
