"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { extractEmailAddress } from "@/lib/email-parse";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import {
  IconInbox,
  IconSend,
  IconPlus,
  IconReply,
  IconMail,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconPaperclip,
  IconDownload,
  IconSearch,
} from "@/components/Icons";

type Folder = "inbox" | "sent";
type ThreadRow = { id: string; snippet: string; subject: string; from: string; date: string };

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
      a { color: #059669; }
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
  const [replyFiles, setReplyFiles] = useState<PendingFile[]>([]);
  const composeFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

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
      setComposeOpen(false);
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
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {titleCase("Mail")}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {titleCase("Read and send messages with your connected Gmail account.")}
          </p>
        </div>
        <button type="button" onClick={() => setComposeOpen(true)} className="btn-primary shrink-0">
          <IconPlus className="h-4 w-4" /> {titleCase("Compose")}
        </button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch" style={{ minHeight: "calc(100vh - 240px)" }}>
        {/* Thread list */}
        <div className="card flex w-full flex-col overflow-hidden lg:max-w-[380px]">
          <div className="flex items-center gap-1 border-b p-1.5">
            {([
              { key: "inbox" as const, label: "Inbox", icon: IconInbox },
              { key: "sent" as const, label: "Sent", icon: IconSend },
            ]).map((f) => {
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
                    "btn-ghost flex-1 justify-center gap-1.5 rounded-lg py-2 text-xs",
                    folder === f.key && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {titleCase(f.label)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => void loadThreads({ append: false })}
              className="btn-ghost rounded-lg p-2"
              title={titleCase("Refresh")}
            >
              <IconRefresh className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="border-b px-3 pb-3 pt-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="search"
                value={mailSearchInput}
                onChange={(e) => setMailSearchInput(e.target.value)}
                placeholder={titleCase("Search mail (same as Gmail)")}
                className="input-field w-full py-2 pl-9 pr-3 text-sm"
                autoComplete="off"
              />
            </div>
          </div>

          {loadingList ? (
            <div className="space-y-2 p-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : listError ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400">{listError}</div>
          ) : threads.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <IconInbox className="h-7 w-7 text-zinc-400" />
              </div>
              <p className="text-sm text-zinc-500">
                {titleCase(mailSearch ? "No threads match your search" : `No threads in ${folder}`)}
              </p>
            </div>
          ) : (
            <ul className="scrollbar-thin flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60">
              {threads.map((t) => {
                const name = senderName(t.from);
                const initial = name[0]?.toUpperCase() || "?";
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => void openThread(t.id)}
                      className={cn(
                        "group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
                        selectedId === t.id && "bg-emerald-50/80 dark:bg-emerald-950/30"
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200/60 text-xs font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                            {name}
                          </p>
                          <time className="shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                            {t.date ? formatDate(t.date) : ""}
                          </time>
                        </div>
                        <p className="truncate text-[13px] text-zinc-700 dark:text-zinc-300">
                          {t.subject || "(no subject)"}
                        </p>
                        <p className="truncate text-[12px] text-zinc-400 dark:text-zinc-500">
                          {t.snippet}
                        </p>
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
              className="border-t p-3 text-center text-xs font-medium text-emerald-600 hover:bg-zinc-50 dark:text-emerald-400 dark:hover:bg-zinc-900/50"
              onClick={() => void loadThreads({ append: true, pageToken: nextPageToken })}
            >
              Load more
            </button>
          ) : null}
        </div>

        {/* Thread detail */}
        <div className="card flex flex-1 flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
                <IconMail className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
              </div>
              <p className="text-sm text-zinc-500">
                {titleCase("Select a thread or compose a new message")}
              </p>
            </div>
          ) : loadingThread ? (
            <div className="space-y-4 p-6">
              <Skeleton className="h-6 w-2/3 rounded-lg" />
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : threadError ? (
            <div className="p-6 text-sm text-red-600 dark:text-red-400">{threadError}</div>
          ) : messages && messages.length ? (
            <>
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {messages[0]?.subject || "(no subject)"}
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {titleCase(
                    `${messages.length} message${messages.length !== 1 ? "s" : ""} in thread`
                  )}
                </p>
              </div>
              <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-5">
                {messages.map((m, i) => (
                  <article
                    key={m.id}
                    className={cn(
                      "rounded-xl border px-4 py-3 transition-colors",
                      i === messages.length - 1
                        ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                        : "border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200/80 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {(m.from || "?")[0]?.toUpperCase()}
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

              <div className="border-t p-4">
                {!replyOpen ? (
                  <button type="button" onClick={() => setReplyOpen(true)} className="btn-secondary w-full justify-center">
                    <IconReply className="h-4 w-4" /> {titleCase("Reply")}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-zinc-500">
                        {titleCase("Replying to")}{" "}
                        {extractEmailAddress(messages[messages.length - 1].from)}
                      </p>
                      <button type="button" onClick={() => setReplyOpen(false)} className="btn-ghost p-1"><IconX className="h-4 w-4" /></button>
                    </div>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={4}
                      placeholder={titleCase("Write your reply…")}
                      className="input-field resize-none"
                      autoFocus
                    />
                    {replyFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {replyFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            <IconPaperclip className="h-3 w-3" />
                            <span className="max-w-[120px] truncate">{f.file.name}</span>
                            <button type="button" onClick={() => setReplyFiles((prev) => prev.filter((_, j) => j !== i))} className="ml-0.5 text-zinc-400 hover:text-red-500"><IconX className="h-3 w-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <input ref={replyFileRef} type="file" multiple className="hidden" onChange={(e) => { void handleFileSelect(e.target.files, "reply"); e.target.value = ""; }} />
                        <button type="button" onClick={() => replyFileRef.current?.click()} className="btn-ghost gap-1 text-[12px]">
                          <IconPaperclip className="h-3.5 w-3.5" /> {titleCase("Attach")}
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={sendBusy || !replyText.trim()}
                        onClick={() => void sendReply()}
                        className="btn-primary"
                      >
                        {sendBusy ? (
                          <>
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />{" "}
                            {titleCase("Sending…")}
                          </>
                        ) : (
                          <>
                            <IconSend className="h-4 w-4" /> {titleCase("Send")}
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

      {/* Compose modal */}
      {composeOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/60 p-4 backdrop-blur-md sm:items-center" role="dialog" aria-modal="true">
              <div className="card w-full max-w-lg animate-[slideUp_0.2s_ease-out] overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {titleCase("New message")}
              </h3>
              <button type="button" onClick={() => setComposeOpen(false)} className="btn-ghost p-1.5"><IconX className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-5">
              <input
                type="email"
                placeholder={titleCase("To")}
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                className="input-field"
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder={titleCase("Cc")}
                  value={composeCc}
                  onChange={(e) => setComposeCc(e.target.value)}
                  className="input-field"
                />
                <input
                  type="text"
                  placeholder={titleCase("Bcc")}
                  value={composeBcc}
                  onChange={(e) => setComposeBcc(e.target.value)}
                  className="input-field"
                />
              </div>
              <input
                type="text"
                placeholder={titleCase("Subject")}
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="input-field"
              />
              <textarea
                placeholder={titleCase("Write your message…")}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={8}
                className="input-field resize-none"
              />
              {composeFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {composeFiles.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      <IconPaperclip className="h-3 w-3" />
                      <span className="max-w-[120px] truncate">{f.file.name}</span>
                      <span className="text-zinc-400">({formatBytes(f.file.size)})</span>
                      <button type="button" onClick={() => setComposeFiles((prev) => prev.filter((_, j) => j !== i))} className="ml-0.5 text-zinc-400 hover:text-red-500"><IconX className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t px-5 py-4">
              <div>
                <input ref={composeFileRef} type="file" multiple className="hidden" onChange={(e) => { void handleFileSelect(e.target.files, "compose"); e.target.value = ""; }} />
                <button type="button" onClick={() => composeFileRef.current?.click()} className="btn-ghost gap-1 text-[12px]">
                  <IconPaperclip className="h-3.5 w-3.5" /> {titleCase("Attach files")}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeCc("");
                    setComposeBcc("");
                    setComposeFiles([]);
                  }}
                  className="btn-ghost"
                >
                  {titleCase("Cancel")}
                </button>
                <button type="button" disabled={sendBusy} onClick={() => void sendCompose()} className="btn-primary">
                  {sendBusy ? (
                    titleCase("Sending…")
                  ) : (
                    <>
                      <IconSend className="h-4 w-4" /> {titleCase("Send")}
                    </>
                  )}
                </button>
              </div>
            </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
