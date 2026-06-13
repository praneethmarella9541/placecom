"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import {
  getFormsPrefetchCache,
  setFormsPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

type FormRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  formTitle?: string | null;
};

export default function FormsPage() {
  const router = useRouter();
  const [forms, setForms] = useState<FormRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [openInput, setOpenInput] = useState("");
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (opts: { append: boolean; pageToken?: string }) => {
    if (!opts.append) {
      if (!searchDebounced) {
        const cached = getFormsPrefetchCache();
        if (cached?.forms.length) {
          setForms(cached.forms as FormRow[]);
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
      const res = await fetch(`/api/forms?${params.toString()}`);
      const data = (await res.json()) as {
        error?: string;
        forms?: FormRow[];
        nextPageToken?: string;
        connectedEmail?: string | null;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load forms");
      setForms((prev) => (opts.append ? [...prev, ...(data.forms || [])] : data.forms || []));
      setNextPageToken(data.nextPageToken);
      if (typeof data.connectedEmail === "string") setConnectedEmail(data.connectedEmail);
      if (!opts.append && !searchDebounced) {
        setFormsPrefetchCache({
          forms: data.forms || [],
          nextPageToken: data.nextPageToken,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      if (!opts.append) setForms([]);
    } finally {
      setLoading(false);
    }
  }, [searchDebounced]);

  useEffect(() => {
    void load({ append: false });
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t }),
      });
      const data = (await res.json()) as { error?: string; message?: string; formId?: string };
      if (!res.ok) {
        throw new Error(
          data.error === "FORMS_INSUFFICIENT_SCOPE" && data.message
            ? data.message
            : data.error || data.message || "Could not create form",
        );
      }
      if (!data.formId) throw new Error("Invalid response");
      setTitle("");
      router.push(`/forms/${encodeURIComponent(data.formId)}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }

  async function handleOpenExisting(e: React.FormEvent) {
    e.preventDefault();
    const input = openInput.trim();
    if (!input || opening) return;
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/forms/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = (await res.json()) as { error?: string; message?: string; formId?: string };
      if (!res.ok) {
        throw new Error(data.message || data.error || "Could not open form");
      }
      if (!data.formId) throw new Error("Invalid response");
      setOpenInput("");
      router.push(`/forms/${encodeURIComponent(data.formId)}/edit?tab=responses`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open form");
    } finally {
      setOpening(false);
    }
  }

  const empty = useMemo(() => !loading && forms.length === 0, [loading, forms.length]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-primary-light)] text-[var(--color-primary)]">
          <ClipboardList className="h-6 w-6" strokeWidth={2} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Forms")}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            {titleCase("Synced with your Google account — including forms you created earlier in Google Forms.")}
          </p>
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
        <p>
          {connectedEmail ? (
            <>
              {titleCase("Connected account")}:{" "}
              <span className="font-medium text-[var(--color-text)]">{connectedEmail}</span>
            </>
          ) : (
            titleCase("Loading Google account…")
          )}
        </p>
        <p className="mt-1 text-[12px] text-[var(--color-text-faint)]">
          {titleCase("All forms in this Google Drive appear here. Open any form to view responses from Google.")}
        </p>
      </div>

      <div className="surface-card rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 shadow-[var(--shadow-sm)]">
        <form onSubmit={(e) => void handleCreate(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-form-title" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-text)]">
              {titleCase("New form")}
            </label>
            <input
              id="new-form-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={titleCase("Form title")}
              className="input-field h-11 w-full text-[14px]"
              autoComplete="off"
              disabled={creating}
            />
          </div>
          <button
            type="submit"
            disabled={creating || !title.trim()}
            className={cn(
              "btn-primary inline-flex h-11 shrink-0 items-center justify-center gap-2 px-6 text-[14px]",
              (!title.trim() || creating) && "opacity-60",
            )}
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {titleCase("Creating…")}
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" strokeWidth={2} />
                {titleCase("Create & edit")}
              </>
            )}
          </button>
        </form>
      </div>

      <div className="surface-card rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 shadow-[var(--shadow-sm)]">
        <form onSubmit={(e) => void handleOpenExisting(e)} className="space-y-3">
          <div>
            <label htmlFor="open-form-input" className="mb-1.5 block text-[13px] font-semibold text-[var(--color-text)]">
              {titleCase("Open existing form")}
            </label>
            <p className="mb-2 text-[12px] text-[var(--color-text-faint)]">
              {titleCase("Paste a Google Form link or form ID to open responses from an older form.")}
            </p>
            <input
              id="open-form-input"
              type="text"
              value={openInput}
              onChange={(e) => setOpenInput(e.target.value)}
              placeholder="https://docs.google.com/forms/d/…/edit"
              className="input-field h-11 w-full text-[14px]"
              autoComplete="off"
              disabled={opening}
            />
          </div>
          <button
            type="submit"
            disabled={opening || !openInput.trim()}
            className={cn(
              "btn-secondary inline-flex h-10 items-center gap-2 px-4 text-[13px]",
              (!openInput.trim() || opening) && "opacity-60",
            )}
          >
            {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            {titleCase("Open & view responses")}
          </button>
        </form>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}

      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
            {titleCase("Your forms")}
          </h2>
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" strokeWidth={2} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={titleCase("Search by form title")}
              className="input-field h-10 w-full pl-9 text-[13px]"
              autoComplete="off"
            />
          </div>
        </div>
        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="skeleton-shimmer h-16 w-full rounded-[var(--radius-lg)]" />
            ))}
          </div>
        ) : empty ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]">
            {searchDebounced
              ? titleCase("No forms match your search.")
              : titleCase("No forms found in your Google account. Create one above or open an existing form by link.")}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
            {forms.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-[var(--color-surface-offset)]"
              >
                <Link href={`/forms/${encodeURIComponent(f.id)}/edit`} className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[var(--color-text)]">
                    {f.formTitle?.trim() || f.name?.trim() || titleCase("Untitled")}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--color-text-faint)]">
                    {titleCase("Modified")} {formatDate(f.modifiedTime)}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-3">
                  <Link
                    href={`/forms/${encodeURIComponent(f.id)}/edit?tab=responses`}
                    className="text-[13px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                  >
                    {titleCase("Responses")}
                  </Link>
                  <Link
                    href={`/forms/${encodeURIComponent(f.id)}/edit`}
                    className="text-[13px] font-semibold text-[var(--color-primary)]"
                  >
                    {titleCase("Edit")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {nextPageToken ? (
          <button
            type="button"
            className="mt-4 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] py-3 text-[13px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-offset)]"
            onClick={() => void load({ append: true, pageToken: nextPageToken })}
          >
            {titleCase("Load more")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
