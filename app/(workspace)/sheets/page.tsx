"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Frame, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { CreateNamePopup } from "@/components/CreateNamePopup";
import {
  getSheetsPrefetchCache,
  setSheetsPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

type SheetRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
};

/** Lists Google Sheets files, linking into the iframe-embedded native Sheets editor at /sheets/[id]. */
export default function SheetsListPage() {
  const router = useRouter();
  const [sheets, setSheets] = useState<SheetRow[]>([]);
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
        const cached = getSheetsPrefetchCache();
        if (cached?.sheets.length) {
          setSheets(cached.sheets as SheetRow[]);
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
      const res = await fetch(`/api/sheets?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string;
        sheets?: SheetRow[];
        nextPageToken?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load sheets");
      setSheets((prev) => (opts.append ? [...prev, ...(data.sheets || [])] : data.sheets || []));
      setNextPageToken(data.nextPageToken);
      if (!opts.append && !searchDebounced) {
        setSheetsPrefetchCache({
          sheets: data.sheets || [],
          nextPageToken: data.nextPageToken,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!opts.append) setSheets([]);
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
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      });
      const data = (await res.json()) as { error?: string; message?: string; spreadsheetId?: string };
      if (!res.ok) {
        throw new Error(
          data.error === "SHEETS_INSUFFICIENT_SCOPE" && data.message
            ? data.message
            : data.error || data.message || "Could not create sheet",
        );
      }
      if (!data.spreadsheetId) throw new Error("Invalid response");
      const optimisticSheet: SheetRow = {
        id: data.spreadsheetId,
        name,
        mimeType: "application/vnd.google-apps.spreadsheet",
        modifiedTime: new Date().toISOString(),
      };
      const cached = getSheetsPrefetchCache();
      setSheetsPrefetchCache({
        sheets: [optimisticSheet, ...(cached?.sheets ?? [])],
        nextPageToken: cached?.nextPageToken,
      });
      setShowCreatePopup(false);
      router.push(`/sheets/${encodeURIComponent(data.spreadsheetId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  const empty = useMemo(() => !loading && sheets.length === 0, [loading, sheets.length]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[19px] font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Sheets")}
        </h1>
        <button
          data-testid="sheets-create-btn"
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
          icon={<Frame className="h-5 w-5" strokeWidth={2} />}
          title="New sheet"
          placeholder="Sheet title, e.g. Placement Tracker 2026"
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
            data-testid="sheets-search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={titleCase("Search by sheet title")}
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
              ? titleCase("No sheets match your search.")
              : titleCase("No Google Sheets found in your account. Create one above.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            {sheets.map((s) => (
              <li
                key={s.id}
                data-testid={`sheets-list-item-${s.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-surface-offset)]"
              >
                <Link href={`/sheets/${encodeURIComponent(s.id)}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                    <Frame className="h-[18px] w-[18px]" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                      {s.name?.trim() || titleCase("Untitled")}
                    </p>
                    <p className="font-mono mt-0.5 text-[11.5px] text-[var(--color-text-faint)]">
                      {titleCase("Modified")} {formatDate(s.modifiedTime)}
                    </p>
                  </div>
                </Link>
                <Link
                  href={`/sheets/${encodeURIComponent(s.id)}`}
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
