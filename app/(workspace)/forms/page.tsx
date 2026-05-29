"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, ExternalLink, Loader2, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async (opts: { append: boolean; pageToken?: string }) => {
    if (!opts.append) {
      setLoading(true);
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
      };
      if (!res.ok) throw new Error(data.error || "Failed to load forms");
      setForms((prev) => (opts.append ? [...prev, ...(data.forms || [])] : data.forms || []));
      setNextPageToken(data.nextPageToken);
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
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
            {titleCase(
              "Build and manage Google Forms here. Publishing uses your connected admin Google account (same token as Mail). Share the responder link from the editor — no need to open Google Forms.",
            )}
          </p>
        </div>
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
              placeholder={titleCase("Search forms")}
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
            {titleCase("No forms yet. Create one above.")}
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
                  <a
                    href={`https://docs.google.com/forms/d/${encodeURIComponent(f.id)}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                    {titleCase("Google")}
                  </a>
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
