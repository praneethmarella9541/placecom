"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import { IconRefresh, IconSend, IconSettings, IconSms, IconX } from "@/components/Icons";

type Conv = { peer_e164: string; last_body: string | null; last_at: string; last_dir: string };
type Msg = {
  id: string;
  direction: string;
  body: string | null;
  created_at: string;
};

type StatusPayload = {
  sendConfigured?: boolean;
  businessLine?: string | null;
  lineError?: string | null;
  fromPreview?: string | null;
  suggestedInboundWebhookUrl?: string | null;
  suggestedStatusWebhookUrl?: string | null;
  migrationHint?: string;
};

function peerInitials(peer: string, name?: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    const initials = parts.slice(0, 2).map((p) => p[0]).join("");
    if (initials) return initials.toUpperCase();
  }
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

export type SmsMessagingProps = {
  embedded?: boolean;
};

export function SmsMessaging({ embedded = false }: SmsMessagingProps) {
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
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollThreadRef = useRef<HTMLDivElement>(null);
  // Contact names — shared with WhatsApp (same wa_contacts book per user).
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/whatsapp/contacts");
        const data = (await res.json()) as { contacts?: { peer_e164: string; name: string }[] };
        if (res.ok && data.contacts) {
          const map: Record<string, string> = {};
          for (const c of data.contacts) {
            if (c.peer_e164) map[c.peer_e164] = c.name;
          }
          setContacts(map);
        }
      } catch {
        // ignore — names just won't show
      }
    })();
  }, []);

  const displayName = useCallback(
    (peer: string): string => contacts[peer] || peer,
    [contacts],
  );

  async function saveName(peer: string, name: string) {
    const trimmed = name.trim();
    setContacts((prev) =>
      trimmed
        ? { ...prev, [peer]: trimmed }
        : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== peer)),
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
    } catch {
      // optimistic state already applied
    }
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sms/status");
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
      const res = await fetch("/api/sms/conversations");
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
      const res = await fetch(`/api/sms/messages?peer=${encodeURIComponent(p)}`);
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
  }, [peer]);

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

  async function sendMessage() {
    const to = (peer || newPhone).trim();
    const text = draft.trim();
    if (to.replace(/\D/g, "").length < 8) {
      setError("Recipient must include country code, e.g. +919876543210");
      return;
    }
    if (!text) return;
    setSending(true);
    setError(null);
    setStickToBottom(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, text }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Send failed");
      setDraft("");
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

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
        embedded
          ? "h-[min(680px,calc(100vh-12rem))] max-h-[calc(100vh-10rem)]"
          : "h-[min(720px,calc(100vh-8rem))] max-h-[calc(100vh-6rem)]",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-sky-700 px-3 py-2.5 text-white dark:border-sky-900 dark:bg-sky-950">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <IconSms className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{titleCase("SMS")}</p>
            <p className="truncate text-[11px] text-sky-100/90">
              {status?.businessLine
                ? `${titleCase("Exotel")} · ${status.businessLine}`
                : status?.sendConfigured
                  ? titleCase("Exotel connected")
                  : titleCase("Check configuration")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadConversations()}
          className="rounded-lg p-2 text-sky-100 transition hover:bg-white/10"
          title={titleCase("Refresh chats")}
        >
          <IconRefresh className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setSetupOpen((v) => !v)}
          className={cn(
            "rounded-lg p-2 transition hover:bg-white/10",
            setupOpen ? "bg-white/20 text-white" : "text-sky-100",
          )}
          title={titleCase("Setup & webhook")}
        >
          <IconSettings className="h-4 w-4" />
        </button>
      </header>

      {setupOpen ? (
        <div className="shrink-0 border-b border-zinc-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-950 dark:border-zinc-800 dark:bg-amber-950/30 dark:text-amber-50">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="font-semibold">{titleCase("Exotel & Supabase setup")}</p>
            <button
              type="button"
              onClick={() => setSetupOpen(false)}
              className="rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
              aria-label="Close"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
          {status?.lineError ? (
            <p className="mb-2 rounded bg-red-100 px-2 py-1 text-[11px] text-red-900 dark:bg-red-950/50 dark:text-red-100">
              {status.lineError}
            </p>
          ) : null}
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
            <li>
              Exotel Dashboard → ExoPhone → <strong>Incoming SMS</strong> webhook: POST to{" "}
              <code className="break-all rounded bg-white/80 px-1 dark:bg-zinc-900">
                {status?.suggestedInboundWebhookUrl || "https://YOUR_HOST/api/exotel/sms"}
              </code>
              .
            </li>
            <li>
              Set the outbound <strong>StatusCallback</strong> to{" "}
              <code className="break-all rounded bg-white/80 px-1 dark:bg-zinc-900">
                {status?.suggestedStatusWebhookUrl || "https://YOUR_HOST/api/exotel/sms/status"}
              </code>{" "}
              for delivery reports.
            </li>
            <li>
              Admin → Team: assign each member an Exotel number. SMS is sent from your assigned line
              {status?.businessLine ? (
                <>
                  {" "}(
                  <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">{status.businessLine}</code>)
                </>
              ) : null}
              .
            </li>
            <li>
              Supabase: apply{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0018_sms_messages.sql</code>,{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0023_profile_telephony.sql</code> and{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">0031_sms_business_line.sql</code>; set{" "}
              <code className="rounded bg-white/80 px-1 dark:bg-zinc-900">SUPABASE_SERVICE_ROLE_KEY</code> for inbound logging.
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
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("No threads yet. Send a message or wait for inbound SMS.")}</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.peer_e164}
                  type="button"
                  onClick={() => selectPeer(c.peer_e164)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2.5 text-left transition dark:border-zinc-800/80",
                    peer === c.peer_e164 ? "bg-sky-100/90 dark:bg-sky-950/50" : "hover:bg-white dark:hover:bg-zinc-900",
                  )}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                    {peerInitials(c.peer_e164, contacts[c.peer_e164])}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{displayName(c.peer_e164)}</span>
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
                placeholder="+919876543210"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary shrink-0 px-3 py-2 text-xs"
                onClick={() => {
                  const t = newPhone.trim();
                  if (t.replace(/\D/g, "").length >= 8) selectPeer(t);
                }}
              >
                {titleCase("Open")}
              </button>
            </div>
          </div>
        </aside>

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-100 dark:bg-zinc-900",
            !mobileShowThread || !peer ? "hidden min-h-[240px] lg:flex" : "flex min-h-0",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200/80 bg-zinc-50 px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900/95">
            <button
              type="button"
              className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-200 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
              onClick={() => setMobileShowThread(false)}
              aria-label="Back to chats"
            >
              ←
            </button>
            {peer && editingName === peer ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  autoFocus
                  className="input-field min-w-0 flex-1 text-sm"
                  placeholder={titleCase("Contact name")}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName(peer, nameInput);
                    if (e.key === "Escape") { setEditingName(null); setNameInput(""); }
                  }}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                  onClick={() => void saveName(peer, nameInput)}
                >
                  {titleCase("Save")}
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {peer ? displayName(peer) : titleCase("Select a chat")}
                </span>
                {peer && contacts[peer] ? (
                  <span className="truncate text-[11px] text-zinc-400">{peer}</span>
                ) : null}
              </div>
            )}
            {peer && editingName !== peer ? (
              <button
                type="button"
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/50"
                onClick={() => { setEditingName(peer); setNameInput(contacts[peer] || ""); }}
              >
                {contacts[peer] ? titleCase("Edit name") : titleCase("Save name")}
              </button>
            ) : null}
          </div>

          <div
            ref={scrollThreadRef}
            onScroll={onThreadScroll}
            className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden bg-slate-100 p-3 dark:bg-zinc-900"
            style={{
              backgroundImage: "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)",
              backgroundSize: "16px 16px",
            }}
          >
            {!peer ? (
              <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-500">
                <IconSms className="h-12 w-12 text-zinc-300 dark:text-zinc-600" />
                <p>{titleCase("Choose a thread or open a number from the list.")}</p>
              </div>
            ) : loadingThread ? (
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("Loading messages…")}</p>
            ) : messages.length === 0 ? (
              <p className="p-4 text-center text-sm text-zinc-500">{titleCase("No messages in this thread yet.")}</p>
            ) : (
              messages.map((m) => {
                const outbound = String(m.direction || "").toLowerCase() === "outbound";
                return (
                  <div key={m.id} className={cn("flex w-full max-w-full", outbound ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[min(85%,20rem)] rounded-lg px-2.5 py-1.5 text-base leading-relaxed shadow-sm",
                        outbound
                          ? "rounded-br-sm bg-sky-100 text-zinc-900 dark:bg-sky-900 dark:text-sky-50"
                          : "rounded-bl-sm border border-zinc-200/80 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words [word-break:break-word]">{m.body || "—"}</p>
                      <p
                        className={cn(
                          "mt-0.5 text-[10px]",
                          outbound ? "text-right text-sky-800/70 dark:text-sky-200/70" : "text-left text-zinc-400",
                        )}
                      >
                        {formatDate(m.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="shrink-0 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex gap-2">
              <textarea
                rows={2}
                className="input-field min-h-[44px] flex-1 resize-none text-sm"
                placeholder={titleCase("Type a message…")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                type="button"
                disabled={sending || !draft.trim()}
                onClick={() => void sendMessage()}
                className="btn-primary h-[44px] shrink-0 self-end px-4"
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
}
