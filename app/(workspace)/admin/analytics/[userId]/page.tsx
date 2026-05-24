"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";

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
  smsSent: number;
  whatsappSent: number;
  emailsSent: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
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
  const max = Math.max(1, ...series.map((d) => d.callsIn + d.callsOut));
  const width = 600;
  const height = 160;
  const padding = { top: 12, right: 12, bottom: 24, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barWidth = innerW / series.length;
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
            <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Incoming
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
        {series.map((d, i) => {
          const total = d.callsIn + d.callsOut;
          const totalH = (total / max) * innerH;
          const outH = (d.callsOut / max) * innerH;
          const inH = (d.callsIn / max) * innerH;
          const x = padding.left + i * barWidth + barGap / 2;
          const w = barWidth - barGap;
          return (
            <g key={d.date}>
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
                fill="#10b981"
              />
              {/* x-axis label every 2 days to avoid overlap */}
              {i % 2 === 0 && (
                <text
                  x={x + w / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.55"
                >
                  {d.date.slice(5)}
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
  const values = series.map((d) => d[field]);
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 140;
  const padding = { top: 12, right: 12, bottom: 24, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const barWidth = innerW / series.length;
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
        {series.map((d, i) => {
          const v = d[field];
          const h = (v / max) * innerH;
          const x = padding.left + i * barWidth + barGap / 2;
          const w = barWidth - barGap;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={padding.top + innerH - h}
                width={w}
                height={h}
                rx={2}
                fill={color}
                opacity={v === 0 ? 0.2 : 1}
              />
              {i % 2 === 0 && (
                <text
                  x={x + w / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="currentColor"
                  opacity="0.55"
                >
                  {d.date.slice(5)}
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
    { label: "SMS", value: totals.smsSent, color: "#6366F1" },
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

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/analytics?userId=${encodeURIComponent(userId)}`);
        const j = (await res.json().catch(() => ({}))) as {
          users?: UserAnalytics[];
          windowDays?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(j.error ?? "Failed to load analytics");
          return;
        }
        setUser((j.users ?? [])[0] ?? null);
        if (j.windowDays) setWindowDays(j.windowDays);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const totalCalls = user ? user.totals.callsIn + user.totals.callsOut : 0;
  const totalTokens = user ? user.totals.tokensIn + user.totals.tokensOut : 0;

  const statusRows = useMemo(() => {
    if (!user) return [];
    const entries = Object.entries(user.callStatusBreakdown).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((n, [, v]) => n + v, 0) || 1;
    const colors: Record<string, string> = {
      completed: "#10b981",
      "no-answer": "#f59e0b",
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
      <header className="flex items-end justify-between gap-4">
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
              {user.email ?? "—"} · {user.role} · last {windowDays} days
            </p>
          )}
        </div>
      </header>

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {user && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total calls" value={String(totalCalls)} sub={`${user.totals.callsIn} in · ${user.totals.callsOut} out`} />
            <StatCard label="Talk minutes" value={String(user.totals.talkMinutes)} sub="completed calls only" />
            <StatCard label="Failed calls" value={String(user.totals.callsFailed)} accent={user.totals.callsFailed > 0 ? "#ef4444" : undefined} />
            <StatCard label="Messages sent" value={String(user.totals.smsSent + user.totals.whatsappSent + user.totals.emailsSent)} sub={`${user.totals.emailsSent} email · ${user.totals.whatsappSent} WA · ${user.totals.smsSent} SMS`} />
            <StatCard label="Tokens used" value={formatNumber(totalTokens)} sub={`${formatNumber(user.totals.tokensIn)} in · ${formatNumber(user.totals.tokensOut)} out`} />
            <StatCard label="AI cost (USD)" value={`$${user.totals.costUsd.toFixed(2)}`} sub="estimated" />
          </div>

          {/* Charts row 1 */}
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
