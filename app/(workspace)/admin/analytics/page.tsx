"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";
import { Phone, MessageSquare, Mail, Zap, TrendingDown, PhoneIncoming, PhoneOutgoing } from "lucide-react";

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
  whatsappReceived: number;
  emailsSent: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

type AccountTotals = {
  callsIn: number;
  callsOut: number;
  talkMinutes: number;
  smsSent: number;
  whatsappSent: number;
  whatsappReceived: number;
  emailsSent: number;
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

type ExotelBalance = {
  balance: number | null;
  currency: string;
  pricingPlan: string | null;
  dateUpdated: string | null;
  accountSid: string;
  error?: string;
  debug?: { hasSid: boolean; hasKey: boolean; hasToken: boolean };
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
          style={{ height: `${Math.max(2, (v / max) * 100)}%`, backgroundColor: color, opacity: v === 0 ? 0.2 : 1 }}
        />
      ))}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="surface-card relative overflow-hidden rounded-2xl p-4">
      <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-10 blur-2xl" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="font-display text-[28px] font-extrabold leading-none tracking-tight" style={{ color: accent }}>
            {value}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">{label}</p>
          {sub && <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">{sub}</p>}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${accent}18` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [users, setUsers] = useState<UserAnalytics[]>([]);
  const [accountTotals, setAccountTotals] = useState<AccountTotals | null>(null);
  const [balance, setBalance] = useState<ExotelBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(14);
  const [range, setRange] = useState<DateRange>(() => rangeEndingToday(14));

  // Fetch Exotel balance once on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/exotel-balance");
        const j = (await res.json()) as ExotelBalance;
        setBalance(j);
      } catch {
        setBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    })();
  }, []);

  const load = useCallback(async (r: DateRange) => {
    setLoading(true);
    setError(null);
    try {
      const qs = `?from=${r.from}&to=${r.to}`;
      const res = await fetch(`/api/admin/analytics${qs}`);
      const j = (await res.json().catch(() => ({}))) as {
        users?: UserAnalytics[];
        accountTotals?: AccountTotals;
        windowDays?: number;
        error?: string;
      };
      if (!res.ok) { setError(j.error ?? "Failed to load analytics"); return; }
      setUsers(j.users ?? []);
      setAccountTotals(j.accountTotals ?? null);
      if (j.windowDays) setWindowDays(j.windowDays);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [load, range]);

  const sorted = useMemo(
    () => [...users].sort((a, b) => (b.totals.callsIn + b.totals.callsOut) - (a.totals.callsIn + a.totals.callsOut)),
    [users]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Team Analytics")}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-faint)]">
            {windowDays} day{windowDays === 1 ? "" : "s"} · calls, messages, AI usage and Exotel balance.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <Link
            href="/admin/team"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
          >
            ← Team
          </Link>
        </div>
      </header>

      {/* ── Exotel balance card ─────────────────────────────── */}
      <div className="surface-card rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[14px] font-semibold text-[var(--color-text)]">Exotel Account Balance</h2>
          {balance?.dateUpdated && (
            <span className="text-[11px] text-[var(--color-text-faint)]">Updated {balance.dateUpdated}</span>
          )}
        </div>
        {balanceLoading ? (
          <div className="flex gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton-shimmer h-14 flex-1 rounded-xl" />)}
          </div>
        ) : balance?.error || !balance || balance.balance === null ? (
          <div className="space-y-1">
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {balance?.error ?? "Exotel not configured — set EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN."}
            </p>
            {balance?.debug && (
              <p className="font-mono text-[11px] text-[var(--color-text-faint)]">
                SID: {balance.debug.hasSid ? "✓" : "✗"} · API Key: {balance.debug.hasKey ? "✓" : "✗"} · API Token: {balance.debug.hasToken ? "✓" : "✗"}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            <div className="flex min-w-[160px] flex-1 flex-col gap-0.5 rounded-xl bg-[var(--color-surface-offset)]/50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Wallet Balance</p>
              <p className="font-display text-[26px] font-extrabold leading-none text-[var(--color-success)]">
                ₹{balance.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-[11px] text-[var(--color-text-faint)]">{balance.currency}</p>
            </div>
            <div className="flex min-w-[160px] flex-1 flex-col gap-0.5 rounded-xl bg-[var(--color-surface-offset)]/50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Pricing Plan</p>
              <p className="mt-1 text-[15px] font-semibold text-[var(--color-text)]">{balance.pricingPlan ?? "—"}</p>
            </div>
            <div className="flex min-w-[160px] flex-1 flex-col gap-0.5 rounded-xl bg-[var(--color-surface-offset)]/50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Account SID</p>
              <p className="mt-1 font-mono text-[13px] text-[var(--color-text)]">{balance.accountSid}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Account-level KPIs ──────────────────────────────── */}
      {accountTotals && (
        <div>
          <h2 className="mb-3 font-display text-[14px] font-semibold text-[var(--color-text)]">
            Account Totals · <span className="font-normal text-[var(--color-text-faint)]">last {windowDays} days, all team members</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
            <KpiCard icon={PhoneIncoming}  label="Calls In"        value={accountTotals.callsIn}           accent="#1a73e8" />
            <KpiCard icon={PhoneOutgoing}  label="Calls Out"       value={accountTotals.callsOut}          accent="#4285f4" sub={`${accountTotals.talkMinutes} min talk`} />
            <KpiCard icon={MessageSquare}  label="WA Sent"         value={accountTotals.whatsappSent}      accent="#25d366" />
            <KpiCard icon={Phone}          label="WA Received"     value={accountTotals.whatsappReceived}  accent="#128c7e" />
            <KpiCard icon={Mail}           label="Emails Sent"     value={accountTotals.emailsSent}        accent="#f29900" />
            <KpiCard icon={MessageSquare}  label="SMS Sent"        value={accountTotals.smsSent}           accent="#188038" />
            <KpiCard icon={Zap}            label="Total Messages"  value={accountTotals.whatsappSent + accountTotals.smsSent + accountTotals.emailsSent} accent="#8430ce" />
            <KpiCard icon={TrendingDown}   label="AI Cost"         value={`$${accountTotals.costUsd.toFixed(4)}`} accent="#d93025" sub="OpenAI extraction" />
          </div>
        </div>
      )}

      {/* ── Per-user table ──────────────────────────────────── */}
      <div>
        <h2 className="mb-3 font-display text-[14px] font-semibold text-[var(--color-text)]">Per-User Breakdown</h2>

        {loading && <p className="text-[13px] text-[var(--color-text-muted)]">Loading…</p>}
        {error && <p className="text-[13px] text-[var(--color-danger)]">{error}</p>}

        {!loading && !error && sorted.length === 0 && (
          <p className="text-[13px] text-[var(--color-text-muted)]">No team members yet.</p>
        )}

        {!loading && !error && sorted.length > 0 && (
          <div className="surface-card overflow-x-auto rounded-2xl">
            <table className="min-w-full divide-y divide-[var(--color-border)] text-[13px]">
              <thead>
                <tr className="bg-[var(--color-surface-offset)]/50">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">User</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Calls In</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Calls Out</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Talk min</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">WA Sent</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">WA Recv</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">SMS</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Emails</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Tokens</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Trend</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sorted.map((u) => {
                  const tokens = u.totals.tokensIn + u.totals.tokensOut;
                  const callTrend = u.series.map((d) => d.callsIn + d.callsOut);
                  return (
                    <tr key={u.userId} className="transition-colors hover:bg-[var(--color-surface-offset)]">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--color-text)]">
                          {u.displayUsername || u.email || u.userId.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-faint)]">
                          {u.email ?? "—"} · {u.role}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.callsIn}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.callsOut}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.talkMinutes}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-[#25d366]">{u.totals.whatsappSent}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.whatsappReceived}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.smsSent}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.emailsSent}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{formatNumber(tokens)}</td>
                      <td className="px-4 py-3">
                        <MiniBars values={callTrend} color="var(--color-primary)" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/analytics/${u.userId}`}
                          className="text-[12px] font-medium text-[var(--color-primary)] hover:underline"
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
    </div>
  );
}
