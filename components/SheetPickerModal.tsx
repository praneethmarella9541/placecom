"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, Loader2, Search, X } from "lucide-react";

export type PickedSheet = { id: string; name: string };

type SheetRow = { id: string; name: string; modifiedTime?: string };

type Props = {
  onClose: () => void;
  onPick: (sheet: PickedSheet) => void;
};

function formatModified(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Picks an existing Google Sheet from the connected mailbox owner's Drive.
 * Portalled to <body>: the compose dialog is transformed, which would otherwise
 * become the containing block for this fixed overlay.
 */
export function SheetPickerModal({ onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow earlier search overwriting a newer one.
  const requestSeq = useRef(0);

  async function load(search: string, pageToken?: string) {
    const seq = ++requestSeq.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (pageToken) params.set("pageToken", pageToken);
    try {
      const res = await fetch(`/api/broadcast/mail-merge-sheets?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sheets?: SheetRow[];
        nextPageToken?: string | null;
        connectedEmail?: string | null;
      };
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error(data.error || `Could not list sheets (${res.status})`);
      setSheets((prev) => (pageToken ? [...prev, ...(data.sheets ?? [])] : data.sheets ?? []));
      setNextPageToken(data.nextPageToken ?? null);
      setConnectedEmail(data.connectedEmail ?? null);
      setError(null);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : "Could not list sheets");
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => void load(query.trim()), query ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a Google Sheet"
        className="flex max-h-[80vh] w-full max-w-[460px] flex-col overflow-hidden rounded-xl bg-white text-[#202124] shadow-[0_24px_48px_rgba(0,0,0,0.32)] [color-scheme:light]"
      >
        <div className="flex items-center gap-2 border-b border-[#e0e0e0] px-4 py-3">
          <h2 className="flex-1 text-[14px] font-medium">Choose a Google Sheet</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-[#444746] hover:bg-[#f1f3f4]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 rounded-lg bg-[#f1f3f4] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#5f6368]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your sheets"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#70757a]"
            />
          </div>
          {connectedEmail ? (
            <p className="mt-2 text-[11px] leading-snug text-[#5f6368]">
              Showing sheets from {connectedEmail}. Row 1 must be column headers, with one column of
              email addresses.
            </p>
          ) : null}
        </div>

        <div className="scrollbar-thin mt-2 min-h-[160px] flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#5f6368]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sheets…
            </div>
          ) : error ? (
            <p className="mx-2 mt-2 rounded-md bg-[#fce8e6] px-2 py-1.5 text-[12px] leading-snug text-[#c5221f]">
              {error}
            </p>
          ) : sheets.length === 0 ? (
            <p className="px-3 py-10 text-center text-[12px] text-[#5f6368]">
              {query.trim() ? "No sheets match that search." : "No Google Sheets found."}
            </p>
          ) : (
            <>
              {sheets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onPick({ id: s.id, name: s.name })}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-[#f1f3f4]"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#137333]" />
                  <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                  <span className="shrink-0 text-[11px] text-[#70757a]">
                    {formatModified(s.modifiedTime)}
                  </span>
                </button>
              ))}
              {nextPageToken ? (
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => {
                    setLoadingMore(true);
                    void load(query.trim(), nextPageToken);
                  }}
                  className="mx-2 mt-1 w-[calc(100%-1rem)] rounded-lg border border-[#dadce0] py-2 text-[12px] font-medium text-[#3c4043] hover:bg-[#f1f3f4] disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
