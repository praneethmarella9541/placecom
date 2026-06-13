"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";
import {
  bucketSeriesForChart,
  chartLabelStep,
  formatChartXLabel,
  type ChartDayPoint,
} from "@/lib/analytics-chart-utils";

type UsageCosts = {
  callsInr: number;
  whatsappInr: number;
  totalInr: number;
  callBillableMinutes: number;
  whatsappUtilityMsgs: number;
  whatsappPromotionalMsgs: number;
  whatsappSessionMsgs: number;
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type DayPoint = {
  date: string;
  callsIn: number;
  callsOut: number;
  messages: number;
  tokens: number;
};

type Totals = {
  callsIn: number;
  callsOut: number;
  callsFailed: number;
  talkMinutes: number;
  whatsappSent: number;
  whatsappReceived: number;
  emailsSent: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costs: UsageCosts;
};

type UserAnalytics = {
  userId: string;
  email: string | null;
  displayUsername: string | null;
  role: string;
  totals: Totals;
  callStatusBreakdown: Record<string, number>;
  series: DayPoint[];
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div
        className="mt-1 text-2xl font-bold"
        style={{ color: accent || "var(--color-text)" }}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

/** Stacked bars: incoming + outgoing per day. */
function CallsPerDayChart({ series }: { series: DayPoint[] }) {
  const chartSeries = useMemo(() => bucketSeriesForChart(series as ChartDayPoint[]), [series]);
  const labelStep = chartLabelStep(chartSeries.length);
  const max = Math.max(1, ...chartSeries.map((d) => d.callsIn + d.callsOut));
  const width = 600;
  const height = 160;
  const padding = { top: 12, right: 12, bottom: 24, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barWidth = innerW / chartSeries.length;
  const barGap = Math.max(2, barWidth * 0.2);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Calls per day</h3>
        <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[var(--color-primary)]" /> Outgoing
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-indigo-500" /> Incoming
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        {/* y-axis ticks */}
        {[0, 0.5, 1].map((t) => {
          const y = padding.top + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity="0.1"
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="currentColor"
                opacity="0.55"
              >
                {Math.round(max * t)}
              </text>
            </g>
          );
        })}
        {chartSeries.map((d, i) => {
          const total = d.callsIn + d.callsOut;
          const totalH = (total / max) * innerH;
          const outH = (d.callsOut / max) * innerH;
          const inH = (d.callsIn / max) * innerH;
          const x = padding.left + i * barWidth + barGap / 2;
          const w = barWidth - barGap;
          return (
            <g key={`${d.date}-${i}`}>
              {/* Outgoing on bottom */}
              <rect
                x={x}
                y={padding.top + innerH - outH}
                width={w}
                height={outH}
                rx={2}
                fill="var(--color-primary)"
              />
              {/* Incoming stacked on top */}
              <rect
                x={x}
                y={padding.top + innerH - totalH}
                width={w}
                height={inH}
                rx={2}
                fill="#6366f1"
              />
              {/* x-axis labels — spaced to avoid overlap */}
              {i % labelStep === 0 && (
                <text
                  x={x + w / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.55"
                >
                  {formatChartXLabel(d.date, chartSeries.length)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SimpleBarChart({
  series,
  field,
  title,
  color,
}: {
  series: DayPoint[];
  field: "messages" | "tokens";
  title: string;
  color: string;
}) {
  const chartSeries = useMemo(() => bucketSeriesForChart(series as ChartDayPoint[]), [series]);
  const labelStep = chartLabelStep(chartSeries.length);
  const values = chartSeries.map((d) => d[field]);
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 140;
  const padding = { top: 12, right: 12, bottom: 24, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barWidth = innerW / chartSeries.length;
  const barGap = Math.max(2, barWidth * 0.2);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
        {[0, 0.5, 1].map((t) => {
          const y = padding.top + innerH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity="0.1"
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="currentColor"
                opacity="0.55"
              >
                {field === "tokens" ? formatNumber(Math.round(max * t)) : Math.round(max * t)}
              </text>
            </g>
          );
        })}
        {chartSeries.map((d, i) => {
          const v = d[field];
          const h = (v / max) * innerH;
          const x = padding.left + i * barWidth + barGap / 2;
          const w = barWidth - barGap;
          return (
            <g key={`${d.date}-${i}`}>
              <rect
                x={x}
                y={padding.top + innerH - h}
                width={w}
                height={h}
                rx={2}
                fill={color}
                opacity={v === 0 ? 0.2 : 1}
              />
              {i % labelStep === 0 && (
                <text
                  x={x + w / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.55"
                >
                  {formatChartXLabel(d.date, chartSeries.length)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MessagesByChannel({ totals }: { totals: Totals }) {
  const rows = [
    { label: "Email", value: totals.emailsSent, color: "var(--color-primary)" },
    { label: "WhatsApp", value: totals.whatsappSent, color: "#25D366" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">Messages by channel</h3>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-muted)]">{r.label}</span>
              <span className="font-medium tabular-nums text-[var(--color-text)]">{r.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
              <div
                className="h-full rounded-full"
                style={{ width: `${(r.value / max) * 100}%`, backgroundColor: r.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminUserAnalyticsPage() {
  const params = useParams<{ userId: string }>();
  const userId = params?.userId as string | undefined;

  const [user, setUser] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);
  const [range, setRange] = useState<DateRange>(() => rangeEndingToday(14));

  const load = useCallback(
    async (r: DateRange) => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const qs = r.allTime
          ? `?userId=${encodeURIComponent(userId)}&allTime=1`
          : `?userId=${encodeURIComponent(userId)}&from=${r.from}&to=${r.to}`;
        const res = await fetch(`/api/admin/analytics${qs}`);
        const j = (await res.json().catch(() => ({}))) as {
          users?: UserAnalytics[];
          windowDays?: number;
          error?: string;
        };
        if (!res.ok) {
          setError(j.error ?? "Failed to load analytics");
          return;
        }
        setUser((j.users ?? [])[0] ?? null);
        if (j.windowDays) setWindowDays(j.windowDays);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const totalCalls = user ? user.totals.callsIn + user.totals.callsOut : 0;

  const statusRows = useMemo(() => {
    if (!user) return [];
    const entries = Object.entries(user.callStatusBreakdown).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((n, [, v]) => n + v, 0) || 1;
    const colors: Record<string, string> = {
      completed: "#10b981",
      "no-answer": "#f59e0b",
      missed: "#ef4444",
      busy: "#fb923c",
      failed: "#ef4444",
      "in-progress": "#3b82f6",
      pending: "#9ca3af",
    };
    return entries.map(([status, count]) => ({
      status,
      count,
      pct: Math.round((count / total) * 100),
      color: colors[status] ?? "#6b7280",
    }));
  }, [user]);

  return (
    <div className="space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/admin/analytics"
            className="text-xs text-[var(--color-text-muted)] hover:underline"
          >
            ← All team analytics
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-text)]">
            {user?.displayUsername || user?.email || titleCase("User Analytics")}
          </h1>
          {user && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {user.email ?? "—"} · {user.role} · {range.allTime ? "All time" : `${windowDays} day${windowDays === 1 ? "" : "s"}`}
            </p>
          )}
        </div>
      </header>

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {user && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Total calls" value={String(totalCalls)} sub={`${user.totals.callsIn} in · ${user.totals.callsOut} out`} />
            <StatCard label="Talk minutes" value={String(user.totals.costs.callBillableMinutes)} />
            <StatCard label="Call cost" value={formatInr(user.totals.costs.callsInr)} sub="₹0.60/min, rounded up per call" accent="#1a73e8" />
            <StatCard label="WhatsApp msgs" value={String(user.totals.whatsappSent + user.totals.whatsappReceived)} sub={`${user.totals.whatsappSent} sent · ${user.totals.whatsappReceived} received`} accent="#25d366" />
            <StatCard label="WA cost" value={formatInr(user.totals.costs.whatsappInr)} sub={`${user.totals.costs.whatsappUtilityMsgs} utility · ${user.totals.costs.whatsappPromotionalMsgs} promo · ${user.totals.costs.whatsappSessionMsgs} session`} accent="#128c7e" />
            <StatCard label="Telephony total" value={formatInr(user.totals.costs.totalInr)} sub="Calls + WhatsApp" accent="#e37400" />
            <StatCard label="Messages sent" value={String(user.totals.whatsappSent + user.totals.emailsSent)} sub={`${user.totals.emailsSent} email · ${user.totals.whatsappSent} WA`} />
            <StatCard label="AI cost (USD)" value={`$${user.totals.costUsd.toFixed(2)}`} sub="OpenAI extraction" />
          </div>

          {/* Charts */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Activity over time</h2>
            <DateRangePicker value={range} onChange={setRange} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CallsPerDayChart series={user.series} />
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <SimpleBarChart series={user.series} field="tokens" title="Tokens per day" color="#8b5cf6" />
            </div>
          </div>

          {/* Charts row 2 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <SimpleBarChart series={user.series} field="messages" title="Messages per day" color="var(--color-primary)" />
            </div>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4">
              <MessagesByChannel totals={user.totals} />
              {statusRows.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)]">Call status breakdown</h3>
                  <div className="flex h-2 overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
                    {statusRows.map((r) => (
                      <div key={r.status} style={{ width: `${r.pct}%`, backgroundColor: r.color }} title={`${r.status}: ${r.count}`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--color-text-muted)]">
                    {statusRows.map((r) => (
                      <span key={r.status} className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: r.color }} />
                        {r.status}: {r.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
