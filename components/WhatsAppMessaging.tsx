"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { isValidE164, normalizePhone } from "@/lib/phone";
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
  IconSend,
  IconSettings,
  IconStar,
  IconTrash,
  IconX,
} from "@/components/Icons";

/** Color emoji + text fall back correctly in bubbles and composer */
const EMOJI_FONT =
  "[font-family:system-ui,sans-serif,'Segoe_UI_Emoji','Segoe_UI_Symbol','Apple_Color_Emoji','Noto_Color_Emoji']";

const EMOJI_PICKER: string[] = [
  "😀",
  "😃",
  "😄",
  "😁",
  "😅",
  "😂",
  "🤣",
  "😊",
  "😇",
  "🙂",
  "😉",
  "😍",
  "🥰",
  "😘",
  "😋",
  "😎",
  "🤔",
  "🙄",
  "😴",
  "🤝",
  "👍",
  "👎",
  "👏",
  "🙌",
  "🙏",
  "✌️",
  "🤞",
  "💪",
  "❤️",
  "🧡",
  "💛",
  "💚",
  "💙",
  "💜",
  "🔥",
  "✨",
  "💯",
  "✅",
  "❌",
  "⚠️",
  "📌",
  "📎",
  "📞",
  "💼",
  "📝",
  "✉️",
  "🎉",
  "👋",
  "☕",
  "🙋",
  "🙋‍♂️",
  "🙋‍♀️",
];

type Conv = { peer_e164: string; last_body: string | null; last_at: string; last_dir: string };
type Msg = {
  id: string;
  direction: string;
  peer_e164?: string;
  from_addr?: string | null;
  to_addr?: string | null;
  body: string | null;
  message_sid?: string | null;
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
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) {
      return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(d);
    }
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
  } catch {
    return "—";
  }
}

