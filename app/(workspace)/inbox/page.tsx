"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LabelChip } from "@/components/LabelChip";
import { LabelPicker } from "@/components/LabelPicker";
import { richTextIsEmpty } from "@/components/RichTextEditor";
import { CalendarInviteOrHtml } from "@/components/CalendarInviteCard";
import { ThreadActionsMenu } from "@/components/ThreadActionsMenu";
import { GmailAttachmentPreviews } from "@/components/GmailAttachmentPreviews";
import { GmailAvatar } from "@/components/GmailAvatar";
import { isCalendarInviteThread } from "@/lib/calendar-invite-email";
import { GmailComposeDialog } from "@/components/GmailComposeDialog";
import { GmailInlineReply, type InlineReplyMode } from "@/components/GmailInlineReply";
import { GmailPendingAttachments } from "@/components/GmailPendingAttachments";
import { appendDriveLinksToHtml } from "@/lib/gmail-drive-links";
import { uploadLargeFileToDrive } from "@/lib/upload-large-file-to-drive";
import {
  DRAFT_AUTOSAVE_DELAY_MS,
  type ComposeDraftSaveStatus,
} from "@/lib/gmail-draft-autosave";
import {
  DRAFT_JSON_INLINE_MAX_BYTES,
  GMAIL_ATTACHMENT_MAX_BYTES,
} from "@/lib/gmail-draft-limits";
import { uploadStagedDraftAttachment } from "@/lib/upload-staged-draft-attachment";
import {
  pendingFileFingerprint,
  pendingFilesFromDraftAttachments,
  type DraftApiAttachment,
  type PendingFile,
} from "@/lib/gmail-compose-types";
import {
  mergeInboxUnread,
  readSessionInboxUnread,
  writeSessionInboxUnread,
} from "@/lib/inbox-unread-session";
import { createPortal } from "react-dom";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { PencilLine, FilePen, SlidersHorizontal, Bookmark, Trash2, AlertOctagon, Mail } from "lucide-react";
import {
  IconInbox,
  IconSend,
  IconStar,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconSearch,
  IconCalendar,
} from "@/components/Icons";

type Folder = "inbox" | "sent" | "drafts" | "starred" | "important" | "trash" | "spam" | "allmail";
type BulkAction =
  | "archive"
  | "trash"
  | "deleteForever"
  | "markRead"
  | "markUnread"
  | "star"
  | "spam"
  | "notSpam"
  | "moveToInbox";
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
  hasCalendarInvite?: boolean;
  historyId?: string;
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

function senderName(from: string): string {
  if (!from) return "Unknown";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
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
  cc: string;
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

const STORAGE_SIDEBAR_W = "placecom-inbox-sidebar-w";
const STORAGE_LIST_W = "placecom-inbox-list-w";

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const n = parseInt(localStorage.getItem(key) ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Vertical drag handle between resizable mail panes. */
function PaneResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 z-20 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none bg-transparent hover:bg-[#0b57d0]/25 active:bg-[#0b57d0]/40"
    />
  );
}

function useResizablePane(storageKey: string, defaultWidth: number, min: number, max: number) {
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    setWidth(readStoredWidth(storageKey, defaultWidth, min, max));
  }, [storageKey, defaultWidth, min, max]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMove(ev: MouseEvent) {
        setWidth(Math.min(max, Math.max(min, startW + ev.clientX - startX)));
      }
      function onUp(ev: MouseEvent) {
        const finalW = Math.min(max, Math.max(min, startW + ev.clientX - startX));
        setWidth(finalW);
        localStorage.setItem(storageKey, String(finalW));
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, storageKey, min, max]
  );

  return { width, onResizeStart };
}

