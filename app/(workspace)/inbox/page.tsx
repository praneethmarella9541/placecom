"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import { Mail, PencilLine, Send, Paperclip, Maximize2, Minus, FilePen } from "lucide-react";
import {
  IconInbox,
  IconSend,
  IconReply,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconPaperclip,
  IconDownload,
  IconSearch,
} from "@/components/Icons";

function avatarHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = seed.charCodeAt(i) + ((h << 5) - h);
  }
  return `hsl(${Math.abs(h) % 360} 42% 44%)`;
}

type Folder = "inbox" | "sent" | "drafts";
type ThreadRow = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  draftId?: string;
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
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[12px] text-zinc-700 transition-colors hover:border-emerald-300 hover:bg-emerald-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
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
      <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
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
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [mailSearchInput, setMailSearchInput] = useState("");
  const [mailSearch, setMailSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgView[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

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
  const [draftLoading, setDraftLoading] = useState(false);
  // Mirror of draftLoading for use inside useCallback without re-creating
  // the handler every time the loading flag flips.
  const draftLoadingRef = useRef(false);
  const [replyFiles, setReplyFiles] = useState<PendingFile[]>([]);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

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
      const params = new URLSearchParams({ folder, maxResults: "25" });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (mailSearch) params.set("search", mailSearch);
      try {
        const res = await fetch(`/api/gmail/threads?${params.toString()}`);
        const data = (await res.json()) as { error?: string; threads?: ThreadRow[]; nextPageToken?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load inbox");
        setThreads((prev) => (opts.append ? [...prev, ...(data.threads || [])] : data.threads || []));
        setNextPageToken(data.nextPageToken);
      } catch (e) {
        setListError(e instanceof Error ? e.message : "Failed to load");
        if (!opts.append) setThreads([]);
      } finally { setLoadingList(false); }
    },     [folder, mailSearch]
  );

  useEffect(() => {
    void loadThreads({ append: false });
  }, [loadThreads]);

  useEffect(() => {
    void loadTracking();
  }, [loadTracking]);

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
    setDraftLoading(true);
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
      setDraftLoading(false);
      draftLoadingRef.current = false;
    }
  }, []);

  const openThread = useCallback(async (threadId: string) => {
    setSelectedId(threadId);
    setMessages(null); setThreadError(null); setReplyText(""); setReplyOpen(false);
    setLoadingThread(true);
    try {
      const res = await fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`);
      const data = (await res.json()) as { error?: string; messages?: MsgView[] };
      if (!res.ok) throw new Error(data.error || "Failed to open thread");
      setMessages(data.messages || []);
      void loadTracking();
    } catch (e) { setThreadError(e instanceof Error ? e.message : "Error"); }
    finally { setLoadingThread(false); }
  }, [loadTracking]);

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

  return (
    <>
    <div className="-mx-4 flex max-h-[calc(100vh-52px-32px)] flex-col md:-mx-6 md:max-h-[calc(100vh-52px-48px)] lg:flex-row">
        {/* Thread list */}
        <div className="surface-card flex min-h-[420px] w-full shrink-0 flex-col overflow-hidden border-0 md:min-h-0 lg:h-[calc(100vh-52px-48px)] lg:w-[300px] lg:rounded-none lg:border-r lg:border-[var(--color-border)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true);
                  setComposeMinimized(false);
                }}
                className="btn-primary inline-flex h-[34px] shrink-0 gap-2 px-3 text-[13px]"
              >
                <PencilLine className="h-4 w-4" strokeWidth={2} />
                {titleCase("Compose")}
              </button>
              <div className="flex flex-1 items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-offset)] p-0.5">
                {[
                  { key: "inbox" as const, label: "Inbox", icon: IconInbox },
                  { key: "sent" as const, label: "Sent", icon: IconSend },
                  { key: "drafts" as const, label: "Drafts", icon: FilePen },
                ].map((f) => {
                  const Icon = f.icon;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        setFolder(f.key);
                        setSelectedId(null);
                        setMessages(null);
                        setMailSearchInput("");
                        setMailSearch("");
                      }}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-[var(--radius-md)] px-2 py-1.5 text-[13px] font-medium transition-colors",
                        folder === f.key
                          ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" /> {titleCase(f.label)}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void loadThreads({ append: false })}
                className="btn-ghost h-8 w-8 shrink-0 justify-center p-0"
                title={titleCase("Refresh")}
              >
                <IconRefresh className="h-4 w-4" />
              </button>
            </div>
            <div className="relative mt-3">
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

          {loadingList ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="skeleton-shimmer h-14 w-full rounded-[var(--radius-md)]" />
              ))}
            </div>
          ) : listError ? (
            <div className="p-6 text-sm text-[var(--color-danger)]">{listError}</div>
          ) : threads.length === 0 ? (
            <div className="flex flex-1 flex-col justify-center gap-3 p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-offset)]">
                {folder === "drafts" ? (
                  <FilePen className="h-7 w-7 text-[var(--color-text-faint)] stroke-[1.25]" />
                ) : (
                  <IconInbox className="h-7 w-7 text-[var(--color-text-faint)]" />
                )}
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                {titleCase(
                  mailSearch
                    ? "Nothing matches your search"
                    : folder === "drafts"
                      ? "No drafts"
                      : `No threads in ${folder}`,
                )}
              </p>
            </div>
          ) : (
            <ul className="scrollbar-thin flex-1 divide-y divide-[var(--color-border)] overflow-y-auto">
              {threads.map((t) => {
                const name = senderName(t.from);
                const initial = avatarInitial(name);
                const bg = avatarHue(name);
                return (
                  <li key={t.draftId ?? t.id} className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        t.draftId
                          ? void openDraft(t.draftId)
                          : void openThread(t.id)
                      }
                      className={cn(
                        "group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-offset)]",
                        selectedId === t.id &&
                          "border-l-[3px] border-l-[var(--color-primary)] bg-[var(--color-primary-light)] pl-[13px]",
                      )}
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white"
                        style={{ backgroundColor: bg }}
                      >
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "truncate text-[14px] text-[var(--color-text)]",
                              selectedId === t.id ? "font-semibold" : "font-medium",
                            )}
                          >
                            {name}
                          </p>
                          <time className="shrink-0 text-[12px] tabular-nums text-[var(--color-text-faint)]">
                            {t.date ? formatDate(t.date) : ""}
                          </time>
                        </div>
                        <p className="truncate text-[13px] font-medium text-[var(--color-text-muted)]">
                          {t.subject || "(no subject)"}
                        </p>
                        <p className="truncate text-[12px] text-[var(--color-text-faint)]">{t.snippet}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {nextPageToken ? (
            <button
              type="button"
              className="border-t border-[var(--color-border)] p-3 text-center text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-surface-offset)]"
              onClick={() => void loadThreads({ append: true, pageToken: nextPageToken })}
            >
              Load more
            </button>
          ) : null}
        </div>

        {/* Thread detail */}
        <div className="surface-card flex min-h-[420px] flex-1 flex-col overflow-hidden border-0 bg-[var(--color-bg)] shadow-none lg:min-h-0">
          {!selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <Mail className="h-12 w-12 text-[var(--color-text-faint)] stroke-[1.25]" />
              <p className="font-display text-lg font-bold text-[var(--color-text)]">
                {titleCase("Select a thread")}
              </p>
              <p className="max-w-sm text-center text-sm text-[var(--color-text-muted)]">
                {titleCase("Choose a conversation from the list to read it.")}
              </p>
            </div>
          ) : loadingThread ? (
            <div className="space-y-4 p-6">
              <Skeleton className="skeleton-shimmer h-6 w-2/3 rounded-lg" />
              <Skeleton className="skeleton-shimmer h-32 w-full rounded-[var(--radius-lg)]" />
              <Skeleton className="skeleton-shimmer h-32 w-full rounded-[var(--radius-lg)]" />
            </div>
          ) : threadError ? (
            <div className="p-6 text-sm text-[var(--color-danger)]">{threadError}</div>
          ) : messages && messages.length ? (
            <>
              <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
                <h2 className="font-display text-xl font-bold text-[var(--color-text)]">
                  {messages[0]?.subject || "(no subject)"}
                </h2>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-semibold text-[var(--color-text)]">{senderName(messages[0]?.from || "")}</span>
                  <span className="text-[var(--color-text-muted)]">
                    &lt;{extractEmailAddress(messages[0]?.from || "")}&gt;
                  </span>
                  <time className="ml-auto text-[var(--color-text-faint)]">{formatDate(messages[0]?.date || "")}</time>
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {titleCase(
                    `${messages.length} message${messages.length !== 1 ? "s" : ""} in thread`
                  )}
                </p>
              </div>
              <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-6">
                {messages.map((m) => (
                  <article
                    key={m.id}
                    className="surface-card rounded-[var(--radius-lg)] p-6 shadow-[var(--shadow-sm)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200/80 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
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
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400" title={`Opened ${tr.open_count}x`}>
                                <IconEye className="h-3 w-3" />
                                Opened{tr.open_count > 1 ? ` ${tr.open_count}x` : ""} · {timeAgo(tr.opened_at)}
                              </span>
                            );
                          }
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
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
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                          {titleCase("Reply")}
                        </p>
                        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
                          <span className="text-[var(--color-text)]">{titleCase("To")}</span>{" "}
                          <span className="font-medium text-[var(--color-primary)]">
                            {extractEmailAddress(messages[messages.length - 1].from)}
                          </span>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setReplyOpen(false);
                          setReplyText("");
                          setReplyFiles([]);
                        }}
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
                          <li
                            key={i}
                            className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)]"
                          >
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
                      <input
                        ref={replyFileRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void handleFileSelect(e.target.files, "reply");
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => replyFileRef.current?.click()}
                        className="btn-secondary h-9 gap-2 px-3 text-[13px]"
                      >
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
                          <>
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />{" "}
                            {titleCase("Sending…")}
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" strokeWidth={2} />
                            {titleCase("Send")}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-500">
              {titleCase("No messages in thread.")}
            </div>
          )}
        </div>
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
