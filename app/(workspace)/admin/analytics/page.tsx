"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeDayCount, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";
import { SHOW_SPEND, SHOW_TOKENS } from "@/lib/analytics-flags";
import { EmailsChart } from "@/components/analytics/EmailsChart";
import { InfoTip, METRIC_HELP } from "@/components/analytics/InfoTip";
import { fetchAnalytics } from "@/lib/analytics-prefetch";
import { Sparkline } from "@/components/analytics/Sparkline";
import { apiSeriesToPoints, bucketPoints, percent, relativeDay, toCsv, type DayPoint } from "@/lib/analytics-chart";
import { ArrowLeft, ChevronRight, Cpu, Download, IndianRupee, Loader2, Mail, MailOpen, MailX, Reply } from "lucide-react";

type ApiDayPoint = {
  date: string;
  /** Emails sent that day, and what has become of them since. */
  messages: number;
  opened?: number;
  replied?: number;
  bounced?: number;
  tokens: number;
};

type Totals = {
  emailsSent: number;
  opened: number;
  /** Emails whose opens can be measured — the open rate's base. */
  openTracked: number;
  replied: number;
  /** Addresses that couldn't be delivered to; `recipients` = addresses emailed. */
  bounced: number;
  recipients?: number;
  lastEmailAt?: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
};

type AccountTotals = {
  emailsSent: number;
  opened: number;
  openTracked: number;
  replied: number;
  bounced: number;
  recipients?: number;
  costUsd: number;
};