export default function InboxPage() {
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
        : folder === "trash" || folder === "spam" || folder === "allmail" || folder === "sent" || folder === "drafts"
          ? null
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

  type ComposeKind = "new" | "forward";
  const [composeKind, setComposeKind] = useState<ComposeKind>("new");
  const [composeThreadId, setComposeThreadId] = useState<string | null>(null);
  const [composeInReplyToId, setComposeInReplyToId] = useState<string | null>(null);

  const [inlineReplyMode, setInlineReplyMode] = useState<InlineReplyMode>(null);
  const [inlineReplyTo, setInlineReplyTo] = useState("");
  const [inlineReplyCc, setInlineReplyCc] = useState("");
  const [inlineReplyBody, setInlineReplyBody] = useState("");
  const [inlineReplyFiles, setInlineReplyFiles] = useState<PendingFile[]>([]);
  const [inlineReplySending, setInlineReplySending] = useState(false);
  const inlineReplyFileRef = useRef<HTMLInputElement>(null);
  const inlineReplyRef = useRef<HTMLDivElement>(null);
  // The current user's own Gmail address — used to exclude self from Reply All
  const [myEmail, setMyEmail] = useState("");

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
  /** File name → 0–100 while a large attachment uploads (Drive or staged). */
  const [driveUploadProgress, setDriveUploadProgress] = useState<Record<string, number>>({});
  const [uploadProgressKind, setUploadProgressKind] = useState<
    Record<string, "drive" | "attachment">
  >({});
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
  /** Set when a save was skipped because another was in-flight — flushed in finally. */
  const draftSavePendingRef = useRef(false);
  /** Wired after loadCounts — refresh draft badge right after autosave. */
  const onDraftCountChangeRef = useRef<(wasNew: boolean) => void>(() => {});
  const [draftSaveStatus, setDraftSaveStatus] = useState<ComposeDraftSaveStatus>("idle");
  const draftSaveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composeFileRef = useRef<HTMLInputElement>(null);
  // Scroll-position preservation: save the list's scrollTop before opening a
  // thread, then restore it the moment the list becomes visible again.
  const listScrollRef = useRef<HTMLUListElement>(null);
  const savedScrollTop = useRef<number>(0);
  // Prefetch cache: hover over a row starts the fetch so the click is instant.
  type ThreadCacheData = { messages: MsgView[]; labelIds: string[] };
  const threadDataCache = useRef<Map<string, Promise<ThreadCacheData>>>(new Map());
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

  // The highest historyId seen across all loaded threads. Used by the
  // History API poll to ask Gmail "did anything change since this point?"
  // so we only reload the list when there are actual new events — instead
  // of unconditionally refreshing every N seconds.
  const latestHistoryIdRef = useRef<string | null>(null);

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

  const clearDraftSaveStatusTimer = useCallback(() => {
    if (draftSaveStatusTimerRef.current) {
      clearTimeout(draftSaveStatusTimerRef.current);
      draftSaveStatusTimerRef.current = null;
    }
  }, []);

  const markDraftSaved = useCallback(() => {
    clearDraftSaveStatusTimer();
    setDraftSaveStatus("saved");
    draftSaveStatusTimerRef.current = setTimeout(() => {
      setDraftSaveStatus("idle");
      draftSaveStatusTimerRef.current = null;
    }, 2500);
  }, [clearDraftSaveStatusTimer]);

  const markDraftSaveError = useCallback(() => {
    clearDraftSaveStatusTimer();
    setDraftSaveStatus("error");
    draftSaveStatusTimerRef.current = setTimeout(() => {
      setDraftSaveStatus("idle");
      draftSaveStatusTimerRef.current = null;
    }, 5000);
  }, [clearDraftSaveStatusTimer]);

  const composeHasDraftableContent = useCallback(
    (s: typeof composeStateRef.current) =>
      !!(
        s.to.trim() ||
        s.cc.trim() ||
        s.bcc.trim() ||
        s.subject.trim() ||
        !richTextIsEmpty(s.body) ||
        s.files.length > 0
      ),
    []
  );

  /** After a draft save, Gmail rotates messageId/attachmentId — rehydrate from server. */
  const syncComposeFilesFromDraft = useCallback(async (draftId: string) => {
    const res = await fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { attachments?: DraftApiAttachment[] };
    const serverFiles = pendingFilesFromDraftAttachments(data.attachments ?? []);
    const driveFiles = composeStateRef.current.files.filter((f) => f.kind === "drive");
    const merged = [...serverFiles, ...driveFiles];
    composeStateRef.current.files = merged;
    setComposeFiles(merged);
    const s = composeStateRef.current;
    draftLastSavedRef.current = JSON.stringify({
      to: s.to,
      cc: s.cc,
      bcc: s.bcc,
      subject: s.subject,
      body: s.body,
      files: merged.map(pendingFileFingerprint),
    });
  }, []);

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
    if (!composeHasDraftableContent(s)) {
      setDraftSaveStatus("idle");
      return null;
    }

    // Fingerprint the files cheaply for the no-op guard. Real bytes are only
    // resolved (fetched/encoded) once we know we're actually going to POST.
    const fileFingerprints = s.files.map(pendingFileFingerprint);
    const snapshot = JSON.stringify({
      to: s.to, cc: s.cc, bcc: s.bcc, subject: s.subject, body: s.body,
      files: fileFingerprints,
    });
    if (snapshot === draftLastSavedRef.current) {
      setDraftSaveStatus("idle");
      return s.draftId;
    }
    if (draftSavingRef.current) {
      draftSavePendingRef.current = true;
      return s.draftId;
    }

    setDraftSaveStatus("saving");
    draftSavingRef.current = true;
    try {
      const lastSavedFiles = (() => {
        if (!draftLastSavedRef.current) return null;
        try {
          const p = JSON.parse(draftLastSavedRef.current) as { files?: string[] };
          return Array.isArray(p.files) ? p.files : null;
        } catch {
          return null;
        }
      })();
      const filesUnchanged =
        !!lastSavedFiles &&
        JSON.stringify(fileFingerprints) === JSON.stringify(lastSavedFiles);
      const hasNewInline = s.files.some((f) => f.kind === "new");
      const hasNewStaged = s.files.some((f) => f.kind === "staged");
      const hasNewAttachments = hasNewInline || hasNewStaged;
      const hasSavedOnDraft = s.files.some((f) => f.kind === "saved");

      const preserveAttachments =
        !!s.draftId && filesUnchanged && !hasNewAttachments && hasSavedOnDraft;
      const mergeExistingAttachments =
        !!s.draftId && hasNewAttachments && hasSavedOnDraft;

      let filesToEncode: PendingFile[] = [];
      if (mergeExistingAttachments) {
        filesToEncode = s.files.filter((f) => f.kind === "new");
      } else if (!preserveAttachments) {
        filesToEncode = s.files.filter((f) => f.kind !== "drive" && f.kind !== "staged");
      }

      const stagedUploadIds = preserveAttachments
        ? []
        : s.files.filter((f) => f.kind === "staged").map((f) => f.uploadId);

      let attachments: Array<{ filename: string; mimeType: string; base64Data: string }> = [];
      if (filesToEncode.length > 0) {
        try {
          attachments = await resolveAttachmentsForUpload(filesToEncode);
        } catch {
          markDraftSaveError();
          return null;
        }
      }

      const htmlBody = appendDriveLinksToHtml(s.body, s.files);

      const res = await fetch("/api/gmail/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: s.to.trim(),
          cc: s.cc.trim() || undefined,
          bcc: s.bcc.trim() || undefined,
          subject: s.subject.trim(),
          textBody: "",
          htmlBody,
          ...(s.draftId ? { draftId: s.draftId } : {}),
          ...(preserveAttachments ? { preserveAttachments: true } : {}),
          ...(mergeExistingAttachments ? { mergeExistingAttachments: true } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(stagedUploadIds.length > 0 ? { stagedUploadIds } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; draftId?: string; messageId?: string };
      if (!res.ok) {
        markDraftSaveError();
        if (data.error && typeof window !== "undefined") {
          console.warn("[draft save]", data.error);
        }
        return null;
      }
      draftLastSavedRef.current = snapshot;
      const draftId = data.draftId ?? s.draftId;
      if (data.draftId && data.draftId !== s.draftId) {
        composeStateRef.current.draftId = data.draftId;
        setComposeDraftId(data.draftId);
      }
      if (data.messageId) {
        const mid = data.messageId;
        const withMessageId = composeStateRef.current.files.map((f) =>
          f.kind === "saved" ? { ...f, messageId: mid } : f
        );
        composeStateRef.current.files = withMessageId;
        setComposeFiles(withMessageId);
      }
      markDraftSaved();
      const wasNewDraft = !s.draftId && !!data.draftId;
      onDraftCountChangeRef.current(wasNewDraft);
      if (
        draftId &&
        (s.files.some((f) => f.kind === "saved" || f.kind === "staged") && !preserveAttachments)
      ) {
        void syncComposeFilesFromDraft(draftId);
      } else if (draftId && preserveAttachments) {
        void syncComposeFilesFromDraft(draftId).catch(() => {});
      }
      return draftId ?? null;
    } catch {
      markDraftSaveError();
      return null;
    } finally {
      draftSavingRef.current = false;
      if (draftSavePendingRef.current) {
        draftSavePendingRef.current = false;
        queueMicrotask(() => {
          void saveDraft();
        });
      }
    }
  }, [syncComposeFilesFromDraft, composeHasDraftableContent, markDraftSaved, markDraftSaveError]);

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
      clearDraftSaveStatusTimer();
      setDraftSaveStatus("idle");
      return;
    }
    if (composeCc.trim() || composeBcc.trim()) {
      setComposeCcBccOpen(true);
    }
  }, [composeOpen, composeCc, composeBcc, clearDraftSaveStatusTimer]);

  // Debounced auto-save — status chip only shows while saving / saved / error.
  useEffect(() => {
    if (!composeOpen) return;
    const s = composeStateRef.current;
    if (!composeHasDraftableContent(s)) {
      setDraftSaveStatus("idle");
      return;
    }
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      void saveDraft();
    }, DRAFT_AUTOSAVE_DELAY_MS);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    composeOpen,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeBody,
    composeFiles,
    saveDraft,
    composeHasDraftableContent,
  ]);

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
    const results = await Promise.all(
      list.map(async (f) => {
        if (f.kind === "new") {
          return {
            filename: f.file.name,
            mimeType: f.file.type || "application/octet-stream",
            base64Data: f.base64,
          };
        }
        if (f.kind === "staged") return null;
        // Drive links are sent as body text, not embedded attachments.
        if (f.kind === "drive") return null;
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
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  }

  async function handleFileSelect(files: FileList | null, target: "compose" | "inline" = "compose") {
    if (!files) return;
    const newFiles: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size <= DRAFT_JSON_INLINE_MAX_BYTES) {
        const base64 = await fileToBase64(file);
        newFiles.push({ kind: "new", file, base64 });
      } else if (file.size <= GMAIL_ATTACHMENT_MAX_BYTES) {
        setUploadProgressKind((prev) => ({ ...prev, [file.name]: "attachment" }));
        setDriveUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));
        try {
          const staged = await uploadStagedDraftAttachment(file, (percent) => {
            setDriveUploadProgress((prev) => ({ ...prev, [file.name]: percent }));
          });
          newFiles.push({
            kind: "staged",
            uploadId: staged.uploadId,
            name: staged.name,
            mimeType: staged.mimeType,
            size: staged.size,
          });
        } catch (e) {
          alert(
            `Failed to upload ${file.name}: ${e instanceof Error ? e.message : "network error"}. Please try again.`
          );
        } finally {
          setDriveUploadProgress((prev) => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
          setUploadProgressKind((prev) => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
        }
      } else {
        // Exceeds Gmail's 25 MB limit — upload to Drive in 4 MB chunks via our API
        // (browser cannot PUT to googleapis.com directly due to CORS).
        setUploadProgressKind((prev) => ({ ...prev, [file.name]: "drive" }));
        setDriveUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));
        try {
          const driveFile = await uploadLargeFileToDrive(file, (percent) => {
            setDriveUploadProgress((prev) => ({ ...prev, [file.name]: percent }));
          });
          newFiles.push({
            kind: "drive",
            name: driveFile.name,
            mimeType: driveFile.mimeType,
            size: driveFile.size ? parseInt(driveFile.size, 10) : file.size,
            driveFileId: driveFile.id,
            webViewLink: driveFile.webViewLink,
          });
        } catch (e) {
          alert(
            `Failed to upload ${file.name} to Drive: ${e instanceof Error ? e.message : "network error"}. Please try again.`
          );
        } finally {
          setDriveUploadProgress((prev) => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
          setUploadProgressKind((prev) => {
            const next = { ...prev };
            delete next[file.name];
            return next;
          });
        }
      }
    }
    if (target === "inline") setInlineReplyFiles((prev) => [...prev, ...newFiles]);
    else setComposeFiles((prev) => [...prev, ...newFiles]);
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
      const apiFolder =
        folder === "starred" || folder === "important"
          ? "inbox"
          : folder === "trash"
            ? "trash"
            : folder === "spam"
              ? "spam"
              : folder === "allmail"
                ? "allmail"
                : folder;
      // Use 50 for search — after thread dedup we need extra headroom.
      const params = new URLSearchParams({ folder: apiFolder, maxResults: mailSearch ? "50" : "25" });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (mailSearch) params.set("search", mailSearch);
      // When a search query is active, drop the category/label filter so results
      // match all mail — exactly like Gmail's own search bar behaviour.
      if (effectiveLabelId && !mailSearch) params.set("labelId", effectiveLabelId);

      const cacheKey = `${apiFolder}|${effectiveLabelId ?? ""}|${mailSearch}`;

      // Track whether the list is already visible (cached) BEFORE the fetch
      // so we know whether to preserve scroll when fresh data arrives.
      let listWasVisible = false;

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
          listWasVisible = true; // list is on screen — preserve scroll on refresh
          // If we just made a local mutation, skip the background refetch.
          // Gmail's read-side lags our writes by a few seconds and would
          // clobber our optimistic state. After the cooldown, fresh wins.
          const sinceMutation = Date.now() - lastMutationAtRef.current;
          if (!opts.forceRefresh && sinceMutation < MUTATION_COOLDOWN_MS) {
            return;
          }
        } else {
          // No cache — spinner is showing; forceRefresh also counts as visible
          // if threads are already rendered (e.g. Sent refresh after compose).
          listWasVisible = opts.forceRefresh === true && (listScrollRef.current?.scrollTop ?? 0) > 0;
          setLoadingList(true);
        }
      }

      try {
        const res = await fetch(`/api/gmail/threads?${params.toString()}`, { cache: "no-store" });
        const data = (await res.json()) as { error?: string; threads?: ThreadRow[]; nextPageToken?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load inbox");
        const incoming = data.threads || [];

        // Track the highest historyId across loaded threads so the poll can
        // ask Gmail "did anything change since this point?" instead of blindly
        // reloading the full list every N seconds.
        const maxHid = incoming.reduce<string | null>((best, t) => {
          if (!t.historyId) return best;
          if (!best) return t.historyId;
          return BigInt(t.historyId) > BigInt(best) ? t.historyId : best;
        }, latestHistoryIdRef.current);
        if (maxHid) latestHistoryIdRef.current = maxHid;

        if (opts.append) {
          setThreads((prev) => {
            const merged = [...prev, ...incoming];
            // Keep the cache snapshot in sync with the merged list so coming
            // back to this view after infinite-scrolling still feels instant.
            listCacheRef.current.set(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
            return merged;
          });
        } else {
          // Background SWR / forceRefresh: the user already sees the list and
          // may have scrolled. Snapshot scrollTop BEFORE React re-renders with
          // fresh data, then restore it immediately after so the view doesn't jump.
          const scrollBefore = listWasVisible ? (listScrollRef.current?.scrollTop ?? 0) : 0;
          setThreads(incoming);
          listCacheRef.current.set(cacheKey, { threads: incoming, nextPageToken: data.nextPageToken });
          if (scrollBefore > 0) {
            requestAnimationFrame(() => {
              if (listScrollRef.current) {
                listScrollRef.current.scrollTop = scrollBefore;
              }
            });
          }
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

  // Fetch the signed-in user's Gmail address once on mount — used to exclude
  // self from Reply All recipients.
  useEffect(() => {
    fetch("/api/gmail/me")
      .then((r) => r.ok ? r.json() : null)
      .then((j: { email?: string } | null) => { if (j?.email) setMyEmail(j.email); })
      .catch(() => {/* non-fatal */});
  }, []);

  // Folder + label counts. Always fetched fresh (server returns no-store) and
  // re-fetched after every mutation that can change a count, so the badges
  // stay correct across navigations without any client-side cache logic.
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>({});

  /** Instant Inbox unread badge — persisted for the tab session so folder switches don't reset. */
  const adjustInboxUnread = useCallback((delta: number) => {
    if (delta === 0) return;
    setLabelCounts((prev) => {
      const cur = prev.INBOX?.unread ?? readSessionInboxUnread() ?? 0;
      const next = Math.max(0, cur + delta);
      writeSessionInboxUnread(next);
      return {
        ...prev,
        INBOX: { total: prev.INBOX?.total ?? 0, unread: next },
      };
    });
  }, []);

  const adjustDraftCount = useCallback((delta: number) => {
    if (delta === 0) return;
    setLabelCounts((prev) => ({
      ...prev,
      DRAFT: {
        total: Math.max(0, (prev.DRAFT?.total ?? 0) + delta),
        unread: prev.DRAFT?.unread ?? 0,
      },
    }));
  }, []);

  const { width: sidebarWidth, onResizeStart: onSidebarResizeStart } = useResizablePane(
    STORAGE_SIDEBAR_W,
    256,
    180,
    400
  );
  const { width: listPaneWidth, onResizeStart: onListPaneResizeStart } = useResizablePane(
    STORAGE_LIST_W,
    420,
    280,
    720
  );

  const loadCounts = useCallback(async () => {
    const ids = [
      "INBOX",
      "SENT",
      "DRAFT",
      "STARRED",
      "IMPORTANT",
      "TRASH",
      "SPAM",
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
      const incoming = j.counts ?? {};
      setLabelCounts((prev) => {
        if (!incoming.INBOX) return incoming;
        const serverUnread = incoming.INBOX.unread ?? 0;
        const sessionUnread = readSessionInboxUnread();
        const mergedUnread = mergeInboxUnread(serverUnread, sessionUnread);
        writeSessionInboxUnread(mergedUnread);
        if (
          Date.now() - lastMutationAtRef.current < MUTATION_COOLDOWN_MS &&
          prev.INBOX
        ) {
          const unread = Math.min(prev.INBOX.unread, mergedUnread);
          writeSessionInboxUnread(unread);
          return { ...incoming, INBOX: { ...incoming.INBOX, unread } };
        }
        return { ...incoming, INBOX: { ...incoming.INBOX, unread: mergedUnread } };
      });
    } catch { /* ignore */ }
  }, [allLabels]);

  useEffect(() => {
    onDraftCountChangeRef.current = (wasNew) => {
      if (wasNew) adjustDraftCount(1);
      void loadCounts();
    };
  }, [adjustDraftCount, loadCounts]);

  /**
   * Re-fetch counts shortly after a mutation. Gmail's label counts API lags
   * a few seconds behind a label change, so we retry once with a delay to
   * catch the propagated value. The first call serves as an immediate sync
   * (in case Gmail responds fast); the second covers the typical lag.
   */
  const scheduleCountRefresh = useCallback(() => {
    void loadCounts();
    const t1 = setTimeout(() => void loadCounts(), 800);
    const t2 = setTimeout(() => void loadCounts(), 2500);
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
        // Background SWR refresh — keep cached list visible (no full-page reload).
        if (folder === "drafts") void loadThreads({ append: false });
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
      adjustDraftCount(-1);
      void fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, {
        method: "DELETE",
      })
        .then(() => {
          if (folder === "drafts") void loadThreads({ append: false });
          scheduleCountRefresh();
        })
        .catch(() => {
          adjustDraftCount(1);
        });
    }
  }, [folder, scheduleCountRefresh, loadThreads, adjustDraftCount]);

  useEffect(() => { void loadCounts(); }, [loadCounts]);
  // Refresh counts after the list reloads (bulk actions, refresh).
  useEffect(() => { if (!loadingList) void loadCounts(); }, [loadingList, loadCounts]);

  // Stable refs to the latest poll callbacks — keeps the interval below
  // mounted once while always calling the current folder/search closures.
  const pollRef = useRef({ loadCounts, loadThreads });
  useEffect(() => {
    pollRef.current = { loadCounts, loadThreads };
  }, [loadCounts, loadThreads]);

  // History-based live refresh — mirrors how Gmail avoids full page reloads:
  //
  //   1. Every 30 s ask Gmail's History API "did anything change in INBOX
  //      since historyId X?" — this is a single lightweight call.
  //   2. Only if Gmail says YES: refresh the thread list (background SWR,
  //      preserves scroll) and counts.
  //   3. If the historyId has expired (>30 days), do a full refresh once to
  //      re-anchor.
  //
  // Net effect: the list NEVER reloads unless real mail events occurred.
  // The user sees no flash for new tabs/app switches, only for actual
  // new mail or label changes.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return;
      const since = latestHistoryIdRef.current;
      if (!since) {
        // No historyId yet — just refresh counts quietly.
        void pollRef.current.loadCounts();
        return;
      }
      try {
        const res = await fetch(
          `/api/gmail/history?since=${encodeURIComponent(since)}&labelId=INBOX`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          hasChanges?: boolean;
          expired?: boolean;
          latestHistoryId?: string;
        };
        // Update our anchor even when there are no changes, so the next tick
        // doesn't re-scan already-processed history.
        if (data.latestHistoryId) latestHistoryIdRef.current = data.latestHistoryId;
        if (data.hasChanges) {
          void pollRef.current.loadCounts();
          void pollRef.current.loadThreads({ append: false, forceRefresh: true });
        }
      } catch {
        // Network blip — skip tick silently.
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

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
    const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
    // Mobile hides the list while reading — skip load-more until back on list.
    if (!sentinel || !scroller || !nextPageToken || (selectedId && !isDesktop)) return;
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
      const loadedFiles = pendingFilesFromDraftAttachments(
        (data.attachments ?? []) as DraftApiAttachment[]
      );
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
      const fileFingerprints = loadedFiles.map(pendingFileFingerprint);
      draftLastSavedRef.current = JSON.stringify({
        to: data.to ?? "", cc: data.cc ?? "", bcc: data.bcc ?? "",
        subject: data.subject ?? "", body: loadedHtmlBody,
        files: fileFingerprints,
      });
      markDraftSaved();
      setComposeKind("new");
      setComposeThreadId(null);
      setComposeInReplyToId(null);
      setComposeOpen(true);
      setComposeMinimized(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not open draft");
    } finally {
      draftLoadingRef.current = false;
    }
  }, [markDraftSaved]);

  const fetchThreadData = useCallback((threadId: string): Promise<ThreadCacheData> => {
    const existing = threadDataCache.current.get(threadId);
    if (existing) return existing;
    const promise = fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`, {
      cache: "no-store",
    }).then(async (res) => {
      const data = (await res.json()) as {
        error?: string;
        messages?: MsgView[];
        labelIds?: string[];
      };
      if (!res.ok) throw new Error(data.error || "Failed to open thread");
      return {
        messages: data.messages || [],
        labelIds: (data.labelIds ?? []).filter((id) => id !== "UNREAD"),
      };
    });
    threadDataCache.current.set(threadId, promise);
    promise.catch(() => {
      threadDataCache.current.delete(threadId);
    });
    setTimeout(() => threadDataCache.current.delete(threadId), 120_000);
    return promise;
  }, []);

  const prefetchThread = useCallback(
    (threadId: string) => {
      void fetchThreadData(threadId);
    },
    [fetchThreadData]
  );

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
    if (wasUnread) {
      adjustInboxUnread(-1);
      lastMutationAtRef.current = Date.now();
    }
    fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: ["UNREAD"] }),
    })
      .then(() => { if (wasUnread) scheduleCountRefresh(); })
      .catch(() => {
        if (wasUnread) adjustInboxUnread(1);
      });

    setSelectedId(threadId);
    setThreadError(null);
    setThreadLabelIds([]);

    const cached = threadDataCache.current.get(threadId);
    if (cached) {
      setLoadingThread(false);
    } else {
      setMessages(null);
      setLoadingThread(true);
    }

    try {
      const data = await fetchThreadData(threadId);
      setMessages(data.messages);
      setThreadLabelIds(data.labelIds);
      void loadTracking();
    } catch (e) {
      setThreadError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingThread(false);
    }
  }, [loadTracking, threads, scheduleCountRefresh, mutateThreads, adjustInboxUnread, fetchThreadData]);

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

  // Toggle the IMPORTANT label on a thread (optimistic). Same shape as
  // toggleThreadStar — instant UI update, API call in background, rollback
  // on failure. Gmail uses a filled/outlined ► marker for this affordance.
  const toggleThreadImportant = useCallback(
    async (threadId: string, nextImportant: boolean) => {
      setRowBusy((s) => new Set(s).add(threadId));
      mutateThreads((rows) =>
        rows.map((r) => (r.id === threadId ? { ...r, important: nextImportant } : r))
      );
      const change = nextImportant ? 1 : -1;
      setLabelCounts((prev) => {
        const cur = prev["IMPORTANT"] ?? { total: 0, unread: 0 };
        return { ...prev, IMPORTANT: { ...cur, total: Math.max(0, cur.total + change) } };
      });
      try {
        const res = await fetch(
          `/api/gmail/threads/${encodeURIComponent(threadId)}/labels`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              nextImportant ? { add: ["IMPORTANT"] } : { remove: ["IMPORTANT"] }
            ),
          }
        );
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        scheduleCountRefresh();
      } catch (e) {
        mutateThreads((rows) =>
          rows.map((r) => (r.id === threadId ? { ...r, important: !nextImportant } : r))
        );
        setLabelCounts((prev) => {
          const cur = prev["IMPORTANT"] ?? { total: 0, unread: 0 };
          return { ...prev, IMPORTANT: { ...cur, total: Math.max(0, cur.total - change) } };
        });
        alert(e instanceof Error ? e.message : "Could not update importance");
      } finally {
        setRowBusy((s) => { const next = new Set(s); next.delete(threadId); return next; });
      }
    },
    [scheduleCountRefresh, mutateThreads]
  );

  // Row quick-actions: archive (remove INBOX), trash (add TRASH), and
  // mark-read/unread. Optimistic — removes the row from the list immediately
  // for archive/trash, rolls back on failure.
  /** Bulk-action for the toolbar above the list. Removes rows for archive
   *  and trash; updates unread/starred state for the other actions. */
  const applyThreadAction = useCallback(
    (action: BulkAction, ids: string[], opts?: { clearSelection?: boolean; closeDetail?: boolean }) => {
      if (ids.length === 0) return;

      const idSet = new Set(ids);
      const unreadInSelection = ids.filter((id) => threads.find((t) => t.id === id)?.unread).length;

      if (action === "markRead" && unreadInSelection > 0) {
        adjustInboxUnread(-unreadInSelection);
      } else if (action === "markUnread" && folder === "inbox") {
        adjustInboxUnread(ids.length);
      } else if (
        (action === "archive" || action === "trash" || action === "spam") &&
        unreadInSelection > 0
      ) {
        adjustInboxUnread(-unreadInSelection);
      }

      const removeFromList =
        action === "archive" ||
        action === "trash" ||
        action === "deleteForever" ||
        action === "spam" ||
        action === "notSpam" ||
        action === "moveToInbox";

      if (removeFromList) {
        mutateThreads((rows) => rows.filter((r) => !idSet.has(r.id)));
      } else if (action === "markRead" || action === "markUnread") {
        mutateThreads((rows) =>
          rows.map((r) =>
            idSet.has(r.id) ? { ...r, unread: action === "markUnread" } : r
          )
        );
      } else if (action === "star") {
        mutateThreads((rows) =>
          rows.map((r) => (idSet.has(r.id) ? { ...r, starred: true } : r))
        );
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

      if (opts?.clearSelection !== false) setSelectedThreadIds(new Set());
      if (opts?.closeDetail && selectedId && idSet.has(selectedId)) {
        setSelectedId(null);
        setMessages(null);
        setThreadError(null);
      }

      const rollback = () => {
        listCacheRef.current.clear();
        void loadThreads({ append: false, forceRefresh: true });
        scheduleCountRefresh();
      };

      if (action === "deleteForever") {
        fetch("/api/gmail/threads/batch-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadIds: ids }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(j.error || "Delete failed");
            }
            scheduleCountRefresh();
          })
          .catch(rollback);
        return;
      }

      const body =
        action === "archive"
          ? { add: [] as string[], remove: ["INBOX"] }
          : action === "trash"
            ? { add: ["TRASH"], remove: ["INBOX"] }
            : action === "spam"
              ? { add: ["SPAM"], remove: ["INBOX"] }
              : action === "notSpam" || action === "moveToInbox"
                ? { add: ["INBOX"], remove: ["TRASH", "SPAM"] }
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
            throw new Error(j.error || "Action failed");
          }
          scheduleCountRefresh();
        })
        .catch(rollback);
    },
    [threads, selectedId, folder, scheduleCountRefresh, mutateThreads, loadThreads, adjustInboxUnread]
  );

  const performBulkAction = useCallback(
    (action: BulkAction) => applyThreadAction(action, Array.from(selectedThreadIds)),
    [applyThreadAction, selectedThreadIds]
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

  function openNewCompose() {
    setComposeKind("new");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    setComposeFiles([]);
    setComposeDraftId(null);
    setComposeCcBccOpen(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  }

  function resetInlineReply() {
    setInlineReplyMode(null);
    setInlineReplyTo("");
    setInlineReplyCc("");
    setInlineReplyBody("");
    setInlineReplyFiles([]);
  }

  function startInlineReply(mode: "reply" | "replyAll") {
    if (!messages?.length) return;
    const last = messages[messages.length - 1];
    setInlineReplyMode(mode);
    setInlineReplyTo(extractEmailAddress(last.from));
    setInlineReplyCc(mode === "replyAll" ? buildReplyAllCc(last) : "");
    setInlineReplyBody("");
    setInlineReplyFiles([]);
    requestAnimationFrame(() => {
      inlineReplyRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function sendInlineReply() {
    if (!selectedId || !messages?.length || !inlineReplyMode || richTextIsEmpty(inlineReplyBody)) return;
    const last = messages[messages.length - 1];
    const to = inlineReplyTo.trim() || extractEmailAddress(last.from);
    const cc = inlineReplyCc.trim() || undefined;
    const snapshot = {
      mode: inlineReplyMode,
      htmlBody: inlineReplyBody,
      files: inlineReplyFiles,
      threadId: selectedId,
      lastId: last.id,
      to,
      cc,
    };

    resetInlineReply();
    setInlineReplySending(true);
    showSendSnack({ phase: "sending" });

    try {
      const attachments = await resolveAttachmentsForUpload(snapshot.files);
      const finalHtmlBody = appendDriveLinksToHtml(snapshot.htmlBody, snapshot.files);
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: snapshot.to,
          cc: snapshot.cc,
          subject: "",
          textBody: "",
          htmlBody: finalHtmlBody,
          threadId: snapshot.threadId,
          inReplyToMessageId: snapshot.lastId,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");

      threadDataCache.current.delete(snapshot.threadId);
      void openThread(snapshot.threadId);
      listCacheRef.current.delete("sent||");
      void loadTracking();
      showSendSnack({ phase: "sent" }, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      showSendSnack({
        phase: "error",
        message: msg,
        retry: () => {
          setSendSnack(null);
          setInlineReplyMode(snapshot.mode);
          setInlineReplyTo(snapshot.to);
          setInlineReplyCc(snapshot.cc ?? "");
          setInlineReplyBody(snapshot.htmlBody);
          setInlineReplyFiles(snapshot.files);
        },
      });
    } finally {
      setInlineReplySending(false);
    }
  }

  /**
   * Build the CC string for Reply All — all addresses in the thread except
   * the original sender (already in To) and the current user's own address.
   */
  function buildReplyAllCc(lastMsg: { from: string; to: string; cc: string }): string {
    const exclude = new Set<string>();
    // Exclude the sender (they go in To).
    exclude.add(extractEmailAddress(lastMsg.from).toLowerCase());
    // Exclude own address so we don't CC ourselves.
    if (myEmail) exclude.add(myEmail.toLowerCase());

    const candidates = [
      ...(lastMsg.to ? extractAllEmailsFromText(lastMsg.to) : []),
      ...(lastMsg.cc ? extractAllEmailsFromText(lastMsg.cc) : []),
    ];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const addr of candidates) {
      const lower = addr.toLowerCase();
      if (!exclude.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        result.push(addr);
      }
    }
    return result.join(", ");
  }

  /**
   * Open the compose window pre-filled for forwarding the current thread.
   * The subject is prefixed with "Fwd:" and the last message body is quoted.
   */
  function openForward() {
    if (!messages?.length) return;
    const last = messages[messages.length - 1];
    const fwdSubject = last.subject.startsWith("Fwd:")
      ? last.subject
      : `Fwd: ${last.subject}`;

    // Build a plain-text quoted block for the forward body.
    const dateStr = last.date ? new Date(last.date).toLocaleString() : "";
    const quotedHtml = `<br><br>---------- Forwarded message ----------<br>From: ${last.from}<br>Date: ${dateStr}<br>Subject: ${last.subject}<br>To: ${last.to}<br><br>${last.bodyHtml || last.body.replace(/\n/g, "<br>")}`;

    setComposeKind("forward");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject(fwdSubject);
    setComposeBody(quotedHtml);
    setComposeFiles([]);
    setComposeDraftId(null);
    setComposeCcBccOpen(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  }

  async function sendCompose() {
    if (!composeTo.trim()) {
      alert("Please add at least one recipient before sending.");
      return;
    }
    if (richTextIsEmpty(composeBody)) {
      alert("Please write a message before sending.");
      return;
    }

    const snapshot = {
      kind: composeKind,
      to: composeTo.trim(),
      cc: composeCc.trim(),
      bcc: composeBcc.trim(),
      subject: composeSubject.trim(),
      htmlBody: composeBody,
      files: composeFiles,
      draftId: composeDraftId,
      threadId: composeThreadId,
      inReplyToMessageId: composeInReplyToId,
    };

    setComposeOpen(false);
    setComposeDraftId(null);
    setComposeKind("new");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    setComposeFiles([]);
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

      const finalHtmlBody = appendDriveLinksToHtml(snapshot.htmlBody, snapshot.files);

      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: snapshot.to,
          cc: snapshot.cc || undefined,
          bcc: snapshot.bcc || undefined,
          subject: snapshot.subject,
          textBody: "",
          htmlBody: finalHtmlBody,
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
      // Only invalidate the Sent cache — a compose send has no effect on
      // Inbox or any other folder, so we must not clear or re-fetch those.
      listCacheRef.current.delete(sentKey);
      // If the user is currently viewing Sent, refresh it so the real row
      // replaces the optimistic one. Any other active folder is left alone.
      if (folder === "sent") {
        void loadThreads({ append: false, forceRefresh: true });
      }
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
          setComposeKind(snapshot.kind);
          setComposeThreadId(snapshot.threadId);
          setComposeInReplyToId(snapshot.inReplyToMessageId);
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
  const closeThread = useCallback(() => {
    setSelectedId(null);
    setMessages(null);
    setThreadError(null);
    resetInlineReply();
  }, [resetInlineReply]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeThread();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, closeThread]);

  const composeWindowTitle = useMemo(() => {
    if (composeKind === "forward") return titleCase("Forward");
    return composeDraftId ? titleCase("Edit Draft") : titleCase("New Message");
  }, [composeKind, composeDraftId]);

  // Folder nav items — shared between left rail (desktop) and mobile tab bar.
  // Inbox badge shows INBOX unread (the server computes it via an is:unread
  // thread search so it matches Gmail's own sidebar number).
  const FOLDER_NAV = [
    { key: "inbox"     as const, label: "Inbox",     Icon: IconInbox,  countId: "INBOX",     unreadOnly: true  },
    { key: "starred"   as const, label: "Starred",   Icon: IconStar,   countId: "STARRED",   unreadOnly: false },
    { key: "important" as const, label: "Important", Icon: Bookmark,   countId: "IMPORTANT", unreadOnly: false },
    { key: "sent"      as const, label: "Sent",      Icon: IconSend,   countId: "SENT",      unreadOnly: false },
    { key: "drafts"    as const, label: "Drafts",    Icon: FilePen,    countId: "DRAFT",     unreadOnly: false },
    { key: "allmail"   as const, label: "All Mail",  Icon: Mail,       countId: null,        unreadOnly: false },
    { key: "spam"      as const, label: "Spam",      Icon: AlertOctagon, countId: "SPAM",    unreadOnly: false },
    { key: "trash"     as const, label: "Trash",     Icon: Trash2,     countId: "TRASH",     unreadOnly: false },
  ] as const;

  return (
    <>
    {/* ── Gmail-style three-column layout ────────────────────────────────────
        Left rail  : Compose + Inbox/Sent/Drafts + Labels  (desktop only)
        Right area : Category tabs (top) + search + thread list OR thread detail
    ──────────────────────────────────────────────────────────────────────── */}
    <div
      data-gmail-mail
      className={cn(
        "flex min-h-0 overflow-hidden bg-[#f6f8fc] text-[#202124]",
        /* Cancel WorkspaceChrome padding so the pane is exactly viewport-tall (no page scroll). */
        "-mx-4 -mt-[calc(56px+16px)] -mb-6 h-[calc(100dvh-40px)]",
        "md:-mx-6 md:-mt-6 md:-mb-6 md:h-[calc(100dvh-48px)]"
      )}
    >

      {/* ══ LEFT RAIL — desktop only ══ */}
      <aside
        className="relative hidden shrink-0 flex-col overflow-y-auto border-r border-[#e8eaed] bg-[#f6f8fc] md:flex"
        style={{ width: sidebarWidth }}
      >
        {/* Compose + Refresh — Gmail pill compose button */}
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => openNewCompose()}
            className="inline-flex h-[56px] flex-1 items-center gap-3 rounded-2xl bg-[#c2e7ff] px-5 text-[14px] font-medium text-[#001d35] shadow-sm transition hover:shadow-md"
          >
            <PencilLine className="h-5 w-5" strokeWidth={2} />
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
            const count = countId ? labelCounts[countId] : undefined;
            const badge = countId
              ? unreadOnly
                ? (count?.unread && count.unread > 0 ? count.unread : null)
                : (count?.total && count.total > 0 ? count.total : null)
              : null;
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
                  "flex w-full items-center gap-3 rounded-r-full py-[6px] pl-3 pr-3 text-[14px] transition-colors",
                  active
                    ? "bg-[#d3e3fd] font-semibold text-[#001d35]"
                    : "font-medium text-[#444746] hover:bg-[#e8eaed]",
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
                    active ? "text-[#0b57d0]" : "text-[#5f6368]"
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
                        ? "bg-[#d3e3fd] font-semibold text-[#001d35]"
                        : "text-[#444746] hover:bg-[#e8eaed]",
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

        <PaneResizeHandle onMouseDown={onSidebarResizeStart} />
      </aside>

      {/* ══ RIGHT CONTENT AREA ══ */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* Mobile folder tabs (replaces left rail on small screens) */}
        <div className="flex shrink-0 border-b border-[#e8eaed] bg-white md:hidden">
          <div className="flex flex-1 overflow-x-auto">
            {FOLDER_NAV.map(({ key, label, Icon, countId, unreadOnly }) => {
              const count = countId ? labelCounts[countId] : undefined;
              const badge = countId
                ? unreadOnly
                  ? (count?.unread && count.unread > 0 ? count.unread : null)
                  : (count?.total && count.total > 0 ? count.total : null)
                : null;
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
                      ? "border-[#0b57d0] text-[#0b57d0]"
                      : "border-transparent text-[#5f6368]",
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
              onClick={() => openNewCompose()}
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
        {folder === "inbox" && !filterLabelId && (
          <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-[#e8eaed] bg-[#f6f8fc]">
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
                      ? "border-[#0b57d0] font-semibold text-[#0b57d0]"
                      : "border-transparent text-[#444746] hover:bg-[#e8eaed]"
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* ── THREAD LIST + optional reading pane (Gmail split view on desktop) ── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div
            className={cn(
                "relative flex min-h-0 flex-col overflow-hidden bg-white md:bg-[#f6f8fc]",
              selectedId
                ? "hidden w-full shrink-0 border-[#e8eaed] md:flex md:border-r"
                : "flex flex-1",
            )}
            style={selectedId ? { width: listPaneWidth } : undefined}
          >

            {/* Slim progress bar at top — visible only while loading more pages */}
            <div
              className={cn(
                "absolute inset-x-0 top-0 z-10 h-[2px] origin-left bg-[var(--color-primary)] transition-all duration-300",
                loadingMore ? "animate-progress-bar opacity-100" : "w-0 opacity-0"
              )}
              aria-hidden
            />

            {/* Search bar + advanced filter popover trigger — fixed; only the list scrolls */}
            <div ref={filterPanelRef} className="relative shrink-0 border-b border-[#e8eaed] bg-[#f6f8fc] px-3 py-2">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
                <input
                  type="search"
                  value={mailSearchInput}
                  onChange={(e) => setMailSearchInput(e.target.value)}
                  placeholder={titleCase("Search mail")}
                  className="h-[46px] w-full rounded-full border border-transparent bg-[#eaf1fb] pl-10 pr-10 text-[16px] text-[#202124] outline-none transition focus:border-[#0b57d0] focus:bg-white focus:shadow-[0_1px_3px_rgba(60,64,67,0.3)] md:text-[14px]"
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
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[#e8eaed] bg-[#f6f8fc] px-3 text-[12px]">
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
                    <div className="ml-2 flex items-center gap-0.5">
                      {folder !== "drafts" && (
                        <LabelPicker
                          allLabels={allLabels.filter((l) => l.type === "user")}
                          selected={bulkLabelSelected}
                          onToggle={(id, checked) => void handleBulkLabelToggle(id, checked)}
                          onCreate={handleBulkLabelCreate}
                          busy={bulkLabelBusy}
                          align="left"
                        />
                      )}
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
              <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
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
              <div className="min-h-0 flex-1 overflow-y-auto p-6 text-sm text-[var(--color-danger)]">{listError}</div>
            ) : threads.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-offset)]">
                  {folder === "drafts"
                    ? <FilePen className="h-7 w-7 text-[var(--color-text-faint)] stroke-[1.25]" />
                    : folder === "starred"
                      ? <IconStar className="h-7 w-7 text-[var(--color-text-faint)]" />
                      : folder === "important"
                        ? <Bookmark className="h-7 w-7 text-[var(--color-text-faint)]" />
                        : folder === "trash"
                          ? <Trash2 className="h-7 w-7 text-[var(--color-text-faint)]" strokeWidth={1.25} />
                          : folder === "spam"
                            ? <AlertOctagon className="h-7 w-7 text-[var(--color-text-faint)]" strokeWidth={1.25} />
                            : <IconInbox className="h-7 w-7 text-[var(--color-text-faint)]" />}
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {titleCase(
                    mailSearch ? "Nothing matches your search"
                    : folder === "drafts" ? "No drafts"
                    : folder === "starred" ? "No starred messages"
                    : folder === "important" ? "No important messages"
                    : folder === "trash" ? "Trash is empty"
                    : folder === "spam" ? "No spam here"
                    : folder === "allmail" ? "No mail"
                    : `No threads in ${folder}`,
                  )}
                </p>
              </div>
            ) : (
              <ul ref={listScrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                {threads.map((t) => {
                  const name = senderName(t.from);
                  const isSelected = selectedThreadIds.has(t.id);
                  const isActiveThread = selectedId === t.id;
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
                      onPointerDown={() => {
                        if (!t.draftId) prefetchThread(t.id);
                      }}
                      onClick={(e) => {
                        const t0 = e.target as HTMLElement;
                        if (t0.closest("button, input, label, a")) return;
                        if (t.draftId) void openDraft(t.draftId);
                        else void openThread(t.id);
                      }}
                      className={cn(
                        "group relative flex h-[40px] cursor-pointer items-center overflow-hidden border-b border-[#f1f3f4] text-[13px] transition-colors",
                        isActiveThread
                          ? "bg-[#c2e3ff] shadow-[inset_3px_0_0_0_#0b57d0]"
                          : isSelected
                            ? "bg-[#d3e3fd]"
                            : isUnread
                              ? "bg-white font-semibold"
                              : "bg-white font-normal",
                        !isActiveThread && "hover:bg-[#f2f6fc] hover:shadow-sm",
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

                      {/* Important marker — Gmail-style filled/outlined label bookmark.
                          Always visible (not hover-gated) so users can scan importance
                          at a glance exactly like in Gmail's own list view. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void toggleThreadImportant(t.id, !t.important); }}
                        disabled={isBusy}
                        className={cn(
                          "flex w-5 shrink-0 items-center justify-center transition-colors",
                          t.important
                            ? "text-yellow-400 hover:text-yellow-300"
                            : "text-[var(--color-text-faint)] hover:text-yellow-400"
                        )}
                        aria-label={t.important ? "Mark not important" : "Mark as important"}
                        title={t.important ? "Mark not important" : "Mark as important"}
                      >
                        {/* Gmail's importance marker is a right-pointing label/bookmark shape */}
                        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                          {t.important ? (
                            <path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                          ) : (
                            <path fill="none" stroke="currentColor" strokeWidth="2" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                          )}
                        </svg>
                      </button>

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

                      {/* Right-side: calendar / attachment icon + date */}
                      <span className="flex w-[155px] shrink-0 items-center justify-end gap-1.5 pr-4">
                        {(() => {
                          const isCal =
                            t.hasCalendarInvite ??
                            isCalendarInviteThread({
                              subject: t.subject,
                              from: t.from,
                              snippet: t.snippet,
                            });
                          return isCal ? (
                            <span title={titleCase("Calendar event")} className="inline-flex shrink-0">
                              <IconCalendar className="h-[15px] w-[15px] text-[#5f6368]" />
                            </span>
                          ) : null;
                        })()}
                        {t.hasAttachments &&
                          !(t.hasCalendarInvite ??
                            isCalendarInviteThread({
                              subject: t.subject,
                              from: t.from,
                              snippet: t.snippet,
                            })) && (
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="shrink-0 text-[var(--color-text-faint)]"
                            aria-label={titleCase("Has attachment")}
                          >
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
            {selectedId && <PaneResizeHandle onMouseDown={onListPaneResizeStart} />}
          </div>

        {/* ── THREAD DETAIL view ── */}
        {selectedId && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            {loadingThread ? (
              <div className="flex h-full flex-col">
                {/* Header skeleton — mirrors the real subject row + sender meta */}
                <div className="border-b border-[#e8eaed] bg-white px-2 py-2 md:px-4">
                  <div className="mb-3 flex items-center gap-1 border-b border-[#f1f3f4] pb-2">
                    <ThreadPaneNavButton variant="back" onClick={closeThread} className="md:hidden" />
                    <Skeleton className="skeleton-shimmer h-8 w-20 shrink-0 rounded-md" />
                    <ThreadPaneNavButton variant="close" onClick={closeThread} className="ml-auto hidden md:inline-flex" />
                  </div>
                  <div className="mb-3 flex items-center gap-3 px-2 md:px-0">
                    <Skeleton className="skeleton-shimmer h-5 w-2/3 rounded md:h-6" />
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
                      className="rounded-lg border border-[#e8eaed] bg-white p-5 md:p-6"
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
                {/* Thread header — Gmail action bar + subject */}
                <div className="border-b border-[#e8eaed] bg-white px-2 py-2 md:px-4">
                  <div className="mb-2 flex items-center gap-1 border-b border-[#f1f3f4] pb-2">
                    <ThreadPaneNavButton variant="back" onClick={closeThread} className="md:hidden" />
                    <LabelPicker
                      allLabels={allLabels}
                      selected={new Set(threadLabelIds)}
                      onToggle={(id, checked) => void toggleThreadLabel(id, checked)}
                      onCreate={createAndApplyLabel}
                      busy={labelBusy}
                      align="left"
                    />
                    <ThreadPaneNavButton
                      variant="close"
                      onClick={closeThread}
                      className="ml-auto hidden md:inline-flex"
                    />
                  </div>
                  <div className="flex items-start gap-1 px-2 md:px-0">
                    <h2 className="min-w-0 flex-1 text-xl font-normal leading-snug text-[#202124]">
                      {messages[0]?.subject || "(no subject)"}
                    </h2>
                    <ThreadActionsMenu
                      onReply={() => startInlineReply("reply")}
                      onReplyAll={() => startInlineReply("replyAll")}
                      onForward={() => openForward()}
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

                {/* Messages + reply actions (scroll together like Gmail) */}
                <div className="scrollbar-thin flex-1 overflow-y-auto">
                  {messages.map((m) => {
                    const fromEmail = extractEmailAddress(m.from || "");
                    const fromName = senderName(m.from || "");
                    return (
                    <article key={m.id} className="flex gap-4 border-b border-[#f1f3f4] px-4 py-5 md:px-8">
                      <GmailAvatar seed={fromEmail} name={fromName} size={40} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="truncate text-[14px] font-medium text-[#202124]">{fromName}</p>
                            <p className="truncate text-[12px] text-[#5f6368]">
                              {titleCase("to")} {m.to || "—"}
                              {m.cc ? <span className="ml-1">· {titleCase("cc")} {m.cc}</span> : null}
                            </p>
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
                          <time className="whitespace-nowrap text-[12px] text-[#5f6368]">{formatDate(m.date)}</time>
                        </div>
                      </div>
                      <CalendarInviteOrHtml
                        subject={m.subject}
                        bodyHtml={m.bodyHtml}
                        plain={m.body}
                      />
                      {(() => {
                        const files = (m.attachments ?? []).filter(
                          (a) =>
                            !/invite\.ics$/i.test(a.filename) &&
                            !/^text\/calendar/i.test(a.mimeType)
                        );
                        if (files.length === 0) return null;
                        return (
                          <div className="mt-3">
                            <GmailAttachmentPreviews attachments={files} messageId={m.id} />
                          </div>
                        );
                      })()}
                      </div>
                    </article>
                  );
                  })}

                  <div ref={inlineReplyRef}>
                  <GmailInlineReply
                    mode={inlineReplyMode}
                    replyLabel={senderName(messages[messages.length - 1]?.from || "")}
                    to={inlineReplyTo}
                    onToChange={setInlineReplyTo}
                    cc={inlineReplyCc}
                    onCcChange={setInlineReplyCc}
                    showCc={inlineReplyMode === "replyAll"}
                    body={inlineReplyBody}
                    onBodyChange={setInlineReplyBody}
                    suggestions={composeRecipientSuggestions}
                    onStartReply={() => startInlineReply("reply")}
                    onStartReplyAll={() => startInlineReply("replyAll")}
                    onForward={() => openForward()}
                    onDiscard={resetInlineReply}
                    onSend={() => void sendInlineReply()}
                    onAttach={() => inlineReplyFileRef.current?.click()}
                    sending={inlineReplySending}
                    files={inlineReplyFiles}
                    driveUploadProgress={driveUploadProgress}
                    uploadProgressKind={uploadProgressKind}
                    onRemoveFile={(i) => setInlineReplyFiles((prev) => prev.filter((_, j) => j !== i))}
                  />
                  </div>
                </div>
                <input
                  ref={inlineReplyFileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void handleFileSelect(e.target.files, "inline");
                    e.target.value = "";
                  }}
                />
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
        </div>{/* end list + reading pane split */}
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

      <GmailComposeDialog
        open={composeOpen}
        minimized={composeMinimized}
        fullscreen={composeFullscreen}
        windowTitle={composeWindowTitle}
        showSubject
        to={composeTo}
        onToChange={setComposeTo}
        cc={composeCc}
        onCcChange={setComposeCc}
        bcc={composeBcc}
        onBccChange={setComposeBcc}
        subject={composeSubject}
        onSubjectChange={setComposeSubject}
        body={composeBody}
        onBodyChange={setComposeBody}
        ccBccOpen={composeCcBccOpen}
        onCcBccOpenChange={setComposeCcBccOpen}
        suggestions={composeRecipientSuggestions}
        contactsHint={contactsHint}
        sendDisabled={!composeTo.trim()}
        onMinimize={() => setComposeMinimized((m) => !m)}
        onToggleFullscreen={() => setComposeFullscreen((v) => !v)}
        onClose={closeComposeAndSaveDraft}
        onSend={() => void sendCompose()}
        onDiscard={discardComposeDraft}
        fileInputRef={composeFileRef}
        onAttachClick={() => composeFileRef.current?.click()}
        onFileChange={(files) => void handleFileSelect(files)}
        draftSaveStatus={draftSaveStatus}
        attachmentChips={
          <GmailPendingAttachments
            files={composeFiles}
            driveUploadProgress={driveUploadProgress}
            uploadProgressKind={uploadProgressKind}
            onRemove={(i) => setComposeFiles((prev) => prev.filter((_, j) => j !== i))}
          />
        }
      />

    </>
  );
}

/** Back (mobile) or close (desktop) control for the reading pane. */
function ThreadPaneNavButton({
  variant,
  onClick,
  className,
}: {
  variant: "back" | "close";
  onClick: () => void;
  className?: string;
}) {
  const label = variant === "back" ? titleCase("Back to list") : titleCase("Close");
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 text-[#444746] hover:bg-[#e8eaed]",
        className
      )}
      aria-label={label}
      title={label}
    >
      {variant === "back" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      ) : (
        <IconX className="h-5 w-5" strokeWidth={2} />
      )}
    </button>
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
