"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { isValidE164, normalizePhone } from "@/lib/phone";
import {
  formatWhatsAppDeliveryLabel,
  getDeliveryFailureAdvice,
  isWhatsAppDeliveryFailed,
} from "@/lib/whatsapp-delivery";
import { WhatsAppComposerBar, type WhatsAppSendPayload } from "@/components/WhatsAppComposerBar";
import { showWhatsAppFailureDetail, WhatsAppTicks } from "@/components/WhatsAppTicks";
import { titleCase } from "@/lib/title-case";
import {
  IconCheck,
  IconCopy,
  IconDotsVertical,
  IconForward,
  IconInfo,
  IconMessageChat,
  IconPin,
  IconRefresh,
  IconReply,
  IconSettings,
  IconStar,
  IconTrash,
  IconX,
} from "@/components/Icons";

const EMOJI_FONT =
  "[font-family:system-ui,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol','Apple_Color_Emoji','Noto_Color_Emoji']";

const POLL_MS = 1500;

/* ── helpers ──────────────────────────────────────────────── */
function mergeFetchedMessages(prev: Msg[], incoming: Msg[]): Msg[] {
  const optimistics = prev.filter((m) => m.id.startsWith("optimistic-"));
  const kept = optimistics.filter(
    (o) =>
      !incoming.some(
        (n) =>
          (n.message_sid && o.message_sid === n.message_sid) ||
          (n.body === o.body &&
            Math.abs(new Date(n.created_at).getTime() - new Date(o.created_at).getTime()) < 120_000)
      )
  );
  return [...incoming, ...kept].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function hasNewMessages(prev: Msg[], incoming: Msg[]): boolean {
  const prevReal = prev.filter((m) => !m.id.startsWith("optimistic-"));
  if (incoming.length > prevReal.length) return true;
  if (!incoming.length) return false;
  return prevReal[prevReal.length - 1]?.id !== incoming[incoming.length - 1]?.id;
}

function previewOutboundBody(
  payload: WhatsAppSendPayload,
  needsTemplate: boolean,
  templateVar1: string,
  templateVar2: string,
  draft: string
): string {
  if (needsTemplate) return `Hi ${templateVar1}, this is ${templateVar2} from PlaceCom`;
  if (payload.messageType === "text") return payload.text?.trim() || draft.trim();
  if (payload.mediaCaption?.trim()) return payload.mediaCaption.trim();
  if (payload.mediaFilename) return `[${payload.messageType}: ${payload.mediaFilename}]`;
  return `[${payload.messageType}]`;
}

/** Format E.164 for display: +91 98494 31508 */
function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (e164.startsWith("+91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return e164;
}

function peerInitials(peer: string): string {
  const digits = peer.replace(/\D/g, "");
  if (digits.length >= 2) return digits.slice(-2);
  return peer.slice(0, 2).toUpperCase() || "?";
}

function formatListTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d);
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  } catch {
    return "—";
  }
}

/* ── types ────────────────────────────────────────────────── */
type Conv = { peer_e164: string; last_body: string | null; last_at: string; last_dir: string };
type Msg = {
  id: string;
  direction: string;
  peer_e164?: string;
  from_addr?: string | null;
  to_addr?: string | null;
  body: string | null;
  message_sid?: string | null;
  num_media?: number;
  delivery_status?: string | null;
  media_url?: string | null;
  content_type?: string | null;
  created_at: string;
  reply_to_id?: string | null;
  is_starred?: boolean;
  is_pinned?: boolean;
};

type StatusPayload = {
  provider?: string;
  sendConfigured?: boolean;
  apiHost?: string;
  businessLine?: string | null;
  lineError?: string | null;
  defaultTemplate?: {
    name: string;
    languageCode: string;
    bodyParamCount: number;
    previewExample?: string;
  };
  sandbox?: boolean;
  fromPreview?: string | null;
  suggestedInboundWebhookUrl?: string | null;
  migrationHint?: string;
};

function recipientE164(raw: string): string {
  return normalizePhone(raw.trim());
}

export type WhatsAppMessagingProps = {
  embedded?: boolean;
};

