"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, Share2 } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { DriveShareModal } from "@/components/DriveShareModal";

type GrantState = { granted: boolean; alreadyShared: boolean; permissionId?: string };

/**
 * Embeds Google's real Sheets editor. That only works without a signed-in
 * Google session in-browser if the file allows anonymous "anyone with the
 * link" editing — so this grants that on mount (unless already shared) and
 * revokes it once the tab is actually left, via two unambiguous signals
 * only: normal unmount (in-app navigation, e.g. clicking the back arrow)
 * and `pagehide` (the tab is closed, or the browser navigates to a
 * different site). Deliberately *not* `visibilitychange` — it fires on
 * any tab-hide, including just switching to another browser tab, which
 * isn't "leaving" and would revoke access out from under a still-open
 * sheet. The `pagehide` path uses `navigator.sendBeacon` since a regular
 * `fetch` from an unload-ish handler isn't reliably delivered. Best-effort,
 * not airtight: a crash between grant and revoke leaves the file
 * link-shared until someone notices.
 */
export default function SheetPage() {
  const params = useParams();
  const spreadsheetId = typeof params.id === "string" ? params.id : "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorWebViewLink, setErrorWebViewLink] = useState<string | null>(null);
  // Set instead of `error` when the connected account can view the sheet but
  // isn't allowed to manage its sharing (so we can't grant the anonymous
  // "anyone with the link can edit" access the live editor needs). Rather
  // than dead-ending on an error, we fall back to the same read-only PDF
  // export + proxy preview the Drive tab uses for files it can't edit inline.
  const [readOnlyNotice, setReadOnlyNotice] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const grantRef = useRef<GrantState | null>(null);

  useEffect(() => {
    if (!spreadsheetId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setErrorWebViewLink(null);
      setReadOnlyNotice(null);
      try {
        const res = await fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/link-share`, {
          method: "POST",
        });
        const data = (await res.json()) as {
          error?: string;
          message?: string;
          granted?: boolean;
          alreadyShared?: boolean;
          permissionId?: string;
          webViewLink?: string;
        };
        if (!res.ok) {
          if (data.error === "DRIVE_NO_SHARE_PERMISSION") {
            if (!cancelled) setReadOnlyNotice(data.message || "You can view this sheet, but only its owner can grant edit access here.");
            return;
          }
          if (!cancelled) setErrorWebViewLink(data.webViewLink ?? null);
          throw new Error(data.error || data.message || "Failed to open sheet");
        }
        if (cancelled) return;
        const state: GrantState = {
          granted: Boolean(data.granted),
          alreadyShared: Boolean(data.alreadyShared),
          permissionId: data.permissionId,
        };
        grantRef.current = state;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to open sheet");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Best-effort — only used for the Share modal's header text, so a
    // failure here shouldn't block opening the sheet itself.
    void fetch(`/api/drive/file/${encodeURIComponent(spreadsheetId)}?details=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { file?: { name?: string } } | null) => {
        if (!cancelled && data?.file?.name) setFileName(data.file.name);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [spreadsheetId]);

  // Revoke on leaving — see the two signals detailed in the effect below.
  useEffect(() => {
    if (!spreadsheetId) return;

    function revokeViaFetch() {
      const g = grantRef.current;
      if (!g?.granted || !g.permissionId) return;
      grantRef.current = null; // guard against double-revoke across the two listeners + unmount
      void fetch(`/api/sheets/${encodeURIComponent(spreadsheetId)}/link-share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionId: g.permissionId }),
        keepalive: true,
      }).catch(() => {
        /* best-effort */
      });
    }

    function revokeViaBeacon() {
      const g = grantRef.current;
      if (!g?.granted || !g.permissionId) return;
      grantRef.current = null;
      const blob = new Blob([JSON.stringify({ permissionId: g.permissionId })], {
        type: "application/json",
      });
      navigator.sendBeacon(`/api/sheets/${encodeURIComponent(spreadsheetId)}/link-share/revoke`, blob);
    }

    // Deliberately *not* using visibilitychange — it fires on any tab-hide,
    // including just switching to another browser tab, which isn't "leaving."
    // Only two unambiguous signals trigger revoke: pagehide (tab actually
    // closed, or navigated to a different site) and this effect's own
    // cleanup (in-app navigation away, e.g. clicking the back arrow).
    window.addEventListener("pagehide", revokeViaBeacon);
    return () => {
      window.removeEventListener("pagehide", revokeViaBeacon);
      revokeViaFetch(); // normal in-app navigation away from this page
    };
  }, [spreadsheetId]);

  if (!spreadsheetId) return null;

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-2">
      <div className="flex items-center gap-3">
        <Link
          href="/sheets"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
          aria-label={titleCase("Back to sheets")}
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2} />
        </Link>
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-copper)]">
          {titleCase("Sheets")}
        </p>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="sheet-share-btn"
          onClick={() => setShareOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-border)] px-3.5 text-[13px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
        >
          <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
          {titleCase("Share")}
        </button>
      </div>

      {shareOpen ? (
        <DriveShareModal
          fileId={spreadsheetId}
          fileName={fileName || titleCase("this sheet")}
          isFolder={false}
          onClose={() => setShareOpen(false)}
        />
      ) : null}

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 py-24 text-[13px] text-[var(--color-text-faint)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {titleCase("Opening sheet…")}
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          <p>{error}</p>
          {errorWebViewLink ? (
            <a
              href={errorWebViewLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 font-medium underline underline-offset-2"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              {titleCase("View in Google Drive")}
            </a>
          ) : null}
        </div>
      ) : readOnlyNotice ? (
        <div className="flex min-h-[80vh] flex-1 flex-col gap-2 overflow-hidden">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-muted)]">
            {titleCase("Read-only")} — {readOnlyNotice}
          </div>
          <iframe
            data-testid="sheet-frame-readonly"
            src={`/api/drive/file/${encodeURIComponent(spreadsheetId)}?mode=preview`}
            className="flex-1 rounded-2xl border border-[var(--color-border)] bg-white"
            title={titleCase("Google Sheets (read-only preview)")}
          />
        </div>
      ) : (
        <iframe
          data-testid="sheet-frame"
          src={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit?embedded=true`}
          className="min-h-[80vh] flex-1 rounded-2xl border border-[var(--color-border)]"
          title={titleCase("Google Sheets")}
        />
      )}
    </div>
  );
}
