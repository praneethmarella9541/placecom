"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LabelChip } from "@/components/LabelChip";
import { LabelPicker } from "@/components/LabelPicker";
import { RichTextEditor, richTextIsEmpty } from "@/components/RichTextEditor";
import { createPortal } from "react-dom";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { PencilLine, Send, Paperclip, Maximize2, Minus, FilePen, Maximize, Minimize, SlidersHorizontal, Bookmark } from "lucide-react";
import {
  IconInbox,
  IconSend,
  IconStar,
  IconReply,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconDownload,
  IconSearch,
  IconFile,
} from "@/components/Icons";

type Folder = "inbox" | "sent" | "drafts" | "starred" | "important";
type ThreadRow = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  draftId?: string;
  labelIds?: string[];
  unread?: boolean;
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
};

type GmailLabel = {
  id: string;
  name: string;
  type: "system" | "user";
  surfaced: boolean;
  isSystem: boolean;
  isCategory: boolean;
  color?: { backgroundColor?: string; textColor?: string };
};

/**
 * Insert a label into a sorted list, matching the server's sort order:
 * user labels first (alphabetical), then system labels (alphabetical).
 * Returns a new array — does not mutate the input.
 * If a label with the same id already exists, returns the input unchanged
 * (defensive against an upstream double-fire).
 */
function insertLabelSorted(list: GmailLabel[], next: GmailLabel): GmailLabel[] {
  if (list.some((l) => l.id === next.id)) return list;
  const out = [...list];
  const cmp = (a: GmailLabel, b: GmailLabel) => {
    if (a.type !== b.type) return a.type === "user" ? -1 : 1;
    return a.name.localeCompare(b.name);
  };
  let i = 0;
  while (i < out.length && cmp(out[i], next) < 0) i++;
  out.splice(i, 0, next);
  return out;
}

/**
 * Two-column row used inside the advanced search filter popover —
 * left label + right input field. Keeps spacing consistent across rows.
 */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3">
      <label className="text-[13px] text-[var(--color-text-muted)]">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Detect whether a message body looks like a Google Calendar invite.
 * We use multiple signals (Google-Calendar sender, ICS attachment, subject
 * prefix, calendar.google.com link in body) because individual signals
 * miss edge cases (forwarded invites, alternate sender domains, etc.).
 */
function isCalendarInvite(msg: {
  from?: string;
  subject?: string;
  bodyHtml?: string;
  attachments?: { filename: string; mimeType: string }[];
}): boolean {
  const from = (msg.from || "").toLowerCase();
  if (from.includes("calendar-notification@google.com")) return true;
  if ((msg.attachments ?? []).some((a) => /invite\.ics$/i.test(a.filename) || /^text\/calendar/i.test(a.mimeType))) return true;
  const subj = msg.subject || "";
  if (/^(?:invitation|updated invitation|cancelled event|accepted|declined|tentatively accepted):/i.test(subj)) return true;
  if ((msg.bodyHtml || "").includes("calendar.google.com/calendar/event")) return true;
  return false;
}

/**
 * Extract the Google Calendar event id from an invite email's HTML body.
 * Google embeds a "View on Google Calendar" link of the form:
 *   https://calendar.google.com/calendar/event?action=VIEW&eid=<base64>
 * The eid decodes to "{eventId} {calendarId}" — we return the eventId.
 * Returns null if no link is present or the eid can't be decoded.
 */
function extractCalendarEventId(bodyHtml?: string): string | null {
  if (!bodyHtml) return null;
  const m = bodyHtml.match(/[?&]eid=([A-Za-z0-9_\-=%]+)/);
  if (!m) return null;
  try {
    // The eid is base64url + may be URL-encoded.
    const raw = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 ? raw + "=".repeat(4 - (raw.length % 4)) : raw;
    const decoded = atob(pad);
    // Decoded form: "<eventId> <calendarId>"
    const eventId = decoded.split(" ")[0];
    return eventId || null;
  } catch {
    return null;
  }
}

function senderName(from: string): string {
  if (!from) return "Unknown";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

/** First letter/digit of a display name — skips quotes, punctuation, whitespace. */
function avatarInitial(name: string): string {
  for (let i = 0; i < name.length; i++) {
    const ch = name.charAt(i);
    // ASCII alphanumeric — covers the common case without needing the `u`
    // regex flag (which requires an es2018+ TS target this project doesn't set).
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9")) {
      return ch.toUpperCase();
    }
  }
  // Non-ASCII names (Cyrillic, CJK, etc.): fall back to the first non-whitespace char.
  const trimmed = name.trim();
  return (trimmed.charAt(0) || "?").toUpperCase();
}
type AttachmentView = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

type MsgView = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  bodyHtml?: string;
  attachments?: AttachmentView[];
};

type TrackingRow = {
  gmail_message_id: string;
  opened: boolean;
  opened_at: string | null;
  open_count: number;
};

/**
 * Attachment in the compose window.
 * - `kind: 'new'` — a freshly picked File whose base64 has been read into memory.
 * - `kind: 'saved'` — an attachment already stored on a draft on the server;
 *   we hold a reference (messageId + attachmentId) and only fetch the bytes
 *   if we have to (re-saving the draft or sending).
 */
type PendingFile =
  | {
      kind: "new";
      file: File;
      base64: string;
    }
  | {
      kind: "saved";
      name: string;
      mimeType: string;
      size: number;
      messageId: string;
      attachmentId: string;
    };

/** Display-name for a PendingFile regardless of variant. */
function pendingFileName(f: PendingFile): string {
  return f.kind === "new" ? f.file.name : f.name;
}
/** Display-size for a PendingFile regardless of variant. */
function pendingFileSize(f: PendingFile): number {
  return f.kind === "new" ? f.file.size : f.size;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Spreadsheets, presentations, and word-processing docs that browsers can't
 * render natively. We show a "Download to open" fallback for these.
 */
function isOfficeFile(mimeType: string, filename?: string): boolean {
  const name = filename?.toLowerCase() ?? "";
  return /spreadsheetml|excel|presentation|powerpoint|wordprocessingml|msword/.test(mimeType)
    || /\.(xlsx?|pptx?|docx?)$/.test(name);
}

/**
 * Returns true for any MIME type that we handle in AttachmentPreviewModal
 * (images, video, audio, PDF, text, CSV, and Office files — even if Office
 * files show a "download to open" fallback, we still show the preview modal
 * so the user gets the filename + download button in a friendly overlay).
 */
function isPreviewable(mimeType: string, filename?: string): boolean {
  return /^image\/|^video\/|^audio\/|^text\/(plain|html|csv)|^application\/pdf/.test(mimeType)
    || mimeType === "text/csv"
    || (filename?.toLowerCase().endsWith(".csv") ?? false)
    || isOfficeFile(mimeType, filename);
}

function attachmentUrl(messageId: string, a: AttachmentView, download = false): string {
  const base = `/api/gmail/attachment?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`;
  return download ? `${base}&download=1` : base;
}

function FileTypeIcon({ mimeType, filename }: { mimeType: string; filename?: string }) {
  const name = filename?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) return <span className="text-base">🖼</span>;
  if (mimeType.startsWith("video/")) return <span className="text-base">🎬</span>;
  if (mimeType.startsWith("audio/")) return <span className="text-base">🎵</span>;
  if (mimeType === "application/pdf") return <span className="text-base">📄</span>;
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || name.match(/\.xlsx?$/)) return <span className="text-base">📊</span>;
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint") || name.match(/\.pptx?$/)) return <span className="text-base">📽</span>;
  if (mimeType.includes("word") || mimeType.includes("msword") || name.match(/\.docx?$/)) return <span className="text-base">📝</span>;
  if (mimeType === "text/csv" || name.endsWith(".csv")) return <span className="text-base">📊</span>;
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return <span className="text-base">🗜</span>;
  return <IconFile className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />;
}

