"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeDayCount, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";
import { SHOW_SPEND, SHOW_TOKENS } from "@/lib/analytics-flags";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EmailsChart } from "@/components/analytics/EmailsChart";
import { fetchAnalytics } from "@/lib/analytics-prefetch";
import { InfoTip, METRIC_HELP } from "@/components/analytics/InfoTip";
import { apiSeriesToPoints, percent, relativeDay, teamAveragePoints, type ApiDayPoint } from "@/lib/analytics-chart";

type Totals = {
  emailsSent: number;
  opened?: number;
  /** Emails whose opens can be measured — the open rate's base. */
  openTracked?: number;
  replied?: number;
  bounced?: number;
  recipients?: number;
  lastEmailAt?: string | null;
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
  series?: ApiDayPoint[];
};

function StatCard({
  label,
  value,
  sub,
  accent,
  info,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  /** One line on what the number means, behind an info icon beside the label. */
  info?: string;
}) {
  const color = accent || "var(--color-text)";
  return (
    <div className="surface-card relative rounded-xl p-4 pl-5">
      {/* The accent bar is clipped on its own layer so the card doesn't clip the info tooltip. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <div className="kpi-accent-bar" style={{ background: color }} />
      </div>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)]">
        {label}
        {info && <InfoTip text={info} label={label} />}
      </div>
      <div className="font-display mt-1 text-[26px] font-extrabold leading-none tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

export default function AdminUserAnalyticsPage() {
  const params = useParams<{ userId: string }>();
  const userId = params?.userId as string | undefined;

  const [user, setUser] = useState<UserAnalytics | null>(null);
  /** Every team member's days, for the "team average" reference line. Optional: the chart just goes without. */
  const [teamSeries, setTeamSeries] = useState<ApiDayPoint[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(() => rangeEndingToday(14));

  /** Ranges already fetched on this page: switching back is instant, then refreshed quietly. */
  const rangeCache = useRef(new Map<string, { user: UserAnalytics | null; teamSeries: ApiDayPoint[][] }>());
  /** Ignores answers to a range the user has already clicked away from. */
  const latestRequest = useRef(0);

  const load = useCallback(
    async (r: DateRange) => {
      if (!userId) return;
      const requestId = ++latestRequest.current;
      const rangeQs = r.allTime ? "allTime=1" : `from=${r.from}&to=${r.to}`;
      const cached = rangeCache.current.get(rangeQs);
      setError(null);
      if (cached) {
        setUser(cached.user);
        setTeamSeries(cached.teamSeries);
      }
      // Only dim when there's nothing for this range on screen yet.
      setLoading(!cached);
      try {
        // One request: the team's answer has every member (for the average
        // line) including this one, and is shared with the analytics home and
        // hover-prefetch, so it's often already loaded.
        type Response = { users?: UserAnalytics[] };
        const team = await fetchAnalytics<Response>(`?${rangeQs}`);
        let member = (team.users ?? []).find((u) => u.userId === userId) ?? null;
        // Not in the team list (e.g. the admin's own page): ask for them directly.
        if (!member) {
          const own = await fetchAnalytics<Response>(`?userId=${encodeURIComponent(userId)}&${rangeQs}`);
          member = (own.users ?? [])[0] ?? null;
        }
        if (requestId !== latestRequest.current) return;
        const next = {
          user: member,
          teamSeries: (team.users ?? [])
            .map((u) => u.series)
            .filter((s): s is ApiDayPoint[] => Array.isArray(s) && s.length > 0),
        };
        rangeCache.current.set(rangeQs, next);
        setUser(next.user);
        setTeamSeries(next.teamSeries);
      } catch (e) {
        if (requestId !== latestRequest.current) return;
        setError(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        if (requestId === latestRequest.current) setLoading(false);
      }
    },
    [userId]
  );

  const activeDays = useMemo(() => (user?.series ?? []).filter((d) => d.messages > 0).length, [user]);
  const memberPoints = useMemo(() => (user?.series ? apiSeriesToPoints(user.series) : []), [user]);
  const teamAverage = useMemo(() => (teamSeries && teamSeries.length > 0 ? teamAveragePoints(teamSeries) : null), [teamSeries]);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      {/* Above the cards (date popup) but under the app's fixed top bar (z-20). */}
      <header className="relative z-[15] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/admin/analytics"
            className="-ml-2 inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[13.5px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {titleCase("All team analytics")}
          </Link>
          {user && (
            <div className="mt-2 flex items-center gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-md"
                style={{ background: "linear-gradient(135deg, #c45c1a, #9a4510)" }}
              >
                {(user.displayUsername || user.email || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <h1 className="font-display truncate text-[24px] font-bold tracking-tight text-[var(--color-text)]">
                  {user.displayUsername || user.email || titleCase("User Analytics")}
                </h1>
                <p className="truncate text-sm text-[var(--color-text-muted)]">
                  {user.email ?? "—"} · {user.role} · {range.allTime ? "All time" : `${rangeDayCount(range)} day${rangeDayCount(range) === 1 ? "" : "s"}`}
                  {loading && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-text-faint)]" role="status">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      Updating…
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
          {!user && (
            <h1 className="mt-1 font-display text-2xl font-bold text-[var(--color-text)]">
              {titleCase("User Analytics")}
            </h1>
          )}
        </div>
        <div className="shrink-0">
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </header>

      {loading && !user && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0].map((i) => <div key={i} className="skeleton-shimmer h-[88px] rounded-xl" />)}
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          <span>{error}</span>
          <button type="button" className="btn-secondary h-8 shrink-0 px-3 text-[12.5px]" onClick={() => void load(range)}>
            Retry
          </button>
        </div>
      )}
      {!loading && !error && !user && (
        <div className="surface-card rounded-2xl px-6 py-12 text-center">
          <p className="text-[14px] font-semibold text-[var(--color-text)]">{titleCase("Member not found")}</p>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            This person may have been removed from the team.
          </p>
        </div>
      )}

      {user && (
        <section
          aria-label="Summary"
          aria-busy={loading}
          className={`relative z-10 grid grid-cols-1 gap-3 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${loading ? "opacity-60" : ""}`}
        >
          <StatCard
            label="Emails sent"
            info={METRIC_HELP.sent}
            value={user.totals.emailsSent.toLocaleString("en-IN")}
            sub={`${activeDays} of ${user.series?.length ?? 0} days · last ${relativeDay(user.totals.lastEmailAt).toLowerCase()}`}
            accent="#1a73e8"
          />
          <StatCard
            label="Opened"
            info={METRIC_HELP.opened}
            value={(user.totals.opened ?? 0).toLocaleString("en-IN")}
            sub={
              (user.totals.openTracked ?? 0) > 0
                ? `${percent(user.totals.opened ?? 0, user.totals.openTracked ?? 0)} of tracked emails`
                : "No tracked emails"
            }
            accent="#188038"
          />
          <StatCard
            label="Responded"
            info={METRIC_HELP.responded}
            value={(user.totals.replied ?? 0).toLocaleString("en-IN")}
            sub="Replies received from recipients"
            accent="#c45c1a"
          />
          <StatCard
            label="Bounced"
            info={METRIC_HELP.bounced}
            value={(user.totals.bounced ?? 0).toLocaleString("en-IN")}
            sub={
              (user.totals.recipients ?? 0) > 0
                ? `${percent(user.totals.bounced ?? 0, user.totals.recipients ?? 0)} of recipients`
                : "No emails in this range"
            }
            accent="#d93025"
          />
          {SHOW_TOKENS && (
              <StatCard
                label="Tokens"
                value={(user.totals.tokensIn + user.totals.tokensOut).toLocaleString("en-IN")}
                sub={`${user.totals.tokensIn.toLocaleString("en-IN")} in · ${user.totals.tokensOut.toLocaleString("en-IN")} out`}
                accent="#4285f4"
              />
            )}
            {SHOW_SPEND && <StatCard label="API cost" value={`$${user.totals.costUsd.toFixed(4)}`} accent="#e37400" />}
        </section>
      )}


      {user && memberPoints.length > 0 && (
        <EmailsChart
          points={memberPoints}
          loading={loading}
          scopeLabel="by this member"
          reference={teamAverage ? { label: "Team average", points: teamAverage } : undefined}
        />
      )}
    </div>
  );
}
