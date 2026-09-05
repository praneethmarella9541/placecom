"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Reply, ReplyAll, Forward } from "lucide-react";
import { EmailHtmlBody } from "@/components/EmailHtmlBody";
import { GmailAttachmentPreviews } from "@/components/GmailAttachmentPreviews";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconX } from "@/components/Icons";
import { GmailComposeDialog } from "@/components/GmailComposeDialog";
import type { RecipientSuggestion } from "@/components/RecipientField";
import { titleCase } from "@/lib/title-case";
import { previewLineFromBody } from "@/lib/utils";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { findInvalidRecipient, formatRecipientError } from "@/lib/validate-mail-recipients";
import { DRAFT_JSON_INLINE_MAX_BYTES } from "@/lib/gmail-draft-limits";
import { isInlinePartReferencedInHtml } from "@/lib/email-html-inline-images";
import type { ThreadMessageView } from "@/lib/gmail-inbox";

function senderName(from: string): string {
  if (!from) return "Unknown";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Re:";
  return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function forwardSubject(subject: string): string {
  const trimmed = subject.trim();
  return /^fwd:\s/i.test(trimmed) ? trimmed : `Fwd: ${trimmed || "(no subject)"}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type ComposeKind = "reply" | "replyAll" | "forward";

/**
 * Small in-app "View email" popup (like Attio's) instead of leaving the app
 * to open the thread in Gmail — same rendering path (EmailHtmlBody) the main
 * Inbox reading pane uses, layered above whatever modal opened it.
 *
 * Shows the WHOLE thread, matching the Inbox reading pane: older messages as
 * collapsed one-line rows, the newest expanded. It used to render only the
 * newest message on the assumption that older ones would be visible as quoted
 * text inside it — but that only holds when each message actually quotes its
 * parent. A follow-up typed fresh above the quote (or sent from a client that
 * strips the quote) left the earlier messages with nowhere to appear at all,
 * so a three-message thread looked like a one-message thread.
 *
 * Reply/Reply All/Forward reuse the exact same compose dock
 * (GmailComposeDialog) the Inbox tab uses, wired up locally here — but with
 * a simplified attachment path (small files only, inline base64; no Drive
 * staged-upload for large files, no draft-autosave) rather than the Inbox
 * page's full pipeline, which is a lot of machinery to replicate for what's
 * meant to be a lightweight popup.
 */
export function EmailThreadPreviewModal({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [thread, setThread] = useState<ThreadMessageView[] | "loading" | "error">("loading");
  /** Which messages are open. Gmail's rule: the newest starts expanded, the rest collapsed. */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setThread("loading");
    setExpandedIds(new Set());
    fetch(`/api/gmail/threads/${encodeURIComponent(threadId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((json: { messages?: ThreadMessageView[] }) => {
        if (cancelled) return;
        const list = json.messages ?? [];
        if (list.length === 0) {
          setThread("error");
          return;
        }
        setThread(list);
        setExpandedIds(new Set([list[list.length - 1].id]));
      })
      .catch(() => {
        if (!cancelled) setThread("error");
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Reply/Reply All/Forward act on the newest message, as they did when this
  // popup rendered only that one — replying to a thread means replying to its
  // latest message regardless of which older ones the reader has expanded.
  const message: ThreadMessageView | "loading" | "error" = Array.isArray(thread)
    ? thread[thread.length - 1]
    : thread;

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Reply / Reply All / Forward — same compose dock the Inbox uses ──────
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  const [composeFullscreen, setComposeFullscreen] = useState(false);
  const [composeKind, setComposeKind] = useState<ComposeKind>("reply");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [ccBccOpen, setCcBccOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentJustNow, setSentJustNow] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/gmail/contacts")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const contacts = (j as { contacts?: RecipientSuggestion[] } | null)?.contacts;
        if (Array.isArray(contacts)) setSuggestions(contacts);
      })
      .catch(() => {});
    fetch("/api/me/mailbox")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const data = j as { sessionEmail?: string | null; mailboxEmail?: string | null } | null;
        setMyEmail((data?.mailboxEmail || data?.sessionEmail || "").trim().toLowerCase() || null);
      })
      .catch(() => {});
  }, []);

  function buildReplyAllCc(msg: ThreadMessageView): string {
    const exclude = new Set<string>();
    exclude.add(extractEmailAddress(msg.from).toLowerCase());
    if (myEmail) exclude.add(myEmail);
    const candidates = [...extractAllEmailsFromText(msg.to || ""), ...extractAllEmailsFromText(msg.cc || "")];
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

  function openCompose(kind: ComposeKind) {
    if (message === "loading" || message === "error") return;
    const ccVal = kind === "replyAll" ? buildReplyAllCc(message) : "";
    setComposeKind(kind);
    setTo(kind === "forward" ? "" : extractEmailAddress(message.from));
    setCc(ccVal);
    setBcc("");
    setSubject(kind === "forward" ? forwardSubject(message.subject || "") : replySubject(message.subject || ""));
    setBody("");
    setCcBccOpen(kind === "replyAll" && !!ccVal.trim());
    setFiles([]);
    setSendError(null);
    setSentJustNow(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  }

  async function handleSend() {
    const invalid = findInvalidRecipient({ to, cc, bcc });
    if (invalid) {
      setSendError(formatRecipientError(invalid));
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (f) => {
          if (f.size > DRAFT_JSON_INLINE_MAX_BYTES) {
            throw new Error(
              `"${f.name}" is too large to attach here (max ${Math.floor(DRAFT_JSON_INLINE_MAX_BYTES / (1024 * 1024))}MB) — try Gmail directly for larger files.`
            );
          }
          return {
            filename: f.name,
            mimeType: f.type || "application/octet-stream",
            base64Data: await fileToBase64(f),
          };
        })
      );

      const isReply = composeKind === "reply" || composeKind === "replyAll";
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject: subject.trim(),
          textBody: "",
          htmlBody: body,
          threadId: isReply ? threadId : undefined,
          inReplyToMessageId: isReply && message !== "loading" && message !== "error" ? message.id : undefined,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Send failed");

      setComposeOpen(false);
      setSentJustNow(true);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  function handleFileChange(fileList: FileList | null) {
    if (!fileList) return;
    setFiles((prev) => [...prev, ...Array.from(fileList)]);
  }

  if (typeof document === "undefined") return null;

  // Portal straight to <body>, same as GmailComposeDialog below — this is
  // routinely opened nested inside another `fixed inset-0` modal (Company/
  // Person), and rendering in place left its own `fixed inset-0` positioned
  // relative to some ancestor instead of the true viewport (a stray backdrop-
  // filter/blur somewhere up the tree quietly creates a containing block for
  // fixed descendants in some browsers) — a gap opened at the top showing
  // the real page underneath. Portaling sidesteps whatever ancestor is
  // responsible instead of chasing it down.
  return createPortal(
    <div
      // Stronger scrim than other modals in this app — this one is often
      // nested on top of another light `.card` modal (Company/Person), and
      // a plain bg-black/50 + light blur wasn't enough to fully hide that
      // white card behind it; it showed through as a bright blurred haze.
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        // Stop here — this can be nested inside another modal's own backdrop
        // (SyncedCompanyModal, SyncedPersonModal); without this, a click to
        // dismiss this popup bubbles up and closes that modal too.
        e.stopPropagation();
        // Only close on a click that actually landed on the empty backdrop.
        // GmailComposeDialog and GmailAttachmentPreviews' lightbox both
        // portal to <body>, but React bubbles synthetic events along the
        // *React* tree, not the DOM tree — so a click anywhere inside either
        // of them (typing a reply, hitting Send, closing the attachment
        // preview) still reaches this handler even though it's rendered
        // elsewhere in the DOM. e.target === e.currentTarget excludes those
        // regardless of which nested portal the click actually came from.
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {titleCase("View email")}
          </h3>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Close">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {thread === "loading" ? (
            <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {titleCase("Loading…")}
            </div>
          ) : thread === "error" ? (
            <p className="px-5 py-8 text-center text-[13px] text-[var(--color-danger)]">
              {titleCase("Failed to load this email.")}
            </p>
          ) : (
            <div className="px-5 py-4">
              <div className="flex items-start gap-2">
                <h2 className="flex-1 text-[16px] font-semibold text-[var(--color-text)]">
                  {thread[0].subject || titleCase("(no subject)")}
                </h2>
                {thread.length > 1 && (
                  <span
                    className="mt-0.5 shrink-0 rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]"
                    title={`${thread.length} messages in this thread`}
                  >
                    {thread.length}
                  </span>
                )}
              </div>

              <div className="mt-3 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                {thread.map((msg) => {
                  const open = expandedIds.has(msg.id);
                  // EmailHtmlBody only uses `attachments` to rewrite inline
                  // cid: images already shown in the body — real downloadable
                  // files (a resume, a PDF) need this separate chip strip or
                  // they never show up at all. Same filtering as the Inbox
                  // reading pane.
                  const files = (msg.attachments ?? []).filter(
                    (a) =>
                      !/invite\.ics$/i.test(a.filename) &&
                      !/^text\/calendar/i.test(a.mimeType) &&
                      !isInlinePartReferencedInHtml(msg.bodyHtml, a.contentId, a.filename)
                  );
                  return (
                    <div key={msg.id} className="py-3">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(msg.id)}
                        aria-expanded={open}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <GmailAvatar seed={msg.from} name={senderName(msg.from)} size={36} />
                        <div className="min-w-0 flex-1 text-[13px]">
                          <p className="font-medium text-[var(--color-text)]">
                            {senderName(msg.from)}
                          </p>
                          {open ? (
                            <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                              {titleCase("to")} {msg.to || "—"}
                            </p>
                          ) : (
                            <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                              {previewLineFromBody(msg.body)}
                            </p>
                          )}
                        </div>
                        <p className="shrink-0 text-[12px] text-[var(--color-text-faint)]">
                          {msg.date ? new Date(msg.date).toLocaleString() : ""}
                        </p>
                      </button>

                      {open && (
                        <div className="mt-3">
                          <EmailHtmlBody
                            html={msg.bodyHtml}
                            plain={msg.body}
                            messageId={msg.id}
                            attachments={msg.attachments}
                          />
                          {files.length > 0 && (
                            <div className="mt-4">
                              <GmailAttachmentPreviews attachments={files} messageId={msg.id} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {message !== "loading" && message !== "error" && (
          <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-5 py-3">
            <button
              type="button"
              onClick={() => openCompose("reply")}
              className="btn-ghost inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-medium"
            >
              <Reply className="h-3.5 w-3.5" />
              {titleCase("Reply")}
            </button>
            <button
              type="button"
              onClick={() => openCompose("replyAll")}
              className="btn-ghost inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-medium"
            >
              <ReplyAll className="h-3.5 w-3.5" />
              {titleCase("Reply all")}
            </button>
            <button
              type="button"
              onClick={() => openCompose("forward")}
              className="btn-ghost inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-medium"
            >
              <Forward className="h-3.5 w-3.5" />
              {titleCase("Forward")}
            </button>
            {sentJustNow && (
              <span className="text-[12px] font-medium text-[var(--color-success)]">{titleCase("Sent")}</span>
            )}
          </div>
        )}
      </div>

      <GmailComposeDialog
        open={composeOpen}
        minimized={composeMinimized}
        fullscreen={composeFullscreen}
        windowTitle={
          composeKind === "forward" ? titleCase("Forward") : composeKind === "replyAll" ? titleCase("Reply all") : titleCase("Reply")
        }
        to={to}
        onToChange={setTo}
        cc={cc}
        onCcChange={setCc}
        bcc={bcc}
        onBccChange={setBcc}
        subject={subject}
        onSubjectChange={setSubject}
        body={body}
        onBodyChange={setBody}
        ccBccOpen={ccBccOpen}
        onCcBccOpenChange={setCcBccOpen}
        suggestions={suggestions}
        sendDisabled={sending || !to.trim()}
        onMinimize={() => setComposeMinimized((v) => !v)}
        onToggleFullscreen={() => setComposeFullscreen((v) => !v)}
        onClose={() => setComposeOpen(false)}
        onSend={() => void handleSend()}
        onDiscard={() => setComposeOpen(false)}
        fileInputRef={fileInputRef}
        onAttachClick={() => fileInputRef.current?.click()}
        onFileChange={handleFileChange}
        attachmentChips={
          files.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-2 py-0.5 text-[11px] text-[var(--color-text-muted)]"
                >
                  {f.name}
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="ml-0.5 opacity-70 hover:opacity-100"
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : undefined
        }
        composeError={sendError}
        onDismissComposeError={() => setSendError(null)}
      />
    </div>,
    document.body
  );
}
