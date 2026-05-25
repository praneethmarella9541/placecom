"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LabelChip } from "@/components/LabelChip";
import { LabelPicker } from "@/components/LabelPicker";
import { createPortal } from "react-dom";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { PencilLine, Send, Paperclip, Maximize2, Minus, FilePen } from "lucide-react";
import {
  IconInbox,
  IconSend,
  IconStar,
  IconReply,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconPaperclip,
  IconDownload,
  IconSearch,
} from "@/components/Icons";

type Folder = "inbox" | "sent" | "drafts" | "starred";
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

type PendingFile = {
  file: File;
  base64: string;
};

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

function AttachmentChips({ attachments, messageId }: { attachments: AttachmentView[]; messageId: string }) {
  if (!attachments.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {attachments.map((a, i) => (
        <a
          key={i}
          href={`/api/gmail/attachment?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`}
          download={a.filename}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-primary-light)]"
        >
          <IconPaperclip className="h-3 w-3 text-zinc-400" />
          <span className="max-w-[150px] truncate">{a.filename}</span>
          <span className="text-zinc-400">({formatBytes(a.size)})</span>
          <IconDownload className="h-3 w-3 text-zinc-400" />
        </a>
      ))}
    </div>
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
    doc.write(`<!DOCTYPE html><html><head><style>
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
    </style></head><body>${html}</body></html>`);
    doc.close();

    const resize = () => {
      if (doc.body) {
        setHeight(Math.max(60, doc.body.scrollHeight + 4));
      }
    };

    const observer = new MutationObserver(resize);
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
    iframe.addEventListener("load", resize);
    setTimeout(resize, 100);
    setTimeout(resize, 500);

    return () => {
      observer.disconnect();
      iframe.removeEventListener("load", resize);
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
      sandbox="allow-same-origin"
      className="mt-3 w-full border-0"
      style={{ height: `${height}px`, minHeight: 60 }}
      title={titleCase("Email body")}
    />
  );
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
  // explicitly filtered to. Starred section always forces labelId=STARRED.
  const effectiveLabelId =
    folder === "starred"
      ? "STARRED"
      : filterLabelId ?? (folder === "inbox" ? CATEGORY_LABEL[category] : null);

  // Multi-select state (Gmail-style row checkboxes).
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const allSelected =
    threads.length > 0 && threads.every((t) => selectedThreadIds.has(t.id));
  // Per-row action busy state (for the optimistic star toggle / row-quick-actions).
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
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
  const [sendBusy, setSendBusy] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFiles, setComposeFiles] = useState<PendingFile[]>([]);
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  // In-flight guard for openDraft. A ref (vs state) keeps the useCallback
  // identity stable so click handlers don't rebind on every flip.
  const draftLoadingRef = useRef(false);
  const [replyFiles, setReplyFiles] = useState<PendingFile[]>([]);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);
  // Scroll-position preservation: save the list's scrollTop before opening a
  // thread, then restore it the moment the list becomes visible again.
  const listScrollRef = useRef<HTMLUListElement>(null);
  const savedScrollTop = useRef<number>(0);
  // Prefetch cache: hover over a row starts the fetch so the click is instant.
  const prefetchCache = useRef<Map<string, Promise<Response>>>(new Map());

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

  useEffect(() => {
    if (!composeOpen) {
      setComposeCcBccOpen(false);
      setComposeMinimized(false);
      setComposeDraftId(null);
      return;
    }
    if (composeCc.trim() || composeBcc.trim()) {
      setComposeCcBccOpen(true);
    }
  }, [composeOpen, composeCc, composeBcc]);

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

  async function handleFileSelect(files: FileList | null, target: "compose" | "reply") {
    if (!files) return;
    const newFiles: PendingFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) { alert(`${file.name} is too large (max 25 MB)`); continue; }
      const base64 = await fileToBase64(file);
      newFiles.push({ file, base64 });
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

  const loadThreads = useCallback(
    async (opts: { append: boolean; pageToken?: string }) => {
      if (!opts.append) { setLoadingList(true); setListError(null); }
      else { setLoadingMore(true); loadingMoreRef.current = true; }
      // "starred" is a virtual folder — pass inbox to the API + labelId=STARRED
      const apiFolder = folder === "starred" ? "inbox" : folder;
      const params = new URLSearchParams({ folder: apiFolder, maxResults: "25" });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (mailSearch) params.set("search", mailSearch);
      if (effectiveLabelId) params.set("labelId", effectiveLabelId);
      try {
        const res = await fetch(`/api/gmail/threads?${params.toString()}`);
        const data = (await res.json()) as { error?: string; threads?: ThreadRow[]; nextPageToken?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load inbox");
        const incoming = data.threads || [];
        setThreads((prev) => (opts.append ? [...prev, ...incoming] : incoming));
        setNextPageToken(data.nextPageToken);
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Failed to load");
        if (!opts.append) setThreads([]);
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

  // Folder + label counts. Refreshed alongside the thread list so a bulk
  // archive/delete updates the badges. Browser caches the response 30 s
  // so the request is cheap.
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>({});
  const loadCounts = useCallback(async () => {
    if (allLabels.length === 0) return;
    const ids = [
      "INBOX",
      "SENT",
      "DRAFT",
      "STARRED",
      "CATEGORY_PERSONAL",
      "CATEGORY_PROMOTIONS",
      "CATEGORY_SOCIAL",
      "CATEGORY_UPDATES",
      "CATEGORY_FORUMS",
      ...allLabels.filter((l) => l.type === "user").map((l) => l.id),
    ];
    try {
      const res = await fetch(`/api/gmail/folder-counts?ids=${encodeURIComponent(ids.join(","))}`);
      if (!res.ok) return;
      const j = (await res.json()) as { counts?: Record<string, { total: number; unread: number }> };
      setLabelCounts(j.counts ?? {});
    } catch { /* ignore */ }
  }, [allLabels]);

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

  useEffect(() => {
    if (!composeOpen) return;
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
        }
      });
    return () => {
      cancelled = true;
    };
  }, [composeOpen]);

  const openDraft = useCallback(async (draftId: string) => {
    if (draftLoadingRef.current) return;
    draftLoadingRef.current = true;
    // Drafts open in the compose panel — clear any open thread view
    setSelectedId(null);
    setMessages(null);
    setThreadError(null);
    try {
      const res = await fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`);
      const data = (await res.json()) as {
        error?: string;
        to?: string;
        cc?: string;
        bcc?: string;
        subject?: string;
        textBody?: string;
      };
      if (!res.ok) throw new Error(data.error || "Failed to open draft");
      setComposeDraftId(draftId);
      setComposeTo(data.to ?? "");
      setComposeCc(data.cc ?? "");
      setComposeBcc(data.bcc ?? "");
      setComposeSubject(data.subject ?? "");
      setComposeBody(data.textBody ?? "");
      setComposeFiles([]);
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
    const promise = fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`);
    prefetchCache.current.set(threadId, promise);
    // Auto-evict after 60 s so stale data doesn't accumulate.
    setTimeout(() => prefetchCache.current.delete(threadId), 60_000);
  }, []);

  const openThread = useCallback(async (threadId: string) => {
    // Save scroll position BEFORE switching to detail view so we can restore it on back.
    savedScrollTop.current = listScrollRef.current?.scrollTop ?? 0;

    // Optimistically mark the row as read the instant the user clicks.
    setThreads((rows) =>
      rows.map((r) => (r.id === threadId && r.unread ? { ...r, unread: false } : r))
    );
    // Fire-and-forget the read API call in parallel.
    fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remove: ["UNREAD"] }),
    }).catch(() => {/* non-critical */});

    setSelectedId(threadId);
    setMessages(null); setThreadError(null); setReplyText(""); setReplyOpen(false);
    setThreadLabelIds([]);
    setLoadingThread(true);
    try {
      // Reuse prefetch response if hover already started the fetch; otherwise start fresh.
      const inflight = prefetchCache.current.get(threadId);
      prefetchCache.current.delete(threadId); // consume — each Response body can only be read once
      const res = inflight ? await inflight : await fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`);
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
  }, [loadTracking]);

  // Add or remove a label on the currently-open thread. Optimistic — flips
  // local chips immediately and rolls back if the server rejects.
  const toggleThreadLabel = useCallback(
    async (labelId: string, nextChecked: boolean) => {
      if (!selectedId) return;
      const prev = threadLabelIds;
      setThreadLabelIds((cur) =>
        nextChecked ? Array.from(new Set([...cur, labelId])) : cur.filter((id) => id !== labelId)
      );
      // Mirror on the row in the list too
      setThreads((rows) =>
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
    [selectedId, threadLabelIds]
  );

  // Create a new Gmail label and immediately apply it to the open thread.
  // Toggle the STARRED label on a thread (optimistic). Used by the row star
  // icon — separate from the labels picker because Gmail treats star as a
  // first-class affordance, not a chip.
  const toggleThreadStar = useCallback(
    async (threadId: string, nextStarred: boolean) => {
      setRowBusy((s) => new Set(s).add(threadId));
      const prevRows = threads;
      setThreads((rows) =>
        rows.map((r) => (r.id === threadId ? { ...r, starred: nextStarred } : r))
      );
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
      } catch (e) {
        setThreads(prevRows);
        alert(e instanceof Error ? e.message : "Could not update star");
      } finally {
        setRowBusy((s) => {
          const next = new Set(s);
          next.delete(threadId);
          return next;
        });
      }
    },
    [threads]
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

      // 1. Optimistic UI update — instant, no waiting.
      const prevRows = threads;
      const removeFromList = action === "archive" || action === "trash";
      if (removeFromList) {
        setThreads((rows) => rows.filter((r) => !selectedThreadIds.has(r.id)));
      } else if (action === "markRead" || action === "markUnread") {
        setThreads((rows) =>
          rows.map((r) =>
            selectedThreadIds.has(r.id) ? { ...r, unread: action === "markUnread" } : r
          )
        );
      } else if (action === "star") {
        setThreads((rows) =>
          rows.map((r) => (selectedThreadIds.has(r.id) ? { ...r, starred: true } : r))
        );
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
        })
        .catch(() => {
          // Roll back silently — re-alert would be jarring since the user has moved on.
          setThreads(prevRows);
        });
    },
    [selectedThreadIds, threads]
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
        setAllLabels((prev) => [...prev, j.label!]);
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
      setAllLabels((prev) => [...prev, j.label!]);
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
    setSendBusy(true); setThreadError(null);
    try {
      const attachments = replyFiles.map((f) => ({
        filename: f.file.name,
        mimeType: f.file.type || "application/octet-stream",
        base64Data: f.base64,
      }));
      const res = await fetch("/api/gmail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: "", textBody: replyText.trim(), threadId: selectedId, inReplyToMessageId: last.id, attachments: attachments.length ? attachments : undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");
      setReplyText(""); setReplyOpen(false); setReplyFiles([]);
      await openThread(selectedId);
      void loadThreads({ append: false });
      void loadTracking();
    } catch (e) { setThreadError(e instanceof Error ? e.message : "Send failed"); }
    finally { setSendBusy(false); }
  }

  async function sendCompose() {
    if (!composeTo.trim() || !composeBody.trim()) return;
    setSendBusy(true);
    try {
      const attachments = composeFiles.map((f) => ({
        filename: f.file.name,
        mimeType: f.file.type || "application/octet-stream",
        base64Data: f.base64,
      }));
      const res = await fetch("/api/gmail/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo.trim(),
          cc: composeCc.trim(),
          bcc: composeBcc.trim(),
          subject: composeSubject.trim(),
          textBody: composeBody.trim(),
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");
      // If this compose was an in-progress draft, drop it from Drafts.
      if (composeDraftId) {
        void fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(composeDraftId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }
      setComposeOpen(false);
      setComposeDraftId(null);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      setComposeFiles([]);
      void loadThreads({ append: false });
      void loadTracking();
    } catch (e) { alert(e instanceof Error ? e.message : "Send failed"); }
    finally { setSendBusy(false); }
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
    { key: "inbox"   as const, label: "Inbox",   Icon: IconInbox,   countId: "CATEGORY_PERSONAL", unreadOnly: true  },
    { key: "starred" as const, label: "Starred",  Icon: IconStar,    countId: "STARRED",           unreadOnly: false },
    { key: "sent"    as const, label: "Sent",     Icon: IconSend,    countId: "SENT",              unreadOnly: false },
    { key: "drafts"  as const, label: "Drafts",   Icon: FilePen,     countId: "DRAFT",             unreadOnly: false },
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
            onClick={() => void loadThreads({ append: false })}
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
              onClick={() => void loadThreads({ append: false })}
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
                { key: "primary"    as const, label: "Primary",    countId: "CATEGORY_PERSONAL"   },
                { key: "promotions" as const, label: "Promotions", countId: "CATEGORY_PROMOTIONS" },
                { key: "social"     as const, label: "Social",     countId: "CATEGORY_SOCIAL"     },
                { key: "updates"    as const, label: "Updates",    countId: "CATEGORY_UPDATES"    },
                { key: "forums"     as const, label: "Forums",     countId: "CATEGORY_FORUMS"     },
              ]
            ).map((t) => {
              const unread = labelCounts[t.countId]?.unread ?? 0;
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
                  {unread > 0 && (
                    <span className={cn(
                      "rounded-full px-1.5 py-[1px] text-[10px] font-bold tabular-nums",
                      active
                        ? "bg-[var(--color-primary)] text-white"
                        : "bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]"
                    )}>
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
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

            {/* Search bar */}
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
                <input
                  type="search"
                  value={mailSearchInput}
                  onChange={(e) => setMailSearchInput(e.target.value)}
                  placeholder={titleCase("Search mail (same as Gmail)")}
                  className="input-field h-[34px] w-full border-0 bg-[var(--color-surface-offset)] pl-9 text-[13px]"
                  autoComplete="off"
                />
              </div>
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
                    <div className="ml-2 flex items-center gap-0.5">
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
              <div className="space-y-2 p-4">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="skeleton-shimmer h-16 w-full rounded-[var(--radius-md)]" />
                ))}
              </div>
            ) : listError ? (
              <div className="p-6 text-sm text-[var(--color-danger)]">{listError}</div>
            ) : threads.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
                <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-offset)]">
                  {folder === "drafts"
                    ? <FilePen className="h-7 w-7 text-[var(--color-text-faint)] stroke-[1.25]" />
                    : folder === "starred"
                      ? <IconStar className="h-7 w-7 text-[var(--color-text-faint)]" />
                      : <IconInbox className="h-7 w-7 text-[var(--color-text-faint)]" />}
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {titleCase(
                    mailSearch ? "Nothing matches your search"
                    : folder === "drafts" ? "No drafts"
                    : folder === "starred" ? "No starred messages"
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
                        "group relative flex items-center gap-2 border-b border-[var(--color-border)] pl-2 pr-3 text-[13px] transition-colors",
                        isSelected
                          ? "bg-[var(--color-primary-light)]"
                          : isUnread
                            ? "bg-[var(--color-surface)]"
                            : "bg-[var(--color-surface-offset)]",
                        "hover:bg-[var(--color-primary-light)] hover:shadow-sm",
                      )}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRowSelection(t.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-primary)]"
                        aria-label="Select"
                      />
                      {/* Star */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void toggleThreadStar(t.id, !isStarred); }}
                        disabled={isBusy}
                        className={cn(
                          "shrink-0 p-0.5 text-[16px] leading-none transition-colors",
                          isStarred
                            ? "text-yellow-500"
                            : "text-[var(--color-text-faint)] opacity-60 hover:text-yellow-500 hover:opacity-100"
                        )}
                        aria-label={isStarred ? "Unstar" : "Star"}
                        title={isStarred ? "Unstar" : "Star"}
                      >
                        {isStarred ? "★" : "☆"}
                      </button>

                      {/* Row click target */}
                      <button
                        type="button"
                        onClick={() => t.draftId ? void openDraft(t.draftId) : void openThread(t.id)}
                        onMouseEnter={() => { if (!t.draftId) prefetchThread(t.id); }}
                        className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                      >
                        <span className={cn(
                          "w-[160px] shrink-0 truncate",
                          isUnread ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                        )}>
                          {name}
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {chips.length > 0 && (
                            <span className="flex shrink-0 items-center gap-1">
                              {chips.map((l) => <LabelChip key={l.id} label={l} />)}
                            </span>
                          )}
                          <span className={cn(
                            "min-w-0 truncate",
                            isUnread ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                          )}>
                            {t.subject || "(no subject)"}
                            {t.snippet ? (
                              <span className="font-normal text-[var(--color-text-faint)]">{" "}— {t.snippet}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>

                      {/* Attachment indicator */}
                      {t.hasAttachments && (
                        <span className="shrink-0 text-[var(--color-text-faint)]" title="Has attachment">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
                          </svg>
                        </span>
                      )}

                      {/* Date */}
                      <time className={cn(
                        "shrink-0 text-[11px] tabular-nums",
                        isUnread ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
                      )}>
                        {t.date ? formatDate(t.date) : ""}
                      </time>
                    </li>
                  );
                })}

                {/* Skeleton rows appended inside the scroll list while loading more */}
                {loadingMore && [0,1,2,3].map((i) => (
                  <li key={`skel-${i}`} className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-3">
                    <Skeleton className="skeleton-shimmer h-3.5 w-3.5 shrink-0 rounded" />
                    <Skeleton className="skeleton-shimmer h-4 w-4 shrink-0 rounded-full" />
                    <Skeleton className="skeleton-shimmer h-4 w-[120px] shrink-0 rounded" />
                    <Skeleton className="skeleton-shimmer h-4 flex-1 rounded" />
                    <Skeleton className="skeleton-shimmer h-3.5 w-14 shrink-0 rounded" />
                  </li>
                ))}

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
              <div className="space-y-4 p-6">
                <div className="flex items-center gap-3 pb-2">
                  <Skeleton className="skeleton-shimmer h-8 w-8 rounded-full" />
                  <Skeleton className="skeleton-shimmer h-6 w-1/2 rounded-lg" />
                </div>
                <Skeleton className="skeleton-shimmer h-32 w-full rounded-[var(--radius-lg)]" />
                <Skeleton className="skeleton-shimmer h-32 w-full rounded-[var(--radius-lg)]" />
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
                              <span className="max-w-[200px] truncate font-medium">{f.file.name}</span>
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
                          disabled={sendBusy || !replyText.trim()}
                          onClick={() => void sendReply()}
                          className="btn-primary min-w-[120px] gap-2 px-5"
                        >
                          {sendBusy ? (
                            <><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> {titleCase("Sending…")}</>
                          ) : (
                            <><Send className="h-4 w-4" strokeWidth={2} />{titleCase("Send")}</>
                          )}
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

      {/* Gmail-style floating compose */}
      {composeOpen && typeof document !== "undefined"
        ? createPortal(
            <>
              {!composeMinimized ? (
                <button
                  type="button"
                  className="fixed inset-0 z-[998] bg-black/20 lg:hidden"
                  aria-label={titleCase("Close compose")}
                  onClick={() => setComposeOpen(false)}
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
                    onClick={() => {
                      setComposeOpen(false);
                      setComposeCcBccOpen(false);
                      setComposeMinimized(false);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
                    aria-label={titleCase("Close")}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div
                  className="fixed bottom-0 left-0 right-0 z-[999] flex max-h-[90vh] flex-col overflow-hidden rounded-t-2xl border-x border-t border-[#dadce0] bg-white text-[#202124] shadow-[0_-8px_24px_rgba(60,64,67,0.18)] [color-scheme:light] lg:bottom-6 lg:left-auto lg:right-6 lg:max-h-[min(620px,calc(100vh-96px))] lg:w-[528px] lg:rounded-t-lg lg:rounded-b-none lg:border lg:shadow-[0_8px_10px_1px_rgba(0,0,0,0.14),0_3px_14px_2px_rgba(0,0,0,0.12)]"
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
                      onClick={() => {
                        setComposeOpen(false);
                        setComposeCcBccOpen(false);
                      }}
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

                    {/* Body */}
                    <textarea
                      placeholder={titleCase("Compose email")}
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={10}
                      className="min-h-[220px] flex-1 resize-y border-0 bg-white px-3 py-3 text-[13px] leading-relaxed text-[#202124] outline-none placeholder:text-[#70757a]"
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
                                <span className="truncate font-medium">{f.file.name}</span>
                                <span className="shrink-0 text-[#5f6368]">({formatBytes(f.file.size)})</span>
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
                        onClick={() => {
                          setComposeOpen(false);
                          setComposeCc("");
                          setComposeBcc("");
                          setComposeFiles([]);
                          setComposeCcBccOpen(false);
                        }}
                        className="rounded-full px-4 py-2 text-[13px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                      >
                        {titleCase("Discard")}
                      </button>
                      <button
                        type="button"
                        disabled={sendBusy}
                        onClick={() => void sendCompose()}
                        className="rounded-full bg-[#1a73e8] px-6 py-2 text-[13px] font-medium text-white shadow-sm hover:bg-[#1557b0] disabled:opacity-50"
                      >
                        {sendBusy ? titleCase("Sending…") : titleCase("Send")}
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
