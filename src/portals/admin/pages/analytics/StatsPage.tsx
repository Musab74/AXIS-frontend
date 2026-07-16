import { useEffect, useMemo, useState } from "react";
import {
  FileDown,
  FileSpreadsheet,
  FileText,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";
import { Card, CardHeader, PageHeader, Button, StatusBadge, Tabs, SimpleKpiCard } from '@admin/components/shared/ui-kit';
import { useI18n } from '@admin/i18n';
import {
  adminApi,
  DashboardStats,
  PassRateStats,
  SubjectStats,
  ReportRound,
  ReportFilterParams,
  CustomReportParams,
  triggerBlobDownload,
} from '@admin/services/api';

/* Palette aligned with design_handoff_axis_admin spec §"Chart color mapping". */
const COLORS = {
  l3: "#2563EB",   // var(--blue)
  l2: "#0D9488",   // var(--teal)
  l1: "#7C3AED",   // var(--purple)
  axis: "#2563EB", // var(--blue)
  axisC: "#16A34A", // var(--green)
  axisH: "#7C3AED", // var(--purple)
  pass: "#16A34A",
  fail: "#94a3b8",
  partial: "#F97316", // var(--orange)
  inprogress: "#2563EB",
};

const tickStyle = { fill: "#9CA3AF", fontSize: 11 };
const gridStroke = "#E5E7EB";

function ChartCard({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        className="!px-5 !py-4"
      />
      <div className="px-5 pb-5 pt-1">
        {subtitle && <p className="mb-4 text-[13px] text-[var(--gray-500)]">{subtitle}</p>}
        {children}
      </div>
    </Card>
  );
}

function EmptyChart({ msg }: { msg: string }) {
  return <div className="h-[260px] grid place-items-center text-sm text-slate-400">{msg}</div>;
}

/* ---------- TAB 1: OVERVIEW ---------- */

function OverviewTab({ dashboard, passRate }: { dashboard: DashboardStats | null; passRate: PassRateStats | null }) {
  const { t } = useI18n();
  const certCompare = (passRate?.byCert ?? []).map((c) => ({
    cert: c.certType === 'AXIS_C' ? 'AXIS-C' : c.certType === 'AXIS_H' ? 'AXIS-H' : 'AXIS',
    reg: c.registered,
    pass: c.passed,
  }));

  const dist = passRate?.distribution ?? { pass: 0, fail: 0, partial: 0, inProgress: 0 };
  const distTotal = dist.pass + dist.fail + dist.partial + dist.inProgress;
  const resultDist = [
    { name: 'pass', value: distTotal > 0 ? Math.round((dist.pass / distTotal) * 100) : 0, color: COLORS.pass },
    { name: 'fail', value: distTotal > 0 ? Math.round((dist.fail / distTotal) * 100) : 0, color: COLORS.fail },
    { name: 'partial', value: distTotal > 0 ? Math.round((dist.partial / distTotal) * 100) : 0, color: COLORS.partial },
    { name: 'inprogress', value: distTotal > 0 ? Math.round((dist.inProgress / distTotal) * 100) : 0, color: COLORS.inprogress },
  ];

  const fmt = (n: number | undefined) => (n == null ? '—' : n.toLocaleString());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-4">
        <SimpleKpiCard
          label={t("dash.kpi.cumulative")}
          value={fmt(dashboard?.cumulativeUsers)}
          meta={<><span className="font-medium text-[var(--gray-900)]">{fmt(dashboard?.cumulativeUsers)}</span> {t("unit.people")}</>}
        />
        <SimpleKpiCard
          label={t("dash.kpi.passRate")}
          value={dashboard ? `${dashboard.passRate}%` : '—'}
          meta={<><span className="font-medium text-[var(--green)]">{dashboard ? `${dashboard.passRate}%` : '—'}</span> {t("dash.col.passRate")}</>}
        />
        <SimpleKpiCard
          label={t("dash.kpi.monthReg")}
          value={fmt(dashboard?.monthlyRegistrations)}
          meta={<><span className="font-medium text-[var(--blue)]">{fmt(dashboard?.monthlyRegistrations)}</span> {t("unit.cases")}</>}
        />
        <SimpleKpiCard
          label={t("dash.kpi.gradingProgress")}
          value={dashboard ? `${dashboard.gradingProgress}%` : '—'}
          meta={<><span className="font-medium text-[var(--orange)]">{dashboard ? `${dashboard.gradingProgress}%` : '—'}</span> {t("dash.kpi.gradingProgress")}</>}
        />
        <SimpleKpiCard
          label={t("stats.kpi.avgWritten")}
          value="—"
          meta={t("common.empty") || 'No data'}
        />
        <SimpleKpiCard
          label={t("stats.kpi.avgPractical")}
          value="—"
          meta={t("common.empty") || 'No data'}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ChartCard title={t("stats.chart.passTrend")} subtitle={t("stats.chart.passTrend.sub")} className="col-span-2">
          {!passRate ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
            passRate.trend.length === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={passRate.trend} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="round" tick={tickStyle} stroke={gridStroke} />
                <YAxis unit="%" tick={tickStyle} stroke={gridStroke} domain={[0, 100]} />
                <Tooltip cursor={{ stroke: "#cbd5e1", strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Line type="monotone" dataKey="l3" name="L3" stroke={COLORS.l3} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="l2" name="L2" stroke={COLORS.l2} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="l1" name="L1" stroke={COLORS.l1} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title={t("stats.chart.resultDist")} subtitle={t("stats.chart.resultDist.sub")}>
          {!passRate ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
            distTotal === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
            <>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={resultDist} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {resultDist.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="grid grid-cols-2 gap-1.5 text-xs mt-2">
                {resultDist.map((d) => (
                  <li key={d.name} className="flex items-center gap-1.5 text-slate-600">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                    <span className="flex-1">{t(`stats.result.${d.name}`)}</span>
                    <span className="tabular-nums text-slate-900">{d.value}%</span>
                  </li>
                ))}
              </ul>
            </>
          }
        </ChartCard>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <ChartCard title={t("stats.chart.certCompare")} subtitle={t("stats.chart.certCompare.sub")} className="col-span-2">
          {!passRate ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
            certCompare.every((c) => c.reg === 0 && c.pass === 0) ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={certCompare} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="cert" tick={tickStyle} stroke={gridStroke} />
                <YAxis tick={tickStyle} stroke={gridStroke} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" />
                <Bar dataKey="reg" name={t("stats.bar.registered")} fill={COLORS.axis} radius={[4, 4, 0, 0]} />
                <Bar dataKey="pass" name={t("stats.bar.passed")} fill={COLORS.pass} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          }
        </ChartCard>

        <Card>
          <CardHeader title={t("stats.recentAlerts")} className="!px-5 !py-4" />
          <div className="px-5 pb-5 pt-1">
            {!dashboard ? (
              <div className="py-6 text-sm text-slate-400 text-center">{t("common.loading") || 'Loading…'}</div>
            ) : dashboard.alerts.length === 0 ? (
              <div className="py-6 text-sm text-slate-400 text-center">{t("common.empty") || 'No alerts'}</div>
            ) : (
              <ul className="space-y-2.5 text-sm">
                {dashboard.alerts.slice(0, 4).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 pb-2 border-b border-slate-100 last:border-0">
                    <StatusBadge tone={a.level === 'HIGH' ? 'red' : a.level === 'MEDIUM' || a.level === 'MED' ? 'amber' : 'blue'}>•</StatusBadge>
                    <span className="flex-1 text-slate-600">{a.message}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{new Date(a.createdAt).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------- TAB 2: PASS RATE ---------- */

function PassRateTab({ passRate }: { passRate: PassRateStats | null }) {
  const { t } = useI18n();
  const dist = passRate?.distribution ?? { pass: 0, fail: 0, partial: 0, inProgress: 0 };
  const distTotal = dist.pass + dist.fail + dist.partial + dist.inProgress;
  const partialDist = [
    { name: 'pass', value: distTotal > 0 ? Math.round((dist.pass / distTotal) * 100) : 0, color: COLORS.pass },
    { name: 'fail', value: distTotal > 0 ? Math.round((dist.fail / distTotal) * 100) : 0, color: COLORS.fail },
    { name: 'partial', value: distTotal > 0 ? Math.round((dist.partial / distTotal) * 100) : 0, color: COLORS.partial },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <ChartCard title={t("stats.chart.passTrend")} subtitle={t("stats.chart.passTrend.sub")} className="col-span-2">
        {!passRate ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
          passRate.trend.length === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={passRate.trend} margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="round" tick={tickStyle} stroke={gridStroke} />
              <YAxis unit="%" tick={tickStyle} stroke={gridStroke} />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
              <Line type="monotone" dataKey="l3" name="L3" stroke={COLORS.l3} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="l2" name="L2" stroke={COLORS.l2} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="l1" name="L1" stroke={COLORS.l1} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        }
      </ChartCard>

      <ChartCard title={t("stats.chart.partial")} subtitle={t("stats.chart.partial.sub")} className="col-span-2">
        {!passRate ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
          distTotal === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
          <>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={partialDist} dataKey="value" innerRadius={60} outerRadius={95} paddingAngle={2}>
                  {partialDist.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex justify-center gap-4 text-xs mt-2">
              {partialDist.map((d) => (
                <li key={d.name} className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                  <span>{t(`stats.result.${d.name}`)}</span>
                  <span className="tabular-nums text-slate-900">{d.value}%</span>
                </li>
              ))}
            </ul>
          </>
        }
      </ChartCard>
    </div>
  );
}

/* ---------- TAB 3: SUBJECT ---------- */

function heatColor(v: number) {
  if (v < 10) return "#dc2626";
  if (v < 30) return "#f97316";
  if (v < 50) return "#fbbf24";
  if (v < 70) return "#84cc16";
  if (v < 85) return "#22c55e";
  return "#10b981";
}

function heatTextColor(v: number) {
  return v < 50 ? "#ffffff" : "#0f172a";
}

function SubjectTab({ subjects }: { subjects: SubjectStats | null }) {
  const { t } = useI18n();
  const [heatView, setHeatView] = useState<"risk" | "matrix">("risk");
  const subjectAvgs = (subjects?.averages ?? []).map((s) => ({ subject: s.subject, avg: s.avgScore }));

  const heatBuckets = (() => {
    if (!subjects) return { subjects: [] as string[], rounds: [] as number[], values: new Map<string, number>() };
    const subjectSet = new Set<string>();
    const roundSet = new Set<number>();
    const values = new Map<string, number>();
    for (const c of subjects.heatmap) {
      subjectSet.add(c.subject);
      roundSet.add(c.round);
      values.set(`${c.subject}|${c.round}`, c.avgScore);
    }
    return {
      subjects: [...subjectSet],
      rounds: [...roundSet].sort((a, b) => a - b),
      values,
    };
  })();

  const aiVsExpert = subjects?.aiVsExpert ?? [];
  const riskRows = useMemo(() => {
    return heatBuckets.subjects
      .map((subj) => {
        const roundValues = heatBuckets.rounds
          .map((round) => ({
            round,
            value: heatBuckets.values.get(`${subj}|${round}`) ?? null,
          }))
          .filter((item) => item.value != null) as Array<{ round: number; value: number }>;

        if (roundValues.length === 0) {
          return {
            subject: subj,
            latest: null as number | null,
            min: null as number | null,
            avg: null as number | null,
            riskRound: null as number | null,
          };
        }

        const latest = roundValues[roundValues.length - 1]?.value ?? null;
        const minItem = roundValues.reduce((lowest, current) =>
          current.value < lowest.value ? current : lowest,
        );
        const avg = Math.round(
          roundValues.reduce((sum, current) => sum + current.value, 0) / roundValues.length,
        );

        return {
          subject: subj,
          latest,
          min: minItem.value,
          avg,
          riskRound: minItem.round,
        };
      })
      .sort((a, b) => {
        const aScore = a.min ?? 999;
        const bScore = b.min ?? 999;
        return aScore - bScore;
      });
  }, [heatBuckets]);
  const flaggedCount = riskRows.filter((row) => row.min != null && row.min < 10).length;
  const warningCount = riskRows.filter((row) => row.min != null && row.min >= 10 && row.min < 30).length;
  const stableCount = riskRows.filter((row) => row.min != null && row.min >= 30).length;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <ChartCard title={t("stats.chart.subjectAvg")} subtitle={t("stats.chart.subjectAvg.sub")}>
          {!subjects ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
            subjectAvgs.length === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={subjectAvgs} margin={{ top: 10, right: 16, left: -8, bottom: 28 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="subject"
                  tick={{ ...tickStyle, fontSize: 10 }}
                  stroke={gridStroke}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={tickStyle} stroke={gridStroke} domain={[0, 100]} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="avg" name={t("stats.bar.avg")} fill={COLORS.axis} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          }
        </ChartCard>

        <ChartCard title={t("stats.chart.practical")} subtitle={t("stats.chart.practical.sub")}>
          {!subjects ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
            (subjects.practical.length === 0) ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
            <ResponsiveContainer width="100%" height={340}>
              <BarChart
                data={subjects.practical.map((p) => ({ task: p.task, avg: p.avgScore }))}
                margin={{ top: 10, right: 16, left: -8, bottom: 28 }}
              >
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="task"
                  tick={{ ...tickStyle, fontSize: 10 }}
                  stroke={gridStroke}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis tick={tickStyle} stroke={gridStroke} domain={[0, 100]} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="avg" fill={COLORS.l2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          }
        </ChartCard>
      </div>

      <ChartCard title={t("stats.chart.heatmap")} subtitle={t("stats.chart.heatmap.sub")}>
        {!subjects ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
          heatBuckets.subjects.length === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-rose-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-rose-400">Critical</div>
                <div className="mt-1 text-2xl font-semibold text-rose-600 tabular-nums">{flaggedCount}</div>
                <div className="mt-1 text-[12px] text-slate-500">{t("stats.heat.flagged")}</div>
              </div>
              <div className="rounded-xl bg-orange-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-orange-400">Warning</div>
                <div className="mt-1 text-2xl font-semibold text-orange-500 tabular-nums">{warningCount}</div>
                <div className="mt-1 text-[12px] text-slate-500">30% 미만 주의 문항</div>
              </div>
              <div className="rounded-xl bg-emerald-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-500">Stable</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-600 tabular-nums">{stableCount}</div>
                <div className="mt-1 text-[12px] text-slate-500">30% 이상 유지 문항</div>
              </div>
            </div>

            <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-5">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">리스크 요약</h4>
                  <span className="text-[11px] text-slate-400">TOP 6</span>
                </div>
                <ul className="space-y-2.5">
                  {riskRows.slice(0, 6).map((row) => {
                    const danger = row.min != null && row.min < 10;
                    const warning = row.min != null && row.min < 30;
                    return (
                      <li key={row.subject} className="flex items-start gap-3">
                        <span
                          className={`mt-1 h-2.5 w-2.5 rounded-full ${
                            danger ? "bg-rose-500" : warning ? "bg-orange-400" : "bg-emerald-500"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-slate-700">{row.subject}</div>
                          <div className="mt-0.5 text-[12px] text-slate-400">
                            최저 {row.min ?? "—"} · 평균 {row.avg ?? "—"} · {row.riskRound != null ? `R${row.riskRound}` : "—"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="text-[12px] text-slate-500">
                    {heatView === "risk" ? "낮은 정답률 순으로 우선 확인" : "회차별 변화를 표 형태로 확인"}
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => setHeatView("risk")}
                      className={[
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors",
                        heatView === "risk" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                      ].join(" ")}
                    >
                      리스크 리스트
                    </button>
                    <button
                      type="button"
                      onClick={() => setHeatView("matrix")}
                      className={[
                        "px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors",
                        heatView === "matrix" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                      ].join(" ")}
                    >
                      매트릭스 보기
                    </button>
                  </div>
                </div>

                {heatView === "risk" ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="min-w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">문항/과목</th>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">최신</th>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">최저</th>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">평균</th>
                          <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">위험 회차</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riskRows.map((row) => {
                          const danger = row.min != null && row.min < 10;
                          const warning = row.min != null && row.min < 30;
                          return (
                            <tr key={row.subject} className="border-t border-slate-100">
                              <td className="px-4 py-3 text-sm text-slate-700">{row.subject}</td>
                              <td className="px-4 py-3 text-center text-sm font-medium text-slate-900 tabular-nums">
                                {row.latest ?? "—"}
                              </td>
                              <td className={`px-4 py-3 text-center text-sm font-semibold tabular-nums ${
                                danger ? "text-rose-600" : warning ? "text-orange-500" : "text-slate-900"
                              }`}>
                                {row.min ?? "—"}
                              </td>
                              <td className="px-4 py-3 text-center text-sm text-slate-600 tabular-nums">
                                {row.avg ?? "—"}
                              </td>
                              <td className="px-4 py-3 text-center text-sm text-slate-500 tabular-nums">
                                {row.riskRound != null ? `R${row.riskRound}` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-white pr-4 pb-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                            Subject
                          </th>
                          {heatBuckets.rounds.map((r) => (
                            <th
                              key={r}
                              className="min-w-[76px] pb-3 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                            >
                              R{r}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {heatBuckets.subjects.map((subj) => (
                          <tr key={subj}>
                            <td className="sticky left-0 z-10 bg-white pr-4 py-2 text-sm text-slate-700 whitespace-nowrap">
                              {subj}
                            </td>
                            {heatBuckets.rounds.map((r) => {
                              const v = heatBuckets.values.get(`${subj}|${r}`) ?? null;
                              const isFlagged = v != null && v < 10;
                              return (
                                <td key={r} className="py-2 text-center">
                                  <div
                                    className={[
                                      "mx-auto flex h-10 w-[60px] items-center justify-center rounded-lg text-[12px] font-semibold tabular-nums",
                                      isFlagged ? "ring-2 ring-rose-500 ring-offset-2 ring-offset-white" : "",
                                      v == null ? "bg-slate-100 text-slate-400" : "",
                                    ].join(" ")}
                                    style={
                                      v == null
                                        ? undefined
                                        : { background: heatColor(v), color: heatTextColor(v) }
                                    }
                                    title={`${subj} R${r}: ${v ?? '—'}`}
                                  >
                                    {v != null ? Math.round(v) : '—'}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 mt-5 text-[11px] text-slate-500">
              <span>{t("stats.heat.legend.low")}</span>
              <div className="flex h-2 flex-1 max-w-xs rounded-full overflow-hidden">
                {["#dc2626", "#f97316", "#fbbf24", "#84cc16", "#22c55e", "#10b981"].map((c) => (
                  <div key={c} className="flex-1" style={{ background: c }} />
                ))}
              </div>
              <span>{t("stats.heat.legend.high")}</span>
              <span className="ml-3 inline-flex items-center gap-1 text-rose-600">
                <AlertTriangle className="w-3 h-3" />
                {t("stats.heat.flagged")}
              </span>
            </div>
          </div>
        }
      </ChartCard>

      <ChartCard title={t("stats.chart.scatter")} subtitle={t("stats.chart.scatter.sub")}>
        {!subjects ? <EmptyChart msg={t("common.loading") || 'Loading…'} /> :
          aiVsExpert.length === 0 ? <EmptyChart msg={t("common.empty") || 'No data yet'} /> :
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 10, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
              <XAxis type="number" dataKey="aiScore" name="AI" domain={[0, 100]} tick={tickStyle} stroke={gridStroke} label={{ value: t("stats.scatter.x"), position: "insideBottom", offset: -2, style: { fill: "#64748b", fontSize: 11 } }} />
              <YAxis type="number" dataKey="expertScore" name="Expert" domain={[0, 100]} tick={tickStyle} stroke={gridStroke} label={{ value: t("stats.scatter.y"), angle: -90, position: "insideLeft", style: { fill: "#64748b", fontSize: 11 } }} />
              <ZAxis range={[60, 60]} />
              <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Scatter data={aiVsExpert} fill={COLORS.l2} fillOpacity={0.6} />
            </ScatterChart>
          </ResponsiveContainer>
        }
      </ChartCard>
    </div>
  );
}

/* ---------- REPORTS SECTION ---------- */

type ReportKind = 'compr' | 'passList' | 'itemAnalysis' | 'gradingStatus';

interface ReportRow {
  kind: ReportKind;
  titleKey: string;
  fmt: 'PDF' | 'Excel';
  ext: 'pdf' | 'xlsx';
  icon: React.ReactNode;
  triggerKey: string;
}

const REPORT_ROWS: ReportRow[] = [
  { kind: 'compr',         titleKey: 'stats.report.compr',         fmt: 'PDF',   ext: 'pdf',  icon: <FileText className="w-4 h-4" />,        triggerKey: 'stats.report.trigger.afterRound' },
  { kind: 'passList',      titleKey: 'stats.report.passList',      fmt: 'Excel', ext: 'xlsx', icon: <FileSpreadsheet className="w-4 h-4" />, triggerKey: 'stats.report.trigger.afterResults' },
  { kind: 'itemAnalysis',  titleKey: 'stats.report.itemAnalysis',  fmt: 'Excel', ext: 'xlsx', icon: <FileSpreadsheet className="w-4 h-4" />, triggerKey: 'stats.report.trigger.afterRound' },
  { kind: 'gradingStatus', titleKey: 'stats.report.gradingStatus', fmt: 'Excel', ext: 'xlsx', icon: <FileSpreadsheet className="w-4 h-4" />, triggerKey: 'stats.report.trigger.onDemand' },
];

async function fetchReportBlob(kind: ReportKind, params: ReportFilterParams): Promise<Blob> {
  switch (kind) {
    case 'compr':         return (await adminApi.downloadRoundComprehensive(params)).data;
    case 'passList':      return (await adminApi.downloadPassList(params)).data;
    case 'itemAnalysis':  return (await adminApi.downloadItemAnalysis(params)).data;
    case 'gradingStatus': return (await adminApi.downloadGradingStatus(params)).data;
  }
}

/**
 * Extract a server-suggested error message from a Blob-typed error response.
 * Axios doesn't auto-parse blobs, so we peek inside if it looks like JSON.
 */
async function extractBlobError(e: unknown): Promise<string | null> {
  const err = e as { response?: { data?: unknown } };
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.message === 'string') return parsed.message;
    } catch { /* not JSON, give up gracefully */ }
  }
  return null;
}

function ReportsSection() {
  const { t } = useI18n();
  const [rounds, setRounds] = useState<ReportRound[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(true);
  // Per-row selected round value. Defaults to latest once rounds load.
  const [selectedRounds, setSelectedRounds] = useState<Record<ReportKind, string>>({
    compr: '', passList: '', itemAnalysis: '', gradingStatus: '',
  });
  const [busyKind, setBusyKind] = useState<ReportKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoundsLoading(true);
    adminApi.getReportRounds()
      .then((res) => {
        if (cancelled) return;
        setRounds(res.data);
        const latest = res.data[0]?.value ?? '';
        setSelectedRounds({ compr: latest, passList: latest, itemAnalysis: latest, gradingStatus: latest });
      })
      .catch(() => {
        if (!cancelled) setError(t('stats.reports.error.roundsLoad'));
      })
      .finally(() => { if (!cancelled) setRoundsLoading(false); });
    return () => { cancelled = true; };
  }, [t]);

  const handleDownload = async (row: ReportRow) => {
    const round = selectedRounds[row.kind];
    setBusyKind(row.kind);
    setError(null);
    try {
      const blob = await fetchReportBlob(row.kind, round ? { round } : {});
      const filename = `${row.kind}${round ? `_${round}` : ''}.${row.ext}`;
      triggerBlobDownload(blob, filename);
    } catch (e) {
      const msg = await extractBlobError(e);
      setError(msg || t('stats.reports.error.downloadFailed'));
    } finally {
      setBusyKind(null);
    }
  };

  // ── Custom report state ────────────────────────────────────────────
  const defaultPeriod = useMemo(() => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const fromDate = new Date(now);
    fromDate.setMonth(fromDate.getMonth() - 6);
    return { from: fromDate.toISOString().slice(0, 10), to };
  }, []);
  const [customFrom, setCustomFrom] = useState(defaultPeriod.from);
  const [customTo, setCustomTo] = useState(defaultPeriod.to);
  const [customCert, setCustomCert] = useState<'all' | 'AXIS' | 'AXIS_C' | 'AXIS_H'>('all');
  const [customLevel, setCustomLevel] = useState<'all' | 'L1' | 'L2' | 'L3'>('all');
  const [customFields, setCustomFields] = useState<Record<'examinees' | 'scores' | 'results', boolean>>({
    examinees: true, scores: true, results: true,
  });
  const [customBusy, setCustomBusy] = useState(false);

  const handleCustomDownload = async () => {
    const fields = (['examinees', 'scores', 'results'] as const).filter((k) => customFields[k]);
    if (fields.length === 0) {
      setError(t('stats.reports.error.pickField'));
      return;
    }
    setCustomBusy(true);
    setError(null);
    try {
      const params: CustomReportParams = {
        from: customFrom || undefined,
        to: customTo || undefined,
        fields: fields.join(','),
      };
      if (customCert !== 'all') params.certType = customCert;
      if (customLevel !== 'all') params.level = customLevel;
      const res = await adminApi.downloadCustomReport(params);
      triggerBlobDownload(res.data, `custom_${customFrom}_${customTo}.xlsx`);
    } catch (e) {
      const msg = await extractBlobError(e);
      setError(msg || t('stats.reports.error.downloadFailed'));
    } finally {
      setCustomBusy(false);
    }
  };

  const selectClass =
    'px-2.5 py-1.5 text-xs rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50';
  const inputClass =
    'w-full px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="grid grid-cols-3 gap-4 mt-6">
      <Card className="col-span-2">
        <CardHeader
          title={t('stats.reports.scheduled')}
          right={<FileDown className="w-4 h-4 text-slate-400" />}
          className="!px-5 !py-4"
        />
        <div className="px-5 pb-5 pt-1">
          <p className="mb-4 text-[13px] text-[var(--gray-500)]">{t('stats.reports.scheduled.sub')}</p>
          {error && (
            <div className="mb-3 text-[12px] text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          <ul className="divide-y divide-slate-100">
            {REPORT_ROWS.map((r) => {
              const busy = busyKind === r.kind;
              return (
                <li key={r.kind} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center">
                    {r.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-900 truncate">{t(r.titleKey)}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <StatusBadge tone={r.fmt === 'PDF' ? 'red' : 'green'}>{r.fmt}</StatusBadge>
                      <span>{t(r.triggerKey)}</span>
                    </div>
                  </div>
                  <select
                    className={selectClass}
                    value={selectedRounds[r.kind]}
                    onChange={(e) =>
                      setSelectedRounds((prev) => ({ ...prev, [r.kind]: e.target.value }))
                    }
                    disabled={roundsLoading || rounds.length === 0}
                  >
                    {rounds.length === 0 && (
                      <option value="">
                        {roundsLoading ? t('common.loading') : t('stats.reports.roundSelect')}
                      </option>
                    )}
                    {rounds.map((rd) => (
                      <option key={rd.value} value={rd.value}>{rd.label}</option>
                    ))}
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleDownload(r)}
                    disabled={busy || roundsLoading}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    {busy
                      ? t('common.loading')
                      : r.fmt === 'PDF'
                        ? t('stats.reports.generate')
                        : t('stats.reports.download')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={t('stats.reports.custom')}
          right={<Settings2 className="w-4 h-4 text-slate-400" />}
          className="!px-5 !py-4"
        />
        <div className="px-5 pb-5 pt-1">
          <p className="mb-4 text-[13px] text-[var(--gray-500)]">{t('stats.reports.custom.sub')}</p>
          <div className="space-y-2.5">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">{t('stats.reports.field.period')}</label>
              <div className="flex items-center gap-1.5">
                <input type="date" className={inputClass} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                <span className="text-slate-400 text-xs">~</span>
                <input type="date" className={inputClass} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">{t('common.cert')}</label>
              <select className={inputClass} value={customCert} onChange={(e) => setCustomCert(e.target.value as typeof customCert)}>
                <option value="all">{t('common.all')}</option>
                <option value="AXIS">AXIS</option>
                <option value="AXIS_C">AXIS-C</option>
                <option value="AXIS_H">AXIS-H</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">{t('common.level')}</label>
              <select className={inputClass} value={customLevel} onChange={(e) => setCustomLevel(e.target.value as typeof customLevel)}>
                <option value="all">{t('common.all')}</option>
                <option value="L3">L3</option>
                <option value="L2">L2</option>
                <option value="L1">L1</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">{t('stats.reports.field.data')}</label>
              <div className="flex flex-wrap gap-2">
                {(['examinees', 'scores', 'results'] as const).map((k) => (
                  <label key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-700 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="rounded text-indigo-600 focus:ring-indigo-300"
                      checked={customFields[k]}
                      onChange={(e) => setCustomFields((prev) => ({ ...prev, [k]: e.target.checked }))}
                    />
                    {t(`stats.reports.field.${k}`)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            className="w-full justify-center mt-4"
            onClick={handleCustomDownload}
            disabled={customBusy}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {customBusy ? t('common.loading') : t('stats.reports.generateExcel')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

/* ---------- MAIN ---------- */

export function StatsScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState("overview");
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [passRate, setPassRate] = useState<PassRateStats | null>(null);
  const [subjects, setSubjects] = useState<SubjectStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      adminApi.getAdminDashboard(),
      adminApi.getAdminPassRate(),
      adminApi.getAdminSubjects(),
    ])
      .then(([d, p, s]) => {
        if (cancelled) return;
        setDashboard(d.data);
        setPassRate(p.data);
        setSubjects(s.data);
      })
      .catch((e) => !cancelled && setError(e?.response?.data?.message ?? 'Failed to load stats'));
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = [
    { id: "overview", label: t("stats.tab.overview") },
    { id: "passrate", label: t("stats.tab.passRate") },
    { id: "subject", label: t("stats.tab.subject") },
  ];

  return (
    <div>
      <PageHeader
        title={t("page.stats.title")}
        subtitle={t("page.stats.sub")}
      />

      {error && <Card className="p-4 mb-4 border-rose-200 bg-rose-50/40 text-sm text-rose-700">{error}</Card>}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />


      {tab === "overview" && <OverviewTab dashboard={dashboard} passRate={passRate} />}
      {tab === "passrate" && <PassRateTab passRate={passRate} />}
      {tab === "subject" && <SubjectTab subjects={subjects} />}

      <ReportsSection />
    </div>
  );
}
export default StatsScreen;
