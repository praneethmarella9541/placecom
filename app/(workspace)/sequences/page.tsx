"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Trash2, Users, Workflow } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { CreateNamePopup } from "@/components/CreateNamePopup";
import { SequenceStatusPill } from "@/components/SequenceStatusPill";
import type { SequenceListItem } from "@/lib/sequence-types";
import {
  getSequencesPrefetchCache,
  setSequencesPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

export default function SequencesPage() {
  const router = useRouter();
  const [sequences, setSequences] = useState<SequenceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreatePopup, setShowCreatePopup] = useState(false);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      };
      if (!res.ok) throw new Error(data.error || "Failed to load sequences");
      setSequences(data.sequences || []);
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

  async function handleDelete(id: string, name: string) {
    if (deletingId) return;
    if (
      !window.confirm(
        `Delete "${name}"? This permanently removes the sequence, its recipients, and its send history. Mail already sent is not recalled. This can't be undone.`,
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string; deleted?: boolean };
      if (!res.ok) throw new Error(data.error || "Could not delete sequence");
      setSequences((prev) => prev.filter((s) => s.id !== id));
      const cached = getSequencesPrefetchCache();
      if (cached) {
        setSequencesPrefetchCache({
          ...cached,
          sequences: cached.sequences.filter((s) => (s as SequenceListItem).id !== id),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete sequence");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sequences;
    return sequences.filter((s) => s.name.toLowerCase().includes(q));
  }, [sequences, search]);

  const empty = !loading && sequences.length === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Sequences")}
        </h1>
        <button
          data-testid="sequences-create-btn"
          type="button"
          onClick={() => {
            setError(null);
            setShowCreatePopup(true);
          }}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-copper)] px-5 text-[14px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)]"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          {titleCase("Create")}
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

      {error && !showCreatePopup ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div>
        <div className="relative mb-3 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]"
            strokeWidth={2}
          />
          <input
            data-testid="sequences-search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={titleCase("Search by name")}
            className="h-10 w-full rounded-xl border border-transparent bg-[var(--color-surface-2)] pl-9 pr-4 text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
            autoComplete="off"
          />
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
              "No sequences yet. Create one to send an email and follow up automatically until someone replies.",
            )}
          </p>
        ) : filtered.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase("No sequences match your search.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {filtered.map((s) => (
              <li
                key={s.id}
                data-testid={`sequences-list-item-${s.id}`}
                className="flex items-center gap-1 pr-2 transition-colors hover:bg-[var(--color-surface-offset)]"
              >
                <Link
                  href={`/sequences/${encodeURIComponent(s.id)}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-4 py-4 pl-5 pr-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                      <Workflow className="h-[18px] w-[18px]" strokeWidth={2} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                        {s.name?.trim() || titleCase("Untitled")}
                      </p>
                      <p className="font-mono mt-0.5 text-[11.5px] text-[var(--color-text-faint)]">
                        {s.emailStepCount} {s.emailStepCount === 1 ? "email" : "emails"}
                        {" · "}
                        {titleCase("Updated")} {formatDate(s.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-muted)]">
                      <Users className="h-3.5 w-3.5" strokeWidth={2} />
                      {s.recipientCount}
                    </span>
                    {s.counts.replied > 0 ? (
                      <span className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                        {s.counts.replied} {titleCase("replied")}
                      </span>
                    ) : null}
                    <SequenceStatusPill status={s.status} />
                  </div>
                </Link>
                <button
                  type="button"
                  data-testid={`sequences-delete-btn-${s.id}`}
                  aria-label={`Delete ${s.name?.trim() || "sequence"}`}
                  disabled={deletingId === s.id}
                  onClick={() => void handleDelete(s.id, s.name?.trim() || "Untitled")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:opacity-60"
                >
                  {deletingId === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
