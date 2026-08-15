"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookText, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { CreateNamePopup } from "@/components/CreateNamePopup";
import {
  getDocsPrefetchCache,
  setDocsPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

type DocRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

/** Lists Google Docs files, linking into the iframe-embedded native Docs editor at /docs/[id]. */
export default function DocsListPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreatePopup, setShowCreatePopup] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (opts: { append: boolean; pageToken?: string }) => {
    if (!opts.append) {
      if (!searchDebounced) {
        const cached = getDocsPrefetchCache();
        if (cached?.docs.length) {
          setDocs(cached.docs as DocRow[]);
          setNextPageToken(cached.nextPageToken);
          setLoading(false);
        } else {
          setLoading(true);
        }
      } else {
        setLoading(true);
      }
      setError(null);
    }
    const params = new URLSearchParams({ pageSize: "30" });
    if (opts.pageToken) params.set("pageToken", opts.pageToken);
    if (searchDebounced) params.set("search", searchDebounced);
    try {
      const res = await fetch(`/api/docs?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string;
        docs?: DocRow[];
        nextPageToken?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load docs");
      setDocs((prev) => (opts.append ? [...prev, ...(data.docs || [])] : data.docs || []));
      setNextPageToken(data.nextPageToken);
      if (!opts.append && !searchDebounced) {
        setDocsPrefetchCache({
          docs: data.docs || [],
          nextPageToken: data.nextPageToken,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!opts.append) setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [searchDebounced]);

  useEffect(() => {
    void load({ append: false });
  }, [load]);

  async function handleCreate(name: string) {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      const data = (await res.json()) as { error?: string; message?: string; documentId?: string };
      if (!res.ok) {
        throw new Error(data.error || data.message || "Could not create doc");
      }
      if (!data.documentId) throw new Error("Invalid response");
      const optimisticDoc: DocRow = {
        id: data.documentId,
        name,
        mimeType: "application/vnd.google-apps.document",
        modifiedTime: new Date().toISOString(),
      };
      const cached = getDocsPrefetchCache();
      setDocsPrefetchCache({
        docs: [optimisticDoc, ...(cached?.docs ?? [])],
        nextPageToken: cached?.nextPageToken,
      });
      setShowCreatePopup(false);
      router.push(`/docs/${encodeURIComponent(data.documentId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  const empty = useMemo(() => !loading && docs.length === 0, [loading, docs.length]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Docs")}
        </h1>
        <button
          data-testid="docs-create-btn"
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
          icon={<BookText className="h-5 w-5" strokeWidth={2} />}
          title="New doc"
          placeholder="Doc title, e.g. Offer Letter Template"
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" strokeWidth={2} />
          <input
            data-testid="docs-search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={titleCase("Search by doc title")}
            className="h-10 w-full rounded-xl border border-transparent bg-[var(--color-surface-2)] pl-9 pr-4 text-[13px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
            autoComplete="off"
          />
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="skeleton-shimmer h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : empty ? (
          <p className="rounded-2xl border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {searchDebounced
              ? titleCase("No docs match your search.")
              : titleCase("No Google Docs found in your account. Create one above.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {docs.map((d) => (
              <li
                key={d.id}
                data-testid={`docs-list-item-${d.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-surface-offset)]"
              >
                <Link href={`/docs/${encodeURIComponent(d.id)}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                    <BookText className="h-[18px] w-[18px]" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                      {d.name?.trim() || titleCase("Untitled")}
                    </p>
                    <p className="font-mono mt-0.5 text-[11.5px] text-[var(--color-text-faint)]">
                      {titleCase("Modified")} {formatDate(d.modifiedTime)}
                    </p>
                  </div>
                </Link>
                <Link
                  href={`/docs/${encodeURIComponent(d.id)}`}
                  className="shrink-0 rounded-xl bg-[var(--color-copper-tint)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-copper)] hover:bg-[var(--color-copper)] hover:text-white transition-colors"
                >
                  {titleCase("Open")}
                </Link>
              </li>
            ))}
          </ul>
        )}

        {nextPageToken ? (
          <button
            type="button"
            className="mt-4 w-full rounded-xl border border-[var(--color-border)] py-3 text-[13px] font-medium text-[var(--color-copper)] hover:bg-[var(--color-surface-offset)]"
            onClick={() => void load({ append: true, pageToken: nextPageToken })}
          >
            {titleCase("Load more")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
