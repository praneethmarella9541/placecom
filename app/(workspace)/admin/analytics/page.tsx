"use client";

import { useEffect, useMemo, useState } from "react";
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

function MiniBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-8 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: `${Math.max(2, (v / max) * 100)}%`,
            backgroundColor: color,
            opacity: v === 0 ? 0.2 : 1,
          }}
        />
      ))}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [users, setUsers] = useState<UserAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/analytics");
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
        setUsers(j.users ?? []);
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
  }, []);

  const sorted = useMemo(
    () => [...users].sort((a, b) => (b.totals.callsIn + b.totals.callsOut) - (a.totals.callsIn + a.totals.callsOut)),
    [users]
  );

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">
            {titleCase("Team Analytics")}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Last {windowDays} days · per-user activity across calls, messages and AI usage.
          </p>
        </div>
        <Link
          href="/admin/team"
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
        >
          ← Team
        </Link>
      </header>

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && sorted.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">No team members yet.</p>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="min-w-full divide-y divide-[var(--color-border)] text-sm">
            <thead className="bg-[var(--color-surface-offset)]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-muted)]">User</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">Calls in</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">Calls out</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">Talk mins</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">Msgs sent</th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">Tokens</th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-muted)]">Trend</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {sorted.map((u) => {
                const msgs = u.totals.smsSent + u.totals.whatsappSent + u.totals.emailsSent;
                const tokens = u.totals.tokensIn + u.totals.tokensOut;
                const callTrend = u.series.map((d) => d.callsIn + d.callsOut);
                return (
                  <tr key={u.userId} className="hover:bg-[var(--color-surface-offset)]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">
                        {u.displayUsername || u.email || u.userId.slice(0, 8)}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                        {u.email ?? "—"} · {u.role}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.totals.callsIn}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.totals.callsOut}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{u.totals.talkMinutes}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{msgs}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(tokens)}</td>
                    <td className="px-4 py-3">
                      <MiniBars values={callTrend} color="var(--color-primary)" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/analytics/${u.userId}`}
                        className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Details →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
