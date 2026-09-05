import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Truncates to a fixed character count, appending "…" when cut. Unlike CSS
 * `truncate` (text-overflow: ellipsis, pixel-width based), this cuts at the same
 * character count regardless of how wide each character renders — so two
 * strings with the same maxLen always show the same amount of text, instead of
 * one cutting off much sooner than another just because its letters are wider.
 */
export function truncateChars(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}…`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Fixed en-US so weekday and month names read consistently in calendar UI. */
export function formatCalendarDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = iso.trim();
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-").map(Number);
      return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(y, m - 1, d)));
    }
    const d = new Date(s);
    const hasTime = s.includes("T");
    if (hasTime) {
      return new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(d);
    }
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

/**
 * A short bare salutation — "Dear Team,", "Hi Nishu," "Hello," — carries no
 * content on its own. Gmail's own thread-list snippet skips straight past
 * these to the actual first sentence; a collapsed message row that instead
 * shows just the greeting (see previewLineFromBody) reads as a mismatch
 * against that snippet even though both are honestly describing the same
 * message, just from different starting points.
 */
const GREETING_ONLY_RE = /^(dear|hi|hello|hey|good\s+(morning|afternoon|evening))\b[\s,][^,]{0,25},?$/i;

/**
 * First line of a message body worth showing as a preview — skips a lone
 * greeting line so a collapsed message in an open thread doesn't show "Dear
 * Team," where the list view's Gmail-provided snippet shows the real first
 * sentence. Falls back to the raw first line if nothing past the greeting
 * exists (e.g. a one-line "Thanks!" reply).
 */
export function previewLineFromBody(body: string | null | undefined): string {
  const lines = (body ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const firstSubstantive = lines.find((l) => !GREETING_ONLY_RE.test(l));
  return firstSubstantive ?? lines[0] ?? "";
}

/** Gmail snippets sometimes include HTML markup from marketing mail — strip for list UI. */
export function cleanMailSnippet(snippet: string): string {
  return snippet
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(iso);
  } catch {
    return "";
  }
}