function AttachmentPreviewModal({
  attachment,
  messageId,
  onClose,
}: {
  attachment: AttachmentView;
  messageId: string;
  onClose: () => void;
}) {
  const url = attachmentUrl(messageId, attachment);
  const downloadUrl = attachmentUrl(messageId, attachment, true);
  const mime = attachment.mimeType;

  // Blob URL state — used for PDF so we bypass X-Frame-Options restrictions.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobLoading, setBlobLoading] = useState(false);
  const [blobError, setBlobError] = useState<string | null>(null);
  // CSV text content rendered as an HTML table.
  const [csvContent, setCsvContent] = useState<string[][] | null>(null);

  const isPdf = mime === "application/pdf";
  const isCsv = mime === "text/csv" || attachment.filename.toLowerCase().endsWith(".csv");
  const isText = mime.startsWith("text/") && !isCsv;

  // Fetch blob for PDF and CSV on mount.
  useEffect(() => {
    if (!isPdf && !isCsv) return;
    setBlobLoading(true);
    setBlobError(null);
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (isCsv) {
          const text = await res.text();
          // Simple CSV parser — split by newline, then by comma (handles quoted
          // commas imperfectly but good enough for preview purposes).
          const rows = text.trim().split(/\r?\n/).map((line) => {
            const cols: string[] = [];
            let cur = "";
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') { inQuotes = !inQuotes; }
              else if (ch === "," && !inQuotes) { cols.push(cur); cur = ""; }
              else { cur += ch; }
            }
            cols.push(cur);
            return cols;
          });
          setCsvContent(rows);
        } else {
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch((e) => setBlobError(e?.message ?? "Failed to load"))
      .finally(() => setBlobLoading(false));

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isPdf, isCsv]);

  const renderPreview = () => {
    if (mime.startsWith("image/")) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.filename}
          className="max-h-full max-w-full object-contain rounded"
          onError={(e) => { (e.target as HTMLImageElement).alt = "Preview unavailable"; }}
        />
      );
    }
    if (mime.startsWith("video/")) {
      return (
        <video controls className="max-h-full max-w-full rounded" src={url}>
          Your browser does not support video preview.
        </video>
      );
    }
    if (mime.startsWith("audio/")) {
      return (
        <div className="flex flex-col items-center gap-4 p-8">
          <span className="text-5xl">🎵</span>
          <p className="text-sm font-medium text-white">{attachment.filename}</p>
          <audio controls src={url} className="w-full max-w-sm" />
        </div>
      );
    }

    // PDF — rendered from a blob URL so Chrome doesn't block it.
    if (isPdf) {
      if (blobLoading) {
        return (
          <div className="flex flex-col items-center gap-3 p-12 text-white/70">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <span className="text-sm">Loading PDF…</span>
          </div>
        );
      }
      if (blobError) {
        return (
          <div className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="text-6xl">📄</span>
            <p className="text-sm text-white/70">Could not load PDF preview.</p>
            <a href={downloadUrl} download={attachment.filename}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30 transition-colors">
              <IconDownload className="h-4 w-4" /> Download PDF
            </a>
          </div>
        );
      }
      if (blobUrl) {
        return (
          <iframe
            src={blobUrl}
            title={attachment.filename}
            className="h-full w-full rounded border-0"
          />
        );
      }
      return null;
    }

    // CSV — render as a scrollable table.
    if (isCsv) {
      if (blobLoading) {
        return (
          <div className="flex flex-col items-center gap-3 p-12 text-white/70">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <span className="text-sm">Loading CSV…</span>
          </div>
        );
      }
      if (blobError || !csvContent) {
        return (
          <div className="flex flex-col items-center gap-4 p-12 text-center">
            <span className="text-6xl">📊</span>
            <p className="text-sm text-white/70">Could not load CSV preview.</p>
            <a href={downloadUrl} download={attachment.filename}
              className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30 transition-colors">
              <IconDownload className="h-4 w-4" /> Download CSV
            </a>
          </div>
        );
      }
      const headers = csvContent[0] ?? [];
      const rows = csvContent.slice(1);
      return (
        <div className="h-full w-full overflow-auto rounded bg-white p-1">
          <table className="min-w-full border-collapse text-[12px] text-[#202124]">
            <thead>
              <tr className="bg-[#f1f3f4]">
                {headers.map((h, i) => (
                  <th key={i} className="border border-[#dadce0] px-3 py-2 text-left font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "" : "bg-[#f8f9fa]"}>
                  {headers.map((_, ci) => (
                    <td key={ci} className="border border-[#dadce0] px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate">
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length > 500 && (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-2 text-center text-[#5f6368] italic">
                    … {rows.length - 500} more rows (download to see all)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    // Plain text.
    if (isText) {
      return (
        <iframe
          src={url}
          title={attachment.filename}
          className="h-full w-full rounded border-0 bg-white"
        />
      );
    }

    // Office files (xlsx, ppt, docx, etc.) — can't render natively in browser.
    if (isOfficeFile(mime, attachment.filename)) {
      return (
        <div className="flex flex-col items-center gap-5 p-12 text-center">
          <span className="text-7xl">
            {(mime.includes("spreadsheet") || mime.includes("excel") || /\.xlsx?$/i.test(attachment.filename))
              ? "📊"
              : (mime.includes("presentation") || mime.includes("powerpoint") || /\.pptx?$/i.test(attachment.filename))
                ? "📽"
                : "📝"}
          </span>
          <div>
            <p className="text-base font-semibold text-white">{attachment.filename}</p>
            <p className="mt-1 text-sm text-white/60">
              This file type cannot be previewed in the browser.
            </p>
          </div>
          <a
            href={downloadUrl}
            download={attachment.filename}
            className="flex items-center gap-2 rounded-lg bg-white/20 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/30 transition-colors"
          >
            <IconDownload className="h-4 w-4" /> Download to open
          </a>
        </div>
      );
    }

    // Generic fallback — can't preview
    return (
      <div className="flex flex-col items-center gap-4 p-12 text-center">
        <span className="text-6xl"><FileTypeIcon mimeType={mime} filename={attachment.filename} /></span>
        <p className="text-sm text-white/70">
          Preview not available for this file type.
        </p>
        <a href={downloadUrl} download={attachment.filename}
          className="flex items-center gap-2 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/30 transition-colors">
          <IconDownload className="h-4 w-4" /> Download to open
        </a>
      </div>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/10 px-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileTypeIcon mimeType={mime} filename={attachment.filename} />
          <span className="truncate text-sm font-medium text-white">{attachment.filename}</span>
          <span className="shrink-0 text-xs text-white/50">{formatBytes(attachment.size)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={downloadUrl}
            download={attachment.filename}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <IconDownload className="h-3.5 w-3.5" /> Download
          </a>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {renderPreview()}
      </div>
    </div>,
    document.body
  );
}

function AttachmentChips({ attachments, messageId }: { attachments: AttachmentView[]; messageId: string }) {
  const [preview, setPreview] = useState<AttachmentView | null>(null);
  if (!attachments.length) return null;
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {attachments.map((a, i) => {
          const canPreview = isPreviewable(a.mimeType, a.filename);
          return (
            <div key={i} className="flex items-stretch rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] overflow-hidden text-[12px] text-[var(--color-text)]">
              {/* Preview / open button */}
              {canPreview ? (
                <button
                  type="button"
                  onClick={() => setPreview(a)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-[var(--color-primary-light)] transition-colors"
                  title={isOfficeFile(a.mimeType, a.filename) ? "Download to open" : "Preview"}
                >
                  <FileTypeIcon mimeType={a.mimeType} filename={a.filename} />
                  <span className="max-w-[150px] truncate">{a.filename}</span>
                  <span className="text-[var(--color-text-faint)]">({formatBytes(a.size)})</span>
                  {isOfficeFile(a.mimeType, a.filename)
                    ? <IconDownload className="h-3 w-3 text-[var(--color-text-faint)]" />
                    : <IconEye className="h-3 w-3 text-[var(--color-text-faint)]" />}
                </button>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-1.5">
                  <FileTypeIcon mimeType={a.mimeType} filename={a.filename} />
                  <span className="max-w-[150px] truncate">{a.filename}</span>
                  <span className="text-[var(--color-text-faint)]">({formatBytes(a.size)})</span>
                </span>
              )}
              {/* Download button — always visible */}
              <a
                href={attachmentUrl(messageId, a, true)}
                download={a.filename}
                className="flex items-center border-l border-[var(--color-border)] px-2 hover:bg-[var(--color-surface-offset)] transition-colors"
                title="Download"
              >
                <IconDownload className="h-3 w-3 text-[var(--color-text-faint)]" />
              </a>
            </div>
          );
        })}
      </div>

      {preview && (
        <AttachmentPreviewModal
          attachment={preview}
          messageId={messageId}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function HtmlBody({ html, plain }: { html?: string; plain?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const isDark = document.documentElement.classList.contains("dark");
    const bg = isDark ? "#18181b" : "#ffffff";
    const fg = isDark ? "#d4d4d8" : "#27272a";

    doc.open();
    doc.write(`<!DOCTYPE html><html><head>
      <!-- Force every anchor without an explicit target to open in a new
           tab. With <base target="_blank"> we don't have to crawl the
           DOM rewriting links (which would break on lazy-rendered emails)
           and we also can't accidentally navigate THIS iframe away. -->
      <base target="_blank">
      <style>
        *, *::before, *::after { box-sizing: border-box; }
        body {
          margin: 0; padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 14px; line-height: 1.6;
          color: ${fg}; background: ${bg};
          word-break: break-word; overflow-wrap: break-word;
        }
        a { color: var(--color-primary, #0d7c78); }
        img { max-width: 100%; height: auto; }
        blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #d4d4d8; color: #71717a; }
        table { border-collapse: collapse; max-width: 100%; }
        pre { white-space: pre-wrap; overflow-x: auto; }
      </style>
    </head><body>${html}</body></html>`);
    doc.close();

    // Belt-and-braces: even with <base target="_blank">, some sandbox
    // configurations silently swallow the click. Intercept anchor clicks
    // at capture and re-open the URL via the parent window.open — which
    // is unaffected by the iframe's sandbox.
    const onLinkClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Skip in-page anchors and mailto/tel (let the browser handle those).
      if (!href || href.startsWith("#")) return;
      // Convert relative URLs to absolute using the iframe document's base
      // URL if any, falling back to about:blank-safe behaviour.
      let abs: string;
      try { abs = new URL(href, doc.baseURI).toString(); }
      catch { abs = href; }
      // mailto:/tel:/etc — let the browser navigate normally.
      if (/^(mailto|tel|sms):/i.test(abs)) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(abs, "_blank", "noopener,noreferrer");
    };
    doc.addEventListener("click", onLinkClick, true);

    /**
     * Walk the rendered iframe and bump any element whose text is too low-
     * contrast against the background to a readable shade. This handles
     * calendar invites (Google emits an inline grey that cascades through
     * the whole left column) and any other dim-text email — much more
     * reliable than allowlisting specific hex values via CSS selectors.
     *
     * Rules:
     *   - Compute the element's actual text colour via getComputedStyle.
     *   - If the colour is "dim" (in light mode: luminance > 0.30 i.e.
     *     lighter than ~#777; in dark mode: luminance < 0.55), set its
     *     inline color to the body's `fg`.
     *   - Skip elements with `background-color` set (button/CTA chips,
     *     coloured badges) so we don't break designer-styled UI.
     *   - Skip <a> tags — they already have our anchor color rule.
     *   - Re-run if the document mutates (some clients lazy-render).
     */
    function relLuma(r: number, g: number, b: number) {
      // Approx luminance: 0 = black, 1 = white.
      const f = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function parseRgb(s: string): [number, number, number] | null {
      const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (!m) return null;
      return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    }
    // Pin non-null references for the helper closures below (TS narrowing
    // is lost inside nested function expressions).
    const iframeEl = iframe;
    const docEl = doc;
    // Body background luminance — used to detect whether an ancestor's
    // background differs enough to be considered "styled" (button / badge)
    // vs just an invisible card-on-card that matches our page bg.
    const bodyBgLum = isDark ? 0.05 : 0.97; // approx luma of body bg
    /** True iff the element itself OR any ancestor has a background colour
     *  meaningfully different from the page background. Buttons / coloured
     *  badges / callouts qualify; the generic white card the email sits
     *  on does NOT. Used to preserve author-chosen text on styled UI. */
    function hasStyledBgInChain(el: HTMLElement | null): boolean {
      let cur: HTMLElement | null = el;
      const win = iframeEl.contentWindow || window;
      while (cur && cur !== docEl.body && cur !== docEl.documentElement) {
        const bg = win.getComputedStyle(cur).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
          const alpha = bg.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\)/);
          const isOpaque = !alpha || parseFloat(alpha[1]) > 0;
          if (isOpaque) {
            const rgb = parseRgb(bg);
            if (rgb) {
              const ancestorLum = relLuma(rgb[0], rgb[1], rgb[2]);
              // Only skip when the bg is materially different from the page
              // bg — a real button/badge, not another white-ish card.
              if (Math.abs(ancestorLum - bodyBgLum) > 0.15) return true;
            }
          }
        }
        cur = cur.parentElement;
      }
      return false;
    }
    function bumpDimText() {
      if (!docEl.body) return;
      const win = iframeEl.contentWindow || window;
      const all = docEl.body.querySelectorAll<HTMLElement>("*");
      for (const el of Array.from(all)) {
        if (el.tagName === "IMG" || el.tagName === "BR") continue;
        // Skip when the element itself OR an ancestor has a meaningfully-
        // different background (button / coloured badge / callout). The
        // author picked the text colour to read on THAT bg, so leave it.
        if (hasStyledBgInChain(el)) continue;
        const cs = win.getComputedStyle(el);
        const rgb = parseRgb(cs.color);
        if (!rgb) continue;
        const lum = relLuma(rgb[0], rgb[1], rgb[2]);
        if (isDark) {
          // Dark mode: any text darker than ~#888 luma is hard to read.
          if (lum < 0.45) el.style.color = fg;
        } else {
          // Light mode: text with luminance > 0.18 (~#777 and lighter) fails
          // WCAG AA against white. Bump it to our readable fg.
          if (lum > 0.18) el.style.color = fg;
        }
      }
    }
    bumpDimText();
    // Some clients lazy-render parts of the message; re-run shortly after
    // first paint to catch them. Two ticks covers fast + slow loaders.
    setTimeout(bumpDimText, 100);
    setTimeout(bumpDimText, 500);

    const resize = () => {
      if (doc.body) {
        setHeight(Math.max(60, doc.body.scrollHeight + 4));
      }
    };

    const observer = new MutationObserver(resize);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
    iframe.addEventListener("load", resize);

    // Re-measure after each image inside the iframe finishes loading.
    // Without this, scrollHeight is measured before images paint and the
    // iframe is clipped — showing only the first line of content.
    const attachImageListeners = () => {
      const imgs = doc.body?.querySelectorAll<HTMLImageElement>("img") ?? [];
      for (const img of Array.from(imgs)) {
        if (!img.complete) {
          img.addEventListener("load", resize, { once: true });
          img.addEventListener("error", resize, { once: true });
        }
      }
    };
    attachImageListeners();
    // Also catch images added by lazy-rendering email clients.
    const imgObserver = new MutationObserver(() => {
      attachImageListeners();
      resize();
    });
    imgObserver.observe(doc.body, { childList: true, subtree: true });

    // Fallback timeouts for emails that don't fire any of the above events.
    setTimeout(resize, 200);
    setTimeout(resize, 800);
    setTimeout(resize, 2000);

    return () => {
      observer.disconnect();
      imgObserver.disconnect();
      iframe.removeEventListener("load", resize);
      doc.removeEventListener("click", onLinkClick, true);
    };
  }, [html]);

  if (!html) {
    return (
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--color-text)]">
        {plain || "(empty body)"}
      </pre>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      // allow-same-origin: lets doc.write() work and grants the iframe
      //   access to its own document after write.
      // allow-popups: required for window.open() in the link-click handler
      //   to open hrefs in a new tab — without this the sandbox silently
      //   swallows every link click.
      // allow-popups-to-escape-sandbox: lets the newly opened tab behave
      //   like a normal browser tab (not inherit the sandbox restrictions).
      // NOTE: allow-scripts is intentionally omitted — email HTML must not
      //   run JavaScript. Images load fine without it; the sandbox does NOT
      //   block external image/CSS resource fetches (only scripts & forms).
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-3 w-full border-0"
      style={{ height: `${height}px`, minHeight: 60 }}
      title={titleCase("Email body")}
    />
  );
}

export default function InboxPage() {
  const router = useRouter();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // stable ref so the observer doesn't re-subscribe on every render
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [mailSearchInput, setMailSearchInput] = useState("");
  const [mailSearch, setMailSearch] = useState("");

  // Advanced search filter panel state — mirrors Gmail's "Show search options".
  // When the user clicks Search, we translate these fields to Gmail operator
  // syntax and stuff the result into mailSearchInput, so the regular search
  // pipeline handles the rest. Visible / editable in the input bar afterwards.
  const [filterOpen, setFilterOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSubject, setFilterSubject] = useState("");
  const [filterHasWords, setFilterHasWords] = useState("");
  const [filterDoesntHave, setFilterDoesntHave] = useState("");
  const [filterHasAttachment, setFilterHasAttachment] = useState(false);
  // Date-within: one of Gmail's preset spans (matches Gmail UI).
  type DateWithin = "" | "1d" | "3d" | "7d" | "14d" | "30d" | "60d" | "180d" | "365d";
  const [filterDateWithin, setFilterDateWithin] = useState<DateWithin>("");
  const DATE_WITHIN_OPTIONS: { value: DateWithin; label: string }[] = [
    { value: "", label: "Any time" },
    { value: "1d", label: "1 day" },
    { value: "3d", label: "3 days" },
    { value: "7d", label: "1 week" },
    { value: "14d", label: "2 weeks" },
    { value: "30d", label: "1 month" },
    { value: "60d", label: "2 months" },
    { value: "180d", label: "6 months" },
    { value: "365d", label: "1 year" },
  ];

  // Close the filter panel on outside-click (Gmail-style behaviour).
  useEffect(() => {
    if (!filterOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [filterOpen]);

  /** Quote a term if it contains whitespace so multi-word values stay together. */
  function quoteIfNeeded(s: string): string {
    const t = s.trim();
    if (!t) return "";
    if (t.includes(" ") && !t.startsWith('"')) return `"${t}"`;
    return t;
  }

  /** Build the Gmail-search-syntax string from current filter fields. */
  function buildFilterQuery(): string {
    const parts: string[] = [];
    // filterFrom / filterTo come from RecipientField which serialises chips
    // as "Name" <email>, ...  Strip to bare email(s) so Gmail's from:/to:
    // operators get something they can match against. OR multiple emails.
    const fromEmails = extractAllEmailsFromText(filterFrom);
    const toEmails = extractAllEmailsFromText(filterTo);
    if (fromEmails.length === 1) {
      parts.push(`from:${fromEmails[0]}`);
    } else if (fromEmails.length > 1) {
      parts.push(`from:{${fromEmails.join(" ")}}`);
    } else if (filterFrom.trim()) {
      // Free-text fallback (user typed something that isn't a valid email)
      parts.push(`from:${quoteIfNeeded(filterFrom)}`);
    }
    if (toEmails.length === 1) {
      parts.push(`to:${toEmails[0]}`);
    } else if (toEmails.length > 1) {
      parts.push(`to:{${toEmails.join(" ")}}`);
    } else if (filterTo.trim()) {
      parts.push(`to:${quoteIfNeeded(filterTo)}`);
    }
    if (filterSubject.trim()) parts.push(`subject:${quoteIfNeeded(filterSubject)}`);
    if (filterHasWords.trim()) parts.push(filterHasWords.trim());
    if (filterDoesntHave.trim()) {
      // Prefix each term with - for Gmail's NOT operator.
      filterDoesntHave.trim().split(/\s+/).forEach((tok) => parts.push(`-${tok}`));
    }
    if (filterHasAttachment) parts.push("has:attachment");
    if (filterDateWithin) parts.push(`newer_than:${filterDateWithin}`);
    return parts.join(" ");
  }

  /** Apply: build the query, push into the input, close the panel. */
  function applyFilter() {
    const q = buildFilterQuery();
    setMailSearchInput(q);
    // Skip the 400 ms debounce — the user explicitly clicked Search.
    setMailSearch(q);
    setFilterOpen(false);
  }

  /** Clear all filter fields (does not affect the live search). */
  function clearFilter() {
    setFilterFrom("");
    setFilterTo("");
    setFilterSubject("");
    setFilterHasWords("");
    setFilterDoesntHave("");
    setFilterHasAttachment(false);
    setFilterDateWithin("");
  }

  // Labels — loaded once, kept in a map by id for O(1) lookup from rows.
  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  const labelsById = useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of allLabels) m.set(l.id, l);
    return m;
  }, [allLabels]);
  // Optional filter — restricts the thread list to a single user label
  // (intersected with the folder).
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);

  // Inbox category sub-tabs (Primary / Promotions / Social / Updates / Forums).
  // Each maps to a CATEGORY_* system label; the API filters INBOX rows to
  // those carrying the chosen category. Only shown when folder = inbox.
  type CategoryKey = "primary" | "promotions" | "social" | "updates" | "forums";
  const CATEGORY_LABEL: Record<CategoryKey, string> = {
    primary: "CATEGORY_PERSONAL",
    promotions: "CATEGORY_PROMOTIONS",
    social: "CATEGORY_SOCIAL",
    updates: "CATEGORY_UPDATES",
    forums: "CATEGORY_FORUMS",
  };
  const [category, setCategory] = useState<CategoryKey>("primary");
  // Effective label-id passed to the API: when in inbox and no user-label
  // filter is set, use the category label; otherwise use whatever the user
  // explicitly filtered to. Starred/Important sections force their label IDs.
  const effectiveLabelId =
    folder === "starred"
      ? "STARRED"
      : folder === "important"
        ? "IMPORTANT"
        : filterLabelId ?? (folder === "inbox" ? CATEGORY_LABEL[category] : null);

  // Multi-select state (Gmail-style row checkboxes).
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const allSelected =
    threads.length > 0 && threads.every((t) => selectedThreadIds.has(t.id));
  // Per-row action busy state (for the optimistic star toggle / row-quick-actions).
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  // Bulk label selection — tracks the union of label IDs on selected threads
  // so the LabelPicker checkboxes show the right initial state.
  const [bulkLabelSelected, setBulkLabelSelected] = useState<Set<string>>(new Set());
  const [bulkLabelBusy, setBulkLabelBusy] = useState(false);

  // bulkBusy removed — actions are fire-and-forget with instant optimistic UI

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgView[] | null>(null);
  const [threadLabelIds, setThreadLabelIds] = useState<string[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [labelBusy, setLabelBusy] = useState(false);
  // Left-rail "Create label" inline form state
  const [newLabelInput, setNewLabelInput] = useState("");
  const [newLabelCreating, setNewLabelCreating] = useState(false);
  const [showNewLabelForm, setShowNewLabelForm] = useState(false);
  const newLabelInputRef = useRef<HTMLInputElement>(null);

  const [replyText, setReplyText] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);

  // Gmail-style send snackbar — shows "Message sent" immediately on click,
  // stays visible while the API call runs in the background, then shows
  // success or error. On error the user can retry (re-opens compose).
  type SendSnackState =
    | { phase: "sending" }
    | { phase: "sent" }
    | { phase: "error"; message: string; retry: () => void };
  const [sendSnack, setSendSnack] = useState<SendSnackState | null>(null);
  const sendSnackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Show the snackbar and auto-dismiss it after `ms` milliseconds. */
  function showSendSnack(state: SendSnackState, autoDismissMs?: number) {
    if (sendSnackTimerRef.current) clearTimeout(sendSnackTimerRef.current);
    setSendSnack(state);
    if (autoDismissMs) {
      sendSnackTimerRef.current = setTimeout(() => setSendSnack(null), autoDismissMs);
    }
  }

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFiles, setComposeFiles] = useState<PendingFile[]>([]);
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeFullscreen, setComposeFullscreen] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  // In-flight guard for openDraft. A ref (vs state) keeps the useCallback
  // identity stable so click handlers don't rebind on every flip.
  const draftLoadingRef = useRef(false);
  // Mirror of compose state — needed because saveDraft fires from useEffect
  // cleanup / close handlers, after React has already cleared the state setters.
  const composeStateRef = useRef({
    to: "", cc: "", bcc: "", subject: "", body: "",
    draftId: null as string | null,
    files: [] as PendingFile[],
  });
  // Debounced auto-save timer + last-saved snapshot (to avoid no-op POSTs).
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLastSavedRef = useRef<string>("");
  // True if a save is in-flight — prevents overlapping POSTs while typing fast.
  const draftSavingRef = useRef(false);
  const [replyFiles, setReplyFiles] = useState<PendingFile[]>([]);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);
  // Scroll-position preservation: save the list's scrollTop before opening a
  // thread, then restore it the moment the list becomes visible again.
  const listScrollRef = useRef<HTMLUListElement>(null);
  const savedScrollTop = useRef<number>(0);
  // Prefetch cache: hover over a row starts the fetch so the click is instant.
  const prefetchCache = useRef<Map<string, Promise<Response>>>(new Map());
  // Same prefetch cache for draft rows — mirrors prefetchCache but keyed by draftId.
  const draftPrefetchCache = useRef<Map<string, Promise<Response>>>(new Map());

  // Session-scoped SWR cache for thread lists. Keyed by the same params that
  // determine which threads are shown, so switching tabs/folders/labels can
  // paint instantly from memory while a fresh fetch runs in the background.
  // Cleared on the Refresh button click; pruned by mutation paths when the
  // affected entries become stale.
  const listCacheRef = useRef<Map<string, { threads: ThreadRow[]; nextPageToken?: string }>>(new Map());

  // Timestamp of the most recent local mutation. We use this to skip the
  // SWR background revalidation for ~5 s afterwards — Gmail's API lags a
  // few seconds behind our writes, so refetching too soon would clobber the
  // optimistic state. After the cooldown, fresh data is authoritative.
  const lastMutationAtRef = useRef<number>(0);
  const MUTATION_COOLDOWN_MS = 5000;

  /**
   * Apply the same transform to BOTH the rendered list and every cached view.
   * Use this instead of bare setThreads() for any mutation that should persist
   * across tab switches (mark read, star, label, archive/trash, etc.).
   * Without this, an optimistic update would vanish the moment the user
   * navigated away and back to a cached view.
   */
  const mutateThreads = useCallback(
    (transform: (rows: ThreadRow[]) => ThreadRow[]) => {
      setThreads(transform);
      listCacheRef.current.forEach((entry, key) => {
        listCacheRef.current.set(key, { ...entry, threads: transform(entry.threads) });
      });
      lastMutationAtRef.current = Date.now();
    },
    []
  );

  const [recruiterSuggestions, setRecruiterSuggestions] = useState<{ email: string; name: string }[]>([]);
  const [googleContacts, setGoogleContacts] = useState<RecipientSuggestion[]>([]);
  const [contactsHint, setContactsHint] = useState<string | null>(null);

  const threadDerivedEmails = useMemo(() => {
    const set = new Set<string>();
    for (const t of threads) {
      for (const e of extractAllEmailsFromText(t.from)) set.add(e);
    }
    if (messages) {
      for (const m of messages) {
        for (const e of extractAllEmailsFromText(m.from)) set.add(e);
        for (const e of extractAllEmailsFromText(m.to)) set.add(e);
      }
    }
    return set;
  }, [threads, messages]);

  // Keep the compose state mirror up to date for the save-on-close path.
  useEffect(() => {
    composeStateRef.current = {
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      body: composeBody,
      draftId: composeDraftId,
      files: composeFiles,
    };
  }, [composeTo, composeCc, composeBcc, composeSubject, composeBody, composeDraftId, composeFiles]);

  /**
   * Save the current compose contents as a Gmail draft. Idempotent: when
   * composeDraftId is set we PUT (update), otherwise we POST (create new) and
   * adopt the returned draftId so subsequent saves update the same draft.
   *   - Skipped entirely if there's nothing meaningful to save (all fields empty).
   *   - Skipped if the snapshot matches the last saved state (no-op guard).
   *   - Returns the draftId on success, or null if skipped/failed.
   */
  const saveDraft = useCallback(async (): Promise<string | null> => {
    const s = composeStateRef.current;
    const hasContent =
      s.to.trim() || s.cc.trim() || s.bcc.trim() ||
      s.subject.trim() || !richTextIsEmpty(s.body) || s.files.length > 0;
    if (!hasContent) return null;

    // Fingerprint the files cheaply for the no-op guard. Real bytes are only
    // resolved (fetched/encoded) once we know we're actually going to POST.
    const fileFingerprints = s.files.map((f) =>
      f.kind === "new"
        ? `new:${f.file.name}:${f.file.size}`
        : `saved:${f.attachmentId}`
    );
    const snapshot = JSON.stringify({
      to: s.to, cc: s.cc, bcc: s.bcc, subject: s.subject, body: s.body,
      files: fileFingerprints,
    });
    if (snapshot === draftLastSavedRef.current) return s.draftId;
    if (draftSavingRef.current) return s.draftId;

    draftSavingRef.current = true;
    try {
      // Resolve attachments to base64 just-in-time. For "saved" attachments
      // this triggers a fetch back to Gmail — bounded by the snapshot diff,
      // so it only happens when the attachment list actually changed.
      let attachments: Array<{ filename: string; mimeType: string; base64Data: string }> = [];
      if (s.files.length > 0) {
        try {
          attachments = await resolveAttachmentsForUpload(s.files);
        } catch {
          // If we can't fetch the bytes (rare — usually network), bail out
          // rather than overwrite the existing draft with an attachment-less
          // version that would silently lose user data.
          return null;
        }
      }
      const res = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: s.to.trim(),
          cc: s.cc.trim() || undefined,
          bcc: s.bcc.trim() || undefined,
          subject: s.subject.trim(),
          // s.body is HTML from RichTextEditor. Send it as htmlBody; the server
          // derives the plain-text part from it.  Leave textBody empty — the
          // server only uses it when htmlBody is missing (legacy callers).
          textBody: "",
          htmlBody: s.body,
          ...(s.draftId ? { draftId: s.draftId } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { draftId?: string; messageId?: string };
      draftLastSavedRef.current = snapshot;
      // Adopt the new draftId so subsequent edits update the same draft.
      if (data.draftId && data.draftId !== s.draftId) {
        composeStateRef.current.draftId = data.draftId;
        setComposeDraftId(data.draftId);
      }
      // After a successful save, all attachments are now "saved" on Gmail.
      // Convert any "new" entries into "saved" references using the returned
      // messageId — this means subsequent auto-saves won't re-base64-encode
      // them (the saved-variant just holds a pointer).
      // We can only do this re-mapping if we know the messageId for each
      // attachment, which Gmail doesn't return individually for a draft.
      // Leaving "new" entries as-is is safe — the snapshot dedup will skip
      // re-uploads until the user actually changes the attachment list.
      return data.draftId ?? s.draftId;
    } catch {
      return null;
    } finally {
      draftSavingRef.current = false;
    }
  }, []);

  // closeComposeAndSaveDraft + discardComposeDraft are declared later — they
  // depend on scheduleCountRefresh and loadThreads which are defined further down.

  useEffect(() => {
    if (!composeOpen) {
      // Reset ALL compose fields when the window closes so the next
      // "Compose" click always opens a blank window, never a stale draft.
      // (closeComposeAndSaveDraft already snapshotted the state via the ref
      //  before this fires, so the in-flight save isn't affected.)
      setComposeCcBccOpen(false);
      setComposeMinimized(false);
      setComposeFullscreen(false);
      setComposeDraftId(null);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      setComposeFiles([]);
      draftLastSavedRef.current = "";
      return;
    }
    if (composeCc.trim() || composeBcc.trim()) {
      setComposeCcBccOpen(true);
    }
  }, [composeOpen, composeCc, composeBcc]);

  // Debounced auto-save while the user is editing. Matches Gmail: ~2s after
  // the last keystroke we silently POST the current contents as a draft.
  // No spinners/UI — feels invisible like Gmail's own auto-save.
  useEffect(() => {
    if (!composeOpen) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      void saveDraft();
    }, 2000);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [composeOpen, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeFiles, saveDraft]);

  const composeRecipientSuggestions = useMemo((): RecipientSuggestion[] => {
    const map = new Map<string, string>();
    for (const c of googleContacts) {
      const em = c.email.trim().toLowerCase();
      if (em) map.set(em, c.displayName?.trim() || em);
    }
    for (const r of recruiterSuggestions) {
      const em = r.email.trim().toLowerCase();
      if (em && !map.has(em)) map.set(em, r.name.trim() || em);
    }
    for (const e of Array.from(threadDerivedEmails)) {
      if (!map.has(e)) map.set(e, e);
    }
    return Array.from(map.entries()).map(([email, label]) => ({
      email,
      displayName: label !== email ? label : undefined,
    }));
  }, [googleContacts, recruiterSuggestions, threadDerivedEmails]);

  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingRow>>({});

  /**
   * Convert the compose attachment list into the {filename, mimeType, base64Data}
   * shape the send/drafts APIs accept. New uploads carry their base64 in
   * memory; saved-server attachments are fetched on demand via /api/gmail/attachment.
   * Returns the resolved attachments in their original order; throws on fetch failure.
   */
  async function resolveAttachmentsForUpload(
    list: PendingFile[]
  ): Promise<Array<{ filename: string; mimeType: string; base64Data: string }>> {
    return Promise.all(
      list.map(async (f) => {
        if (f.kind === "new") {
          return {
            filename: f.file.name,
            mimeType: f.file.type || "application/octet-stream",
            base64Data: f.base64,
          };
        }
        // Saved attachment — fetch the bytes from Gmail and base64-encode them.
        const url = `/api/gmail/attachment?messageId=${encodeURIComponent(f.messageId)}&attachmentId=${encodeURIComponent(f.attachmentId)}&filename=${encodeURIComponent(f.name)}&mimeType=${encodeURIComponent(f.mimeType)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not fetch attachment ${f.name}`);
        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => {
            const result = r.result as string;
            resolve(result.split(",")[1] || "");
          };
          r.onerror = reject;
          r.readAsDataURL(blob);
        });
        return { filename: f.name, mimeType: f.mimeType, base64Data: base64 };
      })
    );
  }

  async function handleFileSelect(files: FileList | null, target: "compose" | "reply") {
    if (!files) return;
    const newFiles: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) { alert(`${file.name} is too large (max 25 MB)`); continue; }
      const base64 = await fileToBase64(file);
      newFiles.push({ kind: "new", file, base64 });
    }
    if (target === "compose") setComposeFiles((prev) => [...prev, ...newFiles]);
    else setReplyFiles((prev) => [...prev, ...newFiles]);
  }

  useEffect(() => {
    const t = setTimeout(() => setMailSearch(mailSearchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [mailSearchInput]);

  const loadTracking = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/tracking");
      const data = (await res.json()) as { tracking?: TrackingRow[] };
      if (data.tracking) {
        const map: Record<string, TrackingRow> = {};
        for (const t of data.tracking) {
          map[t.gmail_message_id] = t;
        }
        setTrackingMap(map);
      }
    } catch {
      // non-critical
    }
  }, []);

  /**
   * SWR-style list loader. For first-page loads:
   *   1. If we have cached data for this (folder, category, labelFilter,
   *      search) combo, paint it INSTANTLY (no spinner).
   *   2. Then fetch in the background and silently swap in the fresh result.
   * For appended pages (infinite scroll) we never cache — that path always
   * hits the network.
   *
   * Tabs/folders/labels therefore feel instant on return, matching Gmail.
   * A mutation that affects the visible list (star/read/archive) updates the
   * cache in-place via the existing setThreads() calls, so cached views are
   * never stale-by-our-own-doing — only Gmail's own ~3-5s propagation lag
   * can cause divergence, which the background refetch then corrects.
   */
  const loadThreads = useCallback(
    async (opts: { append: boolean; pageToken?: string; forceRefresh?: boolean }) => {
      // "starred" and "important" are virtual folders — pass inbox to the API
      // and use labelId=STARRED / labelId=IMPORTANT to filter.
      const apiFolder = (folder === "starred" || folder === "important") ? "inbox" : folder;
      const params = new URLSearchParams({ folder: apiFolder, maxResults: "25" });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (mailSearch) params.set("search", mailSearch);
      // When a search query is active, drop the category/label filter so results
      // match all mail — exactly like Gmail's own search bar behaviour.
      if (effectiveLabelId && !mailSearch) params.set("labelId", effectiveLabelId);

      const cacheKey = `${apiFolder}|${effectiveLabelId ?? ""}|${mailSearch}`;

      if (opts.append) {
        setLoadingMore(true); loadingMoreRef.current = true;
      } else {
        setListError(null);
        // SWR: if we have a cached snapshot for this view, paint it
        // immediately so the user never sees a spinner on tab-switch.
        const cached = !opts.forceRefresh ? listCacheRef.current.get(cacheKey) : undefined;
        if (cached) {
          setThreads(cached.threads);
          setNextPageToken(cached.nextPageToken);
          setLoadingList(false);
          // If we just made a local mutation, skip the background refetch.
          // Gmail's read-side lags our writes by a few seconds and would
          // clobber our optimistic state. After the cooldown, fresh wins.
          const sinceMutation = Date.now() - lastMutationAtRef.current;
          if (!opts.forceRefresh && sinceMutation < MUTATION_COOLDOWN_MS) {
            return;
          }
        } else {
          setLoadingList(true);
        }
      }

      try {
        const res = await fetch(`/api/gmail/threads?${params.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as { error?: string; threads?: ThreadRow[]; nextPageToken?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load inbox");
        const incoming = data.threads || [];

        if (opts.append) {
          setThreads((prev) => {
            const merged = [...prev, ...incoming];
            // Keep the cache snapshot in sync with the merged list so coming
            // back to this view after infinite-scrolling still feels instant.
            listCacheRef.current.set(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
            return merged;
          });
        } else {
          setThreads(incoming);
          listCacheRef.current.set(cacheKey, { threads: incoming, nextPageToken: data.nextPageToken });
        }
        setNextPageToken(data.nextPageToken);
      } catch (e) {
        // Only surface the error if we have nothing on screen — otherwise the
        // cached snapshot is still useful and a transient blip shouldn't blank it.
        if (!opts.append && !listCacheRef.current.has(cacheKey)) {
          setListError(e instanceof Error ? e.message : "Failed to load");
          setThreads([]);
        }
      } finally {
        setLoadingList(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },     [folder, mailSearch, effectiveLabelId]
  );

  useEffect(() => {
    void loadThreads({ append: false });
  }, [loadThreads]);

  // Fetch the user's labels once on mount; rare-change data, so we don't
  // poll. Refreshed only after a successful "create label" action.
  const loadLabels = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/labels");
      if (!res.ok) return;
      const j = (await res.json()) as { labels?: GmailLabel[] };
      setAllLabels(j.labels ?? []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  // Folder + label counts. Always fetched fresh (server returns no-store) and
  // re-fetched after every mutation that can change a count, so the badges
  // stay correct across navigations without any client-side cache logic.
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>({});

  const loadCounts = useCallback(async () => {
    if (allLabels.length === 0) return;
    const ids = [
      "INBOX",
      "SENT",
      "DRAFT",
      "STARRED",
      "IMPORTANT",
      "CATEGORY_PERSONAL",
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_UPDATES",
      "CATEGORY_FORUMS",
      ...allLabels.filter((l) => l.type === "user").map((l) => l.id),
    ];
    try {
      const res = await fetch(
        `/api/gmail/folder-counts?ids=${encodeURIComponent(ids.join(","))}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const j = (await res.json()) as { counts?: Record<string, { total: number; unread: number }> };
      setLabelCounts(j.counts ?? {});
    } catch { /* ignore */ }
  }, [allLabels]);

  /**
   * Re-fetch counts shortly after a mutation. Gmail's label counts API lags
   * a few seconds behind a label change, so we retry once with a delay to
   * catch the propagated value. The first call serves as an immediate sync
   * (in case Gmail responds fast); the second covers the typical lag.
   */
  const scheduleCountRefresh = useCallback(() => {
    void loadCounts();
    const t1 = setTimeout(() => void loadCounts(), 1500);
    const t2 = setTimeout(() => void loadCounts(), 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [loadCounts]);

  /**
   * Called when the user closes the compose window without sending. Saves
   * the current contents as a draft (matches Gmail behaviour — close = save,
   * not lose).  After saving, refresh the drafts list so it appears there
   * immediately.
   */
  const closeComposeAndSaveDraft = useCallback(() => {
    // Cancel any pending debounced save — we're saving now.
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    // Snapshot the state mirror BEFORE the close-effect wipes it.
    const hadContent =
      composeStateRef.current.to.trim() ||
      composeStateRef.current.cc.trim() ||
      composeStateRef.current.bcc.trim() ||
      composeStateRef.current.subject.trim() ||
      !richTextIsEmpty(composeStateRef.current.body) ||
      composeStateRef.current.files.length > 0;
    setComposeOpen(false);
    setComposeCcBccOpen(false);
    if (hadContent) {
      void saveDraft().then(() => {
        // Invalidate cached list views so the drafts folder shows the new draft.
        listCacheRef.current.clear();
        if (folder === "drafts") void loadThreads({ append: false, forceRefresh: true });
        scheduleCountRefresh();
      });
    }
  }, [saveDraft, folder, scheduleCountRefresh, loadThreads]);

  /**
   * Discard button — explicit "throw this away" action. Deletes the draft on
   * the server (if one was previously saved) and closes the window without saving.
   */
  const discardComposeDraft = useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const draftId = composeStateRef.current.draftId;
    setComposeOpen(false);
    setComposeCcBccOpen(false);
    if (draftId) {
      void fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, {
        method: "DELETE",
      })
        .then(() => {
          listCacheRef.current.clear();
          if (folder === "drafts") void loadThreads({ append: false, forceRefresh: true });
          scheduleCountRefresh();
        })
        .catch(() => {/* non-fatal */});
    }
  }, [folder, scheduleCountRefresh, loadThreads]);

  useEffect(() => { void loadCounts(); }, [loadCounts]);
  // Refresh counts after the list reloads (bulk actions, refresh).
  useEffect(() => { if (!loadingList) void loadCounts(); }, [loadingList, loadCounts]);

  useEffect(() => {
    void loadTracking();
  }, [loadTracking]);

  // Restore scroll position when the user navigates back to the list.
  // We use a requestAnimationFrame so the <ul> has re-mounted before we set scrollTop.
  useEffect(() => {
    if (selectedId !== null) return; // only run when returning to list
    const saved = savedScrollTop.current;
    if (saved <= 0) return;
    const raf = requestAnimationFrame(() => {
      if (listScrollRef.current) {
        listScrollRef.current.scrollTop = saved;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  // Auto-load more: observe the sentinel li inside the scrollable ul.
  // Re-subscribes whenever nextPageToken changes so the new token is captured.
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const scroller = listScrollRef.current; // the <ul> that actually scrolls
    if (!sentinel || !scroller || !nextPageToken || selectedId) return;
    let fired = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !fired && !loadingMoreRef.current) {
          fired = true;
          observer.disconnect();
          void loadThreads({ append: true, pageToken: nextPageToken });
        }
      },
      { root: scroller, rootMargin: "200px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextPageToken, selectedId, loadThreads]);

  // Load recipient suggestions (Google contacts + recruiter list) the
  // first time either Compose or the advanced search filter opens. Both
  // surfaces consume composeRecipientSuggestions; we only fetch once
  // per session unless explicitly refreshed.
  const contactsLoadedRef = useRef(false);
  useEffect(() => {
    if (!composeOpen && !filterOpen) return;
    if (contactsLoadedRef.current) return;
    contactsLoadedRef.current = true;
    let cancelled = false;
    setContactsHint(null);
    void Promise.all([
      fetch("/api/recruiters").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/gmail/contacts").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([recruitersJson, contactsJson]) => {
        if (cancelled) return;
        setRecruiterSuggestions(
          (recruitersJson as { recruiters?: { email: string; name: string }[] } | null)?.recruiters ?? [],
        );
        const raw = contactsJson as {
          contacts?: RecipientSuggestion[];
          hint?: string;
        } | null;
        const gc = raw?.contacts;
        setGoogleContacts(Array.isArray(gc) ? gc : []);
        setContactsHint(typeof raw?.hint === "string" && raw.hint.trim() ? raw.hint.trim() : null);
      })
      .catch(() => {
        if (!cancelled) {
          setRecruiterSuggestions([]);
          setGoogleContacts([]);
          // Allow a retry on next open if the first attempt failed
          contactsLoadedRef.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [composeOpen, filterOpen]);

  const openDraft = useCallback(async (draftId: string) => {
    if (draftLoadingRef.current) return;
    draftLoadingRef.current = true;
    // Drafts open in the compose panel — clear any open thread view
    setSelectedId(null);
    setMessages(null);
    setThreadError(null);
    try {
      // Reuse prefetch response if hover already started the fetch; otherwise start fresh.
      const inflight = draftPrefetchCache.current.get(draftId);
      draftPrefetchCache.current.delete(draftId); // consume — each Response body can only be read once
      const res = await (inflight
        ? inflight.then((r) => r.clone()).catch(() => fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`))
        : fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`));
      const data = (await res.json()) as {
        error?: string;
        to?: string;
        cc?: string;
        bcc?: string;
        subject?: string;
        textBody?: string;
        htmlBody?: string;
        attachments?: Array<{
          attachmentId: string;
          filename: string;
          mimeType: string;
          size: number;
          messageId: string;
        }>;
      };
      if (!res.ok) throw new Error(data.error || "Failed to open draft");
      // Hydrate any existing attachments as "saved" references — the bytes
      // are not fetched until/unless the user saves or sends.
      const loadedFiles: PendingFile[] = (data.attachments ?? []).map((a) => ({
        kind: "saved" as const,
        name: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        messageId: a.messageId,
        attachmentId: a.attachmentId,
      }));
      // composeBody is HTML.  Prefer the saved HTML part; fall back to
      // textBody wrapped in a <p> so plain-text drafts still display
      // readably in the rich editor.
      const loadedHtmlBody =
        data.htmlBody && data.htmlBody.trim().length > 0
          ? data.htmlBody
          : (data.textBody ?? "")
              .split(/\n\n+/)
              .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
              .join("");
      setComposeDraftId(draftId);
      setComposeTo(data.to ?? "");
      setComposeCc(data.cc ?? "");
      setComposeBcc(data.bcc ?? "");
      setComposeSubject(data.subject ?? "");
      setComposeBody(loadedHtmlBody);
      setComposeFiles(loadedFiles);
      // Seed the last-saved snapshot so auto-save sees no diff and stays
      // quiet until the user actually edits something.
      const fileFingerprints = loadedFiles.map((f) =>
        f.kind === "saved" ? `saved:${f.attachmentId}` : `new:${(f as { file: File }).file.name}:${(f as { file: File }).file.size}`
      );
      draftLastSavedRef.current = JSON.stringify({
        to: data.to ?? "", cc: data.cc ?? "", bcc: data.bcc ?? "",
        subject: data.subject ?? "", body: loadedHtmlBody,
        files: fileFingerprints,
      });
      setComposeOpen(true);
      setComposeMinimized(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open draft");
    } finally {
      draftLoadingRef.current = false;
    }
  }, []);

  // Prefetch a thread on hover — stores the in-flight Response promise so
  // openThread can clone + consume it without starting a new request.
  const prefetchThread = useCallback((threadId: string) => {
    if (prefetchCache.current.has(threadId)) return; // already in-flight or done
    const promise = fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
    prefetchCache.current.set(threadId, promise);
    // Auto-evict after 60 s so stale data doesn't accumulate.
    setTimeout(() => prefetchCache.current.delete(threadId), 60_000);
  }, []);

  // Prefetch a draft on hover — same pattern as prefetchThread so openDraft
  // can reuse the already-in-flight response and open instantly on click.
  const prefetchDraft = useCallback((draftId: string) => {
    if (draftPrefetchCache.current.has(draftId)) return; // already in-flight or done
    const promise = fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, { cache: "no-store" });
    draftPrefetchCache.current.set(draftId, promise);
    // Auto-evict after 60 s so stale data doesn't accumulate.
    setTimeout(() => draftPrefetchCache.current.delete(draftId), 60_000);
  }, []);

  const openThread = useCallback(async (threadId: string) => {
    // Save scroll position BEFORE switching to detail view so we can restore it on back.
    savedScrollTop.current = listScrollRef.current?.scrollTop ?? 0;

    // Optimistically mark the row as read the instant the user clicks.
    // mutateThreads also updates every cached list view so the read state
    // survives tab switches without waiting for the background refetch.
    mutateThreads((rows) =>
      rows.map((r) => (r.id === threadId && r.unread ? { ...r, unread: false } : r))
    );
    // Fire-and-forget the read API call in parallel; refresh counts on success
    // so the Inbox unread badge moves in sync with the row losing bold.
    const wasUnread = threads.find((r) => r.id === threadId)?.unread;
    fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: ["UNREAD"] }),
    })
      .then(() => { if (wasUnread) scheduleCountRefresh(); })
      .catch(() => {/* non-critical */});

    setSelectedId(threadId);
    setMessages(null); setThreadError(null); setReplyText(""); setReplyOpen(false);
    setThreadLabelIds([]);
    setLoadingThread(true);
    try {
      // Reuse prefetch response if hover already started the fetch; otherwise start fresh.
      const inflight = prefetchCache.current.get(threadId);
      prefetchCache.current.delete(threadId); // consume — each Response body can only be read once
      const res = inflight ? await inflight : await fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`, { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string; messages?: MsgView[]; labelIds?: string[];
      };
      if (!res.ok) throw new Error(data.error || "Failed to open thread");
      setMessages(data.messages || []);
      // Strip UNREAD from returned labelIds — already marked read above.
      setThreadLabelIds((data.labelIds ?? []).filter((id) => id !== "UNREAD"));
      void loadTracking();
    } catch (e) { setThreadError(e instanceof Error ? e.message : "Error"); }
    finally { setLoadingThread(false); }
  }, [loadTracking, threads, scheduleCountRefresh, mutateThreads]);

  // Add or remove a label on the currently-open thread. Optimistic — flips
  // local chips immediately and rolls back if the server rejects.
  const toggleThreadLabel = useCallback(
    async (labelId: string, nextChecked: boolean) => {
      if (!selectedId) return;
      const prev = threadLabelIds;
      setThreadLabelIds((cur) =>
        nextChecked ? Array.from(new Set([...cur, labelId])) : cur.filter((id) => id !== labelId)
      );
      // Mirror on the row in the list too (and in every cached view).
      mutateThreads((rows) =>
        rows.map((r) =>
          r.id === selectedId
            ? {
                ...r,
                labelIds: nextChecked
                  ? Array.from(new Set([...(r.labelIds ?? []), labelId]))
                  : (r.labelIds ?? []).filter((id) => id !== labelId),
              }
            : r
        )
      );
      setLabelBusy(true);
      try {
        const res = await fetch(
          `/api/gmail/threads/${encodeURIComponent(selectedId)}/labels`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              nextChecked ? { add: [labelId] } : { remove: [labelId] }
            ),
          }
        );
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        scheduleCountRefresh();
      } catch (e) {
        // Roll back
        setThreadLabelIds(prev);
        setThreads((rows) =>
          rows.map((r) => (r.id === selectedId ? { ...r, labelIds: r.labelIds } : r))
        );
        alert(e instanceof Error ? e.message : "Could not update labels");
      } finally {
        setLabelBusy(false);
      }
    },
    [selectedId, threadLabelIds, scheduleCountRefresh, mutateThreads]
  );

  // Create a new Gmail label and immediately apply it to the open thread.
  // Toggle the STARRED label on a thread (optimistic). Used by the row star
  // icon — separate from the labels picker because Gmail treats star as a
  // first-class affordance, not a chip.
  const toggleThreadStar = useCallback(
    async (threadId: string, nextStarred: boolean) => {
      setRowBusy((s) => new Set(s).add(threadId));
      mutateThreads((rows) =>
        rows.map((r) => (r.id === threadId ? { ...r, starred: nextStarred } : r))
      );
      // Optimistically update the Starred badge so the UI feels instant.
      // scheduleCountRefresh below catches up with Gmail's authoritative count.
      const change = nextStarred ? 1 : -1;
      setLabelCounts((prev) => {
        const cur = prev["STARRED"] ?? { total: 0, unread: 0 };
        return {
          ...prev,
          STARRED: { ...cur, total: Math.max(0, cur.total + change) },
        };
      });
      try {
        const res = await fetch(
          `/api/gmail/threads/${encodeURIComponent(threadId)}/labels`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              nextStarred ? { add: ["STARRED"] } : { remove: ["STARRED"] }
            ),
          }
        );
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        scheduleCountRefresh();
      } catch (e) {
        // Roll back the optimistic toggle across both rendered list and cache.
        mutateThreads((rows) =>
          rows.map((r) => (r.id === threadId ? { ...r, starred: !nextStarred } : r))
        );
        setLabelCounts((prev) => {
          const cur = prev["STARRED"] ?? { total: 0, unread: 0 };
          return {
            ...prev,
            STARRED: { ...cur, total: Math.max(0, cur.total - change) },
          };
        });
        alert(e instanceof Error ? e.message : "Could not update star");
      } finally {
        setRowBusy((s) => {
          const next = new Set(s);
          next.delete(threadId);
          return next;
        });
      }
    },
    [scheduleCountRefresh, mutateThreads]
  );

  // Row quick-actions: archive (remove INBOX), trash (add TRASH), and
  // mark-read/unread. Optimistic — removes the row from the list immediately
  // for archive/trash, rolls back on failure.
  /** Bulk-action for the toolbar above the list. Removes rows for archive
   *  and trash; updates unread/starred state for the other actions. */
  const performBulkAction = useCallback(
    (action: "archive" | "trash" | "markRead" | "markUnread" | "star") => {
      const ids = Array.from(selectedThreadIds);
      if (ids.length === 0) return;

      // 1. Optimistic UI update — instant, no waiting. mutateThreads also
      //    propagates the change to every cached list view so it survives
      //    tab switches without waiting for the background refetch.
      const selectedSet = selectedThreadIds;
      const removeFromList = action === "archive" || action === "trash";
      if (removeFromList) {
        mutateThreads((rows) => rows.filter((r) => !selectedSet.has(r.id)));
      } else if (action === "markRead" || action === "markUnread") {
        mutateThreads((rows) =>
          rows.map((r) =>
            selectedSet.has(r.id) ? { ...r, unread: action === "markUnread" } : r
          )
        );
      } else if (action === "star") {
        mutateThreads((rows) =>
          rows.map((r) => (selectedSet.has(r.id) ? { ...r, starred: true } : r))
        );
        // Optimistically bump the Starred badge; scheduleCountRefresh below
        // re-syncs with Gmail's authoritative number after a brief delay.
        const newlyStarred = ids.filter(
          (id) => !threads.find((t) => t.id === id)?.starred
        ).length;
        if (newlyStarred > 0) {
          setLabelCounts((prev) => {
            const cur = prev["STARRED"] ?? { total: 0, unread: 0 };
            return { ...prev, STARRED: { ...cur, total: cur.total + newlyStarred } };
          });
        }
      }

      // 2. Clear selection immediately — user is unblocked right away.
      setSelectedThreadIds(new Set());

      // 3. Fire API in the background — roll back silently on failure.
      const body =
        action === "archive"
          ? { add: [] as string[], remove: ["INBOX"] }
          : action === "trash"
            ? { add: ["TRASH"], remove: ["INBOX"] }
            : action === "markRead"
              ? { add: [] as string[], remove: ["UNREAD"] }
              : action === "markUnread"
                ? { add: ["UNREAD"], remove: [] as string[] }
                : { add: ["STARRED"], remove: [] as string[] };
      fetch("/api/gmail/threads/batch-modify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadIds: ids, ...body }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error || "Bulk action failed");
          }
          scheduleCountRefresh();
        })
        .catch(() => {
          // Roll back silently — invalidate the SWR cache and refetch so the
          // server-truth list paints, undoing the optimistic update.
          listCacheRef.current.clear();
          void loadThreads({ append: false, forceRefresh: true });
          scheduleCountRefresh();
        });
    },
    [selectedThreadIds, threads, scheduleCountRefresh, mutateThreads, loadThreads]
  );

  // Re-compute union of labels across selected threads whenever selection changes,
  // so LabelPicker pre-checks labels that are on at least one selected thread.
  useEffect(() => {
    const union = new Set<string>();
    Array.from(selectedThreadIds).forEach((id) => {
      (threads.find((t) => t.id === id)?.labelIds ?? []).forEach((lid) => {
        union.add(lid);
      });
    });
    setBulkLabelSelected(union);
  }, [selectedThreadIds, threads]);

  /** Called when user toggles a checkbox inside the bulk LabelPicker. */
  const handleBulkLabelToggle = useCallback(
    async (labelId: string, nextChecked: boolean) => {
      const ids = Array.from(selectedThreadIds);
      if (ids.length === 0 || bulkLabelBusy) return;

      // Optimistic: update the local union and thread rows immediately.
      setBulkLabelSelected((prev) => {
        const next = new Set(prev);
        if (nextChecked) next.add(labelId); else next.delete(labelId);
        return next;
      });
      mutateThreads((rows) =>
        rows.map((r) => {
          if (!selectedThreadIds.has(r.id)) return r;
          const cur = new Set(r.labelIds ?? []);
          if (nextChecked) cur.add(labelId); else cur.delete(labelId);
          return { ...r, labelIds: Array.from(cur) };
        })
      );

      setBulkLabelBusy(true);
      try {
        await fetch("/api/gmail/threads/batch-modify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadIds: ids,
            ...(nextChecked ? { add: [labelId] } : { remove: [labelId] }),
          }),
        });
        scheduleCountRefresh();
      } catch {
        // Non-fatal — list stays optimistic; user can refresh if needed.
      } finally {
        setBulkLabelBusy(false);
      }
    },
    [selectedThreadIds, bulkLabelBusy, scheduleCountRefresh, mutateThreads]
  );

  /** Create a new label then immediately apply it to all selected threads. */
  const handleBulkLabelCreate = useCallback(
    async (name: string) => {
      const res = await fetch("/api/gmail/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; label?: GmailLabel };
      if (!res.ok || !j.label) throw new Error(j.error || "Could not create label");
      // Insert in alphabetical position (matching the server's sort order)
      // so the new label appears where the user expects to see it, and it
      // doesn't fall off the visible .slice(0, 15) window in the left rail.
      setAllLabels((prev) => insertLabelSorted(prev, j.label!));
      await handleBulkLabelToggle(j.label.id, true);
    },
    [handleBulkLabelToggle]
  );

  const toggleRowSelection = useCallback((threadId: string) => {
    setSelectedThreadIds((s) => {
      const next = new Set(s);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedThreadIds((s) => {
      if (s.size === threads.length && threads.length > 0) return new Set();
      return new Set(threads.map((t) => t.id));
    });
  }, [threads]);

  // Clear selection whenever the underlying list shifts (folder change, refresh,
  // label filter change) — selection ids would otherwise reference rows that
  // are no longer visible.
  useEffect(() => {
    setSelectedThreadIds(new Set());
  }, [folder, mailSearch, effectiveLabelId]);

  const createAndApplyLabel = useCallback(
    async (name: string) => {
      try {
        const res = await fetch("/api/gmail/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          label?: GmailLabel;
        };
        if (!res.ok || !j.label) throw new Error(j.error || "Could not create label");
        // Insert in alphabetical position (matching the server's sort order)
      // so the new label appears where the user expects to see it, and it
      // doesn't fall off the visible .slice(0, 15) window in the left rail.
      setAllLabels((prev) => insertLabelSorted(prev, j.label!));
        if (selectedId) await toggleThreadLabel(j.label.id, true);
      } catch (e) {
        alert(e instanceof Error ? e.message : "Could not create label");
      }
    },
    [selectedId, toggleThreadLabel]
  );

  /** Create a new label from the left-rail form (no thread to apply it to). */
  async function createLabelFromRail() {
    const name = newLabelInput.trim();
    if (!name || newLabelCreating) return;
    setNewLabelCreating(true);
    try {
      const res = await fetch("/api/gmail/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; label?: GmailLabel };
      if (!res.ok || !j.label) throw new Error(j.error || "Could not create label");
      // Insert in alphabetical position (matching the server's sort order)
      // so the new label appears where the user expects to see it, and it
      // doesn't fall off the visible .slice(0, 15) window in the left rail.
      setAllLabels((prev) => insertLabelSorted(prev, j.label!));
      setNewLabelInput("");
      setShowNewLabelForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not create label");
    } finally {
      setNewLabelCreating(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !messages?.length || !replyText.trim()) return;
    const last = messages[messages.length - 1];
    const to = extractEmailAddress(last.from);

    // Snapshot before clearing.
    const replySnapshot = { text: replyText.trim(), files: replyFiles, threadId: selectedId, lastId: last.id };

    // Close the reply panel immediately — optimistic UX.
    setReplyText(""); setReplyOpen(false); setReplyFiles([]);
    setThreadError(null);
    showSendSnack({ phase: "sending" });

    try {
      const attachments = await resolveAttachmentsForUpload(replySnapshot.files);
      const res = await fetch("/api/gmail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: "",
          textBody: replySnapshot.text,
          threadId: replySnapshot.threadId,
          inReplyToMessageId: replySnapshot.lastId,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");

      // Refresh the open thread to show the new reply message.
      void openThread(replySnapshot.threadId);
      listCacheRef.current.clear();
      void loadThreads({ append: false, forceRefresh: true });
      void loadTracking();
      showSendSnack({ phase: "sent" }, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      showSendSnack({
        phase: "error",
        message: msg,
        retry: () => {
          setSendSnack(null);
          setReplyText(replySnapshot.text);
          setReplyFiles(replySnapshot.files);
          setReplyOpen(true);
        },
      });
    }
  }

  async function sendCompose() {
    if (!composeTo.trim()) {
      alert("Please add at least one recipient before sending.");
      return;
    }

    // Snapshot compose state BEFORE closing the window so the retry closure
    // and the background fetch both see a stable copy.
    const snapshot = {
      to: composeTo.trim(),
      cc: composeCc.trim(),
      bcc: composeBcc.trim(),
      subject: composeSubject.trim(),
      htmlBody: composeBody,
      files: composeFiles,
      draftId: composeDraftId,
    };

    // ── Gmail-style optimistic close ──────────────────────────────────────
    // Close the compose window immediately — the user sees "Message sent"
    // right away. The actual API call runs in the background below.
    setComposeOpen(false);
    setComposeDraftId(null);
    setComposeTo(""); setComposeCc(""); setComposeBcc("");
    setComposeSubject(""); setComposeBody(""); setComposeFiles([]);
    showSendSnack({ phase: "sending" });

    // Inject an optimistic row into the Sent list so it appears immediately.
    // We use a stable temp id prefixed "__opt__" so reconciliation can
    // identify and replace it once the real server id comes back.
    const optId = `__opt__${Date.now()}`;
    const optimisticRow: ThreadRow = {
      id: optId,
      snippet: "",
      subject: snapshot.subject || "(no subject)",
      from: "me",
      date: new Date().toISOString(),
      unread: false,
      starred: false,
      important: false,
    };
    // Prepend to Sent list cache so the row appears even if the user is
    // currently viewing another folder.
    const sentKey = `sent||`;
    const sentCached = listCacheRef.current.get(sentKey);
    if (sentCached) {
      listCacheRef.current.set(sentKey, {
        threads: [optimisticRow, ...sentCached.threads],
        nextPageToken: sentCached.nextPageToken,
      });
    }
    if (folder === "sent") {
      mutateThreads((rows) => [optimisticRow, ...rows]);
    }

    // ── Background send ───────────────────────────────────────────────────
    try {
      const attachments = await resolveAttachmentsForUpload(snapshot.files);
      const res = await fetch("/api/gmail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: snapshot.to,
          cc: snapshot.cc || undefined,
          bcc: snapshot.bcc || undefined,
          subject: snapshot.subject,
          textBody: "",
          htmlBody: snapshot.htmlBody,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");

      // Delete the draft it was based on (fire-and-forget).
      if (snapshot.draftId) {
        void fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(snapshot.draftId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      // Remove the optimistic row — the real refresh will add the true row.
      mutateThreads((rows) => rows.filter((r) => r.id !== optId));
      const sentC = listCacheRef.current.get(sentKey);
      if (sentC) {
        listCacheRef.current.set(sentKey, {
          threads: sentC.threads.filter((r) => r.id !== optId),
          nextPageToken: sentC.nextPageToken,
        });
      }
      // Invalidate + refresh so the real sent row and counts paint.
      listCacheRef.current.clear();
      void loadThreads({ append: false, forceRefresh: true });
      void loadTracking();

      showSendSnack({ phase: "sent" }, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      // Remove the optimistic row on failure.
      mutateThreads((rows) => rows.filter((r) => r.id !== optId));
      const sentC = listCacheRef.current.get(sentKey);
      if (sentC) {
        listCacheRef.current.set(sentKey, {
          threads: sentC.threads.filter((r) => r.id !== optId),
          nextPageToken: sentC.nextPageToken,
        });
      }
      // Show error snackbar with Retry button — re-opens compose with the
      // original content so the user doesn't lose their message.
      showSendSnack({
        phase: "error",
        message: msg,
        retry: () => {
          setSendSnack(null);
          setComposeTo(snapshot.to);
          setComposeCc(snapshot.cc);
          setComposeBcc(snapshot.bcc);
          setComposeSubject(snapshot.subject);
          setComposeBody(snapshot.htmlBody);
          setComposeFiles(snapshot.files);
          setComposeDraftId(snapshot.draftId);
          setComposeOpen(true);
          setComposeMinimized(false);
        },
      });
    }
  }

  // Shared back-to-list action used by thread detail
  const closeThread = () => {
    setSelectedId(null);
    setMessages(null);
    setThreadError(null);
    setReplyOpen(false);
    setReplyText("");
    setReplyFiles([]);
  };

  // Folder nav items — shared between left rail (desktop) and mobile tab bar.
  // Inbox badge uses CATEGORY_PERSONAL (Primary) unread — same as Gmail sidebar,
  // which excludes Promotions/Social/etc. from the unread dot.
  const FOLDER_NAV = [
    { key: "inbox"     as const, label: "Inbox",     Icon: IconInbox,  countId: "INBOX",     unreadOnly: true  },
    { key: "starred"   as const, label: "Starred",   Icon: IconStar,   countId: "STARRED",   unreadOnly: false },
    { key: "important" as const, label: "Important", Icon: Bookmark,   countId: "IMPORTANT", unreadOnly: false },
    { key: "sent"      as const, label: "Sent",      Icon: IconSend,   countId: "SENT",      unreadOnly: false },
    { key: "drafts"    as const, label: "Drafts",    Icon: FilePen,    countId: "DRAFT",     unreadOnly: false },
  ] as const;

  return (
    <>
    {/* ── Gmail-style three-column layout ────────────────────────────────────
        Left rail  : Compose + Inbox/Sent/Drafts + Labels  (desktop only)
        Right area : Category tabs (top) + search + thread list OR thread detail
    ──────────────────────────────────────────────────────────────────────── */}
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">

      {/* ══ LEFT RAIL — desktop only ══ */}
      <aside className="hidden w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        {/* Compose + Refresh */}
        <div className="flex items-center gap-2 px-3 py-4">
          <button
            type="button"
            onClick={() => { setComposeOpen(true); setComposeMinimized(false); }}
            className="btn-primary inline-flex h-[38px] flex-1 gap-2 px-4 text-[13px]"
          >
            <PencilLine className="h-4 w-4" strokeWidth={2} />
            {titleCase("Compose")}
          </button>
          <button
            type="button"
            onClick={() => {
              listCacheRef.current.clear();
              void loadThreads({ append: false, forceRefresh: true });
              scheduleCountRefresh();
            }}
            className="btn-ghost flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title={titleCase("Refresh")}
          >
            <IconRefresh className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* Folder nav: Inbox / Starred / Sent / Drafts */}
        <nav className="flex flex-col gap-0.5 px-1">
          {FOLDER_NAV.map(({ key, label, Icon, countId, unreadOnly }) => {
            const count = labelCounts[countId];
            // For unreadOnly items (Inbox → Primary unread), show unread count.
            // For others (Starred, Sent, Drafts) show total count.
            const badge = unreadOnly
              ? (count?.unread && count.unread > 0 ? count.unread : null)
              : (count?.total && count.total > 0 ? count.total : null);
            const active = folder === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setFolder(key);
                  setFilterLabelId(null);
                  setSelectedId(null);
                  setMessages(null);
                  setMailSearchInput("");
                  setMailSearch("");
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-r-full py-[7px] pl-4 pr-3 text-[14px] font-medium transition-colors",
                  active
                    ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]",
                )}
              >
                <Icon className={cn(
                  "h-[18px] w-[18px] shrink-0",
                  key === "starred" && active ? "fill-yellow-400 stroke-yellow-400" : "",
                  key === "starred" && !active ? "stroke-[var(--color-text-muted)]" : "",
                  key === "important" && active ? "fill-yellow-400 stroke-yellow-400" : "",
                  key === "important" && !active ? "stroke-[var(--color-text-muted)]" : "",
                )} />
                <span className="flex-1 truncate text-left">{titleCase(label)}</span>
                {badge !== null && (
                  <span className={cn(
                    "min-w-[20px] rounded-full px-1.5 py-[1px] text-center text-[11px] font-bold tabular-nums",
                    active ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
                  )}>
                    {badge > 9999 ? `${Math.floor(badge / 1000)}k` : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* User labels + create label */}
        <>
          <div className="mx-4 my-3 border-t border-[var(--color-border)]" />
          {/* Section header with "+ New label" button */}
          <div className="mb-1 flex items-center px-4 pr-2">
            <p className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              Labels
            </p>
            <button
              type="button"
              title="Create new label"
              onClick={() => {
                setShowNewLabelForm((v) => !v);
                setTimeout(() => newLabelInputRef.current?.focus(), 50);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Inline create-label form */}
          {showNewLabelForm && (
            <form
              onSubmit={(e) => { e.preventDefault(); void createLabelFromRail(); }}
              className="mx-2 mb-2 flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            >
              <input
                ref={newLabelInputRef}
                type="text"
                value={newLabelInput}
                onChange={(e) => setNewLabelInput(e.target.value)}
                placeholder="Label name…"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
                onKeyDown={(e) => { if (e.key === "Escape") { setShowNewLabelForm(false); setNewLabelInput(""); } }}
              />
              <button
                type="submit"
                disabled={!newLabelInput.trim() || newLabelCreating}
                className="shrink-0 text-[11px] font-semibold text-[var(--color-primary)] disabled:opacity-40"
              >
                {newLabelCreating ? "…" : "Create"}
              </button>
            </form>
          )}

          <div className="flex flex-col gap-0.5 px-1">
            {allLabels
              .filter((l) => l.type === "user")
              .slice(0, 15)
              .map((l) => {
                const unread = labelCounts[l.id]?.unread ?? 0;
                const active = filterLabelId === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setFilterLabelId(active ? null : l.id);
                      setFolder("inbox");
                      setSelectedId(null);
                      setMessages(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-r-full py-[6px] pl-4 pr-3 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                        : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]",
                    )}
                  >
                    {/* Colour dot from label if set */}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          (l as GmailLabel & { color?: { backgroundColor?: string } }).color?.backgroundColor
                          ?? "var(--color-primary)",
                      }}
                    />
                    <span className="flex-1 truncate text-left">{l.name}</span>
                    {unread > 0 && (
                      <span className="text-[11px] font-bold tabular-nums text-[var(--color-text-muted)]">
                        {unread > 999 ? "999+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            {allLabels.filter((l) => l.type === "user").length === 0 && !showNewLabelForm && (
              <p className="px-4 py-1 text-[12px] text-[var(--color-text-faint)]">No labels yet</p>
            )}
          </div>
        </>

      </aside>

      {/* ══ RIGHT CONTENT AREA ══ */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile folder tabs (replaces left rail on small screens) */}
        <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] md:hidden">
          <div className="flex flex-1 overflow-x-auto">
            {FOLDER_NAV.map(({ key, label, Icon, countId, unreadOnly }) => {
              const count = labelCounts[countId];
              const badge = unreadOnly
                ? (count?.unread && count.unread > 0 ? count.unread : null)
                : (count?.total && count.total > 0 ? count.total : null);
              const active = folder === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setFolder(key);
                    setFilterLabelId(null);
                    setSelectedId(null);
                    setMessages(null);
                    setMailSearchInput("");
                    setMailSearch("");
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-medium transition-colors",
                    active
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-transparent text-[var(--color-text-muted)]",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {titleCase(label)}
                  {badge !== null && (
                    <span className="ml-0.5 text-[10px] tabular-nums opacity-70">
                      {badge > 999 ? `${Math.floor(badge / 1000)}k` : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Mobile compose + refresh */}
          <div className="flex shrink-0 items-center gap-1 border-l border-[var(--color-border)] px-2">
            <button
              type="button"
              onClick={() => { setComposeOpen(true); setComposeMinimized(false); }}
              className="btn-ghost h-9 w-9 justify-center p-0"
              title={titleCase("Compose")}
            >
              <PencilLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
              listCacheRef.current.clear();
              void loadThreads({ append: false, forceRefresh: true });
              scheduleCountRefresh();
            }}
              className="btn-ghost h-9 w-9 justify-center p-0"
              title={titleCase("Refresh")}
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Category tabs (Primary / Promotions / Social…) — top of right area, only on Inbox ── */}
        {folder === "inbox" && !filterLabelId && !selectedId && (
          <div className="flex gap-0 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)]">
            {(
              [
                { key: "primary"    as const, label: "Primary"    },
                { key: "promotions" as const, label: "Promotions" },
                { key: "social"     as const, label: "Social"     },
                { key: "updates"    as const, label: "Updates"    },
                { key: "forums"     as const, label: "Forums"     },
              ]
            ).map((t) => {
              const active = category === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setCategory(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-5 py-3 text-[13px] font-medium transition-colors",
                    active
                      ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── THREAD LIST view ── */}
        {!selectedId && (
          <div className="relative flex flex-1 flex-col overflow-hidden">

            {/* Slim progress bar at top — visible only while loading more pages */}
            <div
              className={cn(
                "absolute inset-x-0 top-0 z-10 h-[2px] origin-left bg-[var(--color-primary)] transition-all duration-300",
                loadingMore ? "animate-progress-bar opacity-100" : "w-0 opacity-0"
              )}
              aria-hidden
            />

            {/* Search bar + advanced filter popover trigger */}
            <div ref={filterPanelRef} className="relative border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  type="search"
                  value={mailSearchInput}
                  onChange={(e) => setMailSearchInput(e.target.value)}
                  placeholder={titleCase("Search mail (same as Gmail)")}
                  className="input-field h-[34px] w-full border-0 bg-[var(--color-surface-offset)] pl-9 pr-9 text-[13px]"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setFilterOpen((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
                  aria-label="Show search options"
                  title="Show search options"
                >
                  <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>

              {/* Advanced filter popover — opens beneath the search input */}
              {filterOpen && (
                <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
                  <div className="grid gap-3 p-4">
                    {/* From / To use the same RecipientField as Compose so the
                        typeahead behaviour is identical — narrows the dropdown
                        as the user types instead of dumping the whole list. */}
                    <FilterRow label="From">
                      <RecipientField
                        placeholder="sender@example.com"
                        value={filterFrom}
                        onChange={setFilterFrom}
                        suggestions={composeRecipientSuggestions}
                      />
                    </FilterRow>
                    <FilterRow label="To">
                      <RecipientField
                        placeholder="recipient@example.com"
                        value={filterTo}
                        onChange={setFilterTo}
                        suggestions={composeRecipientSuggestions}
                      />
                    </FilterRow>
                    <FilterRow label="Subject">
                      <input
                        type="text"
                        value={filterSubject}
                        onChange={(e) => setFilterSubject(e.target.value)}
                        className="input-field h-9 w-full text-[13px]"
                      />
                    </FilterRow>
                    <FilterRow label="Has the words">
                      <input
                        type="text"
                        value={filterHasWords}
                        onChange={(e) => setFilterHasWords(e.target.value)}
                        className="input-field h-9 w-full text-[13px]"
                      />
                    </FilterRow>
                    <FilterRow label="Doesn't have">
                      <input
                        type="text"
                        value={filterDoesntHave}
                        onChange={(e) => setFilterDoesntHave(e.target.value)}
                        className="input-field h-9 w-full text-[13px]"
                        placeholder="word(s) to exclude"
                      />
                    </FilterRow>
                    <FilterRow label="Date within">
                      <select
                        value={filterDateWithin}
                        onChange={(e) => setFilterDateWithin(e.target.value as DateWithin)}
                        className="input-field h-9 w-full text-[13px]"
                      >
                        {DATE_WITHIN_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </FilterRow>
                    <label className="flex cursor-pointer items-center gap-2 pl-2 pt-1 text-[13px] text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={filterHasAttachment}
                        onChange={(e) => setFilterHasAttachment(e.target.checked)}
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                      Has attachment
                    </label>
                  </div>
                  <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
                    <button
                      type="button"
                      onClick={clearFilter}
                      className="btn-ghost h-9 text-[13px]"
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterOpen(false)}
                      className="btn-ghost h-9 text-[13px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyFilter}
                      className="btn-primary h-9 px-5 text-[13px]"
                    >
                      Search
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bulk-action / select-all toolbar */}
            {threads.length > 0 && (
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
                  aria-label="Select all"
                  title={allSelected ? "Deselect all" : "Select all"}
                />
                {selectedThreadIds.size > 0 ? (
                  <>
                    <span className="text-[var(--color-text-muted)]">{selectedThreadIds.size} selected</span>
                    <div className="ml-2 flex items-center gap-1.5">
                      {/* Bulk label picker */}
                      <LabelPicker
                        allLabels={allLabels.filter((l) => l.type === "user")}
                        selected={bulkLabelSelected}
                        onToggle={(id, checked) => void handleBulkLabelToggle(id, checked)}
                        onCreate={handleBulkLabelCreate}
                        busy={bulkLabelBusy}
                        align="left"
                      />
                      {/* Single envelope toggle — closed = mark read, open = mark unread (Gmail pattern) */}
                      {(() => {
                        const allRead = Array.from(selectedThreadIds).every(
                          (id) => !threads.find((t) => t.id === id)?.unread
                        );
                        return (
                          <RowAction
                            title={allRead ? "Mark as unread" : "Mark as read"}
                            onClick={() => void performBulkAction(allRead ? "markUnread" : "markRead")}
                          >
                            {allRead ? (
                              /* open envelope = mark unread */
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M22 12V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12" />
                                <polyline points="22,6 12,13 2,6" />
                                <circle cx="19" cy="19" r="3" fill="currentColor" stroke="none" />
                              </svg>
                            ) : (
                              /* closed envelope = mark read */
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                              </svg>
                            )}
                          </RowAction>
                        );
                      })()}
                    </div>
                  </>
                ) : (
                  <span className="text-[var(--color-text-faint)]">
                    {threads.length} message{threads.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            )}

            {/* Thread rows */}
            {loadingList ? (
              <ul>
                {[...Array(20)].map((_, i) => {
                  // Vary widths slightly per row so the skeleton looks like
                  // a real list (different sender name lengths + subject lengths)
                  // instead of a uniform stripe pattern.
                  const senderW = i % 3 === 0 ? "w-[120px]" : i % 3 === 1 ? "w-[95px]" : "w-[140px]";
                  const subjectW = i % 4 === 0 ? "w-[70%]" : i % 4 === 1 ? "w-[55%]" : i % 4 === 2 ? "w-[85%]" : "w-[40%]";
                  const dateW = i % 2 === 0 ? "w-[58px]" : "w-[72px]";
                  return (
                    <li key={i} className="flex h-[57px] items-center overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]">
                      {/* Checkbox slot — matches w-10 in real row */}
                      <span className="flex w-10 shrink-0 items-center justify-center">
                        <Skeleton className="skeleton-shimmer h-3.5 w-3.5 rounded" />
                      </span>
                      {/* Star slot stays empty by default in real rows (only shown on hover); leave blank */}
                      <span className="w-6 shrink-0" />
                      {/* Sender name — fixed 160px slot in real row, padding px-2 */}
                      <span className="w-[160px] shrink-0 px-2">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", senderW)} />
                      </span>
                      {/* Subject + snippet — fills remaining space, pr-3 in real row */}
                      <span className="flex min-w-0 flex-1 items-center pr-3">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", subjectW)} />
                      </span>
                      {/* Date slot — w-[155px] with pr-4 in real row */}
                      <span className="flex w-[155px] shrink-0 items-center justify-end pr-4">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", dateW)} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : listError ? (
              <div className="p-6 text-sm text-[var(--color-danger)]">{listError}</div>
            ) : threads.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-offset)]">
                  {folder === "drafts"
                    ? <FilePen className="h-7 w-7 text-[var(--color-text-faint)] stroke-[1.25]" />
                    : folder === "starred"
                      ? <IconStar className="h-7 w-7 text-[var(--color-text-faint)]" />
                      : folder === "important"
                        ? <Bookmark className="h-7 w-7 text-[var(--color-text-faint)]" />
                        : <IconInbox className="h-7 w-7 text-[var(--color-text-faint)]" />}
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {titleCase(
                    mailSearch ? "Nothing matches your search"
                    : folder === "drafts" ? "No drafts"
                    : folder === "starred" ? "No starred messages"
                    : folder === "important" ? "No important messages"
                    : `No threads in ${folder}`,
                  )}
                </p>
              </div>
            ) : (
              <ul ref={listScrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
                {threads.map((t) => {
                  const name = senderName(t.from);
                  const isSelected = selectedThreadIds.has(t.id);
                  const isUnread = Boolean(t.unread);
                  const isStarred = Boolean(t.starred);
                  const isBusy = rowBusy.has(t.id);
                  const chips = (t.labelIds ?? [])
                    .map((id) => labelsById.get(id))
                    .filter((l): l is GmailLabel => !!l && l.type === "user")
                    .slice(0, 3);
                  return (
                    <li
                      key={t.draftId ?? t.id}
                      className={cn(
                        "group relative flex h-[57px] items-center overflow-hidden border-b border-[var(--color-border)] text-[13px] transition-colors",
                        isSelected
                          ? "bg-[var(--color-primary-light)]"
                          : isUnread
                            ? "bg-[var(--color-surface)] font-semibold"
                            : "bg-[var(--color-surface-offset)] font-normal",
                        "hover:bg-[var(--color-primary-light)] hover:shadow-sm",
                      )}
                    >
                      {/* Checkbox — fixed 40px slot */}
                      <span className="flex w-10 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRowSelection(t.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-primary)]"
                          aria-label="Select"
                        />
                      </span>

                      {/* Important marker — always visible when IMPORTANT label is set */}
                      <span
                        className={cn(
                          "flex w-4 shrink-0 items-center justify-center text-[11px] leading-none",
                          t.important ? "text-yellow-500" : "text-transparent select-none pointer-events-none"
                        )}
                        aria-label={t.important ? "Important" : undefined}
                        title={t.important ? "Important" : undefined}
                      >
                        ►
                      </span>

                      {/* Star — always visible; filled/yellow when starred, faint outline when not */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void toggleThreadStar(t.id, !isStarred); }}
                        disabled={isBusy}
                        className={cn(
                          "flex w-6 shrink-0 items-center justify-center text-[15px] leading-none transition-colors",
                          isStarred
                            ? "text-yellow-500 hover:text-yellow-400"
                            : "text-[var(--color-text-faint)] hover:text-yellow-500"
                        )}
                        aria-label={isStarred ? "Unstar" : "Star"}
                        title={isStarred ? "Unstar" : "Star"}
                      >
                        {isStarred ? "★" : "☆"}
                      </button>

                      {/* Sender name — fixed 160px, truncated */}
                      <button
                        type="button"
                        onClick={() => t.draftId ? void openDraft(t.draftId) : void openThread(t.id)}
                        onMouseEnter={() => { if (t.draftId) { prefetchDraft(t.draftId); } else { prefetchThread(t.id); } }}
                        className={cn(
                          "w-[160px] shrink-0 truncate px-2 text-left text-[13px]",
                          isUnread ? "font-bold text-[var(--color-text)]" : "font-normal text-[var(--color-text)]"
                        )}
                      >
                        {name}
                      </button>

                      {/* Subject + snippet — fills remaining space, single line, truncated before date */}
                      <button
                        type="button"
                        onClick={() => t.draftId ? void openDraft(t.draftId) : void openThread(t.id)}
                        onMouseEnter={() => { if (t.draftId) { prefetchDraft(t.draftId); } else { prefetchThread(t.id); } }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left pr-3"
                      >
                        {chips.length > 0 && (
                          <span className="flex shrink-0 items-center gap-1">
                            {chips.map((l) => <LabelChip key={l.id} label={l} />)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span className={cn(isUnread ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]")}>
                            {t.subject || "(no subject)"}
                          </span>
                          {t.snippet ? (
                            <span className="font-normal text-[var(--color-text-faint)]"> — {t.snippet}</span>
                          ) : null}
                        </span>
                      </button>

                      {/* Right-side: attachment icon + date — fixed width, never shrinks */}
                      <span className="flex w-[155px] shrink-0 items-center justify-end gap-1.5 pr-4">
                        {t.hasAttachments && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--color-text-faint)]">
                            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
                          </svg>
                        )}
                        <time className={cn(
                          "shrink-0 whitespace-nowrap text-[12px] tabular-nums",
                          isUnread ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
                        )}>
                          {t.date ? formatDate(t.date) : ""}
                        </time>
                      </span>
                    </li>
                  );
                })}

                {/* Skeleton rows appended inside the scroll list while loading more.
                    Mirrors the real row layout (checkbox slot, fixed-160 sender,
                    fluid subject, fixed-155 date) so the swap-in is seamless. */}
                {loadingMore && [0,1,2,3].map((i) => {
                  const senderW = i % 3 === 0 ? "w-[120px]" : i % 3 === 1 ? "w-[95px]" : "w-[140px]";
                  const subjectW = i % 4 === 0 ? "w-[70%]" : i % 4 === 1 ? "w-[55%]" : i % 4 === 2 ? "w-[85%]" : "w-[40%]";
                  const dateW = i % 2 === 0 ? "w-[58px]" : "w-[72px]";
                  return (
                    <li key={`skel-${i}`} className="flex h-[57px] items-center overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]">
                      <span className="flex w-10 shrink-0 items-center justify-center">
                        <Skeleton className="skeleton-shimmer h-3.5 w-3.5 rounded" />
                      </span>
                      <span className="w-6 shrink-0" />
                      <span className="w-[160px] shrink-0 px-2">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", senderW)} />
                      </span>
                      <span className="flex min-w-0 flex-1 items-center pr-3">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", subjectW)} />
                      </span>
                      <span className="flex w-[155px] shrink-0 items-center justify-end pr-4">
                        <Skeleton className={cn("skeleton-shimmer h-3 rounded", dateW)} />
                      </span>
                    </li>
                  );
                })}

                {/* Sentinel: sits at bottom of scroll list; IntersectionObserver fires load-more */}
                {nextPageToken && (
                  <li ref={loadMoreSentinelRef} className="h-4 list-none" aria-hidden />
                )}
              </ul>
            )}
          </div>
        )}

        {/* ── THREAD DETAIL view ── */}
        {selectedId && (
          <div className="flex flex-1 flex-col overflow-hidden bg-[var(--color-bg)]">
            {loadingThread ? (
              <div className="flex h-full flex-col">
                {/* Header skeleton — mirrors the real subject row + sender meta */}
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 md:px-6 md:py-5">
                  <div className="mb-3 flex items-center gap-3">
                    {/* Back-button slot */}
                    <Skeleton className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
                    {/* Subject line (h2 text-lg/xl) */}
                    <Skeleton className="skeleton-shimmer h-5 w-2/3 rounded md:h-6" />
                    {/* Labels button slot */}
                    <Skeleton className="skeleton-shimmer ml-auto h-8 w-20 shrink-0 rounded-md" />
                  </div>
                  {/* Sender + email + date row (pl-12 in real header) */}
                  <div className="flex items-center gap-3 pl-12">
                    <Skeleton className="skeleton-shimmer h-3.5 w-28 rounded" />
                    <Skeleton className="skeleton-shimmer h-3 w-44 rounded" />
                    <Skeleton className="skeleton-shimmer ml-auto h-3 w-20 rounded" />
                  </div>
                  {/* "N messages in thread" caption */}
                  <div className="mt-2 pl-12">
                    <Skeleton className="skeleton-shimmer h-2.5 w-32 rounded" />
                  </div>
                </div>

                {/* Message-card skeletons (two — typical thread is 1-3 messages) */}
                <div className="flex-1 space-y-4 overflow-hidden p-4 md:p-6">
                  {[0, 1].map((idx) => (
                    <article
                      key={idx}
                      className="surface-card rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] md:p-6"
                    >
                      {/* Top row: avatar + from/to + date */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="skeleton-shimmer h-7 w-7 rounded-full" />
                          <div className="space-y-1.5">
                            <Skeleton className="skeleton-shimmer h-3 w-36 rounded" />
                            <Skeleton className="skeleton-shimmer h-2.5 w-24 rounded" />
                          </div>
                        </div>
                        <Skeleton className="skeleton-shimmer h-2.5 w-16 shrink-0 rounded" />
                      </div>
                      {/* Body lines — multiple at varying widths */}
                      <div className="mt-4 space-y-2">
                        <Skeleton className="skeleton-shimmer h-3 w-full rounded" />
                        <Skeleton className="skeleton-shimmer h-3 w-[92%] rounded" />
                        <Skeleton className="skeleton-shimmer h-3 w-[78%] rounded" />
                        {idx === 0 && (
                          <>
                            <Skeleton className="skeleton-shimmer h-3 w-[88%] rounded" />
                            <Skeleton className="skeleton-shimmer h-3 w-[40%] rounded" />
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : threadError ? (
              <div className="flex flex-1 flex-col gap-4 p-6">
                <button type="button" onClick={closeThread} className="btn-ghost inline-flex h-9 w-fit items-center gap-2 px-3 text-[13px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  {titleCase("Back")}
                </button>
                <p className="text-sm text-[var(--color-danger)]">{threadError}</p>
              </div>
            ) : messages && messages.length ? (
              <>
                {/* Thread header */}
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 md:px-6">
                  <div className="mb-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={closeThread}
                      className="btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      aria-label={titleCase("Back")}
                      title={titleCase("Back")}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <h2 className="min-w-0 flex-1 font-display text-lg font-bold text-[var(--color-text)] md:text-xl">
                      {messages[0]?.subject || "(no subject)"}
                    </h2>
                    <LabelPicker
                      allLabels={allLabels}
                      selected={new Set(threadLabelIds)}
                      onToggle={(id, checked) => void toggleThreadLabel(id, checked)}
                      onCreate={createAndApplyLabel}
                      busy={labelBusy}
                    />
                  </div>
                  {threadLabelIds.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1 pl-12">
                      {threadLabelIds
                        .map((id) => labelsById.get(id))
                        .filter((l): l is GmailLabel => !!l && l.type === "user")
                        .map((l) => (
                          <LabelChip
                            key={l.id}
                            label={l}
                            onRemove={labelBusy ? undefined : () => void toggleThreadLabel(l.id, false)}
                          />
                        ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-12 text-[13px]">
                    <span className="font-semibold text-[var(--color-text)]">{senderName(messages[0]?.from || "")}</span>
                    <span className="text-[var(--color-text-muted)]">&lt;{extractEmailAddress(messages[0]?.from || "")}&gt;</span>
                    <time className="ml-auto text-[var(--color-text-faint)]">{formatDate(messages[0]?.date || "")}</time>
                  </div>
                  <p className="mt-1 pl-12 text-[11px] text-[var(--color-text-muted)]">
                    {titleCase(`${messages.length} message${messages.length !== 1 ? "s" : ""} in thread`)}
                  </p>
                </div>

                {/* Messages */}
                <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
                  {messages.map((m) => (
                    <article key={m.id} className="surface-card rounded-[var(--radius-lg)] p-5 shadow-[var(--shadow-sm)] md:p-6">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[var(--nucleus-mist)] to-[var(--color-surface-offset)] text-[10px] font-bold text-[var(--color-text-muted)]">
                            {avatarInitial(senderName(m.from || ""))}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">{m.from}</p>
                            <p className="text-[10px] text-zinc-400">to {m.to || "—"}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {(() => {
                            const tr = trackingMap[m.id];
                            if (!tr) return null;
                            if (tr.opened) {
                              return (
                                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]" title={`Opened ${tr.open_count}x`}>
                                  <IconEye className="h-3 w-3" />
                                  Opened{tr.open_count > 1 ? ` ${tr.open_count}x` : ""} · {timeAgo(tr.opened_at)}
                                </span>
                              );
                            }
                            return (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                                <IconCheck className="h-3 w-3" />
                                {titleCase("Sent")}
                              </span>
                            );
                          })()}
                          <time className="text-[10px] text-zinc-400">{formatDate(m.date)}</time>
                        </div>
                      </div>
                      {/* Inline calendar-invite actions — only render when
                          the message is a Google Calendar invite AND we can
                          extract a usable event id from its body. Clicking
                          a button routes to /calendar with the event-id and
                          desired action so the existing Edit/Delete modals
                          (which already support an optional guest note)
                          open pre-loaded. Mirrors Gmail's inline RSVP UX. */}
                      {(() => {
                        if (!isCalendarInvite(m)) return null;
                        const eventId = extractCalendarEventId(m.bodyHtml);
                        if (!eventId) return null;
                        const go = (action: "edit" | "delete") => {
                          const qs = new URLSearchParams({ eventId, action });
                          router.push(`/calendar?${qs.toString()}`);
                        };
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2 text-[12px]">
                            <span className="font-medium text-[var(--color-text-muted)]">Calendar invite</span>
                            <span className="text-[var(--color-text-faint)]">·</span>
                            <button
                              type="button"
                              onClick={() => go("edit")}
                              className="rounded px-2 py-1 font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
                              title="Edit this meeting (opens Calendar)"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => go("delete")}
                              className="rounded px-2 py-1 font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]"
                              title="Delete this meeting (opens Calendar)"
                            >
                              Delete
                            </button>
                          </div>
                        );
                      })()}
                      <HtmlBody html={m.bodyHtml} plain={m.body} />
                      {m.attachments && m.attachments.length > 0 && (
                        <AttachmentChips attachments={m.attachments} messageId={m.id} />
                      )}
                    </article>
                  ))}
                </div>

                {/* Reply bar */}
                <div className="sticky bottom-0 z-10 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] md:px-6">
                  {!replyOpen ? (
                    <button
                      type="button"
                      onClick={() => setReplyOpen(true)}
                      className="btn-secondary h-[38px] w-full justify-center gap-2 border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
                    >
                      <IconReply className="h-4 w-4 text-[var(--color-primary)]" />
                      {titleCase("Reply")}
                    </button>
                  ) : (
                    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 shadow-[var(--shadow-sm)]">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">{titleCase("Reply")}</p>
                          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
                            <span className="text-[var(--color-text)]">{titleCase("To")}</span>{" "}
                            <span className="font-medium text-[var(--color-primary)]">
                              {extractEmailAddress(messages[messages.length - 1].from)}
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setReplyOpen(false); setReplyText(""); setReplyFiles([]); }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                          aria-label={titleCase("Discard reply")}
                        >
                          <IconX className="h-4 w-4" />
                        </button>
                      </div>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={5}
                        placeholder={titleCase("Write your reply…")}
                        className="input-field min-h-[100px] resize-y bg-[var(--color-surface)] py-3 leading-relaxed"
                        autoFocus
                      />
                      {replyFiles.length > 0 ? (
                        <ul className="mt-3 flex flex-wrap gap-2">
                          {replyFiles.map((f, i) => (
                            <li key={i} className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
                              <span className="max-w-[200px] truncate font-medium">{pendingFileName(f)}</span>
                              <button
                                type="button"
                                onClick={() => setReplyFiles((prev) => prev.filter((_, j) => j !== i))}
                                className="ml-1 rounded p-0.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)]"
                                aria-label={titleCase("Remove attachment")}
                              >
                                <IconX className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
                        <input ref={replyFileRef} type="file" multiple className="hidden" onChange={(e) => { void handleFileSelect(e.target.files, "reply"); e.target.value = ""; }} />
                        <button type="button" onClick={() => replyFileRef.current?.click()} className="btn-secondary h-9 gap-2 px-3 text-[13px]">
                          <Paperclip className="h-4 w-4" strokeWidth={2} />
                          {titleCase("Attach")}
                        </button>
                        <button
                          type="button"
                          disabled={!replyText.trim()}
                          onClick={() => void sendReply()}
                          className="btn-primary min-w-[120px] gap-2 px-5"
                        >
                          <Send className="h-4 w-4" strokeWidth={2} />{titleCase("Send")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col gap-4 p-6">
                <button type="button" onClick={closeThread} className="btn-ghost inline-flex h-9 w-fit items-center gap-2 px-3 text-[13px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  {titleCase("Back")}
                </button>
                <p className="text-sm text-zinc-500">{titleCase("No messages in thread.")}</p>
              </div>
            )}
          </div>
        )}
      </div>{/* end right content */}
    </div>

      {/* ── Send snackbar — Gmail-style bottom-left toast ──────────────── */}
      {sendSnack && typeof document !== "undefined" && createPortal(
        <div
          className={cn(
            "fixed bottom-6 left-6 z-[1100] flex items-center gap-3 rounded-lg px-4 py-3 text-[13px] font-medium shadow-xl transition-all",
            sendSnack.phase === "error"
              ? "bg-zinc-800 text-white"
              : "bg-zinc-800 text-white"
          )}
          role="status"
          aria-live="polite"
        >
          {sendSnack.phase === "sending" && (
            <>
              {/* Spinner */}
              <svg className="h-4 w-4 animate-spin shrink-0 text-white/70" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Sending…</span>
            </>
          )}
          {sendSnack.phase === "sent" && (
            <>
              <IconCheck className="h-4 w-4 shrink-0 text-green-400" />
              <span>Message sent</span>
              <button
                type="button"
                onClick={() => setSendSnack(null)}
                className="ml-1 rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {sendSnack.phase === "error" && (
            <>
              <svg className="h-4 w-4 shrink-0 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span className="max-w-[220px] truncate">{sendSnack.message}</span>
              <button
                type="button"
                onClick={sendSnack.retry}
                className="ml-1 rounded bg-white/15 px-2 py-0.5 text-[12px] font-semibold hover:bg-white/25"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => setSendSnack(null)}
                className="rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Gmail-style floating compose */}
      {composeOpen && typeof document !== "undefined"
        ? createPortal(
            <>
              {!composeMinimized ? (
                <button
                  type="button"
                  className="fixed inset-0 z-[998] bg-black/20 lg:hidden"
                  aria-label={titleCase("Close compose")}
                  onClick={closeComposeAndSaveDraft}
                />
              ) : null}

              {composeMinimized ? (
                <div
                  className="fixed bottom-0 left-0 right-0 z-[999] flex h-11 items-center gap-1 border border-[#dadce0] bg-[#323232] px-2 text-white shadow-[0_-4px_16px_rgba(60,64,67,0.25)] lg:bottom-6 lg:left-auto lg:right-6 lg:h-10 lg:w-[528px] lg:rounded-lg lg:shadow-lg"
                  role="dialog"
                  aria-label={titleCase("Compose minimized")}
                >
                  <button
                    type="button"
                    onClick={() => setComposeMinimized(false)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                    title={titleCase("Expand")}
                  >
                    <Maximize2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeMinimized(false)}
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-medium"
                  >
                    {composeSubject.trim() || titleCase("New Message")}
                  </button>
                  <button
                    type="button"
                    onClick={closeComposeAndSaveDraft}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                    aria-label={titleCase("Close")}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div
                  className={cn(
                    "fixed z-[999] flex flex-col overflow-hidden bg-white text-[#202124] [color-scheme:light]",
                    composeFullscreen
                      // Full-screen mode (Gmail's expanded compose) — covers
                      // most of the viewport with comfortable margins.
                      ? "left-[2.5%] right-[2.5%] top-[2.5%] bottom-[2.5%] rounded-lg border border-[#dadce0] shadow-[0_24px_48px_rgba(60,64,67,0.3)]"
                      // Default Gmail-style bottom-right docked compose.
                      : "bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl border-x border-t border-[#dadce0] shadow-[0_-8px_24px_rgba(60,64,67,0.18)] lg:bottom-6 lg:left-auto lg:right-6 lg:max-h-[min(620px,calc(100vh-96px))] lg:w-[528px] lg:rounded-t-lg lg:rounded-b-none lg:border lg:shadow-[0_8px_10px_1px_rgba(0,0,0,0.14),0_3px_14px_2px_rgba(0,0,0,0.12)]"
                  )}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="compose-dialog-title"
                >
                  {/* Title bar — Gmail-style dark chrome */}
                  <div className="flex shrink-0 items-center gap-1 bg-[#404040] px-2 py-1.5 text-white">
                    <h2 id="compose-dialog-title" className="min-w-0 flex-1 truncate pl-2 text-[13px] font-medium">
                      {composeDraftId ? titleCase("Edit Draft") : titleCase("New Message")}
                    </h2>
                    <button
                      type="button"
                      onClick={() => setComposeMinimized(true)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                      title={titleCase("Minimize")}
                    >
                      <Minus className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposeFullscreen((v) => !v)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                      title={composeFullscreen ? titleCase("Exit full screen") : titleCase("Full screen")}
                    >
                      {composeFullscreen ? (
                        <Minimize className="h-4 w-4" strokeWidth={2} />
                      ) : (
                        <Maximize className="h-4 w-4" strokeWidth={2} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={closeComposeAndSaveDraft}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                      aria-label={titleCase("Close")}
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
                    {/* To */}
                    <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
                      <span className="w-9 shrink-0 pt-2 text-right text-[13px] leading-none text-[#5f6368]">
                        {titleCase("To")}
                      </span>
                      <div
                        className={cn(
                          "min-w-0 flex-1",
                          "[&_[role=group]]:min-h-[36px] [&_[role=group]]:rounded-none [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:px-0 [&_[role=group]]:py-1 [&_[role=group]]:shadow-none [&_[role=group]]:focus-within:border-transparent [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-0",
                        )}
                      >
                        <RecipientField
                          placeholder={titleCase("Recipients")}
                          value={composeTo}
                          onChange={setComposeTo}
                          suggestions={composeRecipientSuggestions}
                        />
                      </div>
                    </div>

                    {/* Cc / Bcc toggle — Gmail blue links */}
                    {!composeCcBccOpen ? (
                      <div className="border-b border-[#f1f3f4] px-3 py-1.5 pl-[52px]">
                        <button
                          type="button"
                          onClick={() => setComposeCcBccOpen(true)}
                          className="text-[13px] font-medium text-[#1a73e8] hover:underline"
                        >
                          {titleCase("Cc")}
                        </button>
                        <span className="text-[#dadce0]"> </span>
                        <button
                          type="button"
                          onClick={() => setComposeCcBccOpen(true)}
                          className="text-[13px] font-medium text-[#1a73e8] hover:underline"
                        >
                          {titleCase("Bcc")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
                          <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Cc")}</span>
                          <div
                            className={cn(
                              "min-w-0 flex-1",
                              "[&_[role=group]]:min-h-[36px] [&_[role=group]]:rounded-none [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:px-0 [&_[role=group]]:py-1 [&_[role=group]]:shadow-none [&_[role=group]]:focus-within:border-transparent [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-0",
                            )}
                          >
                            <RecipientField
                              placeholder={titleCase("Cc")}
                              value={composeCc}
                              onChange={setComposeCc}
                              suggestions={composeRecipientSuggestions}
                            />
                          </div>
                        </div>
                        <div className="flex items-start gap-3 border-b border-[#f1f3f4] px-3 py-2">
                          <span className="w-9 shrink-0 pt-2 text-right text-[13px] text-[#5f6368]">{titleCase("Bcc")}</span>
                          <div
                            className={cn(
                              "min-w-0 flex-1",
                              "[&_[role=group]]:min-h-[36px] [&_[role=group]]:rounded-none [&_[role=group]]:border-0 [&_[role=group]]:bg-transparent [&_[role=group]]:px-0 [&_[role=group]]:py-1 [&_[role=group]]:shadow-none [&_[role=group]]:focus-within:border-transparent [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-0",
                            )}
                          >
                            <RecipientField
                              placeholder={titleCase("Bcc")}
                              value={composeBcc}
                              onChange={setComposeBcc}
                              suggestions={composeRecipientSuggestions}
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {contactsHint ? (
                      <p className="border-b border-[#f1f3f4] bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
                        {contactsHint}
                      </p>
                    ) : null}

                    {/* Subject */}
                    <div className="flex items-center gap-3 border-b border-[#f1f3f4] px-3 py-2">
                      <span className="w-9 shrink-0 text-right text-[13px] text-[#5f6368]">{titleCase("Subject")}</span>
                      <input
                        type="text"
                        placeholder=""
                        value={composeSubject}
                        onChange={(e) => setComposeSubject(e.target.value)}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-[#202124] outline-none placeholder:text-[#70757a]"
                      />
                    </div>

                    {/* Body — rich text editor with B/I/U/Strike/Lists/Link toolbar */}
                    <RichTextEditor
                      value={composeBody}
                      onChange={setComposeBody}
                      placeholder={titleCase("Compose email")}
                    />

                    {composeFiles.length > 0 ? (
                      <div className="border-t border-[#f1f3f4] px-3 py-2">
                        <ul className="flex flex-col gap-1.5">
                          {composeFiles.map((f, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between gap-2 rounded border border-[#dadce0] bg-[#f8f9fa] px-2 py-1.5 text-[12px]"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#5f6368]" strokeWidth={2} />
                                <span className="truncate font-medium">{pendingFileName(f)}</span>
                                <span className="shrink-0 text-[#5f6368]">({formatBytes(pendingFileSize(f))})</span>
                              </span>
                              <button
                                type="button"
                                onClick={() => setComposeFiles((prev) => prev.filter((_, j) => j !== i))}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                                aria-label={titleCase("Remove attachment")}
                              >
                                <IconX className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  {/* Footer toolbar */}
                  <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#f1f3f4] bg-white px-3 py-2">
                    <input
                      ref={composeFileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleFileSelect(e.target.files, "compose");
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => composeFileRef.current?.click()}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                      title={titleCase("Attach files")}
                    >
                      <Paperclip className="h-5 w-5" strokeWidth={2} />
                    </button>
                    <div className="flex flex-1 items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={discardComposeDraft}
                        className="rounded-full px-4 py-2 text-[13px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                      >
                        {titleCase("Discard")}
                      </button>
                      <button
                        type="button"
                        disabled={!composeTo.trim()}
                        onClick={() => void sendCompose()}
                        className="rounded-full bg-[#1a73e8] px-6 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#1557b0] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {titleCase("Send")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>,
            document.body,
          )
        : null}
    </>
  );
}

/** Tiny icon button used in the per-row hover quick-action cluster. */
function RowAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}
