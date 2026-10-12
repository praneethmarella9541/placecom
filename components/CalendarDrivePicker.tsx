"use client";

import { useEffect, useState } from "react";
import { FileText, Search } from "lucide-react";
import type { EventAttachment } from "@/lib/calendar-extras";

type Row = { id: string; name: string; mimeType: string; webViewLink?: string };

type Props = {
  /** Files already attached — they're hidden from the list. */
  taken: string[];
  onPick: (file: EventAttachment) => void;
  onClose: () => void;
};

/** Pick a Drive file (recent, or by name) to attach to an event. */
export default function CalendarDrivePicker({ taken, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const q = query.trim();
    // Typing is debounced so each keystroke doesn't hit Drive.
    const t = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ pageSize: "25" });
        if (q) qs.set("search", q);
        else qs.set("view", "recent");
        const res = await fetch(`/api/drive/files?${qs}`, { signal: ctrl.signal });
        const body = (await res.json()) as { files?: Row[]; error?: string };
        if (!res.ok) throw new Error(body.error || "Couldn't load Drive files");
        setRows((body.files ?? []).filter((f) => f.mimeType !== "application/vnd.google-apps.folder" && f.webViewLink));
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : "Couldn't load Drive files");
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, q ? 300 : 0);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const visible = rows.filter((r) => !taken.includes(r.webViewLink ?? ""));

  return (
    <div data-testid="calendar-drive-picker" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" aria-hidden />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your Drive"
          className="input-field !pl-8"
        />
      </div>
      <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
        {loading ? <li className="px-2 py-2 text-xs text-[var(--color-text-faint)]">Loading…</li> : null}
        {error ? <li className="px-2 py-2 text-xs text-red-600">{error}</li> : null}
        {!loading && !error && visible.length === 0 ? (
          <li className="px-2 py-2 text-xs text-[var(--color-text-faint)]">{query.trim() ? "No files match." : "No recent files."}</li>
        ) : null}
        {visible.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick({ fileUrl: f.webViewLink!, title: f.name, mimeType: f.mimeType, fileId: f.id })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface-offset)]"
            >
              <FileText className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" aria-hidden />
              <span className="truncate">{f.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={onClose} className="btn-ghost px-2 py-1 text-xs">
          Done
        </button>
      </div>
    </div>
  );
}
