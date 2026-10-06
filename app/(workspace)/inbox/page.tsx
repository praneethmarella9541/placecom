"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LabelChip, labelAccentStyle, buildLabelColorMap } from "@/components/LabelChip";
import { LabelPicker } from "@/components/LabelPicker";
import { LabelSidebarItem } from "@/components/LabelSidebarItem";
import {
  findInvalidRecipient,
  formatRecipientError,
  recipientErrorTitle,
} from "@/lib/validate-mail-recipients";
import { richTextIsEmpty } from "@/components/RichTextEditor";
import { CalendarInviteOrHtml } from "@/components/CalendarInviteCard";
import { ThreadActionsMenu } from "@/components/ThreadActionsMenu";
import { GmailAttachmentPreviews } from "@/components/GmailAttachmentPreviews";
import { GmailAvatar } from "@/components/GmailAvatar";
import { isCalendarInviteThread } from "@/lib/calendar-invite-email";
import { GmailComposeDialog } from "@/components/GmailComposeDialog";
import {
  MassRecipientsPanel,
  type MassImport,
  type MassRecipient,
  type MassSource,
} from "@/components/MassRecipientsPanel";
import {
  MassSendingToggleDialog,
  type MassToggleDirection,
} from "@/components/MassSendingToggleDialog";
import {
  MailTemplatesButton,
  type TemplateApplyMode,
} from "@/components/MailTemplatesModal";
import type { MailTemplate, MailTemplateAttachment } from "@/lib/mail-template-types";
import { useDirectoryContacts } from "@/hooks/useDirectoryContacts";
import { useSyncedContacts } from "@/hooks/useSyncedContacts";
import type { DirectoryContact } from "@/lib/contact-directory";
import {
  COMPOSE_VARIABLES,
  columnsToComposeVariables,
  contactToMergeFields,
  formatInteractionDate,
  mergeFieldSources,
  reportMissingVariables,
  stripVariableSpans,
  syncedContactToMergeFields,
  templateUsesKnownVariables,
  type ComposeVariable,
  type UnknownPlaceholderMode,
} from "@/lib/compose-variables";
import { listPlaceholdersInTemplate, mergeTemplate, type MailMergeRow } from "@/lib/mail-merge";
import { GmailInlineReply } from "@/components/GmailInlineReply";
import { GmailPendingAttachments } from "@/components/GmailPendingAttachments";
import { appendDriveLinksToHtml } from "@/lib/gmail-drive-links";
import { uploadLargeFileToDrive } from "@/lib/upload-large-file-to-drive";
import {
  DRAFT_AUTOSAVE_DELAY_MS,
  type ComposeDraftSaveStatus,
} from "@/lib/gmail-draft-autosave";
import { sendsAsDriveLink } from "@/lib/gmail-draft-limits";
import { markTemplateCopy } from "@/hooks/useMailTemplates";
import { creepProgress, type AttachmentUploadKind } from "@/components/AttachmentUploadRow";
import { uploadInlineImage } from "@/lib/upload-inline-image";
import { uploadStagedDraftAttachment } from "@/lib/upload-staged-draft-attachment";
import {
  pendingFileFingerprint,
  pendingFileName,
  pendingFileSize,
  pendingFilesFromDraftAttachments,
  type DraftApiAttachment,
  type PendingFile,
} from "@/lib/gmail-compose-types";
import {
  readComposePersistedStateForRestore,
  setComposePersistedState,
  takeExpandComposeOnReturn,
  type ComposePersistedState,
} from "@/lib/compose-persist";
import {
  mergeInboxUnread,
  readSessionInboxUnread,
  writeSessionInboxUnread,
} from "@/lib/inbox-unread-session";
import { createPortal } from "react-dom";
import { useWorkspaceTopbarActionsNode } from "@/lib/workspace-topbar-context";
import { RecipientField, type RecipientSuggestion } from "@/components/RecipientField";
import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { cn, formatDate, previewLineFromBody, timeAgo } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { useModuleVisibility } from "@/lib/module-visibility";
import { useAllowDelete } from "@/lib/use-allow-delete";
import {
  buildDateSearchClauses,
  buildExclusionTokens,
  parseGmailQueryToFilterFields,
  type GmailFilterFields,
} from "@/lib/gmail-search-query";
import { isSelfSentEmail } from "@/lib/email-self-sent";
import { isInlinePartReferencedInHtml } from "@/lib/email-html-inline-images";
import { GmailDatePicker } from "@/components/GmailDatePicker";
import { searchHighlightTerms, SearchHighlight } from "@/lib/search-highlight";
import {
  formatFromHeader,
  formatMessageRecipientsLine,
} from "@/lib/message-recipients-display";
import { MailSearchBar } from "@/components/MailSearchBar";
import {
  buildMailListCacheKey,
  clearMailListSessionCache,
  getMailListSessionCache,
  prefetchMailListViewIfMissing,
  prefetchMailListViews,
  setMailListCache,
} from "@/lib/inbox-list-prefetch";
import {
  clearMailThreadPrefetchCache,
  getCachedThread,
  invalidateCachedThread,
  MAIL_THREAD_PREFETCH_DISABLED,
  rememberOpenThread,
  rememberPrefetchThread,
  prefetchMailThreadBodies,
  prefetchMailBodiesForWarmedCategories,
  startMailListAndBodyPrefetchWarm,
} from "@/lib/mail-thread-prefetch";
import { isPrefetchPausedAfterBrowserReload } from "@/lib/login-prefetch-session";
import { ChevronDown, PencilLine, FilePen, Bookmark, Trash2, AlertOctagon, Mail, Maximize2, X as XIcon, Reply, AlertTriangle, Megaphone, Search as SearchIcon } from "lucide-react";
import {
  IconInbox,
  IconSend,
  IconStar,
  IconRefresh,
  IconX,
  IconEye,
  IconCheck,
  IconCalendar,
  IconInfo,
} from "@/components/Icons";

/** User labels shown in the sidebar before the search box is needed. */
const SIDEBAR_LABEL_LIMIT = 15;

type Folder = "inbox" | "sent" | "drafts" | "starred" | "important" | "trash" | "spam" | "allmail";
type BulkAction =
  | "archive"
  | "trash"
  | "deleteForever"
  | "markRead"
  | "markUnread"
  | "star"
  | "important"
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

function threadIdsForPrefetch(rows: ThreadRow[]): string[] {
  return rows.filter((t) => !t.draftId).map((t) => t.id);
}

/** Maps sidebar folder to the list-cache key used by loadThreads / login warm. */
function listViewForFolder(folder: Folder): { apiFolder: string; labelId: string | null } {
  if (folder === "starred") return { apiFolder: "inbox", labelId: "STARRED" };
  if (folder === "important") return { apiFolder: "inbox", labelId: "IMPORTANT" };
  if (folder === "trash") return { apiFolder: "trash", labelId: null };
  if (folder === "spam") return { apiFolder: "spam", labelId: null };
  if (folder === "allmail") return { apiFolder: "allmail", labelId: null };
  return { apiFolder: folder, labelId: null };
}

function pickHigherHistoryId(
  current: string | null,
  next: string | null | undefined
): string | null {
  const n = next?.trim();
  if (!n) return current;
  if (!current) return n;
  try {
    return BigInt(n) > BigInt(current) ? n : current;
  } catch {
    return current;
  }
}

function bumpHistoryAnchorFromThreads(
  ref: { current: string | null },
  rows: readonly ThreadRow[]
): void {
  for (const t of rows) {
    ref.current = pickHigherHistoryId(ref.current, t.historyId);
  }
}

/** Merge label ids for thread UI — keeps optimistic user labels across stale API/cache. */
function mergeThreadLabelIds(...sources: (string[] | undefined)[]): string[] {
  const merged = new Set<string>();
  for (const ids of sources) {
    for (const id of ids ?? []) {
      if (id && id !== "UNREAD") merged.add(id);
    }
  }
  return Array.from(merged);
}

/** Whether a row still belongs in a label-filtered list (user label, Starred, Important). */
function threadMatchesLabelView(row: ThreadRow, labelId: string): boolean {
  if (labelId === "STARRED") return !!row.starred;
  if (labelId === "IMPORTANT") {
    return !!row.important || (row.labelIds ?? []).includes("IMPORTANT");
  }
  return (row.labelIds ?? []).includes(labelId);
}

/** Middle segment of list cache keys: `${apiFolder}|${labelId}|${search}`. */
function listCacheLabelId(cacheKey: string): string {
  const first = cacheKey.indexOf("|");
  if (first < 0) return "";
  const second = cacheKey.indexOf("|", first + 1);
  if (second < 0) return cacheKey.slice(first + 1);
  return cacheKey.slice(first + 1, second);
}

/** Merge rows by id, sort newest-first (Gmail list order). */
function mergeThreadsByDate(existing: ThreadRow[], incoming: ThreadRow[]): ThreadRow[] {
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const t of incoming) byId.set(t.id, t);
  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
  );
}

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

/** Client-only id until Gmail returns the real label id. */
function makePendingLabel(name: string): GmailLabel {
  return {
    id: `pending:${crypto.randomUUID()}`,
    name,
    type: "user",
    surfaced: true,
    isSystem: false,
    isCategory: false,
  };
}

/**
 * Two-column row used inside the advanced search filter popover —
 * left label + right input field. Keeps spacing consistent across rows.
 */
function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] items-center gap-x-4">
      <label className="text-[13px] text-[var(--color-text-faint)]">{label}</label>
      <div className="min-w-0 [&_.input-field]:rounded [&_.input-field]:border-[var(--color-border)] [&_.input-field]:shadow-none [&_.input-field]:focus:border-[var(--color-copper)] [&_.input-field]:focus:shadow-none [&_.input-field]:focus:ring-1 [&_.input-field]:focus:ring-[var(--color-copper)] [&_[role=group]]:rounded [&_[role=group]]:border-[var(--color-border)] [&_[role=group]]:focus-within:border-[var(--color-copper)] [&_[role=group]]:focus-within:shadow-none [&_[role=group]]:focus-within:ring-1 [&_[role=group]]:focus-within:ring-[var(--color-copper)]">
        {children}
      </div>
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
  contentId?: string;
  inlineDataUri?: string;
};

type MsgView = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  body: string;
  bodyHtml?: string;
  attachments?: AttachmentView[];
  /** "Show details" popover fields — see lib/gmail-inbox.ts's getThreadMessages. */
  replyTo?: string;
  mailedBy?: string;
  signedBy?: string;
};

type TrackingRow = {
  gmail_message_id: string;
  opened: boolean;
  opened_at: string | null;
  open_count: number;
  campaign_id: string | null;
  campaign_name: string | null;
  replied: boolean;
  bounced: boolean;
};

/**
 * Gmail-style "N skipped messages" row — a thread with more than a handful
 * of messages doesn't render every one collapsed in a row (which is what
 * this view used to do); it shows the first message, hides the middle run
 * behind this divider, and shows the last two. Clicking expands that run in
 * place, each still collapsed like any older message. Purely a count of how
 * many rows are hidden, not a preview — Gmail's own divider carries no
 * content either, since anything meaningful there would defeat hiding it.
 */
function ThreadMiddleDivider({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="group flex w-full items-center gap-3 px-4 py-1.5 md:px-6"
      aria-label={`Show ${count} earlier ${count === 1 ? "message" : "messages"}`}
    >
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[11px] font-medium text-[var(--color-text-faint)] transition-colors group-hover:border-[var(--color-copper)] group-hover:text-[var(--color-copper)]">
        {count}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </button>
  );
}

/**
 * Gmail's "Show details" popover — the row of from/reply-to/to/cc/date/
 * subject/mailed-by/signed-by you get from the caret next to "to me". Mailed-
 * by/signed-by are the Return-Path and DKIM-Signature domains respectively
 * (see lib/gmail-inbox.ts's getThreadMessages) — Gmail computes them the same
 * way, which is why they can differ from the From address (e.g. a marketing
 * platform sending "on behalf of" a brand, or a relay like amazonses.com).
 */
/**
 * Rendered via a portal to document.body, positioned with `position: fixed`
 * from the trigger button's own measured rect — not CSS `position: absolute`
 * nested under the trigger. The message body directly below it can be an
 * `<iframe>` (see EmailHtmlBody) for HTML mail, and iframes get their own
 * compositing layer in every major browser: they can paint over a
 * same-stacking-context absolutely-positioned sibling regardless of z-index,
 * a well-known cross-browser quirk rather than anything specific to this
 * layout. A portal sidesteps it categorically by not being a descendant of
 * anything that could stack under the iframe in the first place — the same
 * reasoning as this file's other portal-based overlays (the fullscreen
 * reader below, EmailThreadPreviewModal).
 *
 * Closes on scroll rather than re-tracking position while scrolling — this
 * is meant for a quick glance at headers, not something kept open while
 * scrolling past it.
 */
function MessageDetailsPopover({
  m,
  anchorRect,
  triggerEl,
  onDismiss,
  onClose,
}: {
  m: MsgView;
  anchorRect: { top: number; left: number; bottom: number };
  /** Excluded from "outside" — the trigger button's own onClick handles its own toggle. */
  triggerEl: HTMLElement | null;
  /** A deliberate click away from the whole trigger+popover — also collapses the message. */
  onDismiss: () => void;
  /** Anchor invalidated by scroll/resize — just close, no collapse; the user didn't ask to be done with the message. */
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (triggerEl?.contains(target)) return;
      onDismiss();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onDismiss, triggerEl]);

  useEffect(() => {
    // capture:true so this catches scroll on the thread pane's own
    // overflow-y-auto container, not just window-level scroll — "scroll"
    // doesn't bubble, but a capturing listener on an ancestor still sees it.
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const recipientParts = formatMessageRecipientsLine(m);
  const toFull = recipientParts.find((p) => p.label === "to")?.title;
  const ccFull = recipientParts.find((p) => p.label === "cc")?.title;

  const rows: { label: string; value: string; bold?: boolean }[] = [
    { label: "from", value: formatFromHeader(m.from || ""), bold: true },
    ...(m.replyTo ? [{ label: "reply-to", value: formatFromHeader(m.replyTo) }] : []),
    { label: "to", value: toFull || "—" },
    ...(ccFull ? [{ label: "cc", value: ccFull }] : []),
    { label: "date", value: formatDate(m.date) },
    { label: "subject", value: m.subject || "(no subject)" },
    ...(m.mailedBy ? [{ label: "mailed-by", value: m.mailedBy }] : []),
    ...(m.signedBy ? [{ label: "signed-by", value: m.signedBy }] : []),
  ];

  const POPOVER_WIDTH = 360;
  const left = Math.min(anchorRect.left, Math.max(8, window.innerWidth - POPOVER_WIDTH - 8));

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={titleCase("Message details")}
      onClick={(e) => e.stopPropagation()}
      // cursor-text overrides the cursor-pointer the trigger button sits
      // under in the collapsible header — this panel is read-only, selectable
      // metadata, not another click target, so it shouldn't show a hand
      // cursor over the whole thing.
      style={{ position: "fixed", top: anchorRect.bottom + 4, left }}
      className="z-[200] w-[360px] max-w-[92vw] cursor-text rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3.5 text-[13px] shadow-[0_4px_16px_rgba(60,64,67,0.28)]"
    >
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-2.5">
            {/* w-[68px] was too narrow for "signed-by:"/"reply-to:" (10 chars) —
                it wrapped to two lines, and the right-aligned second line
                ("by:") rendered outside the card's own bottom edge instead of
                pushing the box taller. whitespace-nowrap makes wrapping
                impossible rather than just less likely at a wider guess. */}
            <dt className="w-[80px] shrink-0 whitespace-nowrap text-right text-[var(--color-text-faint)]">
              {r.label}:
            </dt>
            <dd
              className={cn(
                "min-w-0 flex-1 break-words text-[var(--color-text)]",
                r.bold && "font-semibold"
              )}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>,
    document.body
  );
}

/* ── Collapsible message bubble ──────────────────────────────
 * Defined outside the page so useState is a valid hook call.
 * All older messages (not last) start collapsed; the last is open.
 * Clicking the header row toggles collapse either direction — clicking
 * inside the body (links, attachments, the details caret) must not, so
 * those all stop propagation before it reaches the header's handler.
 * ────────────────────────────────────────────────────────── */
function MessageBubble({
  m,
  isLast,
  trackingRow,
  myEmail,
  onReply,
  onReplyAll,
  onForward,
}: {
  m: MsgView;
  isLast: boolean;
  trackingRow: TrackingRow | undefined;
  myEmail: string;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
}) {
  // The campaign chip deep-links into the Campaigns report; hide it when that
  // module is off rather than offering a link that redirects away.
  const campaignsEnabled = useModuleVisibility().isVisible("campaigns");
  const [expanded, setExpanded] = useState(isLast);
  const [fullscreen, setFullscreen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Measured from the trigger button when it's clicked open — the popover is
  // portal-rendered and `position: fixed`, so it needs real viewport
  // coordinates rather than a CSS-relative ancestor. See MessageDetailsPopover.
  const [detailsAnchor, setDetailsAnchor] = useState<{ top: number; left: number; bottom: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasThreadActions = Boolean(onReply && onReplyAll && onForward);

  const runThreadAction = (fn?: () => void) => {
    setFullscreen(false);
    fn?.();
  };

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);
  const isCollapsed = !expanded;
  const fromEmail = extractEmailAddress(m.from || "").trim().toLowerCase();
  const fromName = senderName(m.from || "");

  const bodyContent = (
    <>
      <CalendarInviteOrHtml
        subject={m.subject}
        bodyHtml={m.bodyHtml}
        plain={m.body}
        messageId={m.id}
        attachments={m.attachments}
      />
      {(() => {
        const files = (m.attachments ?? []).filter(
          (a) =>
            !/invite\.ics$/i.test(a.filename) &&
            !/^text\/calendar/i.test(a.mimeType) &&
            !isInlinePartReferencedInHtml(m.bodyHtml, a.contentId, a.filename)
        );
        if (files.length === 0) return null;
        return (
          <div className="mt-4">
            <GmailAttachmentPreviews attachments={files} messageId={m.id} />
          </div>
        );
      })()}
    </>
  );

  // A <span>, not a <p> — this now also renders inside the "show details"
  // <button> below, whose content model (phrasing content) a <p> doesn't fit;
  // `block` keeps its own-line layout wherever it's used standalone.
  const recipientLine = (
    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--color-text-faint)]">
      {(() => {
        const parts = formatMessageRecipientsLine(m);
        if (parts.length === 0) return <>{titleCase("to")} —</>;
        return parts.map((part, i) => (
          <span key={part.label} className={i > 0 ? "ml-1" : undefined} title={part.title || undefined}>
            {i > 0 ? "· " : null}
            <span className="text-[var(--color-text-faint)]">{part.label}</span>{" "}
            <span>{part.value}</span>
          </span>
        ));
      })()}
    </span>
  );

  return (
    <>
      <article className="border-b border-[var(--color-border)]">
        {/* Always-visible header — clicking it toggles collapse either way
            (Gmail lets you re-collapse an open message the same way you
            opened it); interactive children below stop propagation so
            clicking them doesn't also toggle it.
            While the details popover is open, this must collapse rather than
            toggle: a click on the header (outside the trigger+popover, but
            still inside this div) is exactly the natural "click away to
            dismiss the popover" gesture, and it fires alongside — not instead
            of — the popover's own outside-click handler. A toggle here would read the
            still-true detailsOpen from this render's closure and flip
            `expanded` straight back to true right after that handler set it
            false, silently undoing the collapse. */}
        <div
          className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-[var(--color-surface-offset)] md:px-6"
          onClick={() => {
            if (detailsOpen) {
              setDetailsOpen(false);
              setExpanded(false);
            } else {
              setExpanded((v) => !v);
            }
          }}
        >
          <GmailAvatar seed={fromEmail || fromName} name={fromName} email={fromEmail || undefined} size={36} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">
                {formatFromHeader(m.from || "")}
              </p>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                {trackingRow && !isSelfSentEmail(m.from, m.to, m.cc, myEmail) && (
                  trackingRow.bounced ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-danger)]"
                      title="Delivery failed"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {titleCase("Bounced")}
                    </span>
                  ) : trackingRow.opened ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]"
                      title={`Opened ${trackingRow.open_count}x`}
                    >
                      <IconEye className="h-3 w-3" />
                      Opened{trackingRow.open_count > 1 ? ` ${trackingRow.open_count}x` : ""} · {timeAgo(trackingRow.opened_at ?? "")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                      <IconCheck className="h-3 w-3" />
                      {titleCase("Sent")}
                    </span>
                  )
                )}
                {trackingRow?.replied && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-light)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]"
                    title="They replied in this thread"
                  >
                    <Reply className="h-3 w-3" />
                    {titleCase("Replied")}
                  </span>
                )}
                {trackingRow?.campaign_id && campaignsEnabled && (
                  <Link
                    href={`/campaigns/${encodeURIComponent(trackingRow.campaign_id)}`}
                    onClick={(e) => e.stopPropagation()}
                    title={`Part of campaign: ${trackingRow.campaign_name ?? "Untitled campaign"} — view full report`}
                    className="inline-flex max-w-[140px] items-center gap-1 rounded-full bg-[var(--color-copper-tint)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-copper)] hover:underline"
                  >
                    <Megaphone className="h-3 w-3 shrink-0" />
                    <span className="truncate">{trackingRow.campaign_name || "Campaign"}</span>
                  </Link>
                )}
                <time className="whitespace-nowrap text-[12px] text-[var(--color-text-faint)]">
                  {formatDate(m.date)}
                </time>
                {/* Fullscreen button — only visible when expanded */}
                {!isCollapsed && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFullscreen(true); }}
                    className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                    title="Full screen"
                    aria-label="View in full screen"
                  >
                    <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
            {/* Collapsed: snippet; Expanded: to/cc, with a "show details" caret */}
            {isCollapsed ? (
              <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-faint)]">
                {previewLineFromBody(m.body) || "(no preview)"}
              </p>
            ) : (
              <div>
                <button
                  ref={triggerRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (detailsOpen) {
                      setDetailsOpen(false);
                      return;
                    }
                    const rect = triggerRef.current?.getBoundingClientRect();
                    if (rect) {
                      setDetailsAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
                    }
                    setDetailsOpen(true);
                  }}
                  aria-label={titleCase("Show details")}
                  aria-expanded={detailsOpen}
                  className="-ml-1 inline-flex items-center gap-0.5 rounded px-1 hover:bg-[var(--color-border)]/60"
                >
                  {recipientLine}
                  <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" />
                </button>
                {detailsOpen && detailsAnchor && (
                  <MessageDetailsPopover
                    m={m}
                    anchorRect={detailsAnchor}
                    triggerEl={triggerRef.current}
                    onDismiss={() => {
                      setDetailsOpen(false);
                      setExpanded(false);
                    }}
                    onClose={() => setDetailsOpen(false)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Body — inline */}
        {!isCollapsed && (
          <div className="px-4 pb-4 md:px-6">
            <div className="max-w-[720px]">
              {bodyContent}
            </div>
          </div>
        )}
      </article>

      {/* Fullscreen overlay — rendered via portal so it escapes the reading pane */}
      {fullscreen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-white animate-fade-in"
          style={{ animationDuration: "0.15s" }}
        >
          {/* Fullscreen header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
            <GmailAvatar seed={fromEmail || fromName} name={fromName} email={fromEmail || undefined} size={32} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">
                {formatFromHeader(m.from || "")}
              </p>
              {recipientLine}
            </div>
            <time className="shrink-0 text-[12px] text-[var(--color-text-faint)]">
              {formatDate(m.date)}
            </time>
            {hasThreadActions ? (
              <ThreadActionsMenu
                className="ml-1"
                onReply={() => runThreadAction(onReply)}
                onReplyAll={() => runThreadAction(onReplyAll)}
                onForward={() => runThreadAction(onForward)}
              />
            ) : null}
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
              aria-label="Exit full screen"
            >
              <XIcon className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          {/* Fullscreen body — scrollable */}
          <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-5 md:px-12 md:py-8">
            <div className="mx-auto max-w-[860px]">
              <h2 className="mb-4 text-[18px] font-semibold text-[var(--color-text)]">
                {m.subject || "(no subject)"}
              </h2>
              {bodyContent}
            </div>
          </div>
          {hasThreadActions ? (
            <GmailInlineReply
              onStartReply={() => runThreadAction(onReply)}
              onStartReplyAll={() => runThreadAction(onReplyAll)}
              onForward={() => runThreadAction(onForward)}
            />
          ) : null}
        </div>,
        document.body
      )}
    </>
  );
}