/* ── component ────────────────────────────────────────────── */
export function WhatsAppMessaging({ embedded = false }: WhatsAppMessagingProps) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [peer, setPeer] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [draft, setDraft] = useState("");
  const [sessionOpen, setSessionOpen] = useState<boolean | null>(null);
  const [forceTemplate, setForceTemplate] = useState(false);
  const [templateVar1, setTemplateVar1] = useState("");
  const [templateVar2, setTemplateVar2] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollThreadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageRowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [infoMsg, setInfoMsg] = useState<Msg | null>(null);
  const [menu, setMenu] = useState<{ msg: Msg; x: number; y: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newPhoneInput, setNewPhoneInput] = useState(false);
  // Contact names — stored in localStorage keyed by E.164
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null); // peer E.164 being renamed
  const [nameInput, setNameInput] = useState("");

  // Load contacts from Supabase on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/whatsapp/contacts");
        const data = (await res.json()) as { contacts?: { peer_e164: string; name: string }[] };
        if (res.ok && data.contacts) {
          const map: Record<string, string> = {};
          for (const c of data.contacts) map[c.peer_e164] = c.name;
          setContacts(map);
        }
      } catch { /* ignore — contacts just won't show names */ }
    })();
  }, []);

  async function saveName(peer: string, name: string) {
    const trimmed = name.trim();
    // Optimistic update
    setContacts((prev) =>
      trimmed
        ? { ...prev, [peer]: trimmed }
        : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== peer))
    );
    setEditingName(null);
    setNameInput("");
    try {
      if (trimmed) {
        await fetch("/api/whatsapp/contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peer_e164: peer, name: trimmed }),
        });
      } else {
        await fetch("/api/whatsapp/contacts", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peer_e164: peer }),
        });
      }
    } catch { /* ignore — optimistic state already applied */ }
  }

  function displayName(peer: string): string {
    return contacts[peer] || formatPhone(peer);
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const body = (await res.json()) as StatusPayload & { error?: string };
      if (res.ok) setStatus(body);
    } catch { /* ignore */ }
  }, []);

  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) { setLoadingList(true); setError(null); }
    try {
      const res = await fetch("/api/whatsapp/conversations");
      const body = (await res.json()) as { conversations?: Conv[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load conversations");
      setConversations(body.conversations || []);
    } catch (e) {
      if (!silent) setError(clientFetchFailedMessage(e));
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (p: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) { setLoadingThread(true); setError(null); }
    try {
      const res = await fetch(`/api/whatsapp/messages?peer=${encodeURIComponent(p)}`, { cache: "no-store" });
      const body = (await res.json()) as { messages?: Msg[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load messages");
      const incoming = body.messages || [];
      setMessages((prev) => {
        if (!silent) {
          // Initial load: replace entirely — never show old peer's messages
          setStickToBottom(true);
          return incoming;
        }
        // Background poll: merge to preserve optimistic messages
        if (hasNewMessages(prev, incoming)) queueMicrotask(() => setStickToBottom(true));
        return mergeFetchedMessages(prev, incoming);
      });
    } catch (e) {
      if (!silent) setError(clientFetchFailedMessage(e));
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadConversations();
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversations({ silent: true });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadConversations({ silent: true });
        if (peer) void loadMessages(peer, { silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [loadStatus, loadConversations, loadMessages, peer]);

  useEffect(() => {
    // Clear previous peer's messages immediately so they never bleed into the new thread
    setMessages([]);
    setStickToBottom(true); setSelectMode(false); setSelectedIds([]);
    setReplyTo(null); setMenu(null); setInfoMsg(null);
    messageRowRefs.current.clear(); setHighlightMessageId(null);
  }, [peer]);

  useEffect(() => () => { if (highlightClearRef.current) clearTimeout(highlightClearRef.current); }, []);

  const scrollToQuotedMessage = useCallback((targetId: string) => {
    const el = messageRowRefs.current.get(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightMessageId(targetId);
    if (highlightClearRef.current) clearTimeout(highlightClearRef.current);
    highlightClearRef.current = setTimeout(() => setHighlightMessageId(null), 2200);
  }, []);

  useEffect(() => {
    const raw = peer || newPhone.trim();
    const p = recipientE164(raw);
    if (!raw || !isValidE164(p)) { setSessionOpen(null); return; }
    void (async () => {
      try {
        const res = await fetch(`/api/whatsapp/session?peer=${encodeURIComponent(p)}`);
        const data = (await res.json()) as { sessionOpen?: boolean };
        if (res.ok) setSessionOpen(data.sessionOpen ?? false);
      } catch { setSessionOpen(null); }
    })();
  }, [peer, newPhone]);

  useEffect(() => {
    if (!peer) return;
    void loadMessages(peer, { silent: false });
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadMessages(peer, { silent: true });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [peer, loadMessages]);

  const onThreadScroll = useCallback(() => {
    const el = scrollThreadRef.current;
    if (!el) return;
    setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 72);
  }, []);

  useLayoutEffect(() => {
    const el = scrollThreadRef.current;
    if (!el || !peer || !stickToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, stickToBottom, peer]);

  async function patchMessage(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/whatsapp/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error || "Update failed");
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function insertAtCursor(insert: string) {
    const el = textareaRef.current;
    setDraft((prev) => {
      if (!el) return prev + insert;
      const start = Math.min(el.selectionStart ?? prev.length, prev.length);
      const end = Math.min(el.selectionEnd ?? prev.length, prev.length);
      const next = prev.slice(0, start) + insert + prev.slice(end);
      const caret = start + insert.length;
      queueMicrotask(() => { el.focus(); el.setSelectionRange(caret, caret); });
      return next;
    });
  }

  const needsTemplate = forceTemplate || sessionOpen === false;

  async function sendMessage(payload: WhatsAppSendPayload) {
    const to = recipientE164(peer || newPhone);
    if (!isValidE164(to)) { setError("Enter a valid mobile with country code, e.g. +918489431508"); return; }
    if (needsTemplate && (!templateVar1.trim() || !templateVar2.trim())) {
      setError("Fill in both template fields (recipient name and your name)."); return;
    }

    const tempId = `optimistic-${crypto.randomUUID()}`;
    const previewBody = previewOutboundBody(payload, needsTemplate, templateVar1, templateVar2, draft);
    const optimisticMsg: Msg = {
      id: tempId, direction: "outbound", peer_e164: to, body: previewBody,
      created_at: new Date().toISOString(), delivery_status: "sent", message_sid: null,
      num_media: payload.mediaUrl ? 1 : 0, media_url: payload.mediaUrl ?? null,
      content_type: needsTemplate ? "template" : payload.messageType,
      reply_to_id: replyTo?.id ?? null,
    };

    setError(null); setStickToBottom(true);
    setMessages((prev) => [...prev, optimisticMsg]);
    setDraft(""); setReplyTo(null); setMobileShowThread(true);
    if (!peer) { setPeer(to); setNewPhone(""); setNewPhoneInput(false); }

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, useTemplate: needsTemplate,
          messageType: needsTemplate ? "template" : payload.messageType,
          text: payload.text ?? draft.trim(),
          ...(needsTemplate ? { templateVariables: [templateVar1.trim(), templateVar2.trim()] } : {}),
          mediaUrl: payload.mediaUrl, mediaCaption: payload.mediaCaption,
          mediaFilename: payload.mediaFilename,
          ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        }),
      });
      const body = (await res.json()) as { error?: string; peerE164?: string; messageSid?: string };
      if (!res.ok) throw new Error(body.error || "Send failed");
      const threadPeer = body.peerE164 || to;
      if (peer && peer !== threadPeer) setPeer(threadPeer);
      setMessages((prev) =>
        prev.map((m) => m.id === tempId
          ? { ...m, message_sid: body.messageSid ?? m.message_sid, delivery_status: "sent" }
          : m
        )
      );
      void loadConversations({ silent: true });
      void loadMessages(threadPeer, { silent: true });
    } catch (e) {
      const err = clientFetchFailedMessage(e);
      setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, delivery_status: `failed: ${err}` } : m));
      setError(err);
    }
  }

  const selectPeer = (p: string) => { setPeer(p); setMobileShowThread(true); setNewPhoneInput(false); };

  /* ── Sidebar conversation list ─────────────────────────── */
  const sidebar = (
    <aside
      className={cn(
        "flex min-h-0 flex-col border-[var(--color-border)] bg-[var(--color-surface)] lg:w-[300px] lg:shrink-0 lg:border-r",
        mobileShowThread && peer ? "hidden lg:flex" : "flex",
      )}
    >
      {/* Sidebar header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <p className="text-[13px] font-semibold text-[var(--color-text)]">{titleCase("Chats")}</p>
        <button
          type="button"
          onClick={() => setNewPhoneInput((v) => !v)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold transition-colors",
            newPhoneInput
              ? "bg-[var(--color-primary)] text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
          )}
          title={titleCase("New chat")}
          aria-label={titleCase("New chat")}
        >
          {newPhoneInput ? "×" : "+"}
        </button>
      </div>

      {/* New number input */}
      {newPhoneInput && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]/50 px-3 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
            {titleCase("New conversation")}
          </p>
          <div className="flex gap-2">
            <input
              className="input-field min-w-0 flex-1 text-[13px]"
              placeholder="+91… or 10-digit"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const t = recipientE164(newPhone);
                if (!isValidE164(t)) { setError("Enter a valid mobile, e.g. +918489431508"); return; }
                setError(null); selectPeer(t);
              }}
              autoFocus
            />
            <button
              type="button"
              className="btn-primary shrink-0 px-3 text-[13px]"
              onClick={() => {
                const t = recipientE164(newPhone);
                if (!isValidE164(t)) { setError("Enter a valid mobile, e.g. +918489431508"); return; }
                setError(null); selectPeer(t);
              }}
            >
              {titleCase("Open")}
            </button>
          </div>
        </div>
      )}

      {/* Conversation list */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {loadingList ? (
          <div className="space-y-0">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-offset)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              <IconMessageChat className="h-7 w-7 text-[var(--color-text-faint)]" />
            </div>
            <p className="mt-3 text-[13px] font-medium text-[var(--color-text)]">{titleCase("No chats yet")}</p>
            <p className="mt-1 text-[12px] text-[var(--color-text-faint)]">{titleCase("Tap + to start a new conversation")}</p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.peer_e164}
              type="button"
              onClick={() => selectPeer(c.peer_e164)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left transition-colors duration-100",
                peer === c.peer_e164
                  ? "bg-[var(--color-primary-tint)]"
                  : "hover:bg-[var(--color-surface-offset)]"
              )}
            >
              <span className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white",
                peer === c.peer_e164 ? "bg-[var(--color-primary)]" : "bg-[#25d366]"
              )}>
                {peerInitials(c.peer_e164)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn(
                    "truncate text-[13px]",
                    peer === c.peer_e164 ? "font-semibold text-[var(--color-primary)]" : "font-medium text-[var(--color-text)]"
                  )}>
                    {displayName(c.peer_e164)}
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">{formatListTime(c.last_at)}</span>
                </span>
                <span className="mt-0.5 line-clamp-1 text-[12px] text-[var(--color-text-muted)]">
                  {c.last_dir === "outbound" ? "You: " : ""}{c.last_body || "—"}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </aside>
  );

  /* ── Chat thread ───────────────────────────────────────── */
  const thread = (
    <main
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        !mobileShowThread || !peer ? "hidden lg:flex" : "flex",
      )}
      style={{
        background: "var(--wa-bg, #efeae2)",
      }}
    >
      {/* Thread header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
        {/* Mobile back */}
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] lg:hidden"
          onClick={() => setMobileShowThread(false)}
          aria-label="Back to chats"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {peer ? (
          <>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[11px] font-bold text-white">
              {peerInitials(peer)}
            </span>
            <div className="min-w-0 flex-1">
              {editingName === peer ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); void saveName(peer, nameInput); }}
                >
                  <input
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder={formatPhone(peer)}
                    className="input-field h-7 flex-1 text-[13px]"
                    onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(null); setNameInput(""); } }}
                  />
                  <button type="submit" className="btn-primary h-7 px-2.5 text-[12px]">Save</button>
                  <button type="button" className="btn-ghost h-7 px-2 text-[12px]" onClick={() => { setEditingName(null); setNameInput(""); }}>✕</button>
                </form>
              ) : (
                <button
                  type="button"
                  className="group flex items-center gap-1 text-left"
                  onClick={() => { setEditingName(peer); setNameInput(contacts[peer] || ""); }}
                  title="Save contact name"
                >
                  <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{displayName(peer)}</p>
                  <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-[var(--color-text-faint)] opacity-0 transition-opacity group-hover:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>
                </button>
              )}
              {sessionOpen !== null && editingName !== peer && (
                <p className="text-[11px] text-[var(--color-text-faint)]">
                  {sessionOpen ? "● Session open" : "○ Session closed — template required"}
                </p>
              )}
            </div>
          </>
        ) : (
          <span className="flex-1 text-[14px] text-[var(--color-text-muted)]">{titleCase("Select a chat")}</span>
        )}

        {selectMode ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--color-text-muted)]">{selectedIds.length} selected</span>
            <button
              type="button"
              disabled={selectedIds.length === 0 || actionBusy}
              className="btn-ghost gap-1 px-2 py-1 text-[12px]"
              onClick={() => {
                const parts = messages.filter((m) => selectedIds.includes(m.id)).map((m) => m.body || "");
                void navigator.clipboard.writeText(parts.join("\n---\n"));
              }}
            >
              <IconCopy className="h-3.5 w-3.5" /> Copy
            </button>
            <button
              type="button"
              disabled={selectedIds.length === 0 || actionBusy}
              className="btn-ghost gap-1 px-2 py-1 text-[12px] text-[var(--color-danger)]"
              onClick={() => {
                if (!peer || selectedIds.length === 0) return;
                if (!window.confirm(titleCase("Delete selected messages from this view?"))) return;
                setActionBusy(true);
                void (async () => {
                  try {
                    for (const id of selectedIds) await patchMessage(id, { soft_delete: true });
                    setSelectMode(false); setSelectedIds([]);
                    await loadMessages(peer, { silent: true });
                    await loadConversations({ silent: true });
                  } catch (e) { setError(clientFetchFailedMessage(e)); }
                  finally { setActionBusy(false); }
                })();
              }}
            >
              <IconTrash className="h-3.5 w-3.5" /> Delete
            </button>
            <button type="button" className="btn-ghost px-2 py-1 text-[12px]" onClick={() => { setSelectMode(false); setSelectedIds([]); }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {peer && (
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                onClick={() => { setSelectMode(true); setSelectedIds([]); }}
                title="Select messages"
              >
                <IconCheck className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadConversations()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
              title={titleCase("Refresh")}
            >
              <IconRefresh className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSetupOpen((v) => !v)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                setupOpen
                  ? "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
              )}
              title={titleCase("Setup")}
            >
              <IconSettings className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Setup drawer */}
      {setupOpen && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-warning-light)] px-4 py-3 text-[13px] text-[var(--color-text)]">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="font-semibold">{titleCase("Exotel WhatsApp setup")}</p>
            <button type="button" onClick={() => setSetupOpen(false)} className="rounded p-1 hover:bg-black/10" aria-label="Close">
              <IconX className="h-4 w-4" />
            </button>
          </div>
          <ol className="list-decimal space-y-1.5 pl-4 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
            <li>Admin assigns each team member their <strong>Exotel number</strong> and <strong>mobile</strong> under Admin → Team.</li>
            <li>API host: <code className="rounded bg-white/80 px-1">{status?.apiHost ?? "api.exotel.com"}</code> (set <code className="rounded bg-white/80 px-1">EXOTEL_API_HOST=api.in.exotel.com</code> for Mumbai).</li>
            <li>Env vars: <code className="rounded bg-white/80 px-1">EXOTEL_SID</code>, <code className="rounded bg-white/80 px-1">EXOTEL_API_KEY</code>, <code className="rounded bg-white/80 px-1">EXOTEL_API_TOKEN</code>, <code className="rounded bg-white/80 px-1">EXOTEL_VIRTUAL_NUMBERS</code>.</li>
            <li>Inbound webhook: <code className="break-all rounded bg-white/80 px-1">{status?.suggestedInboundWebhookUrl || "https://YOUR_HOST/api/exotel/whatsapp"}</code></li>
            <li>Your line: <code className="rounded bg-white/80 px-1">{status?.businessLine || status?.lineError || "not assigned"}</code></li>
          </ol>
          {status?.migrationHint && <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">{status.migrationHint}</p>}
        </div>
      )}

      {/* Error bar */}
      {error && (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-[12px] text-[var(--color-danger)] dark:border-red-900/40 dark:bg-red-950/30">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Messages area */}
      <div
        ref={scrollThreadRef}
        onScroll={onThreadScroll}
        className={cn("relative min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-3 scrollbar-thin", EMOJI_FONT)}
        style={{
          background: "var(--wa-bg, #efeae2)",
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.03) 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      >
        {!peer ? (
          <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/60 shadow-sm">
              <IconMessageChat className="h-8 w-8 text-[#25d366]" />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[var(--color-text)]">{titleCase("Select a conversation")}</p>
              <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{titleCase("Or tap + to start a new chat")}</p>
            </div>
          </div>
        ) : loadingThread ? (
          <div className="flex h-full items-center justify-center">
            <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#25d366] border-t-transparent" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("No messages yet.")}</p>
            <p className="text-[12px] text-[var(--color-text-faint)]">{titleCase("Send a message to start the conversation.")}</p>
          </div>
        ) : (
          <>
            {/* Pinned messages */}
            {messages.some((m) => m.is_pinned) && (
              <div className="mb-2 rounded-xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[12px]">
                <p className="mb-1 font-semibold text-amber-900">📌 {titleCase("Pinned")}</p>
                {messages.filter((m) => m.is_pinned).map((m) => (
                  <p key={`pin-${m.id}`} className="line-clamp-1 text-amber-800">{m.body || "—"}</p>
                ))}
              </div>
            )}

            {messages.map((m) => {
              const replyRef = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : undefined;
              const selected = selectedIds.includes(m.id);
              const outbound = m.direction?.toLowerCase() === "outbound";
              return (
                <div
                  key={m.id}
                  ref={(el) => { if (el) messageRowRefs.current.set(m.id, el); else messageRowRefs.current.delete(m.id); }}
                  className={cn(
                    "group flex w-full items-end gap-1.5 transition-[box-shadow] duration-300",
                    outbound ? "justify-end" : "justify-start",
                    highlightMessageId === m.id && "ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[#efeae2] rounded-lg",
                  )}
                >
                  {/* Select checkbox (inbound side) */}
                  {!outbound && selectMode && (
                    <button
                      type="button"
                      className={cn(
                        "mb-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        selected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-text-faint)] bg-white"
                      )}
                      onClick={() => toggleSelected(m.id)}
                    >
                      {selected && <IconCheck className="h-3 w-3 text-white" />}
                    </button>
                  )}

                  {/* Bubble */}
                  <div
                    role={selectMode ? "button" : undefined}
                    tabIndex={selectMode ? 0 : undefined}
                    onClick={() => { if (selectMode) toggleSelected(m.id); }}
                    onContextMenu={(e) => { if (selectMode) return; e.preventDefault(); setMenu({ msg: m, x: e.clientX, y: e.clientY }); }}
                    onKeyDown={(e) => { if (selectMode && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleSelected(m.id); } }}
                    className={cn(
                      "relative max-w-[min(75%,28rem)] rounded-2xl px-3 py-2 text-[14px] leading-relaxed shadow-sm",
                      outbound
                        ? "rounded-br-sm bg-[#dcf8c6] text-zinc-900"
                        : "rounded-bl-sm bg-white text-zinc-900",
                      selectMode && selected && "ring-2 ring-[var(--color-primary)]",
                    )}
                  >
                    {/* Starred indicator */}
                    {m.is_starred && <span className="absolute -right-1 -top-1 text-amber-400">★</span>}

                    {/* Message menu button */}
                    {!selectMode && (
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100"
                        aria-label={titleCase("Message options")}
                        onClick={(e) => { e.stopPropagation(); setMenu({ msg: m, x: e.clientX, y: e.clientY }); }}
                      >
                        <IconDotsVertical className="h-3.5 w-3.5 text-zinc-500" />
                      </button>
                    )}

                    {/* Reply quote */}
                    {replyRef ? (
                      <button
                        type="button"
                        className="mb-2 w-full rounded-lg border-l-4 border-[#25d366] bg-black/5 px-2 py-1.5 text-left hover:bg-black/10"
                        onClick={(e) => { e.stopPropagation(); scrollToQuotedMessage(replyRef.id); }}
                      >
                        <p className="text-[10px] font-semibold text-[#25d366]">
                          {replyRef.direction?.toLowerCase() === "outbound" ? "You" : "Contact"}
                        </p>
                        <p className="line-clamp-2 text-[12px] text-zinc-700">{replyRef.body || "—"}</p>
                      </button>
                    ) : m.reply_to_id ? (
                      <div className="mb-2 rounded-lg border-l-4 border-zinc-300 bg-black/5 px-2 py-1.5 text-[11px] text-zinc-500">
                        Original message not in history
                      </div>
                    ) : null}

                    {/* Body */}
                    <p className="whitespace-pre-wrap break-words [word-break:break-word]">{m.body || "—"}</p>

                    {/* Media */}
                    {m.media_url && (m.content_type === "image" || !m.content_type) ? (
                      <a href={m.media_url} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.media_url} alt="" className="max-h-56 w-full rounded-lg object-cover" />
                      </a>
                    ) : m.media_url ? (
                      <a href={m.media_url} target="_blank" rel="noopener noreferrer"
                        className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1.5 text-[12px] font-medium text-zinc-700 hover:bg-black/10">
                        📎 {titleCase("Open attachment")}
                      </a>
                    ) : null}

                    {/* Timestamp + ticks */}
                    <p className={cn(
                      "mt-1 flex items-center gap-1 text-[11px] text-zinc-500",
                      outbound ? "justify-end" : "justify-start"
                    )}>
                      <span className="tabular-nums">{formatDate(m.created_at)}</span>
                      {outbound && <WhatsAppTicks deliveryStatus={m.delivery_status} />}
                    </p>

                    {/* Delivery failure detail */}
                    {outbound && showWhatsAppFailureDetail(m.delivery_status) && (
                      <p className="mt-1 text-[11px] leading-snug text-red-700">
                        {getDeliveryFailureAdvice(m.delivery_status)}
                      </p>
                    )}
                  </div>

                  {/* Select checkbox (outbound side) */}
                  {outbound && selectMode && (
                    <button
                      type="button"
                      className={cn(
                        "mb-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        selected ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-text-faint)] bg-white"
                      )}
                      onClick={() => toggleSelected(m.id)}
                    >
                      {selected && <IconCheck className="h-3 w-3 text-white" />}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Context menu — portalled to body so overflow:hidden doesn't clip it */}
      {menu && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" aria-hidden onClick={() => setMenu(null)} />
          <div
            className="fixed z-[60] min-w-[13rem] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-lg)]"
            style={{
              left: Math.max(8, Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 210 : menu.x)),
              top: Math.max(8, Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 340 : menu.y)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {([
              { key: "reply",   label: "Reply",        icon: IconReply,   onClick: () => { setReplyTo(menu.msg); setMenu(null); } },
              { key: "copy",    label: "Copy",         icon: IconCopy,    onClick: () => { void navigator.clipboard.writeText(menu.msg.body || ""); setMenu(null); } },
              { key: "forward", label: "Forward",      icon: IconForward, onClick: () => { setDraft((d) => (d ? `${d}\n\n` : "") + `[Forwarded]\n${menu.msg.body || ""}`); setMenu(null); } },
              { key: "pin",     label: menu.msg.is_pinned ? "Unpin" : "Pin", icon: IconPin, onClick: () => { void (async () => { try { await patchMessage(menu.msg.id, { is_pinned: !menu.msg.is_pinned }); if (peer) await loadMessages(peer, { silent: true }); } catch (e) { setError(clientFetchFailedMessage(e)); } finally { setMenu(null); } })(); } },
              { key: "star",    label: menu.msg.is_starred ? "Unstar" : "Star", icon: IconStar, onClick: () => { void (async () => { try { await patchMessage(menu.msg.id, { is_starred: !menu.msg.is_starred }); if (peer) await loadMessages(peer, { silent: true }); } catch (e) { setError(clientFetchFailedMessage(e)); } finally { setMenu(null); } })(); } },
              { key: "info",    label: "Message info", icon: IconInfo,    onClick: () => { setInfoMsg(menu.msg); setMenu(null); } },
              { key: "select",  label: "Select",       icon: IconCheck,   onClick: () => { setSelectMode(true); setSelectedIds([menu.msg.id]); setMenu(null); } },
              { key: "delete",  label: "Delete",       icon: IconTrash,   danger: true, onClick: () => { if (!window.confirm(titleCase("Delete this message?"))) { setMenu(null); return; } void (async () => { try { await patchMessage(menu.msg.id, { soft_delete: true }); if (peer) await loadMessages(peer, { silent: true }); await loadConversations({ silent: true }); } catch (e) { setError(clientFetchFailedMessage(e)); } finally { setMenu(null); } })(); } },
            ] as const).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-offset)]",
                    "danger" in item && item.danger ? "text-[var(--color-danger)]" : "text-[var(--color-text)]"
                  )}
                  onClick={item.onClick}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-60" />
                  {titleCase(item.label)}
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* Message info dialog — portalled to body */}
      {infoMsg && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          role="dialog" aria-modal
          onClick={() => setInfoMsg(null)}
        >
          <div
            className="surface-card max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-5 shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h3 className="font-display text-[16px] font-semibold text-[var(--color-text)]">{titleCase("Message info")}</h3>
              <button type="button" className="btn-ghost rounded-lg p-1.5" onClick={() => setInfoMsg(null)}>
                <IconX className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-3 text-[13px]">
              {[
                { label: "Direction", value: infoMsg.direction },
                { label: "Sent", value: formatDate(infoMsg.created_at) },
                { label: "Delivery", value: infoMsg.delivery_status ? formatWhatsAppDeliveryLabel(infoMsg.delivery_status) : null, danger: infoMsg.delivery_status ? isWhatsAppDeliveryFailed(infoMsg.delivery_status) : false },
                { label: "From", value: infoMsg.from_addr, mono: true },
                { label: "To", value: infoMsg.to_addr, mono: true },
                { label: "Message SID", value: infoMsg.message_sid, mono: true },
              ].filter((r) => r.value).map((r) => (
                <div key={r.label} className="rounded-lg bg-[var(--color-surface-offset)]/50 px-3 py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">{r.label}</dt>
                  <dd className={cn("mt-0.5 break-all text-[var(--color-text)]", r.mono && "font-mono text-[12px]", "danger" in r && r.danger && "text-[var(--color-danger)]")}>{r.value}</dd>
                </div>
              ))}
              <div className="rounded-lg bg-[var(--color-surface-offset)]/50 px-3 py-2">
                <dt className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">Body</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-[var(--color-text)]">{infoMsg.body || "—"}</dd>
              </div>
            </dl>
          </div>
        </div>,
        document.body
      )}

      {/* Composer */}
      <div ref={composerRef} className="relative shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
        {replyTo && (
          <div className="mx-3 mt-2 flex items-start gap-2 rounded-xl border-l-4 border-[#25d366] bg-[var(--color-surface-offset)] px-3 py-2 text-[12px]">
            <IconReply className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#25d366]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[#25d366]">
                {replyTo.direction?.toLowerCase() === "outbound" ? "You" : "Contact"}
                <span className="ml-1 font-normal text-[var(--color-text-faint)]">· {formatDate(replyTo.created_at)}</span>
              </p>
              <p className="line-clamp-2 text-[var(--color-text-muted)]">{replyTo.body || "—"}</p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-1 text-[var(--color-text-faint)] hover:bg-[var(--color-border)]"
              onClick={() => setReplyTo(null)}
              aria-label={titleCase("Clear reply")}
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <WhatsAppComposerBar
          wrapperRef={composerRef}
          needsTemplate={needsTemplate}
          draft={draft}
          onDraftChange={setDraft}
          templateVar1={templateVar1}
          templateVar2={templateVar2}
          onTemplateVar1Change={setTemplateVar1}
          onTemplateVar2Change={setTemplateVar2}
          forceTemplate={forceTemplate}
          onForceTemplateChange={setForceTemplate}
          templateName={status?.defaultTemplate?.name}
          templatePreview={status?.defaultTemplate?.previewExample}
          uploading={uploading}
          onUploadingChange={setUploading}
          recipientValid={isValidE164(recipientE164(peer || newPhone))}
          onInsertEmoji={insertAtCursor}
          onSend={(p) => void sendMessage(p)}
          textareaRef={textareaRef}
        />
      </div>
    </main>
  );

  /* ── Shell ─────────────────────────────────────────────── */
  const shell = (
    <div
      className={cn(
        "surface-card flex flex-col overflow-hidden rounded-2xl",
        embedded
          ? "h-[min(680px,calc(100vh-12rem))]"
          : "h-[min(720px,calc(100vh-8rem))]",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {sidebar}
        {thread}
      </div>
    </div>
  );

  if (embedded) return shell;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="animate-fade-up flex items-end justify-between" style={{ animationDuration: "0.3s" }}>
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("WhatsApp")}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-faint)]">
            {status?.sendConfigured
              ? `Connected · ${status.sandbox ? "Sandbox" : "Live"}${status.businessLine ? ` · ${formatPhone(status.businessLine)}` : ""}`
              : titleCase("Check configuration via the settings icon")}
          </p>
        </div>
      </div>
      {shell}
    </div>
  );
}
