"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";
import { Phone, MessageSquare, PhoneIncoming, PhoneOutgoing, IndianRupee } from "lucide-react";

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

type AccountTotals = {
  callsIn: number;
  callsOut: number;
  talkMinutes: number;
  whatsappSent: number;
  whatsappReceived: number;
  emailsSent: number;
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

type ExotelBalance = {
  balance: number | null;
  currency: string;
  pricingPlan: string | null;
  dateUpdated: string | null;
  accountSid: string;
  error?: string;
  debug?: { hasSid: boolean; hasKey: boolean; hasToken: boolean; sidHint?: string | null; keyHint?: string | null; tokenHint?: string | null };
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
    <div className="surface-card relative overflow-hidden rounded-2xl p-4 pl-5">
      <div className="kpi-accent-bar" style={{ background: accent }} />
      <div className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-[0.08] blur-2xl" style={{ background: accent }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="font-display text-[28px] font-extrabold leading-none tracking-tight" style={{ color: accent }}>
            {value}
          </p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">{label}</p>
          {sub && <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">{sub}</p>}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/[0.04]" style={{ background: `${accent}14` }}>
          <Icon className="h-4 w-4" style={{ color: accent }} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

function memberInitial(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  return ch || "?";
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
        const exoRes = await fetch("/api/admin/exotel-balance");
        const exoData = (await exoRes.json()) as ExotelBalance;
        setBalance(exoData);
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
      const qs = r.allTime ? "?allTime=1" : `?from=${r.from}&to=${r.to}`;
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
    () => [...users].sort((a, b) => b.totals.costs.totalInr - a.totals.costs.totalInr),
    [users]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* Header */}
      <header className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-faint)]">
            Admin · Usage
          </p>
          <h1 className="font-display mt-1 text-[26px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Team Analytics")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-faint)]">
            {range.allTime ? "All time" : `${windowDays} day${windowDays === 1 ? "" : "s"}`} · telephony, messaging, and API spend.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <Link
            href="/admin/team"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)]"
          >
            ← Team
          </Link>
        </div>
      </header>

      {/* Hero — telephony spend */}
      {accountTotals && !loading && (
        <div className="analytics-hero-cost animate-fade-up relative px-6 py-6" style={{ animationDelay: "60ms", animationFillMode: "both" }}>
          <div className="relative z-[1] flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9a4510]">
                Telephony spend · {range.allTime ? "all time" : `last ${windowDays} days`}
              </p>
              <p className="font-display mt-2 text-[42px] font-extrabold leading-none tracking-tight text-[#c45c1a]">
                {formatInr(accountTotals.costs.totalInr)}
              </p>
              <p className="mt-2 text-[12px] text-[var(--color-text-muted)]">
                Calls {formatInr(accountTotals.costs.callsInr)} · WhatsApp {formatInr(accountTotals.costs.whatsappInr)}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="rounded-xl bg-white/80 px-4 py-3 ring-1 ring-[#e8e4de]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Calls</p>
                <p className="font-display mt-0.5 text-xl font-bold text-[#1a73e8]">
                  {accountTotals.callsIn + accountTotals.callsOut}
                </p>
              </div>
              <div className="rounded-xl bg-white/80 px-4 py-3 ring-1 ring-[#e8e4de]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">WA msgs</p>
                <p className="font-display mt-0.5 text-xl font-bold text-[#25d366]">
                  {accountTotals.whatsappSent + accountTotals.whatsappReceived}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Account balances ─────────────────────────────────── */}
      <div className="surface-card animate-fade-up rounded-2xl p-5" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
        <h2 className="mb-4 font-display text-[13px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
          Live balances
        </h2>
        {balanceLoading ? (
          <div className="flex gap-4">
            {[...Array(2)].map((_, i) => <div key={i} className="skeleton-shimmer h-16 flex-1 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid gap-3">
            {balance?.error || !balance || balance.balance === null ? (
              <div className="flex flex-col gap-1 rounded-xl bg-[var(--color-surface-offset)]/60 px-4 py-4 ring-1 ring-[var(--color-border)]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Exotel Wallet</p>
                <p className="text-[12px] text-[var(--color-text-muted)]">{balance?.error ?? "Not configured"}</p>
              </div>
            ) : (
              <div className="flex items-center gap-4 rounded-xl bg-[#ecfdf5] px-4 py-4 ring-1 ring-[#a7f3d0]/60">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[var(--color-success)] shadow-sm">
                  <IndianRupee className="h-5 w-5" strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Exotel Wallet</p>
                  <p className="font-display text-[24px] font-extrabold leading-none text-[var(--color-success)]">
                    ₹{balance.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Usage KPIs ──────────────────────────────────────── */}
      {accountTotals && (
        <div className="animate-fade-up" style={{ animationDelay: "140ms", animationFillMode: "both" }}>
          <h2 className="mb-3 font-display text-[13px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
            Usage breakdown
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4">
            <KpiCard icon={PhoneIncoming}  label="Calls In"        value={accountTotals.callsIn}           accent="#1a73e8" />
            <KpiCard icon={PhoneOutgoing}  label="Calls Out"       value={accountTotals.callsOut}          accent="#4285f4" sub={`${accountTotals.talkMinutes} min talk`} />
            <KpiCard icon={MessageSquare}  label="WA Sent"         value={accountTotals.whatsappSent}      accent="#25d366" />
            <KpiCard icon={Phone}          label="WA Received"     value={accountTotals.whatsappReceived}  accent="#128c7e" sub={`${accountTotals.costs.whatsappSessionMsgs + accountTotals.costs.whatsappUtilityMsgs + accountTotals.costs.whatsappPromotionalMsgs} billed msgs`} />
            <KpiCard icon={IndianRupee}    label="Telephony Cost"  value={formatInr(accountTotals.costs.totalInr)} accent="#e37400" sub={`Calls ${formatInr(accountTotals.costs.callsInr)} · WA ${formatInr(accountTotals.costs.whatsappInr)}`} />
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-text-faint)]">
            Call ₹0.60/min (rounded up per call) · WA utility ₹0.11 · promotional ₹0.86 · session ₹0.06 per message (in + out).
          </p>
        </div>
      )}

      {/* ── Per-user breakdown ──────────────────────────────── */}
      <div className="animate-fade-up" style={{ animationDelay: "180ms", animationFillMode: "both" }}>
        <h2 className="mb-3 font-display text-[13px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
          Team members · sorted by spend
        </h2>

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
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Call cost</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">WA cost</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Total</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Tokens</th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Trend</th>
                  <th className="whitespace-nowrap px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sorted.map((u, idx) => {
                  const tokens = u.totals.tokensIn + u.totals.tokensOut;
                  const callTrend = u.series.map((d) => d.callsIn + d.callsOut);
                  const displayName = u.displayUsername || u.email || u.userId.slice(0, 8);
                  return (
                    <tr key={u.userId} className="transition-colors hover:bg-[var(--color-surface-offset)]/80">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="member-row-rank"
                            style={{
                              background: idx === 0 ? "#fdf4ec" : "var(--color-surface-offset)",
                              color: idx === 0 ? "#c45c1a" : "var(--color-text-muted)",
                            }}
                          >
                            {idx + 1}
                          </span>
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                            style={{ background: idx === 0 ? "#c45c1a" : "#4a443c" }}
                          >
                            {memberInitial(displayName)}
                          </div>
                          <div>
                            <div className="font-medium text-[var(--color-text)]">{displayName}</div>
                            <div className="text-[11px] text-[var(--color-text-faint)]">
                              {u.email ?? "—"} · {u.role}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.callsIn}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.callsOut}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.talkMinutes}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium text-[#25d366]">{u.totals.whatsappSent}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{u.totals.whatsappReceived}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{formatInr(u.totals.costs.callsInr)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{formatInr(u.totals.costs.whatsappInr)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#c45c1a]">
                        {formatInr(u.totals.costs.totalInr)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">{formatNumber(tokens)}</td>
                      <td className="px-4 py-3">
                        <MiniBars values={callTrend} color="var(--color-primary)" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        <Link
                          href={`/admin/analytics/${u.userId}`}
                          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-[var(--color-primary-tint)] px-2.5 py-1.5 text-[11px] font-semibold leading-none text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]"
                        >
                          Details
                          <span aria-hidden>→</span>
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
