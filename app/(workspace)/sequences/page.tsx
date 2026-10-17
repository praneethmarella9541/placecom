"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Loader2, Pause, Play, Plus, Search, Trash2, Users, Workflow } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { CreateNamePopup } from "@/components/CreateNamePopup";
import { SequenceStatusPill } from "@/components/SequenceStatusPill";
import type { SequenceListItem } from "@/lib/sequence-types";
import {
  getSequencesPrefetchCache,
  setSequencesPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

type Filter = "all" | "scheduled" | "sequence";

/** "Wed, 14 Oct, 9:00 am" in the viewer's own time zone. */
function formatNextSend(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Everyone is done and nothing is queued — the flow ran its course. */
function isFinished(s: SequenceListItem): boolean {
  return s.status === "active" && s.recipientCount > 0 && s.counts.active === 0 && s.counts.paused === 0;
}

export default function ScheduledPage() {
  const router = useRouter();
  const [sequences, setSequences] = useState<SequenceListItem[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreatePopup, setShowCreatePopup] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const cached = getSequencesPrefetchCache();
    if (cached?.sequences.length) {
      setSequences(cached.sequences as SequenceListItem[]);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = await fetch("/api/sequences", { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string;
        sequences?: SequenceListItem[];
        schedulerLastRunAt?: string | null;
        overdueCount?: number;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load scheduled emails");
      setSequences(data.sequences || []);
      setOverdueCount(data.overdueCount ?? 0);
      setSequencesPrefetchCache({
        sequences: data.sequences || [],
        schedulerLastRunAt: data.schedulerLastRunAt ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(name: string) {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { error?: string; id?: string };
      if (!res.ok) throw new Error(data.error || "Could not create sequence");
      if (!data.id) throw new Error("Invalid response");
      setShowCreatePopup(false);
      router.push(`/sequences/${encodeURIComponent(data.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(s: SequenceListItem) {
    if (deletingId) return;
    const label = s.name?.trim() || "Untitled";
    const message =
      s.status === "draft" && s.recipientCount === 0
        ? `Delete "${label}"? It hasn't sent anything yet and will be removed.`
        : `Cancel and remove "${label}"? No more emails will go out and it leaves this list. Mail already sent is not recalled.`;
    if (!window.confirm(message)) return;
    setDeletingId(s.id);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not remove it");
      setSequences((prev) => prev.filter((x) => x.id !== s.id));
      const cached = getSequencesPrefetchCache();
      if (cached) {
        setSequencesPrefetchCache({
          ...cached,
          sequences: cached.sequences.filter((x) => (x as SequenceListItem).id !== s.id),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove it");
    } finally {
      setDeletingId(null);
    }
  }

  /** Pause or resume a whole flow from the list, without opening it. */
  async function handleToggle(s: SequenceListItem) {
    if (togglingId) return;
    const action = s.status === "active" ? "pause" : "resume";
    setTogglingId(s.id);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(s.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Could not ${action} it`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${action} it`);
    } finally {
      setTogglingId(null);
    }
  }

  const counts = useMemo(
    () => ({
      all: sequences.length,
      scheduled: sequences.filter((s) => s.origin === "scheduled").length,
      sequence: sequences.filter((s) => s.origin !== "scheduled").length,
    }),
    [sequences],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sequences.filter((s) => {
      if (filter === "scheduled" && s.origin !== "scheduled") return false;
      if (filter === "sequence" && s.origin === "scheduled") return false;
      return !q || s.name.toLowerCase().includes(q);
    });
  }, [sequences, search, filter]);

  const empty = !loading && sequences.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Scheduled")}
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-[var(--color-text-muted)]">
            Emails queued to send on their own, even when you are away. Schedule one from Compose: turn on Mass
            sending, then Scheduling.
          </p>
        </div>
        <button
          data-testid="sequences-create-btn"
          type="button"
          title="Build a multi-step sequence from scratch"
          onClick={() => {
            setError(null);
            setShowCreatePopup(true);
          }}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-copper)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-copper-hover)]"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {titleCase("New sequence")}
        </button>
      </div>

      {showCreatePopup ? (
        <CreateNamePopup
          icon={<Workflow className="h-5 w-5" strokeWidth={2} />}
          title="New sequence"
          placeholder="Sequence name, e.g. Recruiter Outreach"
          creating={creating}
          error={error}
          onSubmit={(name) => void handleCreate(name)}
          onClose={() => {
            if (!creating) {
              setShowCreatePopup(false);
              setError(null);
            }
          }}
        />
      ) : null}

      {overdueCount > 0 ? (
        <div
          data-testid="scheduler-overdue-banner"
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <p>
            <strong className="font-semibold">
              {overdueCount} email{overdueCount === 1 ? " is" : "s are"} overdue.
            </strong>{" "}
            They were due more than 10 minutes ago and nothing has picked them up, so the scheduler is probably not
            running. Ask your admin to check the scheduled job that calls /api/cron/sequences.
          </p>
        </div>
      ) : null}

      {error && !showCreatePopup ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-copper)]"
              strokeWidth={2}
            />
            <input
              data-testid="sequences-search-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={titleCase("Search by name")}
              className="h-10 w-full rounded-xl pl-9 pr-4 text-[13px] outline-none search-field"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter">
            {(
              [
                ["all", "All"],
                ["scheduled", "Scheduled sends"],
                ["sequence", "Sequences"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  filter === key
                    ? "bg-[var(--color-copper)] text-white"
                    : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                )}
              >
                {label} <span className="opacity-70">{counts[key]}</span>
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="skeleton-shimmer h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : empty ? (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase(
              "Nothing scheduled yet. In Compose, turn on Mass sending and Scheduling to queue emails with follow-ups, or create a sequence here.",
            )}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase("Nothing matches.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {filtered.map((s) => {
              const scheduled = s.origin === "scheduled";
              const finished = isFinished(s);
              const waiting = s.counts.active + s.counts.paused;
              const canToggle = s.status === "active" || s.status === "paused";
              return (
                <li
                  key={s.id}
                  data-testid={`sequences-list-item-${s.id}`}
                  className="flex items-center gap-1 pr-2 transition-colors hover:bg-[var(--color-surface-offset)]"
                >
                  <Link
                    href={`/sequences/${encodeURIComponent(s.id)}`}
                    className="flex min-w-0 flex-1 flex-col gap-2.5 py-4 pl-4 pr-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pl-5 sm:pr-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3.5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                        {scheduled ? (
                          <CalendarClock className="h-[18px] w-[18px]" strokeWidth={2} />
                        ) : (
                          <Workflow className="h-[18px] w-[18px]" strokeWidth={2} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-semibold text-[var(--color-text)] sm:flex-nowrap sm:truncate">
                          <span className="min-w-0 break-words sm:truncate">{s.name?.trim() || titleCase("Untitled")}</span>
                          <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--color-text-muted)]">
                            {scheduled ? "Scheduled send" : "Sequence"}
                          </span>
                        </p>
                        <p className="font-mono mt-0.5 text-[11.5px] text-[var(--color-text-faint)]">
                          {s.emailStepCount} {s.emailStepCount === 1 ? "email" : "emails"}
                          {" · "}
                          {s.status === "active" && s.nextRunAt
                            ? `${titleCase("Next send")} ${formatNextSend(s.nextRunAt)}`
                            : s.status === "paused"
                              ? titleCase("Paused")
                              : finished
                                ? titleCase("All sent")
                                : `${titleCase("Updated")} ${formatDate(s.updatedAt)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 pl-[54px] sm:pl-0">
                      <span
                        className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-muted)]"
                        title={`${s.recipientCount} recipients, ${waiting} still waiting`}
                      >
                        <Users className="h-3.5 w-3.5" strokeWidth={2} />
                        {s.recipientCount}
                      </span>
                      {s.counts.replied > 0 ? (
                        <span className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                          {s.counts.replied} {titleCase("replied")}
                        </span>
                      ) : null}
                      {s.counts.bounced > 0 ? (
                        <span className="text-[13px] font-medium text-[var(--color-danger)]">
                          {s.counts.bounced} {titleCase("bounced")}
                        </span>
                      ) : null}
                      {s.counts.needs_attention > 0 ? (
                        <span
                          className="text-[13px] font-medium text-amber-600 dark:text-amber-400"
                          title="Skipped because a merge field had no value for them"
                        >
                          {s.counts.needs_attention} {titleCase("need attention")}
                        </span>
                      ) : null}
                      {finished ? (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--color-text-muted)]">
                          Finished
                        </span>
                      ) : (
                        <SequenceStatusPill status={s.status} />
                      )}
                    </div>
                  </Link>
                  {canToggle ? (
                    <button
                      type="button"
                      data-testid={`sequences-toggle-btn-${s.id}`}
                      aria-label={`${s.status === "active" ? "Pause" : "Resume"} ${s.name?.trim() || "this"}`}
                      title={s.status === "active" ? "Pause — no more emails go out until you resume" : "Resume sending"}
                      disabled={togglingId === s.id || finished}
                      onClick={() => void handleToggle(s)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {togglingId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : s.status === "active" ? (
                        <Pause className="h-4 w-4" strokeWidth={2} />
                      ) : (
                        <Play className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`sequences-delete-btn-${s.id}`}
                    aria-label={`Cancel and remove ${s.name?.trim() || "this"}`}
                    title="Cancel and remove"
                    disabled={deletingId === s.id}
                    onClick={() => void handleDelete(s)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
