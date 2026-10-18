"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { fetchAnalytics } from "@/lib/analytics-prefetch";
import { percent } from "@/lib/analytics-chart";
import { titleCase } from "@/lib/title-case";
import type { DateRange } from "@/components/DateRangePicker";

type CompanyRow = {
  domain: string | null;
  name: string;
  logoUrl: string | null;
  personal: boolean;
  sent: number;
  opened: number;
  openTracked: number;
  replied: number;
  bounced: number;
  recipients: number;
};

/** Companies per page. */
const PAGE_SIZE = 10;

const TH = "px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]";

/**
 * One member's emails broken down by the company they went to (recipient email
 * domain, named from the shared company cache, then logo.dev). Loads on its own
 * request so the summary above never waits on company-name lookups.
 */
export function MemberCompanies({ userId, range }: { userId: string; range: DateRange }) {
  const [rows, setRows] = useState<CompanyRow[] | null>(null);
  /** Emails counted, and how many of them went to more than one company (so appear under each). */
  const [tally, setTally] = useState<{ emails: number; multi: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  /** Ignores answers to a range the user has already clicked away from. */
  const latestRequest = useRef(0);

  const rangeQs = range.allTime ? "allTime=1" : `from=${range.from}&to=${range.to}`;

  useEffect(() => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);
    setPage(0);
    setSearch("");
    fetchAnalytics<{ companies?: CompanyRow[]; companyEmails?: number; multiCompanyEmails?: number }>(
      `?userId=${encodeURIComponent(userId)}&breakdown=companies&${rangeQs}`
    )
      .then((json) => {
        if (requestId !== latestRequest.current) return;
        setRows(json.companies ?? []);
        setResultsMinHeight(0);
        setTally({ emails: json.companyEmails ?? 0, multi: json.multiCompanyEmails ?? 0 });
      })
      .catch((e) => {
        if (requestId === latestRequest.current) setError(e instanceof Error ? e.message : "Failed to load companies");
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false);
      });
  }, [userId, rangeQs]);

  const companyCount = (rows ?? []).filter((r) => r.domain && !r.personal).length;
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? (rows ?? []).filter((r) => r.name.toLowerCase().includes(needle) || (r.domain ?? "").includes(needle))
    : rows ?? [];
  const total = matches.length;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  const visible = matches.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  // Hold the results area at the height of the unfiltered list (its tallest page),
  // so a search that returns fewer companies, or none, doesn't shrink the section
  // and shove the rest of the page up and down. Reset whenever new data arrives.
  const resultsRef = useRef<HTMLDivElement>(null);
  const [resultsMinHeight, setResultsMinHeight] = useState(0);
  useLayoutEffect(() => {
    const el = resultsRef.current;
    if (el && rows && !needle) setResultsMinHeight((prev) => Math.max(prev, el.offsetHeight));
  }, [rows, page, needle]);

  const pager =
    total > PAGE_SIZE ? (
      <div className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
        <span className={`mr-1 tabular-nums ${loading ? "opacity-60" : ""}`}>
          {(current * PAGE_SIZE + 1).toLocaleString("en-IN")}–{Math.min((current + 1) * PAGE_SIZE, total).toLocaleString("en-IN")} of{" "}
          {total.toLocaleString("en-IN")}
        </span>
        {[
          { label: "Previous page", icon: ChevronLeft, disabled: current === 0, go: () => setPage(current - 1) },
          { label: "Next page", icon: ChevronRight, disabled: current >= lastPage, go: () => setPage(current + 1) },
        ].map(({ label, icon: Icon, disabled, go }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={go}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors enabled:hover:bg-[var(--color-surface-offset)] enabled:hover:text-[var(--color-text)] disabled:cursor-default disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]"
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
          </button>
        ))}
      </div>
    ) : null;

  return (
    <section aria-label="Emails by company" aria-busy={loading} className="surface-card overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-6 py-4">
        <div>
          <h2 className="font-display text-[16px] font-bold text-[var(--color-text)]">
            {titleCase("Emails by company")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
            {rows && tally && !loading
              ? [
                  `${tally.emails.toLocaleString("en-IN")} email${tally.emails === 1 ? "" : "s"} sent`,
                  `${companyCount.toLocaleString("en-IN")} compan${companyCount === 1 ? "y" : "ies"}`,
                  tally.multi > 0 &&
                    `${tally.multi.toLocaleString("en-IN")} went to more than one company, so ${tally.multi === 1 ? "it appears" : "they appear"} under each`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Who this member's emails went to"}
            {loading && rows && (
              <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-text-faint)]" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Updating…
              </span>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {rows && rows.length > 0 && (
            <div className="relative w-56">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-copper)]"
                strokeWidth={2}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder={titleCase("Search companies")}
                aria-label="Search companies"
                autoComplete="off"
                className="h-8 w-full rounded-lg pl-8 pr-3 text-[12.5px] outline-none search-field"
              />
            </div>
          )}
          {pager}
        </div>
      </div>

      {error && (
        <div className="px-6 py-4 text-[13px] text-[var(--color-danger)]">{error}</div>
      )}
      {loading && !rows && !error && (
        <div className="space-y-2 px-6 py-4" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton-shimmer h-10 rounded-lg" />)}
        </div>
      )}
      {rows && rows.length === 0 && !error && (
        <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-muted)]">No emails in this range.</p>
      )}

      <div ref={resultsRef} style={resultsMinHeight ? { minHeight: resultsMinHeight } : undefined}>
      {rows && rows.length > 0 && total === 0 && (
        <p className="px-6 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
          No companies match &ldquo;{search.trim()}&rdquo;.
        </p>
      )}

      {rows && total > 0 && (
        <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                <th className={TH}>Company</th>
                <th className={`${TH} text-right`}>Emails</th>
                <th className={`${TH} text-right`}>Opened</th>
                <th className={`${TH} text-right`}>Responded</th>
                <th className={`${TH} text-right`}>Bounced</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.domain ?? "unknown"} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <CompanyLogo logoUrl={r.logoUrl} size={32} fill />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--color-text)]">{r.name}</div>
                        <div className="truncate text-[11.5px] text-[var(--color-text-muted)]">
                          {r.domain ?? "Sent before recipients were recorded"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-[var(--color-text)]">
                    {r.sent.toLocaleString("en-IN")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    <span className="text-[var(--color-text)]">{r.opened.toLocaleString("en-IN")}</span>
                    <span className="ml-1.5 text-[11.5px] text-[var(--color-text-faint)]">{percent(r.opened, r.openTracked)}</span>
                    {/* Open rate at a glance: filled to opened ÷ trackable emails. */}
                    <div
                      aria-hidden
                      className="mt-1.5 ml-auto h-1 w-16 overflow-hidden rounded-full bg-[var(--color-surface-offset)]"
                    >
                      <div
                        className="h-full rounded-full bg-[#188038]"
                        style={{ width: r.openTracked > 0 ? `${Math.min(100, (r.opened / r.openTracked) * 100)}%` : "0%" }}
                      />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    <span className="text-[var(--color-text)]">{r.replied.toLocaleString("en-IN")}</span>
                    <span className="ml-1.5 text-[11.5px] text-[var(--color-text-faint)]">{percent(r.replied, r.sent)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    <span className={r.bounced > 0 ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-text)]"}>
                      {r.bounced.toLocaleString("en-IN")}
                    </span>
                    <span className="ml-1.5 text-[11.5px] text-[var(--color-text-faint)]">{percent(r.bounced, r.recipients)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </section>
  );
}
