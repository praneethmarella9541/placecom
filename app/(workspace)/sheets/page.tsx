"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Table, Users, Star, Plus, MoreVertical, Pencil, Trash2, ExternalLink } from "lucide-react";
import { IconSearch, IconRefresh } from "@/components/Icons";
import { Skeleton } from "@/components/Skeleton";
import { cn, timeAgo } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";

type SheetsView = "my-sheets" | "shared-with-me" | "starred";

type SheetRow = {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
  owner?: string;
  starred?: boolean;
};

const VIEW_LABEL: Record<SheetsView, string> = {
  "my-sheets": "My Sheets",
  "shared-with-me": "Shared with me",
  starred: "Starred",
};

export default function SheetsPage() {
  const router = useRouter();
  const [view, setView] = useState<SheetsView>("my-sheets");
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadSheets = useCallback(
    async (opts: { append?: boolean; bust?: boolean } = {}) => {
      const append = opts.append ?? false;
      if (!append) {
        setLoading(true);
        setError(null);
      }
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (view) params.set("view", view);
        if (append && nextPageToken) params.set("pageToken", nextPageToken);
        const res = await fetch(`/api/sheets?${params.toString()}`, {
          cache: opts.bust ? "no-store" : "default",
        });
        const j = (await res.json()) as {
          files?: SheetRow[];
          nextPageToken?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Failed to load sheets");
        setRows((prev) => (append ? [...prev, ...(j.files ?? [])] : j.files ?? []));
        setNextPageToken(j.nextPageToken);
      } catch (e) {
        if (!append) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!append) setLoading(false);
      }
    },
    [search, view, nextPageToken]
  );

  // Reload on view/search change.
  useEffect(() => {
    void loadSheets({ append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, search]);

  async function createSheet() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled spreadsheet" }),
      });
      const j = (await res.json()) as { spreadsheetId?: string; error?: string };
      if (!res.ok || !j.spreadsheetId) throw new Error(j.error || "Create failed");
      router.push(`/sheets/${encodeURIComponent(j.spreadsheetId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function renameSheet(row: SheetRow) {
    const next = window.prompt("Rename spreadsheet", row.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === row.name) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name } : r)));
    try {
      const res = await fetch(`/api/sheets/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string };
        throw new Error(j.message || j.error || "Rename failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
      void loadSheets({ append: false, bust: true });
    }
  }

  async function deleteSheet(row: SheetRow) {
    if (!window.confirm(`Move "${row.name}" to trash?`)) return;
    const snapshot = rows;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`/api/sheets/${encodeURIComponent(row.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string };
        throw new Error(j.message || j.error || "Delete failed");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setRows(snapshot);
    }
  }

  // Close the row menu on outside click.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpenId) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpenId]);

  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Sidebar */}
      <aside className="hidden w-[208px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg)] p-2 sm:flex">
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
          Sheets
        </p>
        <SidebarItem
          icon={<Table className="h-4 w-4" />}
          label={VIEW_LABEL["my-sheets"]}
          active={view === "my-sheets"}
          onClick={() => setView("my-sheets")}
        />
        <SidebarItem
          icon={<Users className="h-4 w-4" />}
          label={VIEW_LABEL["shared-with-me"]}
          active={view === "shared-with-me"}
          onClick={() => setView("shared-with-me")}
        />
        <SidebarItem
          icon={<Star className="h-4 w-4" />}
          label={VIEW_LABEL.starred}
          active={view === "starred"}
          onClick={() => setView("starred")}
        />
      </aside>

      {/* Main column */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-1.5">
          <div className="min-w-0 flex-1 px-2 py-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={titleCase("Search Sheets")}
                className="input-field w-full py-2 pl-9 pr-3 text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void createSheet()}
            disabled={creating}
            className="btn-primary shrink-0 gap-2 px-3 py-2 text-[13px]"
            title={titleCase("New spreadsheet")}
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
            {creating ? titleCase("Creating…") : titleCase("New sheet")}
          </button>
          <button
            type="button"
            onClick={() => void loadSheets({ append: false, bust: true })}
            className="btn-ghost shrink-0 rounded-lg p-2"
            title={titleCase("Refresh")}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <Table className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {search
                ? titleCase("No spreadsheets match your search.")
                : titleCase("No spreadsheets yet. Create one above.")}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3">
            {/* Header row (desktop) */}
            <div className="hidden grid-cols-[minmax(0,1fr)_160px_140px_40px] gap-3 border-b border-[var(--color-border)] px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)] sm:grid">
              <span>{titleCase("Name")}</span>
              <span>{titleCase("Owner")}</span>
              <span>{titleCase("Modified")}</span>
              <span />
            </div>
            <ul>
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="group grid grid-cols-[minmax(0,1fr)_40px] items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-surface-offset)] sm:grid-cols-[minmax(0,1fr)_160px_140px_40px]"
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/sheets/${encodeURIComponent(row.id)}`)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <Table className="h-4 w-4" />
                    </span>
                    <span className="truncate text-[14px] font-medium text-[var(--color-text)]">
                      {row.name}
                    </span>
                  </button>
                  <span className="hidden truncate text-[13px] text-[var(--color-text-muted)] sm:block">
                    {row.owner || "—"}
                  </span>
                  <span className="hidden truncate text-[13px] text-[var(--color-text-muted)] sm:block">
                    {timeAgo(row.modifiedTime)}
                  </span>
                  <div className="relative flex justify-end" ref={menuOpenId === row.id ? menuRef : undefined}>
                    <button
                      type="button"
                      onClick={() => setMenuOpenId((id) => (id === row.id ? null : row.id))}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-faint)] opacity-0 transition-opacity hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] group-hover:opacity-100"
                      aria-label={titleCase("Actions")}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {menuOpenId === row.id && (
                      <div
                        className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                        role="menu"
                      >
                        <RowMenuItem
                          icon={<ExternalLink className="h-3.5 w-3.5" />}
                          label="Open in Sheets"
                          onClick={() => {
                            setMenuOpenId(null);
                            if (row.webViewLink) window.open(row.webViewLink, "_blank", "noopener");
                          }}
                        />
                        <RowMenuItem
                          icon={<Pencil className="h-3.5 w-3.5" />}
                          label="Rename"
                          onClick={() => {
                            setMenuOpenId(null);
                            void renameSheet(row);
                          }}
                        />
                        <RowMenuItem
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                          label="Delete"
                          danger
                          onClick={() => {
                            setMenuOpenId(null);
                            void deleteSheet(row);
                          }}
                        />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {nextPageToken && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => void loadSheets({ append: true })}
                  className="btn-secondary px-4 py-2 text-[13px]"
                >
                  {titleCase("Load more")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-full px-3 py-2 text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function RowMenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
      )}
    >
      <span className="shrink-0">{icon}</span>
      {titleCase(label)}
    </button>
  );
}
