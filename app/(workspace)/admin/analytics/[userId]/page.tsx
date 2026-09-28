"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { titleCase } from "@/lib/title-case";
import { DateRangePicker, rangeEndingToday, type DateRange } from "@/components/DateRangePicker";

type Totals = {
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
};

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
  const color = accent || "var(--color-text)";
  return (
    <div className="surface-card relative overflow-hidden rounded-xl p-4 pl-5">
      <div className="kpi-accent-bar" style={{ background: color }} />
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)]">
        {label}
      </div>
      <div className="font-display mt-1 text-[26px] font-extrabold leading-none tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-faint)]">
        {title}
      </h2>
      {children}
    </section>
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

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/admin/analytics"
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            ← All team analytics
          </Link>
          {user && (
            <div className="mt-3 flex items-center gap-4">
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
                  {user.email ?? "—"} · {user.role} · {range.allTime ? "All time" : `${windowDays} day${windowDays === 1 ? "" : "s"}`}
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

      {loading && <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {user && (
        <SectionBlock title="Usage">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Emails sent" value={String(user.totals.emailsSent)} accent="#1a73e8" />
            <StatCard
              label="Tokens"
              value={(user.totals.tokensIn + user.totals.tokensOut).toLocaleString("en-IN")}
              sub={`${user.totals.tokensIn.toLocaleString("en-IN")} in · ${user.totals.tokensOut.toLocaleString("en-IN")} out`}
              accent="#4285f4"
            />
            <StatCard label="API cost" value={`$${user.totals.costUsd.toFixed(4)}`} accent="#e37400" />
          </div>
        </SectionBlock>
      )}
    </div>
  );
}