export type WhatsAppMessagingProps = {
  /** When true, omit page-level title (e.g. inside Broadcasting tabs). */
  embedded?: boolean;
};

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
  const [sending, setSending] = useState(false);
  const [sessionOpen, setSessionOpen] = useState<boolean | null>(null);
  const [forceTemplate, setForceTemplate] = useState(false);
  const [templateVar1, setTemplateVar1] = useState("");
  const [templateVar2, setTemplateVar2] = useState("");
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
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

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const body = (await res.json()) as StatusPayload & { error?: string };
      if (res.ok) setStatus(body);
    } catch {
      // ignore
    }
  }, []);

  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoadingList(true);
      setError(null);
    }
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
    if (!silent) {
      setLoadingThread(true);
      setError(null);
    }
    try {
      const res = await fetch(`/api/whatsapp/messages?peer=${encodeURIComponent(p)}`);
      const body = (await res.json()) as { messages?: Msg[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load messages");
      setMessages(body.messages || []);
    } catch (e) {
      if (!silent) setError(clientFetchFailedMessage(e));
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadConversations();
  }, [loadStatus, loadConversations]);

  useEffect(() => {
    setStickToBottom(true);
    setSelectMode(false);
    setSelectedIds([]);
    setReplyTo(null);
    setMenu(null);
    setInfoMsg(null);
    messageRowRefs.current.clear();
    setHighlightMessageId(null);
  }, [peer]);

  useEffect(() => {
    return () => {
      if (highlightClearRef.current) clearTimeout(highlightClearRef.current);
    };
  }, []);

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
    if (!raw || !isValidE164(p)) {
      setSessionOpen(null);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`/api/whatsapp/session?peer=${encodeURIComponent(p)}`);
        const data = (await res.json()) as { sessionOpen?: boolean; requiresTemplate?: boolean };
        if (res.ok) setSessionOpen(data.sessionOpen ?? false);
      } catch {
        setSessionOpen(null);
      }
    })();
  }, [peer, newPhone]);

  useEffect(() => {
    if (!peer) return;
    void loadMessages(peer, { silent: false });
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadMessages(peer, { silent: true });
    }, 8000);
    return () => window.clearInterval(t);
  }, [peer, loadMessages]);

  const onThreadScroll = useCallback(() => {
    const el = scrollThreadRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(gap < 72);
  }, []);

  useLayoutEffect(() => {
    const el = scrollThreadRef.current;
    if (!el || !peer || !stickToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, stickToBottom, peer]);

  useEffect(() => {
    if (!emojiPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node;
      if (composerRef.current && !composerRef.current.contains(node)) setEmojiPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEmojiPickerOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [emojiPickerOpen]);

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
      queueMicrotask(() => {
        el.focus();
        el.setSelectionRange(caret, caret);
      });
      return next;
    });
  }

  const needsTemplate = forceTemplate || sessionOpen === false;

  async function sendMessage() {
    const to = recipientE164(peer || newPhone);
    const text = draft.trim();
    if (!isValidE164(to)) {
      setError("Enter a valid mobile with country code, e.g. +918489431508 or 8489431508");
      return;
    }
    if (needsTemplate) {
      if (!templateVar1.trim() || !templateVar2.trim()) {
        setError("Fill in both template fields (recipient name and your name).");
        return;
      }
    } else if (!text) {
      return;
    }
    setSending(true);
    setError(null);
    setStickToBottom(true);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          text: needsTemplate ? "" : text,
          useTemplate: needsTemplate,
          ...(needsTemplate
            ? { templateVariables: [templateVar1.trim(), templateVar2.trim()] }
            : {}),
          ...(replyTo?.id ? { replyToId: replyTo.id } : {}),
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Send failed");
      setDraft("");
      setReplyTo(null);
      if (!peer) {
        setPeer(to);
        setNewPhone("");
      }
      setMobileShowThread(true);
      await loadConversations({ silent: true });
      await loadMessages(to, { silent: true });
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    } finally {
      setSending(false);
    }
  }

  const selectPeer = (p: string) => {
    setPeer(p);
    setMobileShowThread(true);
  };

  const shell = (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
        embedded
          ? "h-[min(680px,calc(100vh-12rem))] max-h-[calc(100vh-10rem)]"
          : "h-[min(720px,calc(100vh-8rem))] max-h-[calc(100vh-6rem)]",
      )}
    >
      {/* Top chrome */}
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-indigo-700 px-3 py-2.5 text-white dark:border-indigo-900 dark:bg-indigo-950">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <IconMessageChat className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{titleCase("WhatsApp")}</p>
            <p className="truncate text-[11px] text-indigo-100/90">
              {status?.sendConfigured ? titleCase("Twilio connected") : titleCase("Check configuration")}
              {status?.sandbox != null ? ` · ${status.sandbox ? "Sandbox" : "Live"}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadConversations()}
          className="rounded-lg p-2 text-indigo-100 transition hover:bg-white/10"
          title={titleCase("Refresh chats")}
        >
          <IconRefresh className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          className={cn(
            "rounded-lg p-2 transition hover:bg-white/10",
            setupOpen ? "bg-white/20 text-white" : "text-indigo-100",
          )}
          title={titleCase("Setup & webhook")}
        >
          <IconSettings className="h-4 w-4" />
        </button>
      </header>

      {/* Setup drawer */}
      {setupOpen ? (
        <div className="shrink-0 border-b border-zinc-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-50">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-semibold">{titleCase("Exotel WhatsApp setup")}</p>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              className="rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
              aria-label="Close"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
            <li>
              Admin assigns each team member their <strong>Exotel number</strong> and <strong>mobile</strong> under Team (same line used for
              calls).
            </li>
            <li>
              API host in use:{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">{status?.apiHost ?? "api.exotel.com"}</code>{" "}
              (set <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">EXOTEL_API_HOST=api.in.exotel.com</code> for
              Mumbai).
            </li>
            <li>
              Server env: <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">EXOTEL_SID</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">EXOTEL_API_KEY</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">EXOTEL_API_TOKEN</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">EXOTEL_VIRTUAL_NUMBERS</code>.
            </li>
            <li>
              Exotel Dashboard → WhatsApp → Webhooks (inbound + status):{" "}
              <code className="break-all rounded bg-white/80 px-1 dark:bg-zinc-900">
                {status?.suggestedInboundWebhookUrl || "https://YOUR_HOST/api/exotel/whatsapp"}
              </code>
            </li>
            <li>
              Your line:{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">
                {status?.businessLine || status?.lineError || "not assigned"}
              </code>{" "}
              — you only see chats for this number.
            </li>
            <li>
              Migrations: <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0016</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0017</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0023</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0024</code>.
            </li>
          </ol>
          {status?.migrationHint ? <p className="mt-2 text-[11px] opacity-90">{status.migrationHint}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      ) : null}

      {/* Chat + thread */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={cn(
            "flex min-h-0 w-full flex-col border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50 lg:w-[300px] lg:max-h-full lg:shrink-0 lg:border-r",
            mobileShowThread && peer ? "hidden max-h-[38vh] lg:flex lg:max-h-full" : "flex max-h-[38vh] lg:max-h-full",
          )}
        >
          <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{titleCase("Chats")}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList ? (
              <p className="p-4 text-sm text-zinc-500">{titleCase("Loading…")}</p>
            ) : conversations.length === 0 ? (
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("No chats yet. Start below.")}</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.peer_e164}
                  type="button"
                  onClick={() => selectPeer(c.peer_e164)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left transition dark:border-zinc-800/80",
                    peer === c.peer_e164 ? "bg-indigo-100/90 dark:bg-indigo-950/50" : "hover:bg-white dark:hover:bg-zinc-900",
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                    {peerInitials(c.peer_e164)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{c.peer_e164}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400">{formatListTime(c.last_at)}</span>
                    </span>
                    <span className="line-clamp-1 text-xs text-zinc-500">{c.last_body || "—"}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <p className="mb-1.5 text-[11px] font-medium text-zinc-500">{titleCase("New number")}</p>
            <div className="flex gap-2">
              <input
                className="input-field min-w-0 flex-1 text-sm"
                placeholder="+91… or 10-digit mobile"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary shrink-0 px-3 py-2 text-xs"
                onClick={() => {
                  const t = recipientE164(newPhone);
                  if (!isValidE164(t)) {
                    setError("Enter a valid mobile, e.g. +918489431508 or 8489431508");
                    return;
                  }
                  setError(null);
                  selectPeer(t);
                }}
              >
                {titleCase("Open")}
              </button>
            </div>
          </div>
        </aside>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#e5ddd5] dark:bg-zinc-900",
            !mobileShowThread || !peer ? "hidden min-h-[240px] lg:flex" : "flex min-h-0",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/80 bg-zinc-100/95 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/95">
            <button
              type="button"
              className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-200 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
              onClick={() => setMobileShowThread(false)}
              aria-label="Back to chats"
            >
              ←
            </button>
            {selectMode ? (
              <>
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2 py-1 text-xs"
                  onClick={() => {
                    setSelectMode(false);
                    setSelectedIds([]);
                  }}
                >
                  {titleCase("Cancel")}
                </button>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {selectedIds.length} {titleCase("selected")}
                </span>
                <button
                  type="button"
                  disabled={selectedIds.length === 0 || actionBusy}
                  className="btn-ghost shrink-0 gap-1 px-2 py-1 text-xs"
                  onClick={() => {
                    const parts = messages.filter((m) => selectedIds.includes(m.id)).map((m) => m.body || "");
                    void navigator.clipboard.writeText(parts.join("\n---\n"));
                  }}
                >
                  <IconCopy className="h-3.5 w-3.5" /> {titleCase("Copy")}
                </button>
                <button
                  type="button"
                  disabled={selectedIds.length === 0 || actionBusy}
                  className="btn-ghost shrink-0 gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400"
                  onClick={() => {
                    if (!peer || selectedIds.length === 0) return;
                    if (!window.confirm(titleCase("Delete selected messages from this view?"))) return;
                    setActionBusy(true);
                    void (async () => {
                      try {
                        for (const id of selectedIds) {
                          await patchMessage(id, { soft_delete: true });
                        }
                        setSelectMode(false);
                        setSelectedIds([]);
                        await loadMessages(peer, { silent: true });
                        await loadConversations({ silent: true });
                      } catch (e) {
                        setError(clientFetchFailedMessage(e));
                      } finally {
                        setActionBusy(false);
                      }
                    })();
                  }}
                >
                  <IconTrash className="h-3.5 w-3.5" /> {titleCase("Delete")}
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {peer || titleCase("Select a chat")}
                </span>
                {peer ? (
                  <button
                    type="button"
                    className="btn-ghost shrink-0 px-2 py-1 text-xs"
                    onClick={() => {
                      setSelectMode(true);
                      setSelectedIds([]);
                    }}
                  >
                    {titleCase("Select")}
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div
            ref={scrollThreadRef}
            onScroll={onThreadScroll}
            className={cn(
              "relative min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden bg-[#efeae2] p-3 dark:bg-zinc-900",
              EMOJI_FONT,
            )}
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)",
              backgroundSize: "16px 16px",
            }}
          >
            {!peer ? (
              <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500">
                <IconMessageChat className="h-12 w-12 text-zinc-300 dark:text-zinc-600" />
                <p>{titleCase("Choose a conversation or open a number from the list.")}</p>
              </div>
            ) : loadingThread ? (
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("Loading messages…")}</p>
            ) : messages.length === 0 ? (
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("No messages in this thread yet.")}</p>
            ) : (
              <>
                {messages.some((m) => m.is_pinned) ? (
                  <div className="mb-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-2 py-1.5 text-xs dark:border-amber-900/50 dark:bg-amber-950/40">
                    <p className="mb-1 font-semibold text-amber-950 dark:text-amber-100">{titleCase("Pinned")}</p>
                    <div className="space-y-1">
                      {messages
                        .filter((m) => m.is_pinned)
                        .map((m) => (
                          <p key={`pin-${m.id}`} className="line-clamp-2 text-amber-900/90 dark:text-amber-50/90">
                            {m.body || "—"}
                          </p>
                        ))}
                    </div>
                  </div>
                ) : null}
                {messages.map((m) => {
                  const replyRef = m.reply_to_id ? messages.find((x) => x.id === m.reply_to_id) : undefined;
                  const selected = selectedIds.includes(m.id);
                  const outbound = String(m.direction || "").toLowerCase() === "outbound";
                  const selectToggle = selectMode ? (
                    <button
                      type="button"
                      className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
                      onClick={() => toggleSelected(m.id)}
                      aria-label={titleCase("Toggle select")}
                    >
                      {selected ? <IconCheck className="h-4 w-4 text-indigo-600" /> : null}
                    </button>
                  ) : null;
                  return (
                    <div
                      key={m.id}
                      ref={(el) => {
                        if (el) messageRowRefs.current.set(m.id, el);
                        else messageRowRefs.current.delete(m.id);
                      }}
                      className={cn(
                        "group flex w-full max-w-full items-start gap-1.5 rounded-lg transition-[box-shadow] duration-300",
                        outbound ? "justify-end" : "justify-start",
                        highlightMessageId === m.id &&
                          "ring-2 ring-indigo-500 ring-offset-2 ring-offset-[#efeae2] dark:ring-offset-zinc-900",
                      )}
                    >
                      {!outbound ? selectToggle : null}
                      <div
                        role={selectMode ? "button" : undefined}
                        tabIndex={selectMode ? 0 : undefined}
                        onClick={() => {
                          if (selectMode) toggleSelected(m.id);
                        }}
                        onContextMenu={(e) => {
                          if (selectMode) return;
                          e.preventDefault();
                          setMenu({ msg: m, x: e.clientX, y: e.clientY });
                        }}
                        onKeyDown={(e) => {
                          if (selectMode && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            toggleSelected(m.id);
                          }
                        }}
                        className={cn(
                          "relative max-w-[min(85%,20rem)] rounded-lg px-2.5 py-1.5 text-base leading-relaxed shadow-sm",
                          outbound
                            ? "rounded-br-sm bg-[#dcf8c6] text-zinc-900 dark:bg-indigo-800 dark:text-indigo-50"
                            : "rounded-bl-sm border border-zinc-200/80 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
                          selectMode && selected && "ring-2 ring-indigo-500 ring-offset-1 dark:ring-offset-zinc-900",
                        )}
                      >
                        {m.is_starred ? (
                          <span className="absolute -right-1 -top-1 text-amber-500" title={titleCase("Starred")}>
                            ★
                          </span>
                        ) : null}
                        {!selectMode ? (
                          <button
                            type="button"
                            className="absolute -right-1 top-1 rounded p-0.5 opacity-0 transition hover:bg-black/10 group-hover:opacity-100 dark:hover:bg-white/10"
                            aria-label={titleCase("Message menu")}
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenu({ msg: m, x: e.clientX, y: e.clientY });
                            }}
                          >
                            <IconDotsVertical className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                          </button>
                        ) : null}
                        {replyRef ? (
                          <button
                            type="button"
                            className="mb-2 w-full rounded-lg border border-indigo-600/35 bg-indigo-50/80 px-2 py-1.5 text-left transition hover:bg-indigo-100/90 dark:border-indigo-400/30 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/55"
                            onClick={(e) => {
                              e.stopPropagation();
                              scrollToQuotedMessage(replyRef.id);
                            }}
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-900/80 dark:text-indigo-100/90">
                              {titleCase("Replied to")}{" "}
                              <span className="normal-case text-indigo-950 dark:text-indigo-50">
                                {String(replyRef.direction || "").toLowerCase() === "outbound"
                                  ? titleCase("You")
                                  : titleCase("Contact")}
                              </span>
                              <span className="mx-1 font-normal text-indigo-800/60 dark:text-indigo-200/60">·</span>
                              <span className="font-normal normal-case text-indigo-900/85 dark:text-indigo-100/85">
                                {formatDate(replyRef.created_at)}
                              </span>
                            </p>
                            <p className="mt-0.5 line-clamp-2 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                              {replyRef.body || "—"}
                            </p>
                            <p className="mt-1 text-[10px] text-indigo-800/80 dark:text-indigo-200/80">
                              {titleCase("View in chat")}
                            </p>
                          </button>
                        ) : m.reply_to_id ? (
                          <div className="mb-2 rounded-lg border border-zinc-300/60 bg-zinc-100/80 px-2 py-1.5 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800/80 dark:text-zinc-400">
                            {titleCase("Replied to a message not loaded here (older than history or deleted).")}
                          </div>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words [word-break:break-word]">{m.body || "—"}</p>
                        <p
                          className={cn(
                            "mt-0.5 text-[10px]",
                            outbound
                              ? "text-right text-indigo-800/70 dark:text-indigo-200/70"
                              : "text-left text-zinc-400",
                          )}
                        >
                          {formatDate(m.created_at)}
                        </p>
                      </div>
                      {outbound ? selectToggle : null}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {menu ? (
            <>
              <div className="fixed inset-0 z-[55]" aria-hidden onClick={() => setMenu(null)} />
              <div
                className="fixed z-[60] min-w-[12.5rem] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                style={{
                  left: Math.max(8, Math.min(menu.x, typeof window !== "undefined" ? window.innerWidth - 200 : menu.x)),
                  top: Math.max(8, Math.min(menu.y, typeof window !== "undefined" ? window.innerHeight - 320 : menu.y)),
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {(
                  [
                    {
                      key: "info",
                      label: titleCase("Message info"),
                      icon: IconInfo,
                      onClick: () => {
                        setInfoMsg(menu.msg);
                        setMenu(null);
                      },
                    },
                    {
                      key: "reply",
                      label: titleCase("Reply"),
                      icon: IconReply,
                      onClick: () => {
                        setReplyTo(menu.msg);
                        setMenu(null);
                      },
                    },
                    {
                      key: "copy",
                      label: titleCase("Copy"),
                      icon: IconCopy,
                      onClick: () => {
                        void navigator.clipboard.writeText(menu.msg.body || "");
                        setMenu(null);
                      },
                    },
                    {
                      key: "forward",
                      label: titleCase("Forward"),
                      icon: IconForward,
                      onClick: () => {
                        const t = menu.msg.body || "";
                        setDraft((d) => (d ? `${d}\n\n` : "") + `[${titleCase("Forwarded")}]\n${t}`);
                        setMenu(null);
                      },
                    },
                    {
                      key: "pin",
                      label: menu.msg.is_pinned ? titleCase("Unpin") : titleCase("Pin"),
                      icon: IconPin,
                      onClick: () => {
                        void (async () => {
                          try {
                            await patchMessage(menu.msg.id, { is_pinned: !menu.msg.is_pinned });
                            if (peer) await loadMessages(peer, { silent: true });
                          } catch (e) {
                            setError(clientFetchFailedMessage(e));
                          } finally {
                            setMenu(null);
                          }
                        })();
                      },
                    },
                    {
                      key: "star",
                      label: menu.msg.is_starred ? titleCase("Unstar") : titleCase("Star"),
                      icon: IconStar,
                      onClick: () => {
                        void (async () => {
                          try {
                            await patchMessage(menu.msg.id, { is_starred: !menu.msg.is_starred });
                            if (peer) await loadMessages(peer, { silent: true });
                          } catch (e) {
                            setError(clientFetchFailedMessage(e));
                          } finally {
                            setMenu(null);
                          }
                        })();
                      },
                    },
                    {
                      key: "select",
                      label: titleCase("Select"),
                      icon: IconCheck,
                      onClick: () => {
                        setSelectMode(true);
                        setSelectedIds([menu.msg.id]);
                        setMenu(null);
                      },
                    },
                    {
                      key: "delete",
                      label: titleCase("Delete"),
                      icon: IconTrash,
                      onClick: () => {
                        if (!window.confirm(titleCase("Delete this message from this view?"))) {
                          setMenu(null);
                          return;
                        }
                        void (async () => {
                          try {
                            await patchMessage(menu.msg.id, { soft_delete: true });
                            if (peer) await loadMessages(peer, { silent: true });
                            await loadConversations({ silent: true });
                          } catch (e) {
                            setError(clientFetchFailedMessage(e));
                          } finally {
                            setMenu(null);
                          }
                        })();
                      },
                    },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                        item.key === "delete" && "text-red-600 dark:text-red-400",
                      )}
                      onClick={item.onClick}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-70" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {infoMsg ? (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
              role="dialog"
              aria-modal
              onClick={() => setInfoMsg(null)}
            >
              <div
                className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{titleCase("Message info")}</h3>
                  <button type="button" className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setInfoMsg(null)}>
                    <IconX className="h-5 w-5" />
                  </button>
                </div>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">{titleCase("Direction")}</dt>
                    <dd className="font-mono text-zinc-900 dark:text-zinc-100">{infoMsg.direction}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">{titleCase("Sent")}</dt>
                    <dd className="text-zinc-900 dark:text-zinc-100">{formatDate(infoMsg.created_at)}</dd>
                  </div>
                  {infoMsg.message_sid ? (
                    <div>
                      <dt className="text-xs font-medium text-zinc-500">Message SID</dt>
                      <dd className="break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{infoMsg.message_sid}</dd>
                    </div>
                  ) : null}
                  {infoMsg.from_addr ? (
                    <div>
                      <dt className="text-xs font-medium text-zinc-500">{titleCase("From")}</dt>
                      <dd className="break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{infoMsg.from_addr}</dd>
                    </div>
                  ) : null}
                  {infoMsg.to_addr ? (
                    <div>
                      <dt className="text-xs font-medium text-zinc-500">{titleCase("To")}</dt>
                      <dd className="break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{infoMsg.to_addr}</dd>
                    </div>
                  ) : null}
                  {infoMsg.peer_e164 ? (
                    <div>
                      <dt className="text-xs font-medium text-zinc-500">{titleCase("Peer")}</dt>
                      <dd className="font-mono text-zinc-900 dark:text-zinc-100">{infoMsg.peer_e164}</dd>
                    </div>
                  ) : null}
                  {infoMsg.reply_to_id ? (
                    <div>
                      <dt className="text-xs font-medium text-zinc-500">{titleCase("Response to")}</dt>
                      <dd className="space-y-2">
                        {(() => {
                          const parent = messages.find((x) => x.id === infoMsg.reply_to_id);
                          if (!parent) {
                            return (
                              <p className="text-xs text-zinc-500">
                                {titleCase("Original message is not in the loaded thread (deleted or outside history).")}
                              </p>
                            );
                          }
                          const parentOutbound = String(parent.direction || "").toLowerCase() === "outbound";
                          return (
                            <>
                              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                {parentOutbound ? titleCase("Your message") : titleCase("Contact message")} ·{" "}
                                {formatDate(parent.created_at)}
                              </p>
                              <p className="line-clamp-3 rounded-lg bg-zinc-50 p-2 text-xs text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                                {parent.body || "—"}
                              </p>
                              <button
                                type="button"
                                className="btn-ghost text-xs"
                                onClick={() => {
                                  setInfoMsg(null);
                                  scrollToQuotedMessage(parent.id);
                                }}
                              >
                                {titleCase("Show in thread")}
                              </button>
                            </>
                          );
                        })()}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs font-medium text-zinc-500">{titleCase("Body")}</dt>
                    <dd className="whitespace-pre-wrap break-words rounded-lg bg-zinc-50 p-2 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
                      {infoMsg.body || "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          ) : null}

          <div
            ref={composerRef}
            className="relative shrink-0 border-t border-zinc-200 bg-zinc-100/95 p-2 dark:border-zinc-800 dark:bg-zinc-900/95"
          >
            {replyTo ? (
              <div className="mb-2 flex items-start gap-2 rounded-xl border border-indigo-200/80 bg-indigo-50/90 px-3 py-2 text-xs dark:border-indigo-900/50 dark:bg-indigo-950/40">
                <IconReply className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700 dark:text-indigo-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-indigo-900 dark:text-indigo-100">
                    {titleCase("Replying to")}{" "}
                    <span className="font-normal">
                      {String(replyTo.direction || "").toLowerCase() === "outbound"
                        ? titleCase("you")
                        : titleCase("contact")}
                    </span>
                    <span className="ml-1 text-[10px] font-normal text-indigo-800/80 dark:text-indigo-200/80">
                      · {formatDate(replyTo.created_at)}
                    </span>
                  </p>
                  <p className="line-clamp-2 text-indigo-800/90 dark:text-indigo-200/90">{replyTo.body || "—"}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-indigo-800 hover:bg-indigo-100 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
                  onClick={() => setReplyTo(null)}
                  aria-label={titleCase("Clear reply")}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            {emojiPickerOpen ? (
              <div
                className={cn(
                  "absolute bottom-full left-2 right-2 z-10 mb-1 max-h-44 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900",
                  EMOJI_FONT,
                )}
                role="listbox"
                aria-label="Emoji"
              >
                <div className="grid grid-cols-8 gap-0.5 sm:grid-cols-10">
                  {EMOJI_PICKER.map((em, idx) => (
                    <button
                      key={`${idx}-${em}`}
                      type="button"
                      className="flex h-9 w-9 items-center justify-center rounded-md text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => {
                        insertAtCursor(em);
                        setEmojiPickerOpen(false);
                      }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {needsTemplate ? (
              <div className="mb-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="font-semibold">{titleCase("Opening message uses approved template")}</p>
                <p className="leading-relaxed opacity-90">
                  WhatsApp only delivers free text after the contact replies (24h window). Your template:{" "}
                  <span className="font-mono">{status?.defaultTemplate?.name ?? "initial_conversation"}</span> —{" "}
                  {status?.defaultTemplate?.previewExample ??
                    "Hi {{1}}, this is {{2}} from PlaceCom"}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-[11px] font-medium">{titleCase("{{1}} Recipient name")}</span>
                    <input
                      className="input-field mt-1 w-full text-sm"
                      value={templateVar1}
                      onChange={(e) => setTemplateVar1(e.target.value)}
                      placeholder="Rahul"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-medium">{titleCase("{{2}} Your name")}</span>
                    <input
                      className="input-field mt-1 w-full text-sm"
                      value={templateVar2}
                      onChange={(e) => setTemplateVar2(e.target.value)}
                      placeholder="Priya"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={forceTemplate}
                    onChange={(e) => setForceTemplate(e.target.checked)}
                  />
                  <span>{titleCase("Always use template (even if session is open)")}</span>
                </label>
              </div>
            ) : (
              <label className="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={forceTemplate}
                  onChange={(e) => setForceTemplate(e.target.checked)}
                />
                <span>{titleCase("Send as approved template instead of free text")}</span>
              </label>
            )}
            <div className="mb-1 flex gap-0.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
              {EMOJI_PICKER.slice(0, 12).map((em, qi) => (
                <button
                  key={`q-${qi}`}
                  type="button"
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-lg hover:bg-zinc-200/80 dark:hover:bg-zinc-800",
                    EMOJI_FONT,
                  )}
                  onClick={() => insertAtCursor(em)}
                  aria-label="Insert emoji"
                >
                  {em}
                </button>
              ))}
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200/80 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  EMOJI_FONT,
                )}
                onClick={() => setEmojiPickerOpen((o) => !o)}
              >
                +{titleCase("More")}
              </button>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                className={cn(
                  "input-field max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border-zinc-300 bg-white py-2.5 text-base leading-normal dark:border-zinc-700 dark:bg-zinc-950",
                  EMOJI_FONT,
                )}
                placeholder={titleCase("Message")}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (
                      !sending &&
                      (needsTemplate || draft.trim()) &&
                      isValidE164(recipientE164(peer || newPhone))
                    ) {
                      void sendMessage();
                    }
                  }
                }}
                autoComplete="off"
                spellCheck
              />
              <button
                type="button"
                className="btn-primary mb-0.5 shrink-0 rounded-full px-4 py-2.5"
                disabled={
                  sending ||
                  !isValidE164(recipientE164(peer || newPhone)) ||
                  (needsTemplate
                    ? !templateVar1.trim() || !templateVar2.trim()
                    : !draft.trim())
                }
                onClick={() => void sendMessage()}
                title={titleCase("Send")}
              >
                {sending ? (
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <IconSend className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );

  if (embedded) {
    return shell;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 py-4">
      <div className="px-1">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{titleCase("WhatsApp")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {titleCase("Session messaging via Twilio. Use the gear menu for webhook and env details.")}
        </p>
      </div>
      {shell}
    </div>
  );
}