type UserAnalytics = {
  userId: string;
  email: string | null;
  displayUsername: string | null;
  role: string;
  totals: Totals;
  series: ApiDayPoint[];
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

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  info,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  /** One line on what the number means, behind an info icon beside the label. */
  info?: string;
}) {
  return (
    <div className="surface-card relative rounded-2xl p-4 pl-5">
      {/* Decoration is clipped on its own layer so the card itself doesn't clip the info tooltip. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div className="kpi-accent-bar" style={{ background: accent }} />
        <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-[0.08] blur-2xl" style={{ background: accent }} />
      </div>
      <div className="relative flex items-start justify-between">
        <div>
          <p className="font-display text-[28px] font-extrabold leading-none tracking-tight" style={{ color: accent }}>
            {value}
          </p>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
            {label}
            {info && <InfoTip text={info} label={label} />}
          </p>
          {sub && <p className="mt-0.5 text-[11.5px] text-[var(--color-text-muted)]">{sub}</p>}
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

/** A count with its share beside it ("12 40%"); `bad` paints a non-zero count in the danger colour. */
function OutcomeCell({ count, base, bad = false }: { count: number; base: number; bad?: boolean }) {
  return (
    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
      <span className={bad && count > 0 ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-text)]"}>
        {count.toLocaleString("en-IN")}
      </span>
      <span className="ml-1.5 text-[11.5px] text-[var(--color-text-faint)]">{percent(count, base)}</span>
    </td>
  );
}

const TH = "px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]";

export default function AdminAnalyticsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserAnalytics[]>([]);
  const [accountTotals, setAccountTotals] = useState<AccountTotals | null>(null);
  const [balance, setBalance] = useState<ExotelBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(SHOW_SPEND);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => rangeEndingToday(14));

  // Fetch Exotel balance once on mount — shared wallet, still drawn on by SMS.
  // Skipped entirely while spend is hidden, so no request is made for it.
  useEffect(() => {
    if (!SHOW_SPEND) return;
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

  type AnalyticsResponse = { users?: UserAnalytics[]; accountTotals?: AccountTotals; windowDays?: number; error?: string };

  /**
   * Ranges already fetched while on this page, so switching back to one is
   * instant (and then refreshed quietly). Lives only as long as the page does —
   * leaving and coming back always starts fresh, so a newly added member is
   * never hidden behind a remembered answer.
   */
  const rangeCache = useRef(new Map<string, AnalyticsResponse>());
  /** Ignores answers to a range the user has already clicked away from. */
  const latestRequest = useRef(0);

  const apply = useCallback((j: AnalyticsResponse) => {
    setUsers(j.users ?? []);
    setAccountTotals(j.accountTotals ?? null);
  }, []);

  const load = useCallback(async (r: DateRange) => {
    const requestId = ++latestRequest.current;
    const qs = r.allTime ? "?allTime=1" : `?from=${r.from}&to=${r.to}`;
    const cached = rangeCache.current.get(qs);
    setError(null);
    if (cached) apply(cached);
    // Only dim when there's nothing for this range on screen yet.
    setLoading(!cached);
    try {
      // Shared with hover-prefetch and the member pages (lib/analytics-prefetch.ts).
      const j = await fetchAnalytics<AnalyticsResponse>(qs);
      if (requestId !== latestRequest.current) return;
      rangeCache.current.set(qs, j);
      apply(j);
    } catch (e) {
      if (requestId !== latestRequest.current) return;
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [apply]);

  useEffect(() => { void load(range); }, [load, range]);

  // Busiest first: by spend when shown, otherwise by emails sent (then tokens,
  // when those are shown).
  const sorted = useMemo(
    () =>
      [...users].sort((a, b) =>
        SHOW_SPEND
          ? b.totals.costUsd - a.totals.costUsd
          : b.totals.emailsSent - a.totals.emailsSent ||
            (SHOW_TOKENS ? b.totals.tokensIn + b.totals.tokensOut - (a.totals.tokensIn + a.totals.tokensOut) : 0)
      ),
    [users]
  );

  const totalTokens = useMemo(
    () => users.reduce((n, u) => n + u.totals.tokensIn + u.totals.tokensOut, 0),
    [users]
  );
  const activeMembers = useMemo(
    () =>
      users.filter((u) => u.totals.emailsSent > 0 || (SHOW_TOKENS && u.totals.tokensIn + u.totals.tokensOut > 0))
        .length,
    [users]
  );

  // Team points for the chart (members only — admins are not in this list) and
  // per-member sparkline buckets, on one shared scale.
  const teamPoints = useMemo<DayPoint[]>(() => {
    const first = users[0]?.series;
    if (!first) return [];
    return first.map((d, i) => {
      const day = { date: d.date, sent: 0, opened: 0, replied: 0, bounced: 0 };
      for (const u of users) {
        const p = u.series[i];
        if (!p) continue;
        day.sent += p.messages;
        day.opened += p.opened ?? 0;
        day.replied += p.replied ?? 0;
        day.bounced += p.bounced ?? 0;
      }
      return day;
    });
  }, [users]);

  const sparkByUser = useMemo(() => {
    const map = new Map<string, ReturnType<typeof bucketPoints>["buckets"]>();
    for (const u of users) map.set(u.userId, bucketPoints(apiSeriesToPoints(u.series), { dayMax: 30, weekMax: 210 }).buckets);
    return map;
  }, [users]);
  const sparkMax = useMemo(() => {
    let max = 1;
    sparkByUser.forEach((buckets) => buckets.forEach((b) => { if (b.sent > max) max = b.sent; }));
    return max;
  }, [sparkByUser]);

  /** Downloads what the table shows, for the selected range. Built in the browser from the data already loaded. */
  function exportCsv() {
    const header = ["Member", "Email", "Role", "Emails sent", "Opened", "Responded", "Bounced", "Last email"];
    if (SHOW_TOKENS) header.push("AI tokens");
    if (SHOW_SPEND) header.push("API cost (USD)");
    const rows = sorted.map((u) => {
      const row: (string | number | null)[] = [
        u.displayUsername || u.email || u.userId,
        u.email,
        u.role,
        u.totals.emailsSent,
        u.totals.opened,
        u.totals.replied,
        u.totals.bounced,
        u.totals.lastEmailAt ? u.totals.lastEmailAt.slice(0, 10) : "",
      ];
      if (SHOW_TOKENS) row.push(u.totals.tokensIn + u.totals.tokensOut);
      if (SHOW_SPEND) row.push(u.totals.costUsd);
      return row;
    });
    // BOM so Excel reads names with accents as UTF-8.
    const blob = new Blob(["\uFEFF" + toCsv([header, ...rows])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = range.allTime ? "team-analytics-all-time.csv" : `team-analytics-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // From the selected range, not the last answer, so it changes the moment a range is picked.
  const selectedDays = range.allTime ? 0 : rangeDayCount(range);
  const rangeLabel = range.allTime ? "All time" : `Last ${selectedDays} day${selectedDays === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Header */}
      {/* z-[15]: this header's fade-in leaves it as its own layer; it must sit above the
          sections below (or the date popup would open under them) but under the app's
          fixed top bar (z-20), which it would otherwise slide over when scrolling. */}
      <header className="animate-fade-up relative z-[15] space-y-1.5">
        <Link
          href="/admin/team"
          className="-ml-2 inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[13.5px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          {titleCase("Team")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-text)]">
              {titleCase("Team Analytics")}
            </h1>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              {rangeLabel} · {SHOW_SPEND ? "email and API spend" : SHOW_TOKENS ? "emails sent and AI token usage" : "emails sent"}
              {loading && accountTotals && (
                <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-text-faint)]" role="status">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  Updating…
                </span>
              )}
            </p>
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      {/* ── Account balances (hidden while SHOW_SPEND is off) ───── */}
      {SHOW_SPEND && (
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
      )}

      {/* ── Summary cards ───────────────────────────────────── */}
      <section aria-label="Summary" className="animate-fade-up relative z-10" style={{ animationDelay: "140ms", animationFillMode: "both" }}>
        {loading && !accountTotals ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton-shimmer h-[92px] rounded-2xl" />)}
          </div>
        ) : accountTotals ? (
          <div
            aria-busy={loading}
            className={`grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${loading ? "opacity-60" : ""}`}
          >
            <KpiCard
              icon={Mail}
              label="Emails sent"
              value={accountTotals.emailsSent.toLocaleString("en-IN")}
              sub={`${activeMembers} of ${users.length} members sent email`}
              accent="#1a73e8"
              info={METRIC_HELP.sent}
            />
            <KpiCard
              icon={MailOpen}
              label="Opened"
              value={accountTotals.opened.toLocaleString("en-IN")}
              sub={accountTotals.openTracked > 0 ? `${percent(accountTotals.opened, accountTotals.openTracked)} of tracked emails` : "No tracked emails"}
              accent="#188038"
              info={METRIC_HELP.opened}
            />
            <KpiCard
              icon={Reply}
              label="Responded"
              value={accountTotals.replied.toLocaleString("en-IN")}
              sub="Replies received from recipients"
              accent="#c45c1a"
              info={METRIC_HELP.responded}
            />
            <KpiCard
              icon={MailX}
              label="Bounced"
              value={accountTotals.bounced.toLocaleString("en-IN")}
              sub={
                (accountTotals.recipients ?? 0) > 0
                  ? `${percent(accountTotals.bounced, accountTotals.recipients ?? 0)} of recipients`
                  : "No emails in this range"
              }
              accent="#d93025"
              info={METRIC_HELP.bounced}
            />
            {SHOW_TOKENS && (
              <KpiCard icon={Cpu} label="AI tokens used" value={formatNumber(totalTokens)} sub={`${totalTokens.toLocaleString("en-IN")} in total`} accent="#4285f4" />
            )}
            {SHOW_SPEND && <KpiCard icon={Cpu} label="API spend" value={`$${accountTotals.costUsd.toFixed(4)}`} accent="#e37400" />}
          </div>
        ) : null}
      </section>

      {/* ── Team emails over time ────────────────────────────── */}
      {!error && (loading && users.length === 0 ? (
        <div className="skeleton-shimmer h-[340px] rounded-2xl" />
      ) : teamPoints.length > 0 ? (
        <div className="animate-fade-up" style={{ animationDelay: "160ms", animationFillMode: "both" }}>
          <EmailsChart points={teamPoints} loading={loading} />
        </div>
      ) : null)}

      {/* ── Members ─────────────────────────────────────────── */}
      <section
        aria-label="Members"
        className="surface-card animate-fade-up overflow-hidden rounded-2xl"
        style={{ animationDelay: "180ms", animationFillMode: "both" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">Members</h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
              {SHOW_SPEND ? "Sorted by spend" : "Most emails first"} · click a member for their detail
            </p>
          </div>
          <button
            type="button"
            data-testid="analytics-export-csv"
            className="btn-secondary inline-flex items-center gap-2 px-3.5 disabled:opacity-50"
            disabled={loading || sorted.length === 0}
            onClick={exportCsv}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </button>
        </div>

        {error && (
          <div className="mx-5 mb-5 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
            <span>{error}</span>
            <button type="button" className="btn-secondary h-8 shrink-0 px-3 text-[12.5px]" onClick={() => void load(range)}>
              Retry
            </button>
          </div>
        )}

        {loading && !error && sorted.length === 0 && (
          <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-shimmer h-3.5 w-40 rounded" />
                  <div className="skeleton-shimmer h-2.5 w-56 rounded" />
                </div>
                <div className="skeleton-shimmer h-3 w-10 rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <div className="border-t border-[var(--color-border)] px-6 py-12 text-center">
            <p className="text-[14px] font-semibold text-[var(--color-text)]">{titleCase("No team members yet")}</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
              Add staff on the Team page and their usage will show up here.
            </p>
            <Link href="/admin/team" className="btn-secondary mt-4 px-4">
              {titleCase("Go to team")}
            </Link>
          </div>
        )}

        {!error && sorted.length > 0 && (
          <div
            aria-busy={loading}
            className={`overflow-x-auto border-t border-[var(--color-border)] transition-opacity ${loading ? "opacity-60" : ""}`}
          >
            <table className="min-w-full divide-y divide-[var(--color-border)] text-[13px]">
              <thead>
                <tr className="bg-[var(--color-surface-offset)]/50">
                  <th scope="col" className={`${TH} text-left`}>Member</th>
                  <th scope="col" className={`${TH} whitespace-nowrap text-right`}>Emails sent</th>
                  <th scope="col" className={`${TH} text-right`}>Opened</th>
                  <th scope="col" className={`${TH} text-right`}>Responded</th>
                  <th scope="col" className={`${TH} text-right`}>Bounced</th>
                  <th scope="col" className={`${TH} whitespace-nowrap text-left`}>Last email</th>
                  {SHOW_TOKENS && <th scope="col" className={`${TH} whitespace-nowrap text-right`}>AI tokens</th>}
                  {SHOW_SPEND && <th scope="col" className={`${TH} whitespace-nowrap text-right`}>API cost</th>}
                  <th scope="col" className={`${TH} whitespace-nowrap text-left`}>Trend</th>
                  <th scope="col" className="w-10 px-3 py-3"><span className="sr-only">Open member</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sorted.map((u, idx) => {
                  const tokens = u.totals.tokensIn + u.totals.tokensOut;
                  const displayName = u.displayUsername || u.email || u.userId.slice(0, 8);
                  return (
                    <tr
                      key={u.userId}
                      data-testid={`analytics-row-${u.userId}`}
                      onClick={() => router.push(`/admin/analytics/${u.userId}`)}
                      className="group cursor-pointer transition-colors hover:bg-[var(--color-surface-offset)]/80"
                    >
                      <td className="px-4 py-3">
                        {/* The row is clickable for mouse users; the name stays a real link for keyboards, screen readers and "open in new tab". */}
                        <Link
                          href={`/admin/analytics/${u.userId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]"
                        >
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
                          <div className="min-w-0">
                            <div className="truncate font-medium text-[var(--color-text)]">{displayName}</div>
                            <div className="truncate text-[11.5px] text-[var(--color-text-muted)]">
                              {u.email ?? "—"} · {u.role}
                            </div>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text)]">{u.totals.emailsSent.toLocaleString("en-IN")}</td>
                      <OutcomeCell count={u.totals.opened} base={u.totals.openTracked} />
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-text)]">
                        {u.totals.replied.toLocaleString("en-IN")}
                      </td>
                      <OutcomeCell count={u.totals.bounced} base={u.totals.recipients ?? u.totals.emailsSent} bad />
                      <td
                        className="whitespace-nowrap px-4 py-3 text-[var(--color-text-muted)]"
                        title={u.totals.lastEmailAt ? new Date(u.totals.lastEmailAt).toLocaleString("en-IN") : "No emails in this range"}
                      >
                        {relativeDay(u.totals.lastEmailAt)}
                      </td>
                      {SHOW_TOKENS && (
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]" title={`${tokens.toLocaleString("en-IN")} tokens`}>
                          {formatNumber(tokens)}
                        </td>
                      )}
                      {SHOW_SPEND && (
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#c45c1a]">
                          ${u.totals.costUsd.toFixed(4)}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Sparkline
                          buckets={sparkByUser.get(u.userId) ?? []}
                          max={sparkMax}
                          label={`${u.totals.emailsSent} emails sent in this range`}
                        />
                      </td>
                      <td className="w-10 px-3 py-3 text-right" aria-hidden>
                        <ChevronRight className="inline h-4 w-4 text-[var(--color-text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[var(--color-copper)]" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