const STORAGE_SIDEBAR_W = "placecom-inbox-sidebar-w";
const STORAGE_LIST_W = "placecom-inbox-list-w";

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  const n = parseInt(localStorage.getItem(key) ?? "", 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Width a collapsed pane keeps so the handle stays reachable. */
const COLLAPSED_PANE_W = 10;

/**
 * Vertical drag handle between resizable mail panes, modelled on Trello's:
 * a grip pill centred on the divider, a thin accent line on hover/drag,
 * double-click to reset the width, and (for collapsible panes) a click on the
 * grip to collapse or expand. The grip is the only click target; the rest of
 * the strip only drags.
 *
 * `className` positions the 12px-wide hit area; the grip and line centre
 * themselves inside it.
 */
function PaneResizeHandle({
  onMouseDown,
  onDoubleClick,
  collapsed,
  collapsible,
  className = "absolute right-0 top-0 h-full",
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  collapsed?: boolean;
  collapsible?: boolean;
  className?: string;
}) {
  const gripTitle = collapsible
    ? collapsed
      ? "Click to expand · drag to resize"
      : "Click to collapse · drag to resize · double-click to reset"
    : "Drag to resize · double-click to reset";
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize pane"
      data-pane-handle
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      className={cn("group z-20 w-3 cursor-col-resize touch-none", className)}
    >
      {/* Divider line — appears on hover and while dragging. */}
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-[var(--color-copper)]/60 group-active:bg-[var(--color-copper)]" />
      {/* Grip pill with two grooves */}
      <span
        data-pane-grip
        title={gripTitle}
        className="absolute left-1/2 top-1/2 flex h-11 w-[10px] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-[2px] rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-[0_1px_4px_rgba(0,0,0,0.18)] transition-all duration-150 group-hover:scale-110 group-hover:border-[var(--color-copper)] group-hover:bg-[var(--color-copper)] group-active:border-[var(--color-copper)] group-active:bg-[var(--color-copper)]"
      >
        <span className="h-4 w-px rounded-full bg-[var(--color-text-faint)] transition-colors group-hover:bg-white group-active:bg-white" />
        <span className="h-4 w-px rounded-full bg-[var(--color-text-faint)] transition-colors group-hover:bg-white group-active:bg-white" />
      </span>
    </div>
  );
}

function useResizablePane(
  storageKey: string,
  defaultWidth: number,
  min: number,
  max: number,
  opts?: { collapsible?: boolean }
) {
  const collapsible = opts?.collapsible ?? false;
  const collapsedKey = `${storageKey}-collapsed`;
  const [width, setWidth] = useState(defaultWidth);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setWidth(readStoredWidth(storageKey, defaultWidth, min, max));
    if (collapsible) {
      try {
        setCollapsed(localStorage.getItem(collapsedKey) === "1");
      } catch {
        /* storage unavailable — stay expanded */
      }
    }
  }, [storageKey, collapsedKey, collapsible, defaultWidth, min, max]);

  const persistCollapsed = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        localStorage.setItem(collapsedKey, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [collapsedKey]
  );

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = collapsed ? 0 : width;
      const startedOnGrip = Boolean((e.target as HTMLElement).closest("[data-pane-grip]"));
      // Dragging narrower than this collapses the pane instead of clamping at min.
      const collapseAt = min * 0.6;
      let moved = false;
      let nextCollapsed = collapsed;
      let nextWidth = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function compute(ev: MouseEvent) {
        const raw = startW + ev.clientX - startX;
        if (collapsible && raw < collapseAt) {
          nextCollapsed = true;
        } else {
          nextCollapsed = false;
          nextWidth = Math.min(max, Math.max(min, raw));
        }
      }
      function onMove(ev: MouseEvent) {
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        if (!moved) return;
        compute(ev);
        setCollapsed(nextCollapsed);
        if (!nextCollapsed) setWidth(nextWidth);
      }
      function onUp() {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (!moved) {
          // A plain click on the grip toggles collapse; elsewhere it does nothing.
          if (collapsible && startedOnGrip) persistCollapsed(!collapsed);
          return;
        }
        if (collapsible) persistCollapsed(nextCollapsed);
        if (!nextCollapsed) {
          try {
            localStorage.setItem(storageKey, String(nextWidth));
          } catch {
            /* ignore */
          }
        }
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, collapsed, collapsible, storageKey, min, max, persistCollapsed]
  );

  /** Double-click on the handle: back to the default width, expanded. */
  const reset = useCallback(() => {
    setWidth(defaultWidth);
    if (collapsible) persistCollapsed(false);
    try {
      localStorage.setItem(storageKey, String(defaultWidth));
    } catch {
      /* ignore */
    }
  }, [defaultWidth, collapsible, persistCollapsed, storageKey]);

  return { width, collapsed, onResizeStart, reset };
}

type InboxCategoryKey = "primary" | "promotions" | "social" | "updates" | "forums";

const INBOX_CATEGORY_LABEL: Record<InboxCategoryKey, string> = {
  primary: "CATEGORY_PERSONAL",
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

export default function InboxPage() {
  // Recruiter suggestions in the composer come from the Extraction module.
  const extractionEnabled = useModuleVisibility().isVisible("dashboard");
  // Saved templates are a /configs module of their own, with no page to hide —
  // this flag is the only thing standing between the operator's switch and the
  // Templates button in the composer footer.
  const templatesEnabled = useModuleVisibility().isVisible("mailTemplates");
  const allowDelete = useAllowDelete();
  const topbarActionsNode = useWorkspaceTopbarActionsNode();
  const [folder, setFolder] = useState<Folder>("inbox");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // stable ref so the observer doesn't re-subscribe on every render
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const [loadingList, setLoadingList] = useState(true);
  /** Gmail-style top bar while manually refreshing an already-visible list. */
  const [listRefreshing, setListRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [mailSearchInput, setMailSearchInput] = useState("");
  const [mailSearch, setMailSearch] = useState("");
  /** Suggest dropdown open — defer debounced list search until Enter (Gmail-style). */
  const [mailSearchSuggesting, setMailSearchSuggesting] = useState(false);
  const searchHighlight = useMemo(
    () => (mailSearch.trim() ? searchHighlightTerms(mailSearch) : []),
    [mailSearch],
  );

  // Advanced search filter panel state — mirrors Gmail's "Show search options".
  // When the user clicks Search, we translate these fields to Gmail operator
  // syntax and stuff the result into mailSearchInput, so the regular search
  // pipeline handles the rest. Visible / editable in the input bar afterwards.
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileFolderMenuOpen, setMobileFolderMenuOpen] = useState(false);
  const mobileFolderMenuRef = useRef<HTMLDivElement>(null);
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
  const [filterDateAnchor, setFilterDateAnchor] = useState("");
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
      parts.push(...buildExclusionTokens(filterDoesntHave));
    }
    if (filterHasAttachment) parts.push("has:attachment");
    parts.push(...buildDateSearchClauses(filterDateWithin, filterDateAnchor));
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

  /** Clear advanced-search form fields only. */
  const clearFilter = useCallback(() => {
    setFilterFrom("");
    setFilterTo("");
    setFilterSubject("");
    setFilterHasWords("");
    setFilterDoesntHave("");
    setFilterHasAttachment(false);
    setFilterDateWithin("");
    setFilterDateAnchor("");
  }, []);

  const applyFilterFields = useCallback((fields: GmailFilterFields) => {
    setFilterFrom(fields.from);
    setFilterTo(fields.to);
    setFilterSubject(fields.subject);
    setFilterHasWords(fields.hasWords);
    setFilterDoesntHave(fields.doesntHave);
    setFilterHasAttachment(fields.hasAttachment);
    setFilterDateWithin(fields.dateWithin);
    setFilterDateAnchor(fields.dateAnchor);
  }, []);

  /** Mirror the active search bar query into advanced-search fields (Gmail UI). */
  const syncFilterFromQuery = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) {
        clearFilter();
        return;
      }
      applyFilterFields(parseGmailQueryToFilterFields(q));
    },
    [applyFilterFields, clearFilter],
  );

  const handleFilterOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        syncFilterFromQuery(mailSearchInput.trim() || mailSearch.trim());
      }
      setFilterOpen(open);
    },
    [mailSearchInput, mailSearch, syncFilterFromQuery],
  );

  const handleMailSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      setMailSearch(q);
      syncFilterFromQuery(q);
    },
    [syncFilterFromQuery],
  );

  /** Exit search mode: clear bar, results query, and advanced-filter form. */
  const resetMailSearch = useCallback(() => {
    setMailSearchInput("");
    setMailSearch("");
    clearFilter();
    setFilterOpen(false);
  }, [clearFilter]);

  const prefetchBodiesForRows = useCallback(
    (rows: ThreadRow[], opts?: { forceRefresh?: boolean; append?: boolean }) => {
      const ids = threadIdsForPrefetch(rows);
      if (!ids.length || MAIL_THREAD_PREFETCH_DISABLED) return;
      void prefetchMailThreadBodies(ids, {
        // Left to prefetchMailThreadBodies' own cap — passing 12 here was what
        // overrode it and put a folder switch's whole first screen in flight.
        forceRefresh: opts?.forceRefresh,
        append: opts?.append,
        landing: true,
      });
    },
    []
  );

  const warmBodiesFromListCacheKey = useCallback(
    (cacheKey: string, opts?: { forceRefresh?: boolean }) => {
      const cached = listCacheRef.current.get(cacheKey);
      if (!cached?.threads.length) return;
      prefetchBodiesForRows(cached.threads, opts);
    },
    [prefetchBodiesForRows]
  );

  /** Start list + body warm for a folder/tab on pointer-down (before click). */
  const primeListView = useCallback(
    (apiFolder: string, labelId: string | null) => {
      const cacheKey = buildMailListCacheKey(apiFolder, labelId, "");
      warmBodiesFromListCacheKey(cacheKey);
      void prefetchMailListViewIfMissing(apiFolder, labelId).then((snap) => {
        if (snap?.threads.length) prefetchBodiesForRows(snap.threads);
      });
    },
    [warmBodiesFromListCacheKey, prefetchBodiesForRows]
  );

  const switchMailFolder = useCallback(
    (key: Folder) => {
      const view = listViewForFolder(key);
      primeListView(view.apiFolder, view.labelId);
      setFolder(key);
      setFilterLabelId(null);
      setSelectedId(null);
      setMessages(null);
      resetMailSearch();
      setMobileFolderMenuOpen(false);
    },
    [resetMailSearch, primeListView]
  );

  useEffect(() => {
    if (!mobileFolderMenuOpen) return;
    function onDown(e: PointerEvent) {
      if (mobileFolderMenuRef.current && !mobileFolderMenuRef.current.contains(e.target as Node)) {
        setMobileFolderMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [mobileFolderMenuOpen]);

  // Opening advanced search with no active query — do not show a stale form.
  useEffect(() => {
    if (filterOpen && !mailSearch.trim() && !mailSearchInput.trim()) {
      clearFilter();
    }
  }, [filterOpen, mailSearch, mailSearchInput, clearFilter]);

  // Search bar cleared (✕ or deleted text) — reset the advanced form too.
  useEffect(() => {
    if (!mailSearch.trim() && !mailSearchInput.trim()) {
      clearFilter();
    }
  }, [mailSearch, mailSearchInput, clearFilter]);

  // Labels — loaded once, kept in a map by id for O(1) lookup from rows.
  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  // Sidebar label search: the rail lists the first SIDEBAR_LABEL_LIMIT labels;
  // typing here searches every user label.
  const [labelSearch, setLabelSearch] = useState("");
  const labelsById = useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of allLabels) m.set(l.id, l);
    return m;
  }, [allLabels]);
  const labelColorMap = useMemo(
    () => buildLabelColorMap(allLabels.filter((l) => l.type === "user")),
    [allLabels]
  );
  // Optional filter — restricts the thread list to a single user label
  // (intersected with the folder).
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);

  // Inbox category sub-tabs (Primary / Promotions / Social / Updates / Forums).
  // Each maps to a CATEGORY_* system label; the API filters INBOX rows to
  // those carrying the chosen category. Only shown when folder = inbox.
  const [category, setCategory] = useState<InboxCategoryKey>("primary");

  const switchCategory = useCallback(
    (key: InboxCategoryKey) => {
      const labelId = INBOX_CATEGORY_LABEL[key];
      const cacheKey = buildMailListCacheKey("inbox", labelId, "");
      activeListCacheKeyRef.current = cacheKey;
      const cached = listCacheRef.current.get(cacheKey);
      if (cached?.threads.length) {
        setThreads(cached.threads);
        setNextPageToken(cached.nextPageToken);
        setLoadingList(false);
        prefetchBodiesForRows(cached.threads);
      } else {
        setLoadingList(true);
        void prefetchMailListViewIfMissing("inbox", labelId).then((snap) => {
          if (!snap?.threads.length) return;
          if (activeListCacheKeyRef.current !== cacheKey) return;
          setThreads(snap.threads);
          setNextPageToken(snap.nextPageToken);
          setLoadingList(false);
          prefetchBodiesForRows(snap.threads);
        });
      }
      setCategory(key);
    },
    [prefetchBodiesForRows]
  );

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
          : filterLabelId ?? (folder === "inbox" ? INBOX_CATEGORY_LABEL[category] : null);

  // Multi-select state (Gmail-style row checkboxes).
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const allSelected =
    threads.length > 0 && threads.every((t) => selectedThreadIds.has(t.id));
  // Per-row action busy state (for the optimistic star toggle / row-quick-actions).
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  // Bulk label selection — tracks the union of label IDs on selected threads
  // so the LabelPicker checkboxes show the right initial state.
  const [bulkLabelSelected, setBulkLabelSelected] = useState<Set<string>>(new Set());

  // bulkBusy removed — actions are fire-and-forget with instant optimistic UI

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Whether the "N skipped messages" divider (see ThreadMiddleDivider) has
  // been clicked open for the currently-open thread. Reset per-thread below —
  // otherwise opening a long thread, expanding its middle run, then opening a
  // different long thread would show that one already expanded too.
  const [middleExpanded, setMiddleExpanded] = useState(false);
  useEffect(() => {
    setMiddleExpanded(false);
  }, [selectedId]);
  const [messages, setMessages] = useState<MsgView[] | null>(null);
  const [threadLabelIds, setThreadLabelIds] = useState<string[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  // Left-rail "Create label" inline form state
  const [newLabelInput, setNewLabelInput] = useState("");
  const [showNewLabelForm, setShowNewLabelForm] = useState(false);
  const newLabelInputRef = useRef<HTMLInputElement>(null);

  type ComposeKind = "new" | "forward" | "reply" | "replyAll";

  // Restore a minimized compose that survived route navigation.
  // getComposePersistedState() is a non-destructive read; the sync effect below
  // writes `null` once React state has taken over, which also keeps a short
  // grace cache so a StrictMode double-mount restores correctly.
  // Captured once via useState lazy init so takeExpandComposeOnReturn only
  // fires on the very first mount, not on every render.
  const [_restoredCompose] = useState<ComposePersistedState | null>(() =>
    typeof window !== "undefined" ? readComposePersistedStateForRestore() : null
  );
  const [_restoredExpand] = useState<boolean>(() =>
    typeof window !== "undefined" ? takeExpandComposeOnReturn() : false
  );

  const [composeKind, setComposeKind] = useState<ComposeKind>(
    (_restoredCompose?.kind as ComposeKind | undefined) ?? "new"
  );
  const [composeThreadId, setComposeThreadId] = useState<string | null>(
    _restoredCompose?.threadId ?? null
  );
  const [composeInReplyToId, setComposeInReplyToId] = useState<string | null>(
    _restoredCompose?.inReplyToId ?? null
  );

  // The current user's own Gmail address — used to exclude self from Reply All
  const [myEmail, setMyEmail] = useState("");

  // Gmail-style send snackbar — shows "Message sent" immediately on click,
  // stays visible while the API call runs in the background, then shows
  // success or error. On error the user can retry (re-opens compose).
  type SendSnackState =
    // `message` overrides the default copy — a mass send reports a count
    // ("Sent to 12 recipients") where a single send just says "Message sent".
    | { phase: "sending"; message?: string }
    | { phase: "sent"; message?: string }
    // Retry is optional: a partially-delivered campaign can't be safely
    // replayed wholesale, so it reports the outcome without offering one.
    | { phase: "error"; message: string; retry?: () => void };
  const [sendSnack, setSendSnack] = useState<SendSnackState | null>(null);
  const sendSnackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Blocking pre-send problem, heading and all. Held together rather than as a
   * bare string so the dialog can name the specific problem instead of saying
   * "Error" over every one of them.
   */
  const [composeFieldError, setComposeFieldError] = useState<
    { title: string; message: string } | null
  >(null);

  /** Show the snackbar and auto-dismiss it after `ms` milliseconds. */
  const showSendSnack = useCallback((state: SendSnackState, autoDismissMs?: number) => {
    if (sendSnackTimerRef.current) clearTimeout(sendSnackTimerRef.current);
    setSendSnack(state);
    if (autoDismissMs) {
      sendSnackTimerRef.current = setTimeout(() => setSendSnack(null), autoDismissMs);
    }
  }, []);

  const [composeOpen, setComposeOpen] = useState(_restoredCompose !== null);
  const [composeTo, setComposeTo] = useState(_restoredCompose?.to ?? "");
  const [composeCc, setComposeCc] = useState(_restoredCompose?.cc ?? "");
  const [composeBcc, setComposeBcc] = useState(_restoredCompose?.bcc ?? "");
  const [composeSubject, setComposeSubject] = useState(_restoredCompose?.subject ?? "");
  const [composeBody, setComposeBody] = useState(_restoredCompose?.body ?? "");
  const [composeFiles, setComposeFiles] = useState<PendingFile[]>([]);
  /**
   * Bumped whenever the draft's files are cleared (sent, discarded, closed, a
   * new compose). Work that finishes later — a template's attachments being
   * copied in the background — checks it so a file never lands in the next
   * draft instead of the one it was meant for.
   */
  const composeFilesGenRef = useRef(0);
  /**
   * Gmail labels picked in compose's label menu. Applied to the message once
   * it is sent (single or every copy of a mass send); cleared with the draft.
   */
  const [composeLabelIds, setComposeLabelIds] = useState<string[]>([]);
  const resetComposeFiles = useCallback(() => {
    composeFilesGenRef.current += 1;
    setComposeFiles([]);
    // Labels belong to the draft being cleared, like its files.
    setComposeLabelIds([]);
  }, []);
  /** File name → 0–100 while a large attachment uploads (Drive or staged). */
  const [driveUploadProgress, setDriveUploadProgress] = useState<Record<string, number>>({});
  const [uploadProgressKind, setUploadProgressKind] = useState<
    Record<string, AttachmentUploadKind>
  >({});
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(_restoredCompose?.ccBccOpen ?? false);
  // Restore as minimized if coming back from another tab, unless the user
  // explicitly clicked "Expand" in the WorkspaceChrome bar (_restoredExpand).
  const [composeMinimized, setComposeMinimized] = useState(
    _restoredCompose !== null && !_restoredExpand
  );
  const [composeFullscreen, setComposeFullscreen] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(_restoredCompose?.draftId ?? null);

  // ── Mass sending ────────────────────────────────────────────────────────
  // One personalised copy per recipient, addressed individually (never a
  // shared To/Cc list), with {variables} resolved from each contact's card.
  const [massSending, setMassSending] = useState(false);
  const [massRecipients, setMassRecipients] = useState<MassRecipient[]>([]);
  /**
   * Which of the two audiences is live. They are mutually exclusive by
   * design: hand-picked contacts merge from their directory/mailbox cards,
   * imported rows merge from spreadsheet columns, and the two variable sets
   * have nothing in common — so a mixed list would leave one half of the
   * campaign with placeholders that can never resolve.
   */
  const [massSource, setMassSource] = useState<MassSource>("contacts");
  const [massImport, setMassImport] = useState<
    | (MassImport & {
        rows: MailMergeRow[];
      })
    | null
  >(null);
  const massImportRef = useRef(massImport);
  massImportRef.current = massImport;
  const [massImportBusy, setMassImportBusy] = useState(false);
  const [massImportError, setMassImportError] = useState<string | null>(null);
  /** Pending mass-sending toggle awaiting confirmation; null when none. */
  const [massToggleConfirm, setMassToggleConfirm] = useState<MassToggleDirection | null>(null);
  /** Email currently shown on the review screen; null means "still editing". */
  const [reviewEmail, setReviewEmail] = useState<string | null>(null);
  /**
   * Campaign-wide default per variable key, set from the review screen's
   * warning banner. Applies to every recipient missing that field, not just
   * the one being previewed — typing it per person for a 50-name list would
   * be unusable.
   */
  const [variableFallbacks, setVariableFallbacks] = useState<Record<string, string>>({});
  /**
   * Every address typed into To. Drives the single-recipient merge, so it is
   * derived here rather than inside the send path — the `{` picker and the
   * review gate both need to know how many people the draft is going to before
   * anything is sent.
   */
  const composeToEmails = useMemo(() => extractAllEmailsFromText(composeTo), [composeTo]);

  /**
   * Whether the draft uses a placeholder a contact card can fill. Gates the
   * single-recipient merge and the contact lookups that feed it.
   *
   * Strict on purpose (templateUsesKnownVariables, not templateUsesVariables):
   * an ordinary mail containing "{TBD}" or a pasted code snippet must not be
   * treated as a merge draft and held behind the review gate.
   */
  const draftUsesVariables = useMemo(
    () => templateUsesKnownVariables(composeSubject, composeBody),
    [composeSubject, composeBody]
  );

  const { contacts: directoryContacts } = useDirectoryContacts();
  /**
   * Fetched for a campaign audience, and for a normal compose only once the
   * draft actually uses a variable — most single mails never do, and the sync
   * is a large payload to pull for a menu nobody opened. An imported list
   * merges from its own columns, so the sync is dead weight there.
   */
  const { contacts: syncedContacts } = useSyncedContacts(
    massSending ? massSource === "contacts" : draftUsesVariables
  );

  /**
   * The campaign audience, whichever source produced it. Imported rows are
   * deduplicated on email so nobody in a spreadsheet with repeat rows gets the
   * same mail twice; the first row wins, matching the contacts picker.
   */
  const massAudience = useMemo<MassRecipient[]>(() => {
    if (massSource === "contacts") return massRecipients;
    const seen = new Set<string>();
    const out: MassRecipient[] = [];
    for (const row of massImport?.rows ?? []) {
      const email = row.email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: row.fields.name?.trim() || "" });
    }
    return out;
  }, [massSource, massRecipients, massImport]);

  /**
   * Variables the `{` picker offers. Imported columns replace the contact-card
   * set rather than joining it — {job_title} on a spreadsheet recipient has
   * nothing behind it, so offering it would only produce empty merges.
   */
  const massVariables = useMemo<ComposeVariable[]>(
    () => (massSource === "contacts" ? COMPOSE_VARIABLES : massImport?.variables ?? []),
    [massSource, massImport]
  );

  /**
   * Placeholders the audience can't fill. Before a file is chosen there are no
   * columns to judge against, so every `{token}` is tinted — they are written
   * for the file about to arrive. Once it has, a token matching no column is
   * flagged: it would go out as literal braces.
   */
  const unknownPlaceholders: UnknownPlaceholderMode =
    massSending && massSource === "import" ? (massImport ? "flag" : "tint") : "ignore";

  /**
   * Placeholders in an imported-list draft that match none of its columns.
   * Without a fallback they go out as literal braces, so the review screen
   * offers one for each — the same chip a blank cell gets, applied to every
   * recipient since no row has a value to prefer.
   */
  const draftUnknownKeys = useMemo(
    () =>
      massSending && massSource === "import" && massImport
        ? reportMissingVariables(composeSubject, composeBody, [], massVariables).unknownKeys
        : [],
    [massSending, massSource, massImport, composeSubject, composeBody, massVariables]
  );

  /**
   * What the editor tints and offers. A not-a-column placeholder that has been
   * given a fallback will be filled, so it stops showing red and joins the
   * picker — the red tint means "this will be sent as typed".
   */
  const editorVariables = useMemo<ComposeVariable[]>(() => {
    if (!massSending) return COMPOSE_VARIABLES;
    const covered = draftUnknownKeys
      .filter((k) => variableFallbacks[k]?.trim())
      .map((k) => ({ key: k, label: k, hint: "Fallback value, same for every recipient" }));
    return covered.length ? [...massVariables, ...covered] : massVariables;
  }, [massSending, massVariables, draftUnknownKeys, variableFallbacks]);

  /**
   * Whether the draft uses a placeholder the *live audience* can fill — the
   * review gate. Differs from draftUsesVariables only for an imported list,
   * whose vocabulary is its own columns rather than the contact-card set.
   */
  const draftUsesMergeVariables = useMemo(
    () =>
      massSending
        ? // A not-a-column placeholder also needs the review screen — it is
          // the only place its fallback can be set.
          templateUsesKnownVariables(composeSubject, composeBody, massVariables) ||
          draftUnknownKeys.length > 0
        : draftUsesVariables,
    [massSending, composeSubject, composeBody, massVariables, draftUsesVariables, draftUnknownKeys]
  );

  /**
   * Email → ISO date of the newest thread exchanged with them, fetched only
   * for the campaign audience and only when the draft actually uses
   * {last_mail_interaction}. This is the same Gmail search the contact's
   * Emails tab runs, so the merged date is the one a user would see there.
   * Addresses already looked up (including those with no mail, stored as "")
   * are never re-requested.
   */
  const [lastMailByEmail, setLastMailByEmail] = useState<Record<string, string>>({});
  const lastMailFetchingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const used = new Set([
      ...listPlaceholdersInTemplate(composeSubject),
      ...listPlaceholdersInTemplate(composeBody),
    ]);
    if (!used.has("last_mail_interaction")) return;

    // Imported rows merge from their own columns, so there is no contact to
    // look mail up for. A normal compose looks up its one recipient — with two
    // or more there is no single person to merge against anyway.
    const targets = massSending
      ? massSource === "contacts"
        ? massAudience.map((r) => r.email)
        : []
      : composeToEmails.length === 1
        ? composeToEmails
        : [];

    const wanted = targets
      .map((e) => e.toLowerCase())
      .filter((e) => !(e in lastMailByEmail) && !lastMailFetchingRef.current.has(e));
    if (wanted.length === 0) return;

    for (const e of wanted) lastMailFetchingRef.current.add(e);
    void (async () => {
      try {
        const res = await fetch("/api/gmail/last-mail-interaction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emails: wanted }),
        });
        const data = (await res.json()) as { dates?: Record<string, string> };
        if (!res.ok) return;
        setLastMailByEmail((prev) => {
          const next = { ...prev };
          // Record the misses as "" too — an address with no mail history is a
          // settled answer, not a reason to ask Gmail again on every keystroke.
          for (const e of wanted) next[e] = data.dates?.[e] ?? "";
          return next;
        });
      } catch {
        // Leave them unrecorded so the next edit retries.
      } finally {
        for (const e of wanted) lastMailFetchingRef.current.delete(e);
      }
    })();
  }, [
    massSending,
    massSource,
    massAudience,
    composeToEmails,
    composeSubject,
    composeBody,
    lastMailByEmail,
  ]);

  // The rail owns the audience while mass sending is on; the To field is a
  // read-only mirror of it. Kept in sync here so the draft that gets autosaved
  // still carries the recipient list.
  useEffect(() => {
    if (!massSending) return;
    setComposeTo(massAudience.map((r) => r.email).join(", "));
  }, [massSending, massAudience]);

  /**
   * Drop the imported list and everything written against it.
   *
   * The draft goes too: a subject/body written for a spreadsheet is full of
   * `{column}` tokens that resolve to nothing once the file is gone, so
   * keeping the text would only leave literal braces in a later send.
   */
  const clearMassImport = useCallback(() => {
    setMassImport(null);
    setMassImportError(null);
    setReviewEmail(null);
    setVariableFallbacks({});
    setComposeSubject("");
    setComposeBody("");
  }, []);

  /**
   * Wipe every trace of a campaign. Compose fields are not touched here —
   * their owners (the close-reset effect, closeMassCompose) clear those.
   */
  const resetMassState = useCallback(() => {
    setMassSending(false);
    setMassRecipients([]);
    setMassSource("contacts");
    setMassImport(null);
    setMassImportError(null);
    setMassImportBusy(false);
    setMassToggleConfirm(null);
    setReviewEmail(null);
    setVariableFallbacks({});
  }, []);

  /**
   * Flip mass sending, discarding whatever the other mode owns. Callers are
   * expected to have confirmed first — see the toggle handler on the compose
   * dialog, which routes anything destructive through a dialog.
   */
  const applyMassSending = useCallback((on: boolean) => {
    setMassSending(on);
    setReviewEmail(null);
    setMassToggleConfirm(null);
    if (on) {
      // Anyone already typed into To becomes the starting audience — the
      // draft is being converted, not restarted, so losing the addresses the
      // user just entered would be the wrong reading of "convert".
      setMassRecipients((prev) => {
        if (prev.length > 0) return prev;
        return extractAllEmailsFromText(composeStateRef.current.to).map((email) => ({
          email,
          name: "",
        }));
      });
      // A campaign addresses each recipient individually and ignores Cc/Bcc;
      // leaving stale ones in the hidden fields would let the autosaved draft
      // carry recipients the send never uses.
      setComposeCc("");
      setComposeBcc("");
      setComposeCcBccOpen(false);
    } else {
      setMassRecipients([]);
      setMassSource("contacts");
      setMassImport(null);
      setMassImportError(null);
      // Campaign-wide defaults were typed against that audience's variable set,
      // which an imported list does not share with a contact card.
      setVariableFallbacks({});
      // The To field is only a mirror of the rail while mass sending is on,
      // and the effect that maintains it stops here — so it has to be cleared
      // explicitly, or the audience survives as a plain address list.
      setComposeTo("");
      // The subject and body are kept, imported campaign or not: what the user
      // typed is theirs, and in ordinary compose a leftover `{column}` token is
      // just prose (unknownPlaceholders is "ignore" there), so nothing is
      // stranded without a source.
    }
  }, []);

  /**
   * Pull a saved template into the open draft.
   *
   * "append" puts the template after what is already written rather than at the
   * caret: the editor's caret is owned by RichTextEditor and the menu steals
   * focus to open, so "where the cursor was" is not reliably recoverable here —
   * and quietly inserting in the wrong place is worse than always inserting at
   * the end, which is at least predictable.
   */
  /**
   * Copy one stored template file into compose's attachment staging, in the
   * background. It shows as an "Uploading attachment…" row where the draft's
   * attachments live, and Send / draft save wait for it like any upload.
   */
  const stageTemplateAttachment = useCallback(
    async (templateId: string, attachment: MailTemplateAttachment) => {
      const key = attachment.filename;
      const gen = composeFilesGenRef.current;
      setUploadProgressKind((prev) => ({ ...prev, [key]: "copy" }));
      // The copy happens server-side, so there are no bytes to count: creep
      // toward 90% on a timer and finish on the response.
      const stopCreep = creepProgress((percent) =>
        setDriveUploadProgress((prev) => ({ ...prev, [key]: Math.round(percent) }))
      );

      try {
        const res = await fetch(`/api/mail-templates/${templateId}/attachments/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attachmentIds: [attachment.id] }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          files?: PendingFile[];
          error?: string;
        };
        if (!res.ok || !data.files) {
          throw new Error(data.error || "the copy failed");
        }
        // The draft was sent, discarded or replaced while this ran.
        if (composeFilesGenRef.current !== gen) return;
        const added = data.files;
        setComposeFiles((prev) => [...prev, ...added]);
      } catch (e) {
        if (composeFilesGenRef.current !== gen) return;
        setComposeFieldError({
          title: "Attachment not added",
          message: `"${attachment.filename}" from the template couldn't be attached (${
            e instanceof Error ? e.message : "network error"
          }). Attach it again with the paperclip.`,
        });
      } finally {
        stopCreep();
        setDriveUploadProgress((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setUploadProgressKind((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    []
  );

  const applyMailTemplate = useCallback(
    (template: MailTemplate, mode: TemplateApplyMode) => {
      // Text goes in at once and the modal closes; the template's files follow
      // in the compose window's own attachment area rather than holding the
      // modal open on a spinner.
      if (mode === "replace") {
        // A template saved from a reply has no subject of its own. "Replace"
        // then means replace the body — clearing a subject the user typed on
        // the strength of a template that never had one would be a loss, not a
        // replacement.
        setComposeSubject((prev) =>
          template.subjectTemplate.trim() ? template.subjectTemplate : prev
        );
        setComposeBody(template.bodyHtml);
      } else {
        // Appending must not silently drop the template's subject when the
        // draft has none — but it must not overwrite one the user typed either.
        setComposeSubject((prev) => (prev.trim() ? prev : template.subjectTemplate));
        setComposeBody((prev) =>
          richTextIsEmpty(prev) ? template.bodyHtml : `${prev}<br>${template.bodyHtml}`
        );
      }

      if (template.attachments.length === 0) return;
      const inDraft = new Set(
        composeFiles.map((f) => `${pendingFileName(f)}:${pendingFileSize(f)}`)
      );
      // Using the same template twice shouldn't attach its files twice.
      const adding = template.attachments.filter(
        (a) => !inDraft.has(`${a.filename}:${a.sizeBytes}`)
      );

      // Drive-linked files are only links — nothing to copy, so they appear now.
      const links: PendingFile[] = adding.flatMap((a) =>
        a.driveFileId && a.webViewLink
          ? [
              {
                kind: "drive" as const,
                name: a.filename,
                mimeType: a.mimeType,
                size: a.sizeBytes,
                driveFileId: a.driveFileId,
                webViewLink: a.webViewLink,
              },
            ]
          : []
      );
      if (links.length > 0) setComposeFiles((prev) => [...prev, ...links]);

      const toCopy = adding.filter((a) => !a.driveFileId);
      if (toCopy.length === 0) return;
      // "Use" stays off for this template until every file has landed (or
      // failed), so a second click can't attach the same files twice.
      const done = markTemplateCopy(template.id);
      void Promise.allSettled(toCopy.map((a) => stageTemplateAttachment(template.id, a))).then(
        done
      );
    },
    [composeFiles, stageTemplateAttachment]
  );

  /**
   * Shared tail of every mass-import path (file or Google Sheet): validates the
   * parser response and swaps it in as the campaign audience. Throws with a
   * user-facing message on failure.
   */
  const applyParsedImport = useCallback(
    (
      res: Response,
      data: {
        error?: string;
        headersFound?: string;
        detectedHeaders?: string[];
        headerLabels?: string[];
        columns?: string[];
        rows?: MailMergeRow[];
        skipped?: number;
        truncated?: boolean;
        maxRows?: number;
        fileName?: string;
        tabs?: string[];
        tab?: string;
      },
      opts: { fileName: string; sheetId?: string; keepFallbacks?: boolean }
    ) => {
      if (!res.ok) {
        const headers = data.headersFound || data.detectedHeaders?.join(", ");
        throw new Error(
          (data.error || "Import failed") + (headers ? ` Headers found: ${headers}.` : "")
        );
      }
      const rows = data.rows ?? [];
      if (rows.length === 0) throw new Error("No rows with a valid email address in that file.");

      const headerLabels = data.headerLabels ?? data.detectedHeaders ?? [];
      const columns = data.columns ?? [];
      // A refresh of the same sheet keeps its typed fallbacks only if the
      // columns didn't change underneath them.
      const prev = massImportRef.current;
      const sameColumns =
        !!opts.keepFallbacks &&
        !!prev &&
        prev.variables.map((v) => v.key).join("|") === columns.join("|");
      if (!sameColumns) setVariableFallbacks({});
      setMassImport({
        fileName: opts.fileName,
        rows,
        count: rows.length,
        skipped: data.skipped,
        truncated: data.truncated,
        maxRows: data.maxRows,
        variables: columnsToComposeVariables(columns, headerLabels),
        ...(opts.sheetId && data.tab && data.tabs
          ? { sheet: { id: opts.sheetId, tab: data.tab, tabs: data.tabs } }
          : {}),
      });
      // Rows may have changed, so the review screen must be re-entered.
      setReviewEmail(null);
    },
    []
  );

  /**
   * Parse a CSV/Excel file into merge rows. Reuses the broadcast mail-merge
   * parser endpoint — same header detection, email-column resolution and row
   * cap, so an import behaves identically in both places.
   */
  const importMassFile = useCallback(
    async (file: File) => {
      setMassImportBusy(true);
      setMassImportError(null);
      try {
        const fd = new FormData();
        fd.set("file", file);
        const res = await fetch("/api/broadcast/parse-mail-merge", { method: "POST", body: fd });
        const data = await res.json();
        applyParsedImport(res, data, { fileName: file.name });
      } catch (e) {
        setMassImportError(e instanceof Error ? e.message : "Import failed");
      } finally {
        setMassImportBusy(false);
      }
    },
    [applyParsedImport]
  );

  /**
   * Read a tab of an existing Google Sheet into merge rows. A snapshot, like a
   * file import — "Refresh" in the panel simply calls this again for the same
   * sheet and tab. Fallbacks survive a refresh when the columns are unchanged.
   */
  const importMassSheet = useCallback(
    async (sheet: { id: string; name: string }, tab?: string) => {
      setMassImportBusy(true);
      setMassImportError(null);
      try {
        const res = await fetch("/api/broadcast/parse-mail-merge-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spreadsheetId: sheet.id, tab }),
        });
        const data = await res.json().catch(() => ({}));
        applyParsedImport(res, data, {
          fileName: data.fileName || sheet.name,
          sheetId: sheet.id,
          keepFallbacks: true,
        });
      } catch (e) {
        setMassImportError(e instanceof Error ? e.message : "Could not read that sheet");
      } finally {
        setMassImportBusy(false);
      }
    },
    [applyParsedImport]
  );

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
  // Ignores in-flight thread fetches when the user opens another thread first.
  const activeThreadLoadRef = useRef<string | null>(null);
  // Same prefetch cache for draft rows — mirrors prefetchCache but keyed by draftId.
  const draftPrefetchCache = useRef<Map<string, Promise<Response>>>(new Map());

  // Session-scoped SWR cache for thread lists. Keyed by the same params that
  // determine which threads are shown, so switching tabs/folders/labels can
  // paint instantly from memory while a fresh fetch runs in the background.
  // Cleared on the Refresh button click; pruned by mutation paths when the
  // affected entries become stale.
  const listCacheRef = useRef(getMailListSessionCache());
  const listPrefetchBoostRef = useRef(false);
  /** Which folder/label/search view the UI is showing — stale fetches must not overwrite. */
  const activeListCacheKeyRef = useRef<string | null>(null);
  const listFetchAbortRef = useRef<AbortController | null>(null);
  /** Bumps on each non-append fetch so aborted/superseded loads cannot clear the spinner. */
  const listLoadGenRef = useRef(0);
  const countsInFlightRef = useRef(false);
  const countsRescheduleRef = useRef(false);
  const countRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** Patch every cached list view without touching the rendered list (label bucket sync). */
  const patchAllThreadCaches = useCallback(
    (transform: (rows: ThreadRow[]) => ThreadRow[]) => {
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
  /**
   * `sentFiles` is the file list (fingerprinted) the save sent. Gmail's copy
   * only replaces the local list if the user hasn't touched it since: a file
   * removed while the save was in flight would otherwise come straight back
   * from Gmail, and be marked as saved so nothing ever dropped it again. When
   * the list has moved on, it is left alone and the next autosave rewrites the
   * Gmail draft to match it.
   */
  const syncComposeFilesFromDraft = useCallback(async (draftId: string, sentFiles: string[]) => {
    const res = await fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(draftId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { attachments?: DraftApiAttachment[] };
    const current = composeStateRef.current;
    // Another draft is open now (this one was sent, discarded or closed), or
    // the user added/removed a file meanwhile — Gmail's list is stale for it.
    if (current.draftId !== draftId) return;
    if (
      JSON.stringify(current.files.map(pendingFileFingerprint)) !== JSON.stringify(sentFiles)
    ) {
      return;
    }
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

    const uploadsInFlight = Object.keys(driveUploadProgress).length > 0;
    if (s.files.some((f) => f.kind === "staged") && uploadsInFlight) {
      setDraftSaveStatus("idle");
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

      const attachmentPayloadSent =
        stagedUploadIds.length > 0 || attachments.length > 0;
      if (preserveAttachments) {
        draftLastSavedRef.current = snapshot;
      } else if (draftId && attachmentPayloadSent) {
        await syncComposeFilesFromDraft(draftId, fileFingerprints);
      } else {
        draftLastSavedRef.current = snapshot;
      }

      markDraftSaved();
      const wasNewDraft = !s.draftId && !!data.draftId;
      onDraftCountChangeRef.current(wasNewDraft);
      if (draftId && preserveAttachments) {
        void syncComposeFilesFromDraft(draftId, fileFingerprints).catch(() => {});
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
  }, [
    syncComposeFilesFromDraft,
    composeHasDraftableContent,
    markDraftSaved,
    markDraftSaveError,
    driveUploadProgress,
  ]);

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
      setComposeKind("new");
      setComposeThreadId(null);
      setComposeInReplyToId(null);
      setComposeTo("");
      setComposeCc("");
      setComposeBcc("");
      setComposeSubject("");
      setComposeBody("");
      resetComposeFiles();
      // Mass state lives outside the compose fields, so discarding or closing
      // the window would otherwise leave the campaign standing — and the To
      // mirror would refill the "cleared" field from it on reopen.
      resetMassState();
      draftLastSavedRef.current = "";
      clearDraftSaveStatusTimer();
      setDraftSaveStatus("idle");
      return;
    }
    if (composeCc.trim() || composeBcc.trim()) {
      setComposeCcBccOpen(true);
    }
  }, [composeOpen, composeCc, composeBcc, clearDraftSaveStatusTimer, resetMassState, resetComposeFiles]);

  // Auto-open compose when navigated here with ?composeTo=email (e.g. from Google Contacts).
  // Must be registered AFTER the reset effect above so this runs last and wins.
  const searchParams = useSearchParams();
  useEffect(() => {
    const to = searchParams.get("composeTo");
    if (!to) return;
    setComposeKind("new");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo(to);
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    resetComposeFiles();
    setComposeDraftId(null);
    setComposeCcBccOpen(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

  /**
   * Search pool for the mass-send rail, ordered by how much merge data each
   * source carries: Team Directory (all five variables), then mailbox-synced
   * people (name / company / last interaction), then the plain Gmail
   * suggestions the To field uses (name only).
   */
  const massSuggestions = useMemo((): RecipientSuggestion[] => {
    const seen = new Set<string>();
    const out: RecipientSuggestion[] = [];

    const push = (email: string, displayName?: string) => {
      const key = email.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ email: key, displayName: displayName?.trim() || undefined });
    };

    for (const c of directoryContacts) push(c.email ?? "", c.name);
    for (const s of syncedContacts) push(s.email, s.display_name ?? undefined);
    for (const s of composeRecipientSuggestions) push(s.email, s.displayName);

    return out;
  }, [directoryContacts, syncedContacts, composeRecipientSuggestions]);

  /** Full merge data — badged "Directory" in the rail. */
  const directoryEmails = useMemo(() => {
    const set = new Set<string>();
    for (const c of directoryContacts) {
      const e = (c.email ?? "").trim().toLowerCase();
      if (e) set.add(e);
    }
    return set;
  }, [directoryContacts]);

  /** Partial merge data (no title/phone) — badged "Synced" in the rail. */
  const syncedEmails = useMemo(() => {
    const set = new Set<string>();
    for (const s of syncedContacts) {
      const e = s.email?.trim().toLowerCase();
      if (e) set.add(e);
    }
    return set;
  }, [syncedContacts]);

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

  /**
   * Attach picked files. Every file uploads with a progress row in the
   * attachment area — the same row sequences and templates show — and its chip
   * appears the moment it lands, not when the whole batch has finished. Up to
   * Gmail's 25 MB a file is staged as an attachment; past that it goes to Drive
   * and is sent as a link (sendsAsDriveLink, shared with templates and
   * sequences). Send and draft save wait while any row is showing.
   */
  async function handleFileSelect(files: FileList | null) {
    if (!files) return;
    const picked = Array.from(files);
    const gen = composeFilesGenRef.current;

    // Every row appears at once, queued at 0%, so a batch shows what's coming.
    setUploadProgressKind((prev) => ({
      ...prev,
      ...Object.fromEntries(
        picked.map((f) => [f.name, sendsAsDriveLink(f.size) ? "drive" : "attachment"])
      ),
    }));
    setDriveUploadProgress((prev) => ({
      ...prev,
      ...Object.fromEntries(picked.map((f) => [f.name, 0])),
    }));

    for (const file of picked) {
      const onProgress = (percent: number) =>
        setDriveUploadProgress((prev) => ({ ...prev, [file.name]: percent }));
      try {
        let added: PendingFile;
        if (!sendsAsDriveLink(file.size)) {
          const staged = await uploadStagedDraftAttachment(file, onProgress);
          added = {
            kind: "staged",
            uploadId: staged.uploadId,
            name: staged.name,
            mimeType: staged.mimeType,
            size: staged.size,
          };
        } else {
          // Over Gmail's 25 MB — upload to Drive in 4 MB chunks via our API
          // (the browser cannot PUT to googleapis.com directly due to CORS).
          const driveFile = await uploadLargeFileToDrive(file, onProgress);
          added = {
            kind: "drive",
            name: driveFile.name,
            mimeType: driveFile.mimeType,
            size: driveFile.size ? parseInt(driveFile.size, 10) : file.size,
            driveFileId: driveFile.id,
            webViewLink: driveFile.webViewLink,
          };
        }
        // The draft was sent, discarded or replaced while this uploaded.
        if (composeFilesGenRef.current === gen) {
          setComposeFiles((prev) => [...prev, added]);
        }
      } catch (e) {
        if (composeFilesGenRef.current === gen) {
          setComposeFieldError({
            title: "Attachment not added",
            message: `"${file.name}" couldn't be ${
              sendsAsDriveLink(file.size) ? "uploaded to Drive" : "uploaded"
            } (${e instanceof Error ? e.message : "network error"}). Please try again.`,
          });
        }
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


  useEffect(() => {
    const trimmed = mailSearchInput.trim();
    if (!trimmed) {
      setMailSearch("");
      return;
    }
    if (mailSearchSuggesting) return;
    const t = setTimeout(() => setMailSearch(trimmed), 400);
    return () => clearTimeout(t);
  }, [mailSearchInput, mailSearchSuggesting]);

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
    async (opts: {
      append: boolean;
      pageToken?: string;
      forceRefresh?: boolean;
      indicateRefresh?: boolean;
    }) => {
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
      const params = new URLSearchParams({ folder: apiFolder, maxResults: mailSearch ? "100" : "25" });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (mailSearch) params.set("search", mailSearch);
      // When a search query is active, drop the category/label filter so results
      // match all mail — exactly like Gmail's own search bar behaviour.
      if (effectiveLabelId && !mailSearch) params.set("labelId", effectiveLabelId);

      const cacheKey = buildMailListCacheKey(apiFolder, effectiveLabelId, mailSearch);
      const isActiveListView = () => activeListCacheKeyRef.current === cacheKey;

      // Track whether the list is already visible (cached) BEFORE the fetch
      // so we know whether to preserve scroll when fresh data arrives.
      let listWasVisible = false;

      let loadGen = listLoadGenRef.current;
      if (!opts.append) {
        loadGen = ++listLoadGenRef.current;
        activeListCacheKeyRef.current = cacheKey;
        listFetchAbortRef.current?.abort();
        listFetchAbortRef.current = new AbortController();
      }

      const fetchSignal = listFetchAbortRef.current?.signal;

      if (opts.append) {
        setLoadingMore(true); loadingMoreRef.current = true;
      } else {
        if (opts.indicateRefresh) setListRefreshing(true);
        setListError(null);
        // SWR: paint cached rows instantly on tab-switch (never an empty placeholder).
        const cached = !opts.forceRefresh ? listCacheRef.current.get(cacheKey) : undefined;
        const hasCachedRows = Boolean(cached?.threads.length);
        if (hasCachedRows && cached) {
          setThreads(cached.threads);
          setNextPageToken(cached.nextPageToken);
          bumpHistoryAnchorFromThreads(latestHistoryIdRef, cached.threads);
          setLoadingList(false);
          listWasVisible = true;
          void prefetchBodiesForRows(cached.threads, {
            forceRefresh: opts.forceRefresh,
          });
          const sinceMutation = Date.now() - lastMutationAtRef.current;
          if (!opts.forceRefresh && sinceMutation < MUTATION_COOLDOWN_MS) {
            return;
          }
        } else if (opts.forceRefresh) {
          listWasVisible = true;
        } else {
          setLoadingList(true);
        }
      }

      try {
        const fetchStartedAt = Date.now();
        const res = await fetch(`/api/gmail/threads?${params.toString()}`, {
          cache: "no-store",
          signal: fetchSignal,
        });
        const data = (await res.json()) as { error?: string; threads?: ThreadRow[]; nextPageToken?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load inbox");
        const incoming = data.threads || [];

        // User switched tabs while this request was in flight — discard result.
        if (!isActiveListView()) return;

        bumpHistoryAnchorFromThreads(latestHistoryIdRef, incoming);

        if (opts.append) {
          setThreads((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const uniqueIncoming = incoming.filter((t) => !seen.has(t.id));
            const merged = [...prev, ...uniqueIncoming];
            // Keep the cache snapshot in sync with the merged list so coming
            // back to this view after infinite-scrolling still feels instant.
            setMailListCache(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
            prefetchBodiesForRows(uniqueIncoming, { append: true });
            return merged;
          });
        } else {
          // Don't clobber optimistic label/star/read state if the user mutated
          // while this fetch was in-flight (unless this is an explicit refresh).
          if (!opts.forceRefresh && lastMutationAtRef.current > fetchStartedAt) {
            return;
          }
          // Background SWR / forceRefresh: the user already sees the list and
          // may have scrolled. Snapshot scrollTop BEFORE React re-renders with
          // fresh data, then restore it immediately after so the view doesn't jump.
          const scrollBefore = listWasVisible ? (listScrollRef.current?.scrollTop ?? 0) : 0;
          setThreads(incoming);
          setMailListCache(cacheKey, { threads: incoming, nextPageToken: data.nextPageToken });
          prefetchBodiesForRows(incoming, { forceRefresh: opts.forceRefresh });
          if (scrollBefore > 0) {
            requestAnimationFrame(() => {
              if (listScrollRef.current) {
                listScrollRef.current.scrollTop = scrollBefore;
              }
            });
          }
        }
        if (isActiveListView()) {
          setNextPageToken(data.nextPageToken);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        if (!opts.append && isActiveListView() && loadGen === listLoadGenRef.current) {
          const hasRows = listCacheRef.current.get(cacheKey)?.threads.length;
          if (!hasRows) {
            setListError(e instanceof Error ? e.message : "Failed to load");
            setThreads([]);
          }
        }
      } finally {
        if (opts.indicateRefresh) setListRefreshing(false);
        const stillCurrent =
          !opts.append &&
          loadGen === listLoadGenRef.current &&
          !fetchSignal?.aborted;
        if (opts.append) {
          if (isActiveListView()) {
            setLoadingMore(false);
            loadingMoreRef.current = false;
          }
        } else if (isActiveListView() && stillCurrent) {
          setLoadingList(false);
        }
      }
    },
    [folder, mailSearch, effectiveLabelId, prefetchBodiesForRows]
  );

  // useLayoutEffect so cached folder/tab content paints before the browser
  // draws — avoids one frame of the previous folder when switching fast.
  useLayoutEffect(() => {
    void loadThreads({ append: false });
  }, [loadThreads]);

  // Prefetch thread bodies as soon as the user lands on a folder/tab (from list cache).
  useLayoutEffect(() => {
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
    const cacheKey = buildMailListCacheKey(apiFolder, effectiveLabelId, mailSearch);
    const cached = listCacheRef.current.get(cacheKey);
    if (cached?.threads.length) {
      prefetchBodiesForRows(cached.threads);
    }
  }, [folder, category, effectiveLabelId, mailSearch, prefetchBodiesForRows]);

  // Warm list + body caches on first visit only — after F5 use sessionStorage instead.
  //
  // Body warming goes through prefetchMailBodiesForWarmedCategories rather
  // than firing prefetchMailThreadBodies per spec here: that helper pools
  // every warmed folder/category into ONE shared, low-concurrency worker set
  // (and guards against overlapping runs), whereas calling
  // prefetchMailThreadBodies independently per spec stacks each spec's own
  // (much higher) default concurrency on top of the others with nothing
  // coordinating the total — easily dozens of simultaneous
  // threads.get(format=full) calls, which is exactly what was blowing past
  // Gmail's per-user "units per minute" quota on inbox load.
  useEffect(() => {
    if (isPrefetchPausedAfterBrowserReload()) return;

    void prefetchMailListViews({ concurrency: 4 }).then(() => {
      if (MAIL_THREAD_PREFETCH_DISABLED) return;
      void prefetchMailBodiesForWarmedCategories();
    });
  }, []);

  // Warm bodies when the visible list changes (current folder/tab only).
  useEffect(() => {
    if (loadingList || !threads.length || selectedId) return;
    prefetchBodiesForRows(threads);
  }, [threads, loadingList, selectedId, prefetchBodiesForRows, folder, category, effectiveLabelId]);

  // Bridge module/session body cache into the per-page open cache for instant paint.
  useEffect(() => {
    for (const t of threads) {
      if (t.draftId) continue;
      const mod = getCachedThread(t.id);
      if (!mod) continue;
      const payload: ThreadCacheData = {
        messages: mod.messages as MsgView[],
        labelIds: mod.labelIds.filter((id) => id !== "UNREAD"),
      };
      const resolved = Promise.resolve(payload);
      const prefetchKey = `prefetch:${t.id}`;
      const openKey = `open:${t.id}`;
      if (!threadDataCache.current.has(prefetchKey)) {
        threadDataCache.current.set(prefetchKey, resolved);
      }
      if (!threadDataCache.current.has(openKey)) {
        threadDataCache.current.set(openKey, resolved);
      }
    }
  }, [threads]);

  // After the active view loads, warm remaining views + bulk bodies when allowed.
  useEffect(() => {
    if (loadingList || listPrefetchBoostRef.current) return;
    listPrefetchBoostRef.current = true;
    const skip = new Set<string>();
    if (activeListCacheKeyRef.current) skip.add(activeListCacheKeyRef.current);
    void startMailListAndBodyPrefetchWarm({ skipKeys: skip, listConcurrency: 4, bodyConcurrency: 2 });
    return () => {
      listPrefetchBoostRef.current = false;
    };
  }, [loadingList]);

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

  /** Unread per user label from loaded thread rows (fills gaps when Gmail counts lag). */
  const derivedUserLabelUnread = useMemo(() => {
    const byLabel = new Map<string, Set<string>>();
    for (const t of threads) {
      if (!t.unread) continue;
      for (const id of t.labelIds ?? []) {
        if (!byLabel.has(id)) byLabel.set(id, new Set());
        byLabel.get(id)!.add(t.id);
      }
    }
    const out: Record<string, number> = {};
    byLabel.forEach((ids, id) => {
      out[id] = ids.size;
    });
    return out;
  }, [threads]);

  const sidebarLabelUnread = useCallback(
    (labelId: string) => {
      const stored = labelCounts[labelId]?.unread ?? 0;
      const derived = derivedUserLabelUnread[labelId] ?? 0;
      const inCooldown =
        Date.now() - lastMutationAtRef.current < MUTATION_COOLDOWN_MS;
      // During cooldown, loaded rows are ahead of stale count API — cap badge down.
      if (inCooldown && derived < stored) return derived;
      return Math.max(stored, derived);
    },
    [labelCounts, derivedUserLabelUnread]
  );

  /** Instant Inbox unread badge — persisted for the tab session so folder switches don't reset. */
  const adjustInboxUnread = useCallback((delta: number) => {
    if (delta === 0) return;
    lastMutationAtRef.current = Date.now();
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

  /** Optimistic unread badge on user-label chips in the left rail. */
  const adjustUserLabelUnread = useCallback((labelIds: Iterable<string>, delta: number) => {
    if (delta === 0) return;
    lastMutationAtRef.current = Date.now();
    setLabelCounts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Array.from(labelIds)) {
        if (!id) continue;
        const cur = next[id] ?? { total: 0, unread: 0 };
        const unread = Math.max(0, cur.unread + delta);
        if (unread !== cur.unread) {
          next[id] = { ...cur, unread };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const setUserLabelCount = useCallback(
    (labelId: string, patch: { total?: number; unread?: number }) => {
      lastMutationAtRef.current = Date.now();
      setLabelCounts((prev) => {
        const cur = prev[labelId] ?? { total: 0, unread: 0 };
        return {
          ...prev,
          [labelId]: {
            total: patch.total ?? cur.total,
            unread: patch.unread ?? cur.unread,
          },
        };
      });
    },
    []
  );

  const {
    width: sidebarWidth,
    collapsed: sidebarCollapsed,
    onResizeStart: onSidebarResizeStart,
    reset: resetSidebarWidth,
  } = useResizablePane(STORAGE_SIDEBAR_W, 256, 180, 400, { collapsible: true });
  const {
    width: listPaneWidth,
    onResizeStart: onListPaneResizeStart,
    reset: resetListPaneWidth,
  } = useResizablePane(
    STORAGE_LIST_W,
    420,
    280,
    720
  );

  const loadCounts = useCallback(async () => {
    if (countsInFlightRef.current) {
      countsRescheduleRef.current = true;
      return;
    }
    countsInFlightRef.current = true;
    countsRescheduleRef.current = false;

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
    const fetchStartedAt = Date.now();
    try {
      const res = await fetch(
        `/api/gmail/folder-counts?ids=${encodeURIComponent(ids.join(","))}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      // Drop responses from before recent read/label mutations finished.
      if (lastMutationAtRef.current > fetchStartedAt) return;
      const j = (await res.json()) as { counts?: Record<string, { total: number; unread: number }> };
      const incoming = j.counts ?? {};
      setLabelCounts((prev) => {
        const inCooldown =
          Date.now() - lastMutationAtRef.current < MUTATION_COOLDOWN_MS;
        const merged: Record<string, { total: number; unread: number }> = { ...incoming };
        for (const l of allLabels) {
          if (l.type !== "user") continue;
          const inc = incoming[l.id];
          const previous = prev[l.id];
          const serverUnread = inc?.unread ?? previous?.unread ?? 0;
          if (inCooldown && previous) {
            // Optimistic reads win over stale high counts from in-flight API calls.
            merged[l.id] = {
              total: Math.max(inc?.total ?? 0, previous.total),
              unread: Math.min(serverUnread, previous.unread),
            };
          } else if (inc) {
            merged[l.id] = { total: inc.total, unread: inc.unread };
          } else if (previous) {
            merged[l.id] = previous;
          }
        }
        if (!incoming.INBOX) return merged;
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
          return { ...merged, INBOX: { ...incoming.INBOX, unread } };
        }
        return { ...merged, INBOX: { ...incoming.INBOX, unread: mergedUnread } };
      });
    } catch { /* ignore */ }
    finally {
      countsInFlightRef.current = false;
      if (countsRescheduleRef.current) {
        countsRescheduleRef.current = false;
        void loadCounts();
      }
    }
  }, [allLabels]);

  useEffect(() => {
    onDraftCountChangeRef.current = (wasNew) => {
      if (wasNew) adjustDraftCount(1);
      void loadCounts();
    };
  }, [adjustDraftCount, loadCounts]);

  /**
   * Sync sidebar counts with Gmail after a mutation. Optimistic UI updates
   * badges immediately; one delayed fetch catches Gmail's ~1–3 s count lag.
   */
  const scheduleCountRefresh = useCallback(() => {
    if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current);
    countRefreshTimerRef.current = setTimeout(() => {
      countRefreshTimerRef.current = null;
      void loadCounts();
    }, 1500);
  }, [loadCounts]);

  useEffect(() => {
    return () => {
      if (countRefreshTimerRef.current) clearTimeout(countRefreshTimerRef.current);
    };
  }, []);

  const warmMailListCachesAfterRefresh = useCallback(() => {
    const skip = new Set<string>();
    if (activeListCacheKeyRef.current) skip.add(activeListCacheKeyRef.current);
    startMailListAndBodyPrefetchWarm({
      skipKeys: skip,
      listConcurrency: 3,
      bodyConcurrency: 2,
      force: true,
    });
  }, []);

  const handleMailListRefresh = useCallback(async () => {
    clearMailListSessionCache();
    clearMailThreadPrefetchCache();
    await loadThreads({ append: false, forceRefresh: true, indicateRefresh: true });
    scheduleCountRefresh();
    warmMailListCachesAfterRefresh();
  }, [loadThreads, scheduleCountRefresh, warmMailListCachesAfterRefresh]);

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
        .then(async (res) => {
          // The old handler treated any response as success — a 4xx/5xx left
          // the draft on the server while the count said otherwise.
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error || "Could not delete draft");
          }
          if (folder === "drafts") void loadThreads({ append: false });
          scheduleCountRefresh();
          showSendSnack({ phase: "sent", message: "Draft deleted" }, 3000);
        })
        .catch((e) => {
          adjustDraftCount(1);
          showSendSnack({
            phase: "error",
            message: e instanceof Error ? e.message : "Could not delete draft",
          });
        });
    }
  }, [folder, scheduleCountRefresh, loadThreads, adjustDraftCount, showSendSnack]);

  useEffect(() => { void loadCounts(); }, [loadCounts]);
  // Refresh counts after the list reloads (bulk actions, refresh).
  useEffect(() => { if (!loadingList) void loadCounts(); }, [loadingList, loadCounts]);

  // Stable refs to the latest poll callbacks — keeps the interval below
  // mounted once while always calling the current folder/search closures.
  const pollRef = useRef({ loadCounts, loadThreads });
  useEffect(() => {
    pollRef.current = { loadCounts, loadThreads };
  }, [loadCounts, loadThreads]);

  // History-based live refresh:
  //   1. Bootstrap mailbox historyId from Gmail profile on mount.
  //   2. Every 30 s (and when tab becomes visible) ask History API if anything changed.
  //   3. On change: silently refresh thread list + counts (no spinner).
  useEffect(() => {
    const runHistoryPoll = async () => {
      if (document.hidden) return;

      let since = latestHistoryIdRef.current;
      if (!since) {
        try {
          const boot = await fetch("/api/gmail/history", { cache: "no-store" });
          if (boot.ok) {
            const j = (await boot.json()) as { historyId?: string; latestHistoryId?: string };
            const hid = j.latestHistoryId ?? j.historyId;
            if (hid) latestHistoryIdRef.current = hid;
            since = hid ?? null;
          }
        } catch {
          /* ignore */
        }
        if (!since) {
          void pollRef.current.loadCounts();
          return;
        }
      }

      try {
        const res = await fetch(
          `/api/gmail/history?since=${encodeURIComponent(since)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          hasChanges?: boolean;
          expired?: boolean;
          latestHistoryId?: string;
        };
        if (data.latestHistoryId) {
          latestHistoryIdRef.current = pickHigherHistoryId(
            latestHistoryIdRef.current,
            data.latestHistoryId
          );
        }
        if (data.hasChanges || data.expired) {
          const inMutationCooldown =
            Date.now() - lastMutationAtRef.current < MUTATION_COOLDOWN_MS;
          // Local read/label/archive already updated list + badges optimistically.
          if (!inMutationCooldown) {
            void pollRef.current.loadCounts();
            void pollRef.current.loadThreads({ append: false, forceRefresh: true });
          }
        }
      } catch {
        /* network blip */
      }
    };

    void runHistoryPoll();
    const id = setInterval(() => void runHistoryPoll(), 30_000);
    const onVisible = () => {
      if (!document.hidden) void runHistoryPoll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
      // Recruiter suggestions come from Extraction; skip that half when the
      // module is off so the composer still gets Google contacts.
      extractionEnabled
        ? fetch("/api/recruiters").then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null),
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
  }, [composeOpen, filterOpen, extractionEnabled]);

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

  const threadCacheKey = useCallback(
    (threadId: string, prefetch?: boolean) =>
      prefetch ? `prefetch:${threadId}` : `open:${threadId}`,
    []
  );

  const fetchThreadData = useCallback(
    (threadId: string, opts?: { prefetch?: boolean }): Promise<ThreadCacheData> => {
      const prefetch = opts?.prefetch === true;
      const cacheKey = threadCacheKey(threadId, prefetch);
      const existing = threadDataCache.current.get(cacheKey);
      if (existing) return existing;

      const moduleCached = getCachedThread(threadId);
      if (moduleCached) {
        const data: ThreadCacheData = {
          messages: moduleCached.messages as MsgView[],
          labelIds: moduleCached.labelIds.filter((id) => id !== "UNREAD"),
        };
        const promise = Promise.resolve(data);
        threadDataCache.current.set(cacheKey, promise);
        return promise;
      }

      const url = `/api/gmail/threads/${encodeURIComponent(threadId)}${
        prefetch ? "?prefetch=1" : ""
      }`;
      const promise = fetch(url, { cache: "no-store" }).then(async (res) => {
        const data = (await res.json()) as {
          error?: string;
          messages?: MsgView[];
          labelIds?: string[];
        };
        if (!res.ok) throw new Error(data.error || "Failed to open thread");
        const payload: ThreadCacheData = {
          messages: data.messages || [],
          labelIds: (data.labelIds ?? []).filter((id) => id !== "UNREAD"),
        };
        if (prefetch) rememberPrefetchThread(threadId, payload);
        else rememberOpenThread(threadId, payload);
        return payload;
      });
      threadDataCache.current.set(cacheKey, promise);
      promise.catch(() => {
        threadDataCache.current.delete(cacheKey);
      });
      setTimeout(() => threadDataCache.current.delete(cacheKey), 120_000);
      return promise;
    },
    [threadCacheKey]
  );

  /** Open path: reuse hover prefetch when available; otherwise fetch + mark read. */
  const loadThreadForOpen = useCallback(
    async (threadId: string): Promise<ThreadCacheData> => {
      const openKey = threadCacheKey(threadId, false);
      const cachedOpen = threadDataCache.current.get(openKey);
      if (cachedOpen) return cachedOpen;

      const prefetchKey = threadCacheKey(threadId, true);
      const cachedPrefetch = threadDataCache.current.get(prefetchKey);
      if (cachedPrefetch) {
        threadDataCache.current.set(openKey, cachedPrefetch);
        return cachedPrefetch;
      }

      return fetchThreadData(threadId);
    },
    [fetchThreadData, threadCacheKey]
  );

  const prefetchThread = useCallback(
    (threadId: string) => {
      if (MAIL_THREAD_PREFETCH_DISABLED) return;
      void fetchThreadData(threadId, { prefetch: true });
    },
    [fetchThreadData]
  );

  const invalidateThreadCache = useCallback(
    (threadId: string) => {
      threadDataCache.current.delete(threadCacheKey(threadId, false));
      threadDataCache.current.delete(threadCacheKey(threadId, true));
    },
    [threadCacheKey]
  );

  /** Drop rows that no longer match the active label bucket (sidebar / Starred / Important). */
  const shouldFilterCurrentList = useCallback(() => {
    if (mailSearch.trim()) return false;
    if (folder === "starred" || folder === "important") return true;
    if (filterLabelId) return true;
    return false;
  }, [mailSearch, folder, filterLabelId]);

  const filterRowsForActiveLabelView = useCallback(
    (rows: ThreadRow[]) => {
      if (!shouldFilterCurrentList() || !effectiveLabelId) return rows;
      return rows.filter((r) => threadMatchesLabelView(r, effectiveLabelId));
    },
    [shouldFilterCurrentList, effectiveLabelId]
  );

  /** Cache key for Starred / Important virtual folders (`inbox|STARRED|search`). */
  const virtualLabelBucketCacheKey = useCallback(
    (labelId: string, search: string) => {
      if (labelId === "STARRED" || labelId === "IMPORTANT") {
        return buildMailListCacheKey("inbox", labelId, search);
      }
      return null;
    },
    []
  );

  /** Keep cached label-bucket snapshots in sync when labels are added or removed. */
  const syncLabelBucketCache = useCallback(
    (
      labelId: string,
      threadIds: string[],
      rowsById: Map<string, ThreadRow>,
      action: "add" | "remove",
      search: string
    ) => {
      const bucketKey = virtualLabelBucketCacheKey(labelId, search);

      listCacheRef.current.forEach((entry, cacheKey) => {
        if (listCacheLabelId(cacheKey) !== labelId) return;
        if (action === "remove") {
          const idSet = new Set(threadIds);
          const next = entry.threads.filter((t) => !idSet.has(t.id));
          if (next.length !== entry.threads.length) {
            listCacheRef.current.set(cacheKey, { ...entry, threads: next });
          }
        } else {
          const existing = new Set(entry.threads.map((t) => t.id));
          const toAdd = threadIds
            .map((id) => rowsById.get(id))
            .filter(
              (r): r is ThreadRow =>
                !!r && threadMatchesLabelView(r, labelId) && !existing.has(r.id)
            );
          if (toAdd.length > 0) {
            listCacheRef.current.set(cacheKey, {
              ...entry,
              threads: mergeThreadsByDate(entry.threads, toAdd),
            });
          }
        }
      });

      // Starred/Important may never have been opened — seed cache so the next
      // sidebar click shows the row without waiting on Gmail API propagation.
      if (action === "add" && bucketKey && !listCacheRef.current.has(bucketKey)) {
        const toAdd = threadIds
          .map((id) => rowsById.get(id))
          .filter((r): r is ThreadRow => !!r && threadMatchesLabelView(r, labelId));
        if (toAdd.length > 0) {
          listCacheRef.current.set(bucketKey, {
            threads: mergeThreadsByDate([], toAdd),
            nextPageToken: undefined,
          });
        }
      }

      // Already viewing Starred/Important — paint the updated bucket immediately.
      if (action === "add" && bucketKey && activeListCacheKeyRef.current === bucketKey) {
        const entry = listCacheRef.current.get(bucketKey);
        if (entry) {
          setThreads(entry.threads);
          setNextPageToken(entry.nextPageToken);
        }
      }
    },
    [virtualLabelBucketCacheKey]
  );

  const closeThreadIfMissingFromList = useCallback((rows: ThreadRow[]) => {
    if (selectedId && !rows.some((r) => r.id === selectedId)) {
      activeThreadLoadRef.current = null;
      setSelectedId(null);
      setMessages(null);
      setThreadError(null);
      setThreadLabelIds([]);
    }
  }, [selectedId]);

  /** Optimistic list + label-bucket cache update after a label add/remove. */
  const applyLabelListUpdate = useCallback(
    (
      transform: (rows: ThreadRow[]) => ThreadRow[],
      opts: { labelId: string; added: boolean; threadIds: string[] }
    ) => {
      let updatedRows: ThreadRow[] = [];
      setThreads((prev) => {
        const updated = transform(prev);
        updatedRows = updated;
        const visible = filterRowsForActiveLabelView(updated);
        closeThreadIfMissingFromList(visible);
        return visible;
      });
      // Patch every cached view in-place (preserve order); never apply the
      // active-view filter to other buckets — that was causing list jumps.
      patchAllThreadCaches(transform);

      const rowsById = new Map<string, ThreadRow>();
      for (const id of opts.threadIds) {
        const fromVisible = updatedRows.find((r) => r.id === id);
        if (fromVisible) {
          rowsById.set(id, fromVisible);
          continue;
        }
        for (const entry of Array.from(listCacheRef.current.values())) {
          const hit = entry.threads.find((t: ThreadRow) => t.id === id);
          if (hit) {
            rowsById.set(id, hit);
            break;
          }
        }
      }

      syncLabelBucketCache(
        opts.labelId,
        opts.threadIds,
        rowsById,
        opts.added ? "add" : "remove",
        mailSearch
      );
    },
    [
      filterRowsForActiveLabelView,
      closeThreadIfMissingFromList,
      patchAllThreadCaches,
      syncLabelBucketCache,
      mailSearch,
    ]
  );

  /** LabelPicker checkboxes — thread state + list row (optimistic) stay in sync. */
  const openThreadLabelSelected = useMemo(() => {
    const ids = new Set(threadLabelIds);
    if (selectedId) {
      for (const id of threads.find((t) => t.id === selectedId)?.labelIds ?? []) {
        ids.add(id);
      }
    }
    return ids;
  }, [threadLabelIds, selectedId, threads]);

  /**
   * What actually renders in the open thread pane — Gmail's rule, not "every
   * message gets a row": show the first message, hide any run of messages
   * strictly between it and the last two behind a single count divider
   * (ThreadMiddleDivider), and always show the last two (the very last one
   * expanded, via MessageBubble's own isLast prop). With 3 or fewer messages
   * there's no "middle" to hide, so nothing collapses into a divider.
   */
  const threadRows = useMemo(() => {
    type Row =
      | { kind: "message"; message: MsgView; isLast: boolean }
      | { kind: "divider"; count: number };
    if (!messages) return [] as Row[];
    const n = messages.length;
    if (n <= 3 || middleExpanded) {
      return messages.map((message, i) => ({
        kind: "message" as const,
        message,
        isLast: i === n - 1,
      }));
    }
    return [
      { kind: "message" as const, message: messages[0]!, isLast: false },
      { kind: "divider" as const, count: n - 3 },
      { kind: "message" as const, message: messages[n - 2]!, isLast: false },
      { kind: "message" as const, message: messages[n - 1]!, isLast: true },
    ];
  }, [messages, middleExpanded]);

  // Prefetch a draft on pointer-down so openDraft can reuse the in-flight response.
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
      const rowLabels = threads.find((r) => r.id === threadId)?.labelIds;
      if (rowLabels?.length) adjustUserLabelUnread(rowLabels, -1);
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

    activeThreadLoadRef.current = threadId;
    setSelectedId(threadId);
    setThreadError(null);
    const rowLabelIds = threads.find((r) => r.id === threadId)?.labelIds;
    setThreadLabelIds(mergeThreadLabelIds(rowLabelIds));

    const warmed = getCachedThread(threadId);
    if (warmed) {
      setMessages(warmed.messages as MsgView[]);
      setLoadingThread(false);
    } else {
      setMessages(null);
      setLoadingThread(true);
    }

    if (composeOpen && (composeKind === "reply" || composeKind === "replyAll")) {
      setComposeOpen(false);
    }

    try {
      const data = await loadThreadForOpen(threadId);
      if (activeThreadLoadRef.current !== threadId) return;
      setMessages(data.messages);
      setThreadLabelIds((prev) => mergeThreadLabelIds(prev, data.labelIds, rowLabelIds));
      void loadTracking();
    } catch (e) {
      if (activeThreadLoadRef.current !== threadId) return;
      setThreadError(e instanceof Error ? e.message : "Error");
    } finally {
      if (activeThreadLoadRef.current === threadId) {
        setLoadingThread(false);
      }
    }
  }, [
    loadTracking,
    threads,
    scheduleCountRefresh,
    mutateThreads,
    adjustInboxUnread,
    adjustUserLabelUnread,
    loadThreadForOpen,
    composeOpen,
    composeKind,
  ]);

  // Add or remove a label on the currently-open thread. Optimistic — flips
  // local chips immediately and rolls back if the server rejects.
  const toggleThreadLabel = useCallback(
    (labelId: string, nextChecked: boolean) => {
      if (!selectedId) return;
      const prev = threadLabelIds;
      const prevRow = threads.find((r) => r.id === selectedId);
      const rowWasUnread = !!prevRow?.unread;
      setThreadLabelIds((cur) =>
        nextChecked ? Array.from(new Set([...cur, labelId])) : cur.filter((id) => id !== labelId)
      );
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) =>
            r.id === selectedId
              ? {
                  ...r,
                  labelIds: nextChecked
                    ? Array.from(new Set([...(r.labelIds ?? []), labelId]))
                    : (r.labelIds ?? []).filter((id) => id !== labelId),
                }
              : r
          ),
        { labelId, added: nextChecked, threadIds: [selectedId] }
      );
      if (!labelId.startsWith("pending:")) {
        if (nextChecked && rowWasUnread) adjustUserLabelUnread([labelId], 1);
        if (!nextChecked && rowWasUnread) adjustUserLabelUnread([labelId], -1);
      }
      invalidateThreadCache(selectedId);
      if (labelId.startsWith("pending:")) return;

      void (async () => {
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
          setThreadLabelIds(prev);
          applyLabelListUpdate(
            (rows) => {
              const exists = rows.some((r) => r.id === selectedId);
              if (exists) {
                return rows.map((r) =>
                  r.id === selectedId ? { ...r, labelIds: prev } : r
                );
              }
              if (prevRow) {
                return [{ ...prevRow, labelIds: prev }, ...rows];
              }
              return rows;
            },
            { labelId, added: !nextChecked, threadIds: [selectedId] }
          );
          alert(e instanceof Error ? e.message : "Could not update labels");
        }
      })();
    },
    [
      selectedId,
      threadLabelIds,
      threads,
      scheduleCountRefresh,
      applyLabelListUpdate,
      invalidateThreadCache,
      adjustUserLabelUnread,
    ]
  );

  // Create a new Gmail label and immediately apply it to the open thread.
  // Toggle the STARRED label on a thread (optimistic). Used by the row star
  // icon — separate from the labels picker because Gmail treats star as a
  // first-class affordance, not a chip.
  const toggleThreadStar = useCallback(
    async (threadId: string, nextStarred: boolean) => {
      setRowBusy((s) => new Set(s).add(threadId));
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) => (r.id === threadId ? { ...r, starred: nextStarred } : r)),
        { labelId: "STARRED", added: nextStarred, threadIds: [threadId] }
      );
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
        applyLabelListUpdate(
          (rows) =>
            rows.map((r) => (r.id === threadId ? { ...r, starred: !nextStarred } : r)),
          { labelId: "STARRED", added: !nextStarred, threadIds: [threadId] }
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
    [scheduleCountRefresh, applyLabelListUpdate]
  );

  // Toggle the IMPORTANT label on a thread (optimistic). Same shape as
  // toggleThreadStar — instant UI update, API call in background, rollback
  // on failure. Gmail uses a filled/outlined ► marker for this affordance.
  const toggleThreadImportant = useCallback(
    async (threadId: string, nextImportant: boolean) => {
      setRowBusy((s) => new Set(s).add(threadId));
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) => (r.id === threadId ? { ...r, important: nextImportant } : r)),
        { labelId: "IMPORTANT", added: nextImportant, threadIds: [threadId] }
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
        applyLabelListUpdate(
          (rows) =>
            rows.map((r) => (r.id === threadId ? { ...r, important: !nextImportant } : r)),
          { labelId: "IMPORTANT", added: !nextImportant, threadIds: [threadId] }
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
    [scheduleCountRefresh, applyLabelListUpdate]
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
        for (const id of ids) {
          const row = threads.find((t) => t.id === id);
          if (row?.unread && row.labelIds?.length) {
            adjustUserLabelUnread(row.labelIds, -1);
          }
        }
      } else if (action === "markUnread" && folder === "inbox") {
        adjustInboxUnread(ids.length);
        for (const id of ids) {
          const row = threads.find((t) => t.id === id);
          if (row && !row.unread && row.labelIds?.length) {
            adjustUserLabelUnread(row.labelIds, 1);
          }
        }
      } else if (
        (action === "archive" || action === "trash" || action === "spam") &&
        unreadInSelection > 0
      ) {
        adjustInboxUnread(-unreadInSelection);
        for (const id of ids) {
          const row = threads.find((t) => t.id === id);
          if (row?.unread && row.labelIds?.length) {
            adjustUserLabelUnread(row.labelIds, -1);
          }
        }
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
        const newlyStarred = ids.filter(
          (id) => !threads.find((t) => t.id === id)?.starred
        ).length;
        applyLabelListUpdate(
          (rows) =>
            rows.map((r) => (idSet.has(r.id) ? { ...r, starred: true } : r)),
          { labelId: "STARRED", added: true, threadIds: ids }
        );
        if (newlyStarred > 0) {
          setLabelCounts((prev) => {
            const cur = prev["STARRED"] ?? { total: 0, unread: 0 };
            return { ...prev, STARRED: { ...cur, total: cur.total + newlyStarred } };
          });
        }
      } else if (action === "important") {
        const newlyImportant = ids.filter(
          (id) => !(threads.find((t) => t.id === id)?.labelIds ?? []).includes("IMPORTANT")
        ).length;
        applyLabelListUpdate(
          (rows) =>
            rows.map((r) =>
              idSet.has(r.id)
                ? {
                    ...r,
                    important: true,
                    labelIds: Array.from(new Set([...(r.labelIds ?? []), "IMPORTANT"])),
                  }
                : r
            ),
          { labelId: "IMPORTANT", added: true, threadIds: ids }
        );
        if (newlyImportant > 0) {
          setLabelCounts((prev) => {
            const cur = prev["IMPORTANT"] ?? { total: 0, unread: 0 };
            return { ...prev, IMPORTANT: { ...cur, total: cur.total + newlyImportant } };
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
                    : action === "important"
                      ? { add: ["IMPORTANT"], remove: [] as string[] }
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
    [
      threads,
      selectedId,
      folder,
      scheduleCountRefresh,
      mutateThreads,
      loadThreads,
      adjustInboxUnread,
      adjustUserLabelUnread,
      applyLabelListUpdate,
    ]
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

  const replaceLabelId = useCallback(
    (tempId: string, real: GmailLabel) => {
      setAllLabels((prev) => insertLabelSorted(prev.filter((l) => l.id !== tempId), real));
      setThreadLabelIds((cur) => cur.map((id) => (id === tempId ? real.id : id)));
      setComposeLabelIds((cur) => cur.map((id) => (id === tempId ? real.id : id)));
      mutateThreads((rows) =>
        rows.map((r) => ({
          ...r,
          labelIds: r.labelIds?.map((id) => (id === tempId ? real.id : id)),
        }))
      );
      setBulkLabelSelected((prev) => {
        if (!prev.has(tempId)) return prev;
        const next = new Set(prev);
        next.delete(tempId);
        next.add(real.id);
        return next;
      });
      const remapRows = (rows: ThreadRow[]) =>
        rows.map((r) => ({
          ...r,
          labelIds: r.labelIds?.map((id) => (id === tempId ? real.id : id)),
        }));
      const migrated: Array<[string, { threads: ThreadRow[]; nextPageToken?: string }]> = [];
      listCacheRef.current.forEach((entry, cacheKey) => {
        if (listCacheLabelId(cacheKey) === tempId) {
          migrated.push([
            cacheKey.replace(`|${tempId}|`, `|${real.id}|`),
            { ...entry, threads: remapRows(entry.threads) },
          ]);
          listCacheRef.current.delete(cacheKey);
        } else if (entry.threads.some((t) => t.labelIds?.includes(tempId))) {
          listCacheRef.current.set(cacheKey, { ...entry, threads: remapRows(entry.threads) });
        }
      });
      for (const [key, entry] of migrated) {
        listCacheRef.current.set(key, entry);
      }
      setLabelCounts((prev) => {
        if (!(tempId in prev)) return prev;
        const next = { ...prev };
        const counts = next[tempId];
        delete next[tempId];
        next[real.id] = counts ?? { total: 0, unread: 0 };
        return next;
      });
    },
    [mutateThreads]
  );

  const removePendingLabel = useCallback(
    (tempId: string) => {
      setAllLabels((prev) => prev.filter((l) => l.id !== tempId));
      setThreadLabelIds((cur) => cur.filter((id) => id !== tempId));
      setComposeLabelIds((cur) => cur.filter((id) => id !== tempId));
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) => ({
            ...r,
            labelIds: r.labelIds?.filter((id) => id !== tempId),
          })),
        {
          labelId: tempId,
          added: false,
          threadIds: threads.filter((t) => t.labelIds?.includes(tempId)).map((t) => t.id),
        }
      );
      setBulkLabelSelected((prev) => {
        if (!prev.has(tempId)) return prev;
        const next = new Set(prev);
        next.delete(tempId);
        return next;
      });
    },
    [applyLabelListUpdate, threads]
  );

  const applyLabelOptimistic = useCallback(
    (threadId: string, labelId: string) => {
      invalidateThreadCache(threadId);
      if (selectedId === threadId) {
        setThreadLabelIds((cur) => Array.from(new Set([...cur, labelId])));
      }
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) =>
            r.id === threadId
              ? {
                  ...r,
                  labelIds: Array.from(new Set([...(r.labelIds ?? []), labelId])),
                }
              : r
          ),
        { labelId, added: true, threadIds: [threadId] }
      );
    },
    [selectedId, applyLabelListUpdate, invalidateThreadCache]
  );

  /** Create on Gmail in the background after optimistic UI is already shown. */
  const finalizeLabelCreation = useCallback(
    async (
      tempId: string,
      name: string,
      apply?: { threadId?: string; threadIds?: string[] }
    ) => {
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
        replaceLabelId(tempId, j.label);

        if (apply?.threadId) {
          const mod = await fetch(
            `/api/gmail/threads/${encodeURIComponent(apply.threadId)}/labels`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ add: [j.label.id] }),
            }
          );
          if (!mod.ok) {
            throw new Error(
              ((await mod.json().catch(() => ({}))) as { error?: string })?.error ||
                "Failed to apply label"
            );
          }
          scheduleCountRefresh();
        } else if (apply?.threadIds?.length) {
          const mod = await fetch("/api/gmail/threads/batch-modify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadIds: apply.threadIds,
              add: [j.label.id],
            }),
          });
          if (!mod.ok) throw new Error("Failed to apply label to selected threads");
          scheduleCountRefresh();
        }
      } catch (e) {
        removePendingLabel(tempId);
        alert(e instanceof Error ? e.message : "Could not create label");
      }
    },
    [replaceLabelId, removePendingLabel, scheduleCountRefresh]
  );

  /** Called when user toggles a checkbox inside the bulk LabelPicker. */
  const handleBulkLabelToggle = useCallback(
    (labelId: string, nextChecked: boolean) => {
      const ids = Array.from(selectedThreadIds);
      if (ids.length === 0) return;

      setBulkLabelSelected((prev) => {
        const next = new Set(prev);
        if (nextChecked) next.add(labelId); else next.delete(labelId);
        return next;
      });
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) => {
            if (!selectedThreadIds.has(r.id)) return r;
            const cur = new Set(r.labelIds ?? []);
            if (nextChecked) cur.add(labelId); else cur.delete(labelId);
            return { ...r, labelIds: Array.from(cur) };
          }),
        { labelId, added: nextChecked, threadIds: ids }
      );
      if (!labelId.startsWith("pending:")) {
        let unreadDelta = 0;
        for (const id of ids) {
          const row = threads.find((t) => t.id === id);
          if (row?.unread) unreadDelta += nextChecked ? 1 : -1;
        }
        if (unreadDelta !== 0) adjustUserLabelUnread([labelId], unreadDelta);
      }
      if (selectedId && selectedThreadIds.has(selectedId)) {
        setThreadLabelIds((cur) => {
          const next = new Set(cur);
          if (nextChecked) next.add(labelId); else next.delete(labelId);
          return Array.from(next);
        });
      }
      if (labelId.startsWith("pending:")) return;

      for (const id of ids) invalidateThreadCache(id);

      void (async () => {
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
        }
      })();
    },
    [
      selectedThreadIds,
      selectedId,
      threads,
      scheduleCountRefresh,
      applyLabelListUpdate,
      invalidateThreadCache,
      adjustUserLabelUnread,
    ]
  );

  /** Create a new label then immediately apply it to all selected threads. */
  const handleBulkLabelCreate = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      const ids = Array.from(selectedThreadIds);
      if (!trimmed || ids.length === 0) return;
      const pending = makePendingLabel(trimmed);
      setAllLabels((prev) => insertLabelSorted(prev, pending));
      setBulkLabelSelected((prev) => new Set(prev).add(pending.id));
      const unreadCount = ids.filter((id) => threads.find((t) => t.id === id)?.unread).length;
      setUserLabelCount(pending.id, { total: ids.length, unread: unreadCount });
      applyLabelListUpdate(
        (rows) =>
          rows.map((r) => {
            if (!selectedThreadIds.has(r.id)) return r;
            return {
              ...r,
              labelIds: Array.from(new Set([...(r.labelIds ?? []), pending.id])),
            };
          }),
        { labelId: pending.id, added: true, threadIds: ids }
      );
      void finalizeLabelCreation(pending.id, trimmed, { threadIds: ids });
    },
    [selectedThreadIds, threads, applyLabelListUpdate, finalizeLabelCreation, setUserLabelCount]
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

  const clearSelection = useCallback(() => {
    setSelectedThreadIds(new Set());
  }, []);

  // Clear selection whenever the underlying list shifts (folder change, refresh,
  // label filter change) — selection ids would otherwise reference rows that
  // are no longer visible.
  useEffect(() => {
    setSelectedThreadIds(new Set());
  }, [folder, mailSearch, effectiveLabelId]);

  const createAndApplyLabel = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const pending = makePendingLabel(trimmed);
      setAllLabels((prev) => insertLabelSorted(prev, pending));
      setUserLabelCount(pending.id, { total: 0, unread: 0 });
      const threadId = selectedId;
      if (threadId) {
        applyLabelOptimistic(threadId, pending.id);
        const row = threads.find((t) => t.id === threadId);
        if (row?.unread) {
          setUserLabelCount(pending.id, { total: 1, unread: 1 });
        } else if (row) {
          setUserLabelCount(pending.id, { total: 1, unread: 0 });
        }
      }
      void finalizeLabelCreation(
        pending.id,
        trimmed,
        threadId ? { threadId } : undefined
      );
    },
    [selectedId, threads, applyLabelOptimistic, finalizeLabelCreation, setUserLabelCount]
  );

  /**
   * Create a label from compose's label menu: it appears at once (pending),
   * is ticked for the mail being written, and is created in Gmail in the
   * background. replaceLabelId / removePendingLabel keep the compose selection
   * in step when it lands or fails.
   */
  const createComposeLabel = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const pending = makePendingLabel(trimmed);
      setAllLabels((prev) => insertLabelSorted(prev, pending));
      setUserLabelCount(pending.id, { total: 0, unread: 0 });
      setComposeLabelIds((cur) => [...cur, pending.id]);
      void finalizeLabelCreation(pending.id, trimmed);
    },
    [finalizeLabelCreation, setUserLabelCount]
  );

  const composeLabelSelected = useMemo(() => new Set(composeLabelIds), [composeLabelIds]);

  /**
   * Upload a photo being inserted into the body ("Insert photo"). Its progress
   * row sits with the attachment uploads, which also holds Send and draft save
   * until it lands — before then the body only has a local preview of it.
   */
  const uploadComposeInlineImage = useCallback(async (file: File): Promise<string> => {
    const key = file.name;
    setUploadProgressKind((prev) => ({ ...prev, [key]: "photo" }));
    setDriveUploadProgress((prev) => ({ ...prev, [key]: 0 }));
    try {
      return await uploadInlineImage(file, (percent) =>
        setDriveUploadProgress((prev) => ({ ...prev, [key]: percent }))
      );
    } catch (e) {
      setComposeFieldError({
        title: "Photo not inserted",
        message: e instanceof Error ? e.message : `"${file.name}" couldn't be inserted.`,
      });
      throw e;
    } finally {
      setDriveUploadProgress((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setUploadProgressKind((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }, []);

  /** Create a new label from the left-rail form (no thread to apply it to). */
  function createLabelFromRail() {
    const name = newLabelInput.trim();
    if (!name) return;
    const pending = makePendingLabel(name);
    setAllLabels((prev) => insertLabelSorted(prev, pending));
    setUserLabelCount(pending.id, { total: 0, unread: 0 });
    setNewLabelInput("");
    setShowNewLabelForm(false);
    void finalizeLabelCreation(pending.id, name);
  }

  const handleLabelEdit = useCallback((labelId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    let previousName = "";
    setAllLabels((prev) => {
      const existing = prev.find((l) => l.id === labelId);
      if (!existing) return prev;
      previousName = existing.name;
      return insertLabelSorted(prev.filter((l) => l.id !== labelId), {
        ...existing,
        name: trimmed,
      });
    });
    void (async () => {
      try {
        const res = await fetch(`/api/gmail/labels/${encodeURIComponent(labelId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          label?: GmailLabel;
        };
        if (!res.ok || !j.label) throw new Error(j.error || "Could not rename label");
        setAllLabels((prev) => {
          const existing = prev.find((l) => l.id === labelId);
          if (!existing) return prev;
          return insertLabelSorted(prev.filter((l) => l.id !== labelId), {
            ...existing,
            ...j.label,
          });
        });
        void loadCounts();
      } catch (e) {
        setAllLabels((prev) => {
          const existing = prev.find((l) => l.id === labelId);
          if (!existing) return prev;
          return insertLabelSorted(prev.filter((l) => l.id !== labelId), {
            ...existing,
            name: previousName,
          });
        });
        alert(e instanceof Error ? e.message : "Could not rename label");
      }
    })();
  }, [loadCounts]);

  const handleLabelDelete = useCallback(
    (labelId: string) => {
      const snapshotLabels = allLabels;
      const snapshotCounts = labelCounts;
      const stripLabel = (rows: ThreadRow[]) =>
        rows.map((r) => ({
          ...r,
          labelIds: r.labelIds?.filter((id) => id !== labelId),
        }));

      setAllLabels((prev) => prev.filter((l) => l.id !== labelId));
      setThreads((prev) => {
        const updated = stripLabel(prev);
        const visible = filterRowsForActiveLabelView(updated);
        closeThreadIfMissingFromList(visible);
        return visible;
      });
      patchAllThreadCaches(stripLabel);
      listCacheRef.current.forEach((entry, key) => {
        if (listCacheLabelId(key) === labelId) {
          listCacheRef.current.delete(key);
        } else {
          listCacheRef.current.set(key, { ...entry, threads: stripLabel(entry.threads) });
        }
      });
      setThreadLabelIds((cur) => cur.filter((id) => id !== labelId));
      setBulkLabelSelected((prev) => {
        if (!prev.has(labelId)) return prev;
        const next = new Set(prev);
        next.delete(labelId);
        return next;
      });
      if (filterLabelId === labelId) setFilterLabelId(null);
      setLabelCounts((prev) => {
        if (!(labelId in prev)) return prev;
        const next = { ...prev };
        delete next[labelId];
        return next;
      });

      void (async () => {
        try {
          const res = await fetch(`/api/gmail/labels/${encodeURIComponent(labelId)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(j.error || "Could not delete label");
          }
          void loadCounts();
        } catch (e) {
          setAllLabels(snapshotLabels);
          setLabelCounts(snapshotCounts);
          listCacheRef.current.clear();
          void loadThreads({ append: false, forceRefresh: true });
          alert(e instanceof Error ? e.message : "Could not delete label");
        }
      })();
    },
    [
      allLabels,
      labelCounts,
      filterRowsForActiveLabelView,
      closeThreadIfMissingFromList,
      patchAllThreadCaches,
      filterLabelId,
      loadCounts,
      loadThreads,
    ]
  );

  function openNewCompose() {
    setComposeKind("new");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    resetComposeFiles();
    setComposeDraftId(null);
    setComposeCcBccOpen(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  }

  function replySubject(subject: string): string {
    const trimmed = subject.trim();
    if (!trimmed) return "Re:";
    return /^re:\s/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
  }

  function openReply(mode: "reply" | "replyAll") {
    if (!selectedId || !messages?.length) return;
    const last = messages[messages.length - 1];
    const cc = mode === "replyAll" ? buildReplyAllCc(last) : "";
    setComposeKind(mode);
    setComposeThreadId(selectedId);
    setComposeInReplyToId(last.id);
    setComposeTo(extractEmailAddress(last.from));
    setComposeCc(cc);
    setComposeBcc("");
    setComposeSubject(replySubject(last.subject || ""));
    setComposeBody("");
    resetComposeFiles();
    setComposeDraftId(null);
    setComposeCcBccOpen(mode === "replyAll" && !!cc.trim());
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
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
    const quotedHtml = `<br><br>---------- Forwarded message ----------<br>From: ${last.from}<br>Date: ${dateStr}<br>Subject: ${last.subject}<br>To: ${last.to}${last.cc ? `<br>Cc: ${last.cc}` : ""}${last.bcc ? `<br>Bcc: ${last.bcc}` : ""}<br><br>${last.bodyHtml || last.body.replace(/\n/g, "<br>")}`;

    setComposeKind("forward");
    setComposeThreadId(null);
    setComposeInReplyToId(null);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject(fwdSubject);
    setComposeBody(quotedHtml);
    resetComposeFiles();
    setComposeDraftId(null);
    setComposeCcBccOpen(false);
    setComposeMinimized(false);
    setComposeFullscreen(false);
    setComposeOpen(true);
  }

  /**
   * Merge fields per selected recipient, keyed by email. Recipients whose
   * contact card has since been deleted fall back to name/email only, so a
   * stale selection degrades to a plain email rather than blocking the send.
   *
   * An imported list skips the card lookup entirely — the spreadsheet row is
   * the only source of truth for those recipients.
   */
  /**
   * Resolves one contact-card recipient into the merge-field bag
   * mergeTemplate() consumes.
   *
   * Shared by mass sending and the single-recipient composer on purpose: both
   * answer "where does {company_name} come from for this address?", and two
   * copies of that answer would drift. Returns a function rather than rows so
   * the single-send path can call it for one address without building a list.
   */
  const buildContactMergeRow = useMemo(() => {
    const cardByEmail = new Map<string, DirectoryContact>();
    const cardByName = new Map<string, DirectoryContact>();
    for (const c of directoryContacts) {
      const email = (c.email ?? "").trim().toLowerCase();
      if (email && !cardByEmail.has(email)) cardByEmail.set(email, c);
      const name = c.name.trim().toLowerCase();
      // First card wins on a duplicate name — with no email to disambiguate,
      // picking arbitrarily among namesakes would be worse than being stable.
      if (name && !cardByName.has(name)) cardByName.set(name, c);
    }

    const syncedByEmail = new Map(
      syncedContacts
        .filter((s) => s.email?.trim())
        .map((s) => [s.email.trim().toLowerCase(), s])
    );

    return (r: MassRecipient) => {
      const key = r.email.toLowerCase();
      // Email is the reliable key; the display name is a fallback for people
      // whose card was filed under a different (or missing) address.
      const card =
        cardByEmail.get(key) ??
        (r.name.trim() ? cardByName.get(r.name.trim().toLowerCase()) : undefined);
      const synced = syncedByEmail.get(key);

      // The live Gmail lookup owns {last_mail_interaction} — it is the only
      // source that is actually "last email exchanged". Then the Team
      // Directory card field-by-field, the mailbox sync for whatever the card
      // left blank, and the Gmail display name as a last resort.
      const liveLastMail = lastMailByEmail[key];
      const baseFields = mergeFieldSources(
        liveLastMail
          ? { last_mail_interaction: formatInteractionDate(liveLastMail) }
          : undefined,
        card ? contactToMergeFields(card) : undefined,
        synced ? syncedContactToMergeFields(synced) : undefined,
        { email: r.email, name: r.name }
      );
      // Always mail the address that was actually selected, not the card's.
      baseFields.email = r.email;

      // User-typed fallbacks are the weakest source — real data always wins.
      // Kept separate from baseFields so the review banner can keep listing a
      // field as "missing" (and therefore editable) after a fallback is set.
      const fields = mergeFieldSources(baseFields, variableFallbacks);

      return {
        email: r.email,
        name: fields.name || r.email,
        baseFields,
        fields,
        hasCard: !!card || !!synced,
      };
    };
  }, [directoryContacts, syncedContacts, lastMailByEmail, variableFallbacks]);

  /**
   * The one recipient a normal (non-mass) compose merges against.
   *
   * Null unless exactly one address is in To: a normal compose sends a single
   * mail to everyone addressed, so with two recipients there is no one person
   * {name} could mean — see the guard in sendCompose, which says so rather than
   * silently merging the first.
   *
   * The display name has to be looked up rather than read off the field. Mass
   * sending gets it for free because its rail stores {email, name} together,
   * but the To field keeps only the address (serializeRecipientValue drops the
   * label) — so without this, {name} would fill for a campaign and come out
   * blank for the very same person in a single mail, and the directory's
   * by-name card fallback could never fire either.
   */
  const singleMergeRow = useMemo(() => {
    if (massSending || composeToEmails.length !== 1) return null;
    const email = composeToEmails[0];
    const suggested = composeRecipientSuggestions.find(
      (s) => s.email.trim().toLowerCase() === email
    )?.displayName;
    return buildContactMergeRow({ email, name: suggested?.trim() || "" });
  }, [massSending, composeToEmails, composeRecipientSuggestions, buildContactMergeRow]);

  const massMergeRows = useMemo(() => {
    if (massSource === "import") {
      const seen = new Set<string>();
      const rows: Array<{
        email: string;
        name: string;
        baseFields: Record<string, string>;
        fields: Record<string, string>;
        hasCard: boolean;
      }> = [];
      for (const row of massImport?.rows ?? []) {
        const email = row.email.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        const baseFields: Record<string, string> = { ...row.fields, email };
        rows.push({
          email,
          name: baseFields.name?.trim() || email,
          baseFields,
          // Fallbacks fill columns the row left blank, exactly as they do for
          // contact-card recipients.
          fields: mergeFieldSources(baseFields, variableFallbacks),
          // No card is expected here, so the review banner should not claim
          // one is missing — a blank cell is a blank cell.
          hasCard: true,
        });
      }
      return rows;
    }

    return massRecipients.map(buildContactMergeRow);
  }, [massSource, massImport, massRecipients, buildContactMergeRow, variableFallbacks]);

  /**
   * What is *still* missing once fallbacks are applied — the recipient rail's
   * warning badge. Measured against the resolved fields rather than the raw
   * ones so typing a fallback clears the badge for everyone it covers, which
   * is the whole point of the badge being there.
   */
  const massUnresolved = useMemo(() => {
    const byRecipient = reportMissingVariables(
      composeSubject,
      composeBody,
      massMergeRows.map((r) => ({ email: r.email, fields: r.fields })),
      massVariables
    ).byRecipient;
    // A not-a-column placeholder is unresolved for every row until its
    // fallback is set.
    const uncovered = draftUnknownKeys.filter((k) => !variableFallbacks[k]?.trim());
    if (uncovered.length === 0) return byRecipient;
    for (const r of massMergeRows) {
      byRecipient.set(r.email, [...(byRecipient.get(r.email) ?? []), ...uncovered]);
    }
    return byRecipient;
  }, [composeSubject, composeBody, massMergeRows, massVariables, draftUnknownKeys, variableFallbacks]);

  /** The row currently being previewed on the review screen. */
  const reviewRow = useMemo(() => {
    if (!reviewEmail) return null;
    const key = reviewEmail.toLowerCase();
    // A normal compose has exactly one candidate rather than a list to search.
    if (!massSending) {
      return singleMergeRow && singleMergeRow.email.toLowerCase() === key
        ? singleMergeRow
        : null;
    }
    return massMergeRows.find((r) => r.email.toLowerCase() === key) ?? null;
  }, [reviewEmail, massSending, singleMergeRow, massMergeRows]);

  /**
   * Variables that resolve to nothing for the row on screen, measured against
   * real data only so the review banner keeps offering a fallback after one is
   * typed. Single and mass share the report; only the row set differs.
   */
  const reviewMissing = useMemo(() => {
    if (!reviewRow) return undefined;
    return reportMissingVariables(
      composeSubject,
      composeBody,
      [{ email: reviewRow.email, fields: reviewRow.baseFields }],
      massSending ? massVariables : COMPOSE_VARIABLES
    ).byRecipient.get(reviewRow.email);
  }, [reviewRow, composeSubject, composeBody, massSending, massVariables]);

  async function sendMassCampaign() {
    const rows = massMergeRows;
    if (rows.length === 0) return;

    const snapshot = {
      subject: composeSubject,
      body: composeBody,
      files: composeFiles,
      draftId: composeDraftId,
      labelIds: composeLabelIds,
    };
    // Shared across every recipient in this batch so the campaign report
    // (app/(workspace)/campaigns) can group them — one Send click, one
    // campaign. Named after the template subject rather than prompting for a
    // name, so this send flow doesn't gain an extra required step.
    const campaignId = crypto.randomUUID();
    const campaignName = snapshot.subject.trim() || "Untitled campaign";

    // Close immediately and finish the batch in the background — same
    // pattern as a normal single send (sendCompose), instead of leaving the
    // whole compose dialog open and blocked for as long as the campaign
    // takes. Progress surfaces in the snackbar instead of the dialog's send
    // button, since the dialog is no longer around to show it.
    closeMassCompose();
    showSendSnack({ phase: "sending", message: `Sending 0/${rows.length}…` });

    let sent = 0;
    const failed: string[] = [];
    try {
      const attachments = await resolveAttachmentsForUpload(snapshot.files);
      // Staged files (every attachment added in compose, and every file copied
      // in from a template) stay on the server — resolveAttachmentsForUpload
      // skips them — so each send names them, and all but the last keep them
      // staged for the next recipient.
      const stagedUploadIds = snapshot.files
        .filter((f): f is Extract<PendingFile, { kind: "staged" }> => f.kind === "staged")
        .map((f) => f.uploadId);

      // Sequential, not Promise.all — Gmail rate-limits concurrent sends and a
      // partial failure mid-campaign must not lose the count of what got out.
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const htmlBody = appendDriveLinksToHtml(
          stripVariableSpans(mergeTemplate(snapshot.body, row.fields)),
          snapshot.files
        );
        try {
          const res = await fetch("/api/gmail/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: row.email,
              subject: mergeTemplate(snapshot.subject, row.fields),
              textBody: "",
              htmlBody,
              attachments: attachments.length ? attachments : undefined,
              ...(stagedUploadIds.length > 0
                ? { stagedUploadIds, keepStagedUploads: i < rows.length - 1 }
                : {}),
              ...(snapshot.labelIds.length > 0 ? { labelIds: snapshot.labelIds } : {}),
              campaignId,
              campaignName,
            }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(data.error || "Send failed");
          }
          sent += 1;
          showSendSnack({ phase: "sending", message: `Sending ${sent}/${rows.length}…` });
        } catch {
          failed.push(row.email);
        }
      }
    } catch (e) {
      showSendSnack({
        phase: "error",
        message: e instanceof Error ? e.message : "Could not send campaign",
      });
      return;
    }

    if (failed.length === 0) {
      showSendSnack({ phase: "sent", message: `Sent to ${sent} recipient${sent === 1 ? "" : "s"}` }, 3000);
    } else {
      showSendSnack({
        phase: "error",
        message: `Sent ${sent} of ${rows.length}. Failed: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`,
      });
    }

    if (snapshot.draftId) {
      void fetch(`/api/gmail/drafts/${snapshot.draftId}`, { method: "DELETE" }).catch(() => {});
    }
    void loadThreads({ append: false, forceRefresh: true });
  }

  /** Reset compose + all mass state after a campaign finishes. */
  function closeMassCompose() {
    setComposeOpen(false);
    setComposeTo("");
    setComposeCc("");
    setComposeBcc("");
    setComposeSubject("");
    setComposeBody("");
    resetComposeFiles();
    setComposeDraftId(null);
    resetMassState();
  }

  async function sendCompose() {
    const invalid = findInvalidRecipient({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
    });
    if (invalid) {
      setComposeFieldError({
        title: recipientErrorTitle(invalid),
        message: formatRecipientError(invalid),
      });
      return;
    }

    /**
     * Fields to substitute into this one mail, or null when it sends verbatim.
     *
     * A normal compose sends one message to everyone addressed, so `{name}` only
     * has a single meaning when there is a single recipient. With none or
     * several, refuse rather than merge somebody arbitrary — the alternative is
     * a recruiter opening a mail addressed to a colleague.
     */
    let mergeFields: Record<string, string> | null = null;
    if (draftUsesVariables) {
      if (composeToEmails.length !== 1) {
        setComposeFieldError(
          composeToEmails.length === 0
            ? {
                title: "Can't read that address",
                message:
                  "This draft uses variables like {name}, which are filled in from the recipient's contact card — but no usable address could be read from the To field. Check it and try again.",
              }
            : {
                title: "Variables need a single recipient",
                message:
                  "This draft uses variables like {name}, which are filled in per person. A normal email goes to everyone at once, so there is no one person to fill them from. Send it to one recipient, or switch on mass sending to give each of them their own personalised copy.",
              }
        );
        return;
      }
      mergeFields = singleMergeRow?.fields ?? null;
    }

    setComposeFieldError(null);

    const snapshot = {
      kind: composeKind,
      labelIds: composeLabelIds,
      to: composeTo.trim(),
      cc: composeCc.trim(),
      bcc: composeBcc.trim(),
      // Merged here, not in the editor: the draft that stays autosaved keeps its
      // `{variable}` form, so reopening it still shows the template. Spans are
      // stripped further down, after the substitution — same order the review
      // screen renders in, so what was previewed is what gets sent.
      subject: mergeFields ? mergeTemplate(composeSubject.trim(), mergeFields) : composeSubject.trim(),
      htmlBody: mergeFields ? mergeTemplate(composeBody, mergeFields) : composeBody,
      // Read files/draftId from the ref rather than React state: an in-flight
      // autosave (syncComposeFilesFromDraft) may have just promoted staged files
      // to "saved" and updated the ref before the state flush. Staged files that
      // haven't been promoted yet are still covered — stagedUploadIds below
      // carries them to the send route, which resolves them from durable
      // cross-instance staging.
      files: composeStateRef.current.files,
      draftId: composeStateRef.current.draftId,
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
    resetComposeFiles();
    showSendSnack({ phase: "sending" });

    const isReply = snapshot.kind === "reply" || snapshot.kind === "replyAll";

    // Inject an optimistic row into the Sent list so it appears immediately.
    // We use a stable temp id prefixed "__opt__" so reconciliation can
    // identify and replace it once the real server id comes back.
    const sentKey = `sent||`;
    const optId = `__opt__${Date.now()}`;
    if (!isReply) {
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
    }

    // ── Background send ───────────────────────────────────────────────────
    try {
      const attachments = await resolveAttachmentsForUpload(snapshot.files);
      const stagedUploadIds = snapshot.files
        .filter((f) => f.kind === "staged")
        .map((f) => f.uploadId);

      // Strip editor-only variable tinting here too — a draft written with
      // mass sending on can be sent as a normal single email after toggling off.
      const finalHtmlBody = appendDriveLinksToHtml(
        stripVariableSpans(snapshot.htmlBody),
        snapshot.files
      );

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
          threadId: isReply ? snapshot.threadId ?? undefined : undefined,
          inReplyToMessageId: isReply ? snapshot.inReplyToMessageId ?? undefined : undefined,
          attachments: attachments.length ? attachments : undefined,
          stagedUploadIds: stagedUploadIds.length ? stagedUploadIds : undefined,
          labelIds: snapshot.labelIds.length ? snapshot.labelIds : undefined,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        id?: string;
        threadId?: string;
        labelError?: string;
      };
      if (!res.ok) throw new Error(data.error || "Send failed");

      // Delete the draft it was based on (fire-and-forget).
      if (snapshot.draftId) {
        void fetch(`/api/gmail/drafts?draftId=${encodeURIComponent(snapshot.draftId)}`, {
          method: "DELETE",
        }).catch(() => {});
      }

      if (isReply && snapshot.threadId) {
        // The previous call here used the bare thread id as the cache key,
        // which matches neither of threadDataCache's real keys (`open:`/
        // `prefetch:`) — it deleted nothing. Worse, even a correct delete
        // wouldn't have been enough: fetchThreadData falls back to
        // getCachedThread's own module-level cache (up to a 30-minute TTL)
        // before ever hitting the network, and that was never touched either.
        // invalidateThreadCache clears the local Map correctly;
        // invalidateCachedThread clears the module-level one (and its
        // sessionStorage mirror) so a future open actually refetches.
        invalidateThreadCache(snapshot.threadId);
        invalidateCachedThread(snapshot.threadId);

        // Append the reply straight into the open thread immediately, rather
        // than waiting on a refetch — we already know exactly what we sent,
        // so there's nothing to wait for. This also sidesteps a real Gmail
        // quirk: threads.get can lag behind messages.send by a few seconds
        // (the Sent list's own snippet updates faster than the full thread
        // read does), so an immediate refetch can legitimately come back
        // without the message we just sent. If the thread is still open when
        // this lands, merge: trust the background refetch's content once it
        // includes our message, but never let it make the reply disappear in
        // the meantime by overwriting with a response that doesn't have it yet.
        if (data.id && selectedId === snapshot.threadId) {
          const sentMessageId = data.id;
          const optimisticMessage: MsgView = {
            id: sentMessageId,
            threadId: data.threadId || snapshot.threadId,
            subject: snapshot.subject,
            from: myEmail,
            to: snapshot.to,
            cc: snapshot.cc,
            bcc: snapshot.bcc,
            date: new Date().toISOString(),
            body: "",
            bodyHtml: finalHtmlBody,
          };
          setMessages((prev) => [...(prev ?? []), optimisticMessage]);

          loadThreadForOpen(snapshot.threadId)
            .then((fresh) => {
              if (activeThreadLoadRef.current !== snapshot.threadId) return;
              const hasRealMessage = fresh.messages.some((m) => m.id === sentMessageId);
              setMessages(
                hasRealMessage ? fresh.messages : [...fresh.messages, optimisticMessage]
              );
            })
            .catch(() => {
              // Keep the optimistic message showing rather than clearing it on a failed reconcile.
            });
        } else {
          void openThread(snapshot.threadId);
        }
      } else {
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
      }
      void loadTracking();

      if (snapshot.labelIds.length > 0) scheduleCountRefresh();
      // The mail went out; only the labelling didn't stick — say so, but as a
      // sent mail, not a failed one.
      showSendSnack(
        data.labelError
          ? { phase: "error", message: "Sent, but the labels couldn't be applied." }
          : { phase: "sent" },
        data.labelError ? 5000 : 3000
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      if (!isReply) {
        // Remove the optimistic row on failure.
        mutateThreads((rows) => rows.filter((r) => r.id !== optId));
        const sentC = listCacheRef.current.get(sentKey);
        if (sentC) {
          listCacheRef.current.set(sentKey, {
            threads: sentC.threads.filter((r) => r.id !== optId),
            nextPageToken: sentC.nextPageToken,
          });
        }
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
          setComposeCcBccOpen(!!snapshot.cc.trim() || !!snapshot.bcc.trim());
          setComposeOpen(true);
          setComposeMinimized(false);
        },
      });
    }
  }

  // Shared back-to-list action used by thread detail
  const closeThread = useCallback(() => {
    activeThreadLoadRef.current = null;
    setSelectedId(null);
    setMessages(null);
    setThreadError(null);
    if (composeOpen && (composeKind === "reply" || composeKind === "replyAll")) {
      setComposeOpen(false);
    }
  }, [composeOpen, composeKind]);

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
    if (composeKind === "replyAll") return titleCase("Reply all");
    if (composeKind === "reply") return titleCase("Reply");
    return composeDraftId ? titleCase("Edit Draft") : titleCase("New Message");
  }, [composeKind, composeDraftId]);

  // Sync minimized compose to the module-level store so WorkspaceChrome can
  // render the minimized bar when the user navigates to another tab.
  useEffect(() => {
    if (composeOpen && composeMinimized) {
      setComposePersistedState({
        kind: composeKind,
        windowTitle: composeWindowTitle,
        to: composeTo,
        cc: composeCc,
        bcc: composeBcc,
        subject: composeSubject,
        body: composeBody,
        ccBccOpen: composeCcBccOpen,
        draftId: composeDraftId,
        threadId: composeThreadId,
        inReplyToId: composeInReplyToId,
      });
    } else {
      setComposePersistedState(null);
    }
  }, [
    composeOpen,
    composeMinimized,
    composeKind,
    composeWindowTitle,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeBody,
    composeCcBccOpen,
    composeDraftId,
    composeThreadId,
    composeInReplyToId,
  ]);

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

  const MOBILE_PRIMARY_FOLDER_KEYS = new Set<Folder>(["inbox", "sent", "drafts", "starred"]);
  const mobilePrimaryFolders = FOLDER_NAV.filter((f) => MOBILE_PRIMARY_FOLDER_KEYS.has(f.key));
  const mobileMoreFolders = FOLDER_NAV.filter((f) => !MOBILE_PRIMARY_FOLDER_KEYS.has(f.key));
  const mobileMoreFolderActive = mobileMoreFolders.some((f) => f.key === folder);

  const topbarActions = topbarActionsNode
    ? createPortal(
        <div ref={filterPanelRef} className="relative flex items-center gap-2.5">
          <div className="w-[260px]">
            <MailSearchBar
              inputValue={mailSearchInput}
              onInputChange={setMailSearchInput}
              onSearch={handleMailSearch}
              onReset={resetMailSearch}
              filterOpen={filterOpen}
              onFilterOpenChange={handleFilterOpenChange}
              localContacts={composeRecipientSuggestions}
              onOpenThread={(threadId) => void openThread(threadId)}
              onSuggestingChange={setMailSearchSuggesting}
            />
          </div>

          {/* Advanced filter panel — dropdown anchored under the topbar search field */}
          {filterOpen && (
            <div className="absolute right-[124px] top-[calc(100%+8px)] z-40 max-h-[80vh] w-[440px] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="grid gap-3.5 px-4 py-4">
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
                  <div className="flex min-w-0 gap-2">
                    <select
                      value={filterDateWithin}
                      onChange={(e) => setFilterDateWithin(e.target.value as DateWithin)}
                      className="input-field h-9 min-w-0 flex-1 text-[13px]"
                    >
                      {DATE_WITHIN_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <GmailDatePicker
                      value={filterDateAnchor}
                      onChange={setFilterDateAnchor}
                      className="min-w-0 flex-1"
                    />
                  </div>
                </FilterRow>
                <label className="flex cursor-pointer items-center gap-2 pl-[108px] text-[13px] text-[var(--color-text)]">
                  <input
                    type="checkbox"
                    checked={filterHasAttachment}
                    onChange={(e) => setFilterHasAttachment(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-copper)]"
                  />
                  Has attachment
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
                <button
                  data-testid="inbox-filter-clear-btn"
                  type="button"
                  onClick={clearFilter}
                  className="btn-ghost h-9 text-[13px]"
                >
                  Clear
                </button>
                <button
                  data-testid="inbox-filter-cancel-btn"
                  type="button"
                  onClick={() => setFilterOpen(false)}
                  className="btn-ghost h-9 text-[13px]"
                >
                  Cancel
                </button>
                <button
                  data-testid="inbox-filter-search-btn"
                  type="button"
                  onClick={applyFilter}
                  className="h-9 rounded bg-[var(--color-copper)] px-5 text-[13px] font-medium text-white transition hover:bg-[var(--color-copper-hover)]"
                >
                  Search
                </button>
              </div>
            </div>
          )}

          <button
            data-testid="inbox-topbar-compose-btn"
            type="button"
            onClick={() => openNewCompose()}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-[var(--color-copper)] px-4 text-[13px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)]"
          >
            <PencilLine className="h-4 w-4" strokeWidth={2} />
            {titleCase("Compose")}
          </button>
        </div>,
        topbarActionsNode,
      )
    : null;

  return (
    <>
    {topbarActions}
    {/* ── Gmail-style three-column layout ────────────────────────────────────
        Left rail  : Compose + Inbox/Sent/Drafts + Labels  (desktop only)
        Right area : Category tabs (top) + search + thread list OR thread detail
    ──────────────────────────────────────────────────────────────────────── */}
    <div
      className={cn(
        "flex min-h-0 overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]",
        /* Mobile: stay below WorkspaceChrome header (no negative top margin). Desktop: full-bleed. */
        "-mx-4 -mb-6 h-[calc(100dvh-56px-16px-24px-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))]",
        "md:-mx-6 md:-mt-6 md:-mb-6 md:h-[calc(100dvh-48px)]"
      )}
    >

      {/* ══ LEFT RAIL — desktop only ══ */}
      <aside
        className={cn(
          "relative hidden shrink-0 flex-col overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg)] md:flex",
          // Collapsed: hide the contents; the handle (a sibling) stays to drag or click back open.
          sidebarCollapsed && "overflow-hidden [&>*]:hidden"
        )}
        style={{ width: sidebarCollapsed ? COLLAPSED_PANE_W : sidebarWidth }}
      >
        {/* Compose + Refresh — Gmail pill compose button */}
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            data-testid="inbox-compose-btn"
            type="button"
            onClick={() => openNewCompose()}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2.5 rounded-2xl bg-[var(--color-copper)] px-4 text-[14px] font-medium text-white shadow-sm transition hover:bg-[var(--color-copper-hover)] hover:shadow-md"
          >
            <PencilLine className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            {titleCase("Compose")}
          </button>
          <button
            data-testid="inbox-refresh-btn"
            type="button"
            onClick={() => void handleMailListRefresh()}
            className="btn-ghost flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title={titleCase("Refresh")}
          >
            <IconRefresh className={cn("h-[18px] w-[18px]", listRefreshing && "animate-spin")} />
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
                data-testid={`inbox-folder-${key}`}
                type="button"
                onClick={() => switchMailFolder(key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-r-full py-[6px] pl-3 pr-3 text-[14px] transition-colors",
                  active
                    ? "bg-[var(--color-copper-tint)] font-semibold text-[var(--color-copper)]"
                    : "font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
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
                    active ? "text-[var(--color-copper)]" : "text-[var(--color-text-faint)]"
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
                disabled={!newLabelInput.trim()}
                className="shrink-0 text-[11px] font-semibold text-[var(--color-copper)] disabled:opacity-40"
              >
                Create
              </button>
            </form>
          )}

          {(() => {
            const userLabels = allLabels.filter((l) => l.type === "user");
            const query = labelSearch.trim().toLowerCase();
            let visible: GmailLabel[];
            if (query) {
              visible = userLabels.filter((l) => l.name.toLowerCase().includes(query));
            } else {
              visible = userLabels.slice(0, SIDEBAR_LABEL_LIMIT);
              // A label picked through search stays visible once the box is cleared.
              const pinned = userLabels.find((l) => l.id === filterLabelId);
              if (pinned && !visible.some((l) => l.id === pinned.id)) {
                visible = [pinned, ...visible];
              }
            }
            const hiddenCount = query ? 0 : userLabels.length - visible.length;
            return (
              <>
                {userLabels.length > SIDEBAR_LABEL_LIMIT && (
                  <div className="mx-2 mb-1.5 flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1">
                    <SearchIcon className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" strokeWidth={2.25} />
                    <input
                      type="text"
                      data-testid="label-search-input"
                      value={labelSearch}
                      onChange={(e) => setLabelSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setLabelSearch(""); }}
                      placeholder="Search labels…"
                      aria-label="Search labels"
                      className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
                    />
                    {labelSearch && (
                      <button
                        type="button"
                        onClick={() => setLabelSearch("")}
                        aria-label="Clear label search"
                        className="shrink-0 text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                      >
                        <XIcon className="h-3 w-3" strokeWidth={2.25} />
                      </button>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-0.5 px-1">
                  {visible.map((l) => {
                    const unread = sidebarLabelUnread(l.id);
                    const active = filterLabelId === l.id;
                    const accent = labelColorMap.get(l.id) ?? labelAccentStyle(l);
                    return (
                      <LabelSidebarItem
                        key={l.id}
                        label={l}
                        active={active}
                        unread={unread}
                        accent={accent}
                        onSelect={() => {
                          // Clicking the active label again clears the filter.
                          if (filterLabelId === l.id) {
                            switchMailFolder("inbox");
                            return;
                          }
                          setFilterLabelId(l.id);
                          setFolder("inbox");
                          setSelectedId(null);
                          setMessages(null);
                        }}
                        onClear={() => switchMailFolder("inbox")}
                        onEdit={handleLabelEdit}
                        onDelete={handleLabelDelete}
                      />
                    );
                  })}
                  {userLabels.length === 0 && !showNewLabelForm && (
                    <p className="px-4 py-1 text-[12px] text-[var(--color-text-faint)]">No labels yet</p>
                  )}
                  {query && visible.length === 0 && (
                    <p className="px-4 py-1 text-[12px] text-[var(--color-text-faint)]">No matching labels</p>
                  )}
                  {hiddenCount > 0 && (
                    <p className="px-4 py-1 text-[11px] text-[var(--color-text-faint)]">
                      {hiddenCount} more — use search
                    </p>
                  )}
                </div>
              </>
            );
          })()}
        </>

        </aside>

      {/* Handle lives outside the aside (which clips overflow) in a zero-width
          slot, so the grip can straddle the divider instead of hugging inside it. */}
      <div className="relative z-20 hidden w-0 shrink-0 md:block">
        <PaneResizeHandle
          onMouseDown={onSidebarResizeStart}
          onDoubleClick={resetSidebarWidth}
          collapsed={sidebarCollapsed}
          collapsible
          className="absolute inset-y-0 left-0 -translate-x-1/2"
        />
      </div>

      {/* ══ RIGHT CONTENT AREA ══ */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">

        {/* Mobile mail nav — compose + primary folders (replaces left rail) */}
        <div className="z-20 flex shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)] md:hidden">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <button
              type="button"
              onClick={() => openNewCompose()}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--color-copper)] px-4 text-[14px] font-medium text-white shadow-sm"
            >
              <PencilLine className="h-4 w-4 shrink-0" strokeWidth={2} />
              {titleCase("Compose")}
            </button>
            <button
              type="button"
              onClick={() => void handleMailListRefresh()}
              className="btn-ghost flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0"
              title={titleCase("Refresh")}
            >
              <IconRefresh className={cn("h-4 w-4", listRefreshing && "animate-spin")} />
            </button>
          </div>
          <div className="flex items-stretch overflow-x-auto scrollbar-thin">
            {mobilePrimaryFolders.map(({ key, label, Icon, countId, unreadOnly }) => {
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
                  onClick={() => switchMailFolder(key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
                    active
                      ? "border-[var(--color-copper)] text-[var(--color-copper)]"
                      : "border-transparent text-[var(--color-text-muted)]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {titleCase(label)}
                  {badge !== null && (
                    <span className="text-[10px] tabular-nums opacity-80">
                      {badge > 999 ? `${Math.floor(badge / 1000)}k` : badge}
                    </span>
                  )}
                </button>
              );
            })}
            <div ref={mobileFolderMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMobileFolderMenuOpen((v) => !v)}
                className={cn(
                  "flex h-full items-center gap-1 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
                  mobileMoreFolderActive || mobileFolderMenuOpen
                    ? "border-[var(--color-copper)] text-[var(--color-copper)]"
                    : "border-transparent text-[var(--color-text-muted)]",
                )}
              >
                {titleCase("More")}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", mobileFolderMenuOpen && "rotate-180")} />
              </button>
              {mobileFolderMenuOpen && (
                <ul className="absolute left-0 top-full z-30 min-w-[11rem] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-md)]">
                  {mobileMoreFolders.map(({ key, label, Icon, countId, unreadOnly }) => {
                    const count = countId ? labelCounts[countId] : undefined;
                    const badge = countId
                      ? unreadOnly
                        ? (count?.unread && count.unread > 0 ? count.unread : null)
                        : (count?.total && count.total > 0 ? count.total : null)
                      : null;
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => switchMailFolder(key)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-offset)]",
                            folder === key && "bg-[var(--color-copper-tint)] font-medium text-[var(--color-copper)]",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{titleCase(label)}</span>
                          {badge !== null && (
                            <span className="text-[10px] tabular-nums text-[var(--color-text-faint)]">{badge}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* ── Category tabs (Primary / Promotions / Social…) — top of right area, only on Inbox ── */}
        {folder === "inbox" && !filterLabelId && (
          <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-bg)]">
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
                  onPointerDown={() => primeListView("inbox", INBOX_CATEGORY_LABEL[t.key])}
                  onClick={() => switchCategory(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-5 py-3 text-[13px] font-medium transition-colors",
                    active
                      ? "border-[var(--color-copper)] font-semibold text-[var(--color-copper)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
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
                "relative flex min-h-0 flex-col overflow-hidden bg-[var(--color-bg)]",
              selectedId
                ? "hidden w-full shrink-0 border-[var(--color-border)] md:flex md:border-r"
                : "flex flex-1",
            )}
            style={selectedId ? { width: listPaneWidth } : undefined}
          >

            {/* Gmail-style top bar — manual refresh + load-more */}
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 z-20 h-[3px] overflow-hidden transition-opacity duration-200",
                listRefreshing || loadingMore ? "opacity-100" : "opacity-0"
              )}
              aria-hidden={!listRefreshing && !loadingMore}
              aria-live="polite"
              aria-busy={listRefreshing || loadingMore}
            >
              {listRefreshing ? (
                <div className="h-full w-1/4 animate-gmail-refresh-indeterminate bg-[var(--color-copper)]" />
              ) : loadingMore ? (
                <div className="h-full w-full origin-left animate-progress-bar bg-[var(--color-copper)]" />
              ) : null}
            </div>

            {/* Search bar + Compose now render in the WorkspaceChrome topbar — see topbarActions below. */}

            {/* Bulk-action / select-all toolbar */}
            {threads.length > 0 && (
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-[12px]">
                <input
                  data-testid="inbox-select-all-checkbox"
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-[var(--color-copper)]"
                  aria-label="Select all"
                  title={allSelected ? "Deselect all" : "Select all"}
                />
                {selectedThreadIds.size > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                      aria-label={titleCase("Clear selection")}
                      title={titleCase("Clear selection")}
                    >
                      <IconX className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <span className="text-[var(--color-text-muted)]">
                      {selectedThreadIds.size} selected
                    </span>
                    <div className="ml-2 flex items-center gap-0.5">
                      {folder !== "drafts" && (
                        <LabelPicker
                          allLabels={allLabels.filter((l) => l.type === "user")}
                          selected={bulkLabelSelected}
                          onToggle={handleBulkLabelToggle}
                          onCreate={handleBulkLabelCreate}
                          onEdit={handleLabelEdit}
                          onDelete={handleLabelDelete}
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
                      {/* Bulk star */}
                      {(() => {
                        const allStarred = Array.from(selectedThreadIds).every(
                          (id) => threads.find((t) => t.id === id)?.starred
                        );
                        return (
                          <RowAction
                            title={allStarred ? "Remove star" : "Add star"}
                            onClick={() => void performBulkAction("star")}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill={allStarred ? "#f6c026" : "none"} stroke={allStarred ? "#f6c026" : "currentColor"} strokeWidth="2">
                              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                            </svg>
                          </RowAction>
                        );
                      })()}
                      {/* Bulk important — Gmail uses a filled/outlined bookmark shape */}
                      {(() => {
                        const allImportant = Array.from(selectedThreadIds).every(
                          (id) => (threads.find((t) => t.id === id)?.labelIds ?? []).includes("IMPORTANT")
                        );
                        return (
                          <RowAction
                            title={allImportant ? "Remove important" : "Mark as important"}
                            onClick={() => void performBulkAction("important")}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill={allImportant ? "#f6c026" : "none"} stroke={allImportant ? "#f6c026" : "currentColor"} strokeWidth="2" strokeLinejoin="round">
                              <path d="M19 3H5a1 1 0 0 0-1 1v16l8-4 8 4V4a1 1 0 0 0-1-1z" />
                            </svg>
                          </RowAction>
                        );
                      })()}
                      {allowDelete && (
                        <RowAction
                          title={folder === "trash" ? "Delete forever" : "Move to trash"}
                          onClick={() => {
                            if (
                              folder === "trash" &&
                              !window.confirm("Delete the selected conversations forever? This cannot be undone.")
                            ) {
                              return;
                            }
                            void performBulkAction(folder === "trash" ? "deleteForever" : "trash");
                          }}
                        >
                          <Trash2 className="h-[15px] w-[15px]" />
                        </RowAction>
                      )}
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
              <ul className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
                {[...Array(20)].map((_, i) => {
                  // Vary widths slightly per row so the skeleton looks like
                  // a real list (different sender name lengths + subject lengths)
                  // instead of a uniform stripe pattern.
                  const senderW = i % 3 === 0 ? "w-[120px]" : i % 3 === 1 ? "w-[95px]" : "w-[140px]";
                  const subjectW = i % 4 === 0 ? "w-[70%]" : i % 4 === 1 ? "w-[55%]" : i % 4 === 2 ? "w-[85%]" : "w-[40%]";
                  const dateW = i % 2 === 0 ? "w-[58px]" : "w-[72px]";
                  return (
                    <li key={i} className="flex w-full items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
                      <div className="skeleton-shimmer h-[34px] w-[34px] shrink-0 rounded-full" />
                      <div className="min-w-0 w-full flex-1">
                        <div className="flex w-full items-center gap-2">
                          <div className={cn("skeleton-shimmer h-3 shrink-0 rounded", senderW)} />
                          <span className="min-w-2 flex-1" />
                          <div className={cn("skeleton-shimmer h-2.5 shrink-0 rounded", dateW)} />
                        </div>
                        <div className={cn("skeleton-shimmer mt-2 h-2.5 rounded", subjectW)} />
                      </div>
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
              // Flat Gmail-style colors (no border/shadow), but rounded,
              // spaced-out rows rather than Gmail's own flush hairline-divided
              // list — gap-1.5 back instead of divide-y, since rounded corners
              // on edge-to-edge rows would cut a straight divider line across
              // a curved corner.
              <ul
                ref={listScrollRef}
                className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-y-contain p-3"
              >
                {threads.map((t) => {
                  const name = senderName(t.from);
                  const fromEmail = extractEmailAddress(t.from || "");
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
                      data-testid={`inbox-thread-${t.id}`}
                      onPointerDown={() => {
                        if (t.draftId) prefetchDraft(t.draftId);
                        else prefetchThread(t.id);
                      }}
                      onClick={(e) => {
                        const t0 = e.target as HTMLElement;
                        if (t0.closest("button, input, label, a")) return;
                        if (t.draftId) void openDraft(t.draftId);
                        else void openThread(t.id);
                      }}
                      className={cn(
                        "group relative cursor-pointer rounded-xl text-[13px] transition-colors",
                        isActiveThread || isSelected
                          ? "bg-[var(--color-copper-tint)]"
                          : "bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]",
                        isUnread && !isActiveThread && !isSelected && "font-semibold",
                      )}
                    >
                      {/* Mobile — compact two-line row (desktop layout unchanged below). */}
                      <div className="flex flex-col gap-0.5 px-3 py-2.5 md:hidden">
                        <div className="flex min-w-0 items-center gap-2">
                          {isUnread && (
                            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-copper)]" />
                          )}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void toggleThreadStar(t.id, !isStarred); }}
                            disabled={isBusy}
                            className={cn(
                              "shrink-0 text-[15px] leading-none",
                              isStarred ? "text-yellow-500" : "text-[var(--color-text-faint)]",
                            )}
                            aria-label={isStarred ? "Unstar" : "Star"}
                          >
                            {isStarred ? "★" : "☆"}
                          </button>
                          <span className={cn(
                            "min-w-0 flex-1 truncate text-[14px]",
                            isUnread ? "font-bold text-[var(--color-text)]" : "font-medium text-[var(--color-text)]",
                          )}>
                            {searchHighlight.length > 0 ? (
                              <SearchHighlight text={name} terms={searchHighlight} />
                            ) : (
                              name
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {(t.hasCalendarInvite ?? isCalendarInviteThread({ subject: t.subject, from: t.from, snippet: t.snippet })) && (
                              <IconCalendar className="h-3.5 w-3.5 text-[var(--color-text-faint)]" />
                            )}
                            {t.hasAttachments && !(t.hasCalendarInvite ?? isCalendarInviteThread({ subject: t.subject, from: t.from, snippet: t.snippet })) && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--color-text-faint)]" aria-hidden>
                                <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.49" />
                              </svg>
                            )}
                            <time className={cn(
                              "whitespace-nowrap text-[11px] tabular-nums",
                              isUnread ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-faint)]",
                            )}>
                              {t.date ? formatDate(t.date) : ""}
                            </time>
                          </span>
                        </div>
                        <p className="min-w-0 truncate pl-5 text-[13px] text-[var(--color-text-muted)]">
                          <span className={isUnread ? "font-semibold text-[var(--color-text)]" : undefined}>
                            {searchHighlight.length > 0 ? (
                              <SearchHighlight text={t.subject || "(no subject)"} terms={searchHighlight} />
                            ) : (
                              t.subject || "(no subject)"
                            )}
                          </span>
                          {t.snippet ? (
                            <span className="text-[var(--color-text-faint)]">
                              {" — "}
                              {searchHighlight.length > 0 ? (
                                <SearchHighlight text={t.snippet} terms={searchHighlight} />
                              ) : (
                                t.snippet
                              )}
                            </span>
                          ) : null}
                        </p>
                      </div>

                      <div className="hidden items-start gap-3 overflow-hidden px-3.5 py-3 md:flex">
                        {/* Checkbox — overlaps the avatar's top-left corner. An unread
                            dot shows there by default; on row hover (or once selected)
                            it yields to the checkbox for bulk actions. */}
                        <span className="relative mt-0.5 shrink-0">
                          <GmailAvatar
                            seed={fromEmail || name}
                            name={name}
                            email={fromEmail || undefined}
                            size={34}
                          />
                          <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center">
                            {isUnread && !isSelected && (
                              <span
                                aria-hidden
                                className="pointer-events-none absolute h-2.5 w-2.5 rounded-full border-2 border-[var(--color-surface)] bg-[var(--color-copper)] transition-opacity group-hover:opacity-0"
                              />
                            )}
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelection(t.id)}
                              onClick={(e) => e.stopPropagation()}
                              className={cn(
                                "h-3.5 w-3.5 cursor-pointer accent-[var(--color-copper)] transition-opacity",
                                isUnread && !isSelected
                                  ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                  : "opacity-100",
                              )}
                              aria-label="Select"
                            />
                          </span>
                        </span>

                        <button
                          type="button"
                          onClick={() => t.draftId ? void openDraft(t.draftId) : void openThread(t.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-[13px]",
                                isUnread ? "font-bold text-[var(--color-text)]" : "font-semibold text-[var(--color-text)]",
                              )}
                            >
                              {searchHighlight.length > 0 ? (
                                <SearchHighlight text={name} terms={searchHighlight} />
                              ) : (
                                name
                              )}
                            </span>
                            <time className={cn(
                              "shrink-0 whitespace-nowrap text-[11.5px] tabular-nums",
                              isUnread ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
                            )}>
                              {t.date ? formatDate(t.date) : ""}
                            </time>
                          </span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                            {chips.length > 0 && (
                              <span className="flex shrink-0 items-center gap-1">
                                {chips.map((l) => (
                                  <LabelChip key={l.id} label={l} accent={labelColorMap.get(l.id)} />
                                ))}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12.5px]">
                              <span className={cn(isUnread ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]")}>
                                {searchHighlight.length > 0 ? (
                                  <SearchHighlight text={t.subject || "(no subject)"} terms={searchHighlight} />
                                ) : (
                                  t.subject || "(no subject)"
                                )}
                              </span>
                              {t.snippet ? (
                                <span className="font-normal text-[var(--color-text-faint)]">
                                  {" — "}
                                  {searchHighlight.length > 0 ? (
                                    <SearchHighlight text={t.snippet} terms={searchHighlight} />
                                  ) : (
                                    t.snippet
                                  )}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>

                        {/* Right-side controls: calendar/attachment icon, important marker, star */}
                        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
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
                                <IconCalendar className="h-[15px] w-[15px] text-[var(--color-text-faint)]" />
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
                          {/* Important marker — Gmail-style filled/outlined label bookmark.
                              Always visible (not hover-gated) so users can scan importance
                              at a glance exactly like in Gmail's own list view. */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void toggleThreadImportant(t.id, !t.important); }}
                            disabled={isBusy}
                            className={cn(
                              "flex w-4 shrink-0 items-center justify-center transition-colors",
                              t.important
                                ? "text-yellow-400 hover:text-yellow-300"
                                : "text-[var(--color-text-faint)] hover:text-yellow-400"
                            )}
                            aria-label={t.important ? "Mark not important" : "Mark as important"}
                            title={t.important ? "Mark not important" : "Mark as important"}
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
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
                              "flex w-4 shrink-0 items-center justify-center text-[14px] leading-none transition-colors",
                              isStarred
                                ? "text-yellow-500 hover:text-yellow-400"
                                : "text-[var(--color-text-faint)] hover:text-yellow-500"
                            )}
                            aria-label={isStarred ? "Unstar" : "Star"}
                            title={isStarred ? "Unstar" : "Star"}
                          >
                            {isStarred ? "★" : "☆"}
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}

                {/* Skeleton rows appended inside the scroll list while loading more.
                    Mirrors the real card layout (avatar, sender + date, subject line)
                    so the swap-in is seamless. */}
                {loadingMore && [0,1,2,3].map((i) => {
                  const senderW = i % 3 === 0 ? "w-[120px]" : i % 3 === 1 ? "w-[95px]" : "w-[140px]";
                  const subjectW = i % 4 === 0 ? "w-[70%]" : i % 4 === 1 ? "w-[55%]" : i % 4 === 2 ? "w-[85%]" : "w-[40%]";
                  const dateW = i % 2 === 0 ? "w-[58px]" : "w-[72px]";
                  return (
                    <li key={`skel-${i}`} className="flex w-full items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
                      <div className="skeleton-shimmer h-[34px] w-[34px] shrink-0 rounded-full" />
                      <div className="min-w-0 w-full flex-1">
                        <div className="flex w-full items-center gap-2">
                          <div className={cn("skeleton-shimmer h-3 shrink-0 rounded", senderW)} />
                          <span className="min-w-2 flex-1" />
                          <div className={cn("skeleton-shimmer h-2.5 shrink-0 rounded", dateW)} />
                        </div>
                        <div className={cn("skeleton-shimmer mt-2 h-2.5 rounded", subjectW)} />
                      </div>
                    </li>
                  );
                })}

                {/* Sentinel: sits at bottom of scroll list; IntersectionObserver fires load-more */}
                {nextPageToken && (
                  <li ref={loadMoreSentinelRef} className="h-4 list-none" aria-hidden />
                )}
              </ul>
            )}
            {selectedId && (
              <PaneResizeHandle onMouseDown={onListPaneResizeStart} onDoubleClick={resetListPaneWidth} />
            )}
          </div>

        {/* ── THREAD DETAIL view ── */}
        {selectedId && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
            {loadingThread ? (
              <div className="flex h-full flex-col">
                {/* Header skeleton — mirrors the real subject row + sender meta */}
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 md:px-4">
                  <div className="mb-3 flex items-center gap-1 border-b border-[var(--color-border)] pb-2">
                    <ThreadPaneNavButton variant="back" onClick={closeThread} className="md:hidden" />
                    <LabelPicker
                      allLabels={allLabels}
                      selected={openThreadLabelSelected}
                      onToggle={toggleThreadLabel}
                      onCreate={createAndApplyLabel}
                      onEdit={handleLabelEdit}
                      onDelete={handleLabelDelete}
                      align="left"
                    />
                    <ThreadPaneNavButton variant="close" onClick={closeThread} className="ml-auto hidden md:inline-flex" />
                  </div>
                  <div className="mb-3 flex items-center gap-3 px-2 md:px-0">
                    <div className="skeleton-shimmer h-5 w-2/3 rounded md:h-6" />
                  </div>
                  {/* Sender + email + date row (pl-12 in real header) */}
                  <div className="flex items-center gap-3 pl-12">
                    <div className="skeleton-shimmer h-3.5 w-28 rounded" />
                    <div className="skeleton-shimmer h-3 w-44 rounded" />
                    <div className="skeleton-shimmer ml-auto h-3 w-20 rounded" />
                  </div>
                  {/* "N messages in thread" caption */}
                  <div className="mt-2 pl-12">
                    <div className="skeleton-shimmer h-2.5 w-32 rounded" />
                  </div>
                </div>

                {/* Message-card skeletons (two — typical thread is 1-3 messages) */}
                <div className="flex-1 space-y-4 overflow-hidden p-4 md:p-6">
                  {[0, 1].map((idx) => (
                    <article
                      key={idx}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 md:p-6"
                    >
                      {/* Top row: avatar + from/to + date */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="skeleton-shimmer h-7 w-7 rounded-full" />
                          <div className="space-y-1.5">
                            <div className="skeleton-shimmer h-3 w-36 rounded" />
                            <div className="skeleton-shimmer h-2.5 w-24 rounded" />
                          </div>
                        </div>
                        <div className="skeleton-shimmer h-2.5 w-16 shrink-0 rounded" />
                      </div>
                      {/* Body lines — multiple at varying widths */}
                      <div className="mt-4 space-y-2">
                        <div className="skeleton-shimmer h-3 w-full rounded" />
                        <div className="skeleton-shimmer h-3 w-[92%] rounded" />
                        <div className="skeleton-shimmer h-3 w-[78%] rounded" />
                        {idx === 0 && (
                          <>
                            <div className="skeleton-shimmer h-3 w-[88%] rounded" />
                            <div className="skeleton-shimmer h-3 w-[40%] rounded" />
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : threadError ? (
              <div className="flex flex-1 flex-col gap-4 p-6">
                <button data-testid="inbox-close-thread-btn" type="button" onClick={closeThread} className="btn-ghost inline-flex h-9 w-fit items-center gap-2 px-3 text-[13px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  {titleCase("Back")}
                </button>
                <p className="text-sm text-[var(--color-danger)]">{threadError}</p>
              </div>
            ) : messages && messages.length ? (
              <>
                {/* Thread header — subject + actions only, no redundant sender info */}
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-2 md:px-4">
                  <div className="mb-2 flex items-center gap-1 border-b border-[var(--color-border)] pb-2">
                    <ThreadPaneNavButton variant="back" onClick={closeThread} className="md:hidden" />
                    <LabelPicker
                      allLabels={allLabels}
                      selected={openThreadLabelSelected}
                      onToggle={toggleThreadLabel}
                      onCreate={createAndApplyLabel}
                      onEdit={handleLabelEdit}
                      onDelete={handleLabelDelete}
                      align="left"
                    />
                    <ThreadPaneNavButton
                      variant="close"
                      onClick={closeThread}
                      className="ml-auto hidden md:inline-flex"
                    />
                  </div>
                  <p className="mb-1 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-copper)] md:px-0">
                    {titleCase(folder === "allmail" ? "All mail" : folder)}
                  </p>
                  <div className="flex items-center gap-2 px-2 md:px-0">
                    <h2 className="font-display min-w-0 flex-1 text-[20px] font-bold leading-snug tracking-tight text-[var(--color-text)] md:text-[22px]">
                      {messages[0]?.subject || "(no subject)"}
                    </h2>
                    {messages.length > 1 && (
                      <span className="shrink-0 rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-faint)]">
                        {messages.length}
                      </span>
                    )}
                    <ThreadActionsMenu
                      onReply={() => openReply("reply")}
                      onReplyAll={() => openReply("replyAll")}
                      onForward={() => openForward()}
                    />
                  </div>
                  {(openThreadLabelSelected.size > 0 || threadLabelIds.length > 0) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {mergeThreadLabelIds(threadLabelIds, Array.from(openThreadLabelSelected))
                        .map((id) => labelsById.get(id))
                        .filter((l): l is GmailLabel => !!l && l.type === "user")
                        .map((l) => (
                          <LabelChip
                            key={l.id}
                            label={l}
                            accent={labelColorMap.get(l.id)}
                            onRemove={() => void toggleThreadLabel(l.id, false)}
                          />
                        ))}
                    </div>
                  )}
                </div>

                {/* Messages + reply actions (scroll together like Gmail) */}
                <div className="scrollbar-thin flex-1 overflow-y-auto">
                  {threadRows.map((row) =>
                    row.kind === "divider" ? (
                      <ThreadMiddleDivider
                        key="middle-divider"
                        count={row.count}
                        onExpand={() => setMiddleExpanded(true)}
                      />
                    ) : (
                      <MessageBubble
                        key={row.message.id}
                        m={row.message}
                        isLast={row.isLast}
                        trackingRow={trackingMap[row.message.id]}
                        myEmail={myEmail}
                        onReply={() => openReply("reply")}
                        onReplyAll={() => openReply("replyAll")}
                        onForward={() => openForward()}
                      />
                    )
                  )}

                  <GmailInlineReply
                    onStartReply={() => openReply("reply")}
                    onStartReplyAll={() => openReply("replyAll")}
                    onForward={() => openForward()}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col gap-4 p-6">
                <button data-testid="inbox-close-thread-btn" type="button" onClick={closeThread} className="btn-ghost inline-flex h-9 w-fit items-center gap-2 px-3 text-[13px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  {titleCase("Back")}
                </button>
                <p className="text-sm text-[var(--color-text-muted)]">{titleCase("No messages in thread.")}</p>
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
            "fixed bottom-6 left-6 z-[1100] flex items-center gap-3 rounded-lg px-4 py-3 text-[13px] font-medium text-white shadow-xl transition-all",
            sendSnack.phase === "error"
              ? "bg-[var(--color-danger)]"
              : "bg-[var(--color-text)]"
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
              <span>{sendSnack.message ?? "Message sent"}</span>
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
              {sendSnack.retry && (
                <button
                  type="button"
                  onClick={sendSnack.retry}
                  className="ml-1 rounded bg-[var(--color-surface)]/15 px-2 py-0.5 text-[12px] font-semibold hover:bg-[var(--color-surface)]/25"
                >
                  Retry
                </button>
              )}
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
        sendDisabled={
          Object.keys(driveUploadProgress).length > 0 ||
          (massSending ? massMergeRows.length === 0 : !composeTo.trim())
        }
        composeError={composeFieldError?.message ?? null}
        composeErrorTitle={composeFieldError?.title ?? null}
        onDismissComposeError={() => setComposeFieldError(null)}
        onMinimize={() => setComposeMinimized((m) => !m)}
        onToggleFullscreen={() => setComposeFullscreen((v) => !v)}
        onClose={closeComposeAndSaveDraft}
        onSend={() => {
          if (!massSending) return void sendCompose();
          void sendMassCampaign();
        }}
        // Any draft with variables gets reviewed once before it can go out —
        // mass or not. Deliberately not offered when there is nothing to merge
        // against (no recipient yet, or several): GmailComposeDialog hides Send
        // whenever Review exists, so offering an impossible review would leave
        // the draft with no way forward. sendCompose explains those cases.
        onReview={
          draftUsesMergeVariables && (massSending ? massMergeRows.length > 0 : !!singleMergeRow)
            ? () =>
                setReviewEmail(
                  massSending ? massMergeRows[0]?.email ?? null : singleMergeRow?.email ?? null
                )
            : undefined
        }
        reviewDisabled={massSending ? massMergeRows.length === 0 : !singleMergeRow}
        onDiscard={discardComposeDraft}
        placement="centered"
        // Normal compose merges against its one recipient's contact card, so it
        // offers the same card-backed set a campaign does. Only an imported
        // list replaces that set with its own columns.
        variables={editorVariables}
        unknownPlaceholders={unknownPlaceholders}
        uploadInlineImage={uploadComposeInlineImage}
        // Labels for the mail being written, applied when it is sent.
        labelsButton={
          <LabelPicker
            variant="icon"
            allLabels={allLabels}
            selected={composeLabelSelected}
            onToggle={(labelId, checked) =>
              setComposeLabelIds((cur) =>
                checked ? (cur.includes(labelId) ? cur : [...cur, labelId]) : cur.filter((id) => id !== labelId)
              )
            }
            onCreate={createComposeLabel}
            align="left"
          />
        }
        templatesButton={
          templatesEnabled ? (
            <MailTemplatesButton
              subject={composeSubject}
              bodyHtml={composeBody}
              draftIsEmpty={!composeSubject.trim() && richTextIsEmpty(composeBody)}
              onApply={applyMailTemplate}
            />
          ) : undefined
        }
        recipientsLocked={massSending}
        lockedRecipientCount={massAudience.length}
        massSending={massSending}
        onMassSendingChange={(on) => {
          // Confirm only when the flip actually destroys something: To
          // addresses survive the conversion, so going in only costs Cc/Bcc,
          // while coming out clears the audience (and, for an imported list,
          // the draft written against its columns). A contact-card draft is no
          // longer at risk either way, so it no longer forces a prompt.
          const losesWork = on
            ? !!(composeCc.trim() || composeBcc.trim())
            : massAudience.length > 0 || !!massImport;
          if (losesWork) {
            setMassToggleConfirm(on ? "on" : "off");
            return;
          }
          applyMassSending(on);
        }}
        sendLabel={massSending ? `Send emails (${massMergeRows.length})` : "Send email"}
        review={
          reviewRow
            ? {
                toLabel: reviewRow.name || reviewRow.email,
                subject: mergeTemplate(composeSubject, reviewRow.fields),
                // Tinting is an editor affordance — the review screen shows
                // the mail exactly as the recipient will receive it.
                bodyHtml: stripVariableSpans(mergeTemplate(composeBody, reviewRow.fields)),
                missingKeys: reviewMissing,
                unknownKeys: massSending ? draftUnknownKeys : undefined,
                unknownSource: massImport?.fileName,
                noContactCard: !reviewRow.hasCard,
                fallbacks: variableFallbacks,
                onFallbackChange: (key, value) =>
                  setVariableFallbacks((prev) => {
                    const next = { ...prev };
                    if (value.trim()) next[key] = value.trim();
                    else delete next[key];
                    return next;
                  }),
              }
            : null
        }
        onBackToEditor={() => setReviewEmail(null)}
        footerNotice={
          massSending ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-[#f1f3f4] bg-white px-4 py-2 text-[12px] text-[#5f6368]">
              <IconInfo className="h-3.5 w-3.5 shrink-0" />
              <span>Delivery time will depend on items in your outbox.</span>
            </div>
          ) : null
        }
        sidePanel={
          massSending ? (
            <MassRecipientsPanel
              suggestions={massSuggestions}
              directoryEmails={directoryEmails}
              syncedEmails={syncedEmails}
              selected={massAudience}
              onChange={setMassRecipients}
              missingByEmail={massUnresolved}
              readOnly={!!reviewEmail}
              activeEmail={reviewEmail}
              onActiveEmailChange={setReviewEmail}
              source={massSource}
              onSourceChange={(next) => {
                setMassSource(next);
                setMassImportError(null);
                setReviewEmail(null);
                // Variables differ per source, so fallbacks typed against the
                // old set would silently attach to unrelated keys and start
                // clean. The subject and body are kept: what the user typed is
                // theirs, and a `{token}` the new source cannot fill is already
                // handled — tinted until a file arrives, flagged red once it
                // has, and offered a fallback on review (see
                // unknownPlaceholders) — while in contact mode it is prose.
                setVariableFallbacks({});
              }}
              imported={massImport}
              onImportFile={(file) => void importMassFile(file)}
              onImportSheet={(sheet, tab) => void importMassSheet(sheet, tab)}
              onClearImport={clearMassImport}
              importBusy={massImportBusy}
              importError={massImportError}
            />
          ) : null
        }
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

      {massToggleConfirm ? (
        <MassSendingToggleDialog
          direction={massToggleConfirm}
          onCancel={() => setMassToggleConfirm(null)}
          onConfirm={() => applyMassSending(massToggleConfirm !== "off")}
        />
      ) : null}

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
      data-testid={variant === "back" ? "inbox-back-btn" : "inbox-close-thread-btn"}
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full p-0 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]",
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
