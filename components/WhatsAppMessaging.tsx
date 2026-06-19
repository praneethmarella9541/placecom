"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { formatDate } from "@/lib/utils";
import { isValidE164, normalizePhone } from "@/lib/phone";
import { formatPhone, peerInitials } from "@/lib/wa-contacts-display";
import { categorizeWhatsAppMedia, mediaFilenameFromMessage, type WhatsAppMediaCategory } from "@/lib/whatsapp-media-helpers";
import { resolveWhatsAppMediaUrl } from "@/lib/whatsapp-media-url-client";
import { ForwardChatModal } from "@/components/ForwardChatModal";
import { useWaContacts } from "@/hooks/useWaContacts";
import {
  formatWhatsAppDeliveryLabel,
  getDeliveryFailureAdvice,
  isWhatsAppDeliveryFailed,
} from "@/lib/whatsapp-delivery";
import { WhatsAppComposerBar, type WhatsAppSendPayload, type PendingAttachment } from "@/components/WhatsAppComposerBar";
import {
  applyTemplatePreview,
  type WhatsAppTemplateMeta,
} from "@/lib/whatsapp-template-shared";
import {
  getSelectedWhatsAppTemplateName,
  setSelectedWhatsAppTemplateName,
} from "@/lib/whatsapp-template-preference";
import {
  getWhatsAppPrefetchCache,
  patchWhatsAppPrefetchCache,
} from "@/lib/workspace-feature-prefetch";
import {
  getCachedWhatsAppMessages,
  prefetchWhatsAppThreadIntent,
  prefetchWhatsAppThreads,
  warmWhatsAppThread,
  writeWhatsAppThreadCache,
} from "@/lib/whatsapp-thread-prefetch";
import { showWhatsAppFailureDetail, WhatsAppTicks } from "@/components/WhatsAppTicks";
import { titleCase } from "@/lib/title-case";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconDownload,
  IconFile,
  IconForward,
  IconInfo,
  IconMessageChat,
  IconPin,
  IconPlay,
  IconRefresh,
  IconReply,
  IconStar,
  IconUpload,
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
  template: WhatsAppTemplateMeta | undefined,
  templateVariables: string[],
  draft: string
): string {
  if (needsTemplate && template) {
    return applyTemplatePreview(template, templateVariables);
  }
  if (payload.messageType === "text") return payload.text?.trim() || draft.trim();
  // For media messages, only store the caption — never a [type] placeholder
  if (payload.mediaCaption?.trim()) return payload.mediaCaption.trim();
  return ""; // body will be empty; the media_url renders the image
}

/** True if the body text is just a system placeholder like [image] and shouldn't be shown */
function isMediaPlaceholder(body: string | null): boolean {
  if (!body) return true;
  return /^\[(?:image|video|audio|document|sticker|location|template)(?::[^\]]+)?\]$/i.test(body.trim());
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
type Conv = {
  peer_e164: string;
  last_body: string | null;
  last_at: string;
  last_dir: string;
  unread_count?: number;
};
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
  templates?: WhatsAppTemplateMeta[];
  defaultTemplate?: {
    name: string;
    languageCode: string;
    bodyParamCount: number;
    label?: string;
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
  /** Fill the parent container completely — used on the dedicated /whatsapp page */
  fullPage?: boolean;
  /** Open a thread on load (e.g. from Contact book → WhatsApp link) */
  initialPeer?: string | null;
};

/* ── component ────────────────────────────────────────────── */
export function WhatsAppMessaging({
  embedded = false,
  fullPage = false,
  initialPeer = null,
}: WhatsAppMessagingProps) {
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
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [templateVariables, setTemplateVariables] = useState(["", ""]);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollThreadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const messageRowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const highlightClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerRef = useRef<string | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [infoMsg, setInfoMsg] = useState<Msg | null>(null);
  const [menu, setMenu] = useState<{ msg: Msg; x: number; y: number } | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Msg | null>(null);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newPhoneInput, setNewPhoneInput] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedPhones, setImportedPhones] = useState<string[]>([]);
  const importFileRef = useRef<HTMLInputElement>(null);
  const { contacts: contactList, saveContact, deleteContact, resolveName } = useWaContacts();
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  // Media gallery drawer (opened by tapping the contact name) + in-chat
  // media viewer (lightbox) — mirrors WhatsApp Web behaviour.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryTab, setGalleryTab] = useState<WhatsAppMediaCategory>("image");
  const [viewer, setViewer] = useState<Msg | null>(null);

  // Group the loaded thread's media by category for the gallery tabs.
  const mediaGroups = useMemo(() => {
    const groups: Record<WhatsAppMediaCategory, Msg[]> = {
      image: [],
      video: [],
      audio: [],
      document: [],
    };
    for (const m of messages) {
      if (!m.media_url) continue;
      const cat = categorizeWhatsAppMedia(m);
      if (cat) groups[cat].push(m);
    }
    return groups;
  }, [messages]);

  // Download media with its real filename. The browser ignores an <a download>
  // filename for cross-origin URLs (and the stored object path is UUID-prefixed
  // with no extension → it saves as "<uuid>.bin"). Fetching to a blob first
  // gives us a same-origin URL, so the chosen filename is always honoured.
  const downloadMedia = useCallback(async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      // Fallback: open in a new tab so the file is at least reachable.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  // Step through media within the viewer's own category (prev/next).
  const navigateViewer = useCallback((dir: 1 | -1) => {
    setViewer((cur) => {
      if (!cur) return cur;
      const cat = categorizeWhatsAppMedia(cur);
      if (!cat) return cur;
      const list = mediaGroups[cat];
      const idx = list.findIndex((x) => x.id === cur.id);
      if (idx === -1) return cur;
      const next = idx + dir;
      return next >= 0 && next < list.length ? list[next] : cur;
    });
  }, [mediaGroups]);

  // Close gallery + viewer when switching conversations.
  useEffect(() => {
    setGalleryOpen(false);
    setViewer(null);
  }, [peer]);

  // Keyboard: Escape closes (viewer first, then gallery); arrows step
  // through media while the viewer is open.
  useEffect(() => {
    if (!viewer && !galleryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (viewer) setViewer(null);
        else setGalleryOpen(false);
        return;
      }
      if (viewer && e.key === "ArrowRight") { e.preventDefault(); navigateViewer(1); }
      else if (viewer && e.key === "ArrowLeft") { e.preventDefault(); navigateViewer(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, galleryOpen, navigateViewer]);

  async function saveName(peer: string, name: string) {
    const trimmed = name.trim();
    setEditingName(null);
    setNameInput("");
    try {
      if (trimmed) {
        await saveContact(peer, trimmed);
      } else {
        await deleteContact(peer);
      }
    } catch {
      /* optimistic hook state already applied on save; ignore delete errors */
    }
  }

  function displayName(peer: string): string {
    return resolveName(peer) || formatPhone(peer);
  }

  function savedContactName(peer: string): string | undefined {
    return resolveName(peer);
  }

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status");
      const body = (await res.json()) as StatusPayload & { error?: string };
      if (res.ok) {
        setStatus(body);
        patchWhatsAppPrefetchCache({ status: body });
        const list = body.templates?.length
          ? body.templates
          : body.defaultTemplate
            ? [{
                name: body.defaultTemplate.name,
                languageCode: body.defaultTemplate.languageCode,
                bodyParamCount: body.defaultTemplate.bodyParamCount,
                label: body.defaultTemplate.label ?? body.defaultTemplate.name,
                preview: body.defaultTemplate.previewExample ?? "",
              }]
            : [];
        if (list.length > 0) {
          const saved = getSelectedWhatsAppTemplateName();
          const legacyName =
            saved === "xlri_recruiter_schedules" ? "utility" : saved;
          const pick =
            (legacyName && list.some((t) => t.name === legacyName) ? legacyName : null) ??
            list[0]!.name;
          if (pick !== saved) setSelectedWhatsAppTemplateName(pick);
          setSelectedTemplateName(pick);
          setTemplateVariables((prev) => {
            const count = list.find((t) => t.name === pick)?.bodyParamCount ?? 2;
            return Array.from({ length: count }, (_, i) => prev[i] ?? "");
          });
        }
      }
    } catch { /* ignore */ }
  }, []);

  const availableTemplates: WhatsAppTemplateMeta[] =
    status?.templates?.length
      ? status.templates
      : status?.defaultTemplate
        ? [{
            name: status.defaultTemplate.name,
            languageCode: status.defaultTemplate.languageCode,
            bodyParamCount: status.defaultTemplate.bodyParamCount,
            label: status.defaultTemplate.label ?? status.defaultTemplate.name,
            preview: status.defaultTemplate.previewExample ?? "",
          }]
        : [];

  const selectedTemplate =
    availableTemplates.find((t) => t.name === selectedTemplateName) ??
    availableTemplates[0];

  function handleTemplateChange(name: string) {
    setSelectedTemplateName(name);
    setSelectedWhatsAppTemplateName(name);
    const tpl = availableTemplates.find((t) => t.name === name);
    const count = tpl?.bodyParamCount ?? 2;
    setTemplateVariables((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? "")
    );
  }

  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      const cached = getWhatsAppPrefetchCache();
      if (cached?.conversations.length) {
        setConversations(cached.conversations);
        setLoadingList(false);
      } else {
        setLoadingList(true);
      }
      setError(null);
    }
    try {
      const res = await fetch("/api/whatsapp/conversations");
      const body = (await res.json()) as { conversations?: Conv[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load conversations");
      const list = body.conversations || [];
      setConversations(list);
      patchWhatsAppPrefetchCache({ conversations: list });
      if (list.length) {
        void prefetchWhatsAppThreads(
          list.map((c) => c.peer_e164),
          { limit: 24 }
        );
      }
    } catch (e) {
      if (!silent) setError(clientFetchFailedMessage(e));
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, []);

  const markThreadRead = useCallback(async (p: string) => {
    try {
      await fetch("/api/whatsapp/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer: p }),
      });
    } catch {
      /* best-effort — list poll will reconcile */
    }
  }, []);

  const clearUnreadForPeer = useCallback((p: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.peer_e164 === p ? { ...c, unread_count: 0 } : c))
    );
  }, []);

  const loadMessages = useCallback(async (p: string, opts?: { silent?: boolean; force?: boolean }) => {
    const silent = opts?.silent ?? false;
    const force = opts?.force ?? false;

    if (!silent) setError(null);

    try {
      const incoming = (await warmWhatsAppThread(p, { force })) ?? [];
      // Ignore stale responses when the user switched chats mid-fetch.
      if (peerRef.current !== p) return;

      writeWhatsAppThreadCache(p, incoming);
      setMessages((prev) => {
        if (!silent) {
          setStickToBottom(true);
          return incoming;
        }
        if (hasNewMessages(prev, incoming)) queueMicrotask(() => setStickToBottom(true));
        return mergeFetchedMessages(prev, incoming);
      });
      clearUnreadForPeer(p);
      void markThreadRead(p);
    } catch (e) {
      if (peerRef.current === p && !silent) setError(clientFetchFailedMessage(e));
    } finally {
      if (peerRef.current === p && !silent) setLoadingThread(false);
    }
  }, [clearUnreadForPeer, markThreadRead]);

  const resetThreadUi = useCallback(() => {
    setStickToBottom(true);
    setSelectMode(false);
    setSelectedIds([]);
    setReplyTo(null);
    setMenu(null);
    setInfoMsg(null);
    messageRowRefs.current.clear();
    setHighlightMessageId(null);
  }, []);

  /** Instant paint from cache, then background refresh — matches mobile chat open. */
  const switchToPeer = useCallback(
    (raw: string) => {
      const p = recipientE164(raw);
      if (!isValidE164(p)) return;

      resetThreadUi();
      setError(null);
      clearUnreadForPeer(p);

      const cached = getCachedWhatsAppMessages(p);
      if (cached?.length) {
        setMessages(cached);
        setLoadingThread(false);
      } else {
        setMessages([]);
        setLoadingThread(true);
      }

      peerRef.current = p;
      setPeer(p);
      setMobileShowThread(true);
      setNewPhoneInput(false);

      void loadMessages(p, { silent: Boolean(cached?.length), force: Boolean(cached?.length) });
    },
    [resetThreadUi, clearUnreadForPeer, loadMessages]
  );

  useEffect(() => { peerRef.current = peer; }, [peer]);

  useEffect(() => {
    if (!initialPeer) return;
    const normalized = recipientE164(initialPeer);
    if (!isValidE164(normalized)) return;
    switchToPeer(normalized);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPeer]);

  const filteredContactsForNewChat = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const list = q
      ? contactList.filter((c) => {
          const phone = formatPhone(c.peer_e164).toLowerCase();
          return c.name.toLowerCase().includes(q) || c.peer_e164.includes(q) || phone.includes(q);
        })
      : contactList;
    return list.slice(0, q ? 12 : 8);
  }, [contactList, contactSearch]);

  const filteredImportedPhones = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const list = importedPhones.filter((p) => {
      if (!q) return true;
      return p.includes(q) || formatPhone(p).toLowerCase().includes(q);
    });
    return list.slice(0, q ? 20 : 12);
  }, [importedPhones, contactSearch]);

  const onPickImportFile = useCallback(async (list: FileList | null) => {
    if (!list?.length) return;
    setImportError(null);
    setImportBusy(true);
    const fd = new FormData();
    fd.set("file", list[0]);
    try {
      const res = await fetch("/api/broadcast/parse-phones", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string; phones?: string[] };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const phones = data.phones ?? [];
      if (phones.length === 0) {
        setImportError("No phone numbers found. Use a Phone/Mobile column with 10-digit Indian numbers or +91… format.");
      } else {
        setImportedPhones((prev) => Array.from(new Set([...prev, ...phones])));
        setNewPhoneInput(true);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    const cached = getWhatsAppPrefetchCache();
    if (cached?.status) setStatus(cached.status as StatusPayload);
    void loadStatus();
    void loadConversations();
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadConversations({ silent: true });
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadConversations({ silent: true });
        if (peerRef.current) void loadMessages(peerRef.current, { silent: true, force: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus, loadConversations, loadMessages]);

  useEffect(() => {
    if (!peer) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadMessages(peer, { silent: true, force: true });
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [peer, loadMessages]);

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

  function sendAttachments(items: PendingAttachment[], caption: string) {
    if (!items.length || needsTemplate) return;
    const to = recipientE164(peer || newPhone);
    if (!isValidE164(to)) {
      setError("Enter a valid mobile with country code, e.g. +918489431508");
      return;
    }

    const replyId = replyTo?.id;
    const replyToId = replyId && !replyId.startsWith("optimistic-") ? replyId : undefined;

    items.forEach((att, index) => {
      const isLast = index === items.length - 1;
      const tempId = `optimistic-${Date.now()}-${index}`;
      const messageType = att.kind ?? (att.isImage ? "image" : "document");
      const optimisticMsg: Msg = {
        id: tempId,
        direction: "outbound",
        peer_e164: to,
        body:
          isLast && caption
            ? caption
            : messageType === "image"
              ? "[Image]"
              : messageType === "video"
                ? "[Video]"
                : messageType === "audio"
                  ? "[Audio]"
                  : `[Document: ${att.filename ?? att.name}]`,
        created_at: new Date().toISOString(),
        delivery_status: "pending",
        message_sid: null,
        num_media: 1,
        media_url: att.remoteUrl ?? att.previewUrl,
        content_type: messageType,
        reply_to_id: isLast ? replyToId ?? null : null,
      };

      setMessages((prev) => [...prev, optimisticMsg]);
      setStickToBottom(true);

      void (async () => {
        try {
          const remoteUrl = att.remoteUrl;
          const kind = att.kind ?? messageType;
          if (!remoteUrl) throw new Error("Attachment is still uploading — wait and try again.");

          const res = await fetch("/api/whatsapp/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              to,
              useTemplate: false,
              messageType: kind,
              mediaUrl: remoteUrl,
              mediaCaption: isLast ? caption || undefined : undefined,
              mediaFilename: att.filename ?? att.name,
              ...(isLast && replyToId ? { replyToId } : {}),
            }),
          });
          const body = (await res.json()) as { error?: string; messageSid?: string; peerE164?: string };
          if (!res.ok) throw new Error(body.error || "Send failed");

          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    delivery_status: "sent",
                    message_sid: body.messageSid ?? m.message_sid ?? null,
                    media_url: remoteUrl!,
                  }
                : m
            )
          );
          void loadConversations({ silent: true });
          if (peer) void loadMessages(peer, { silent: true, force: true });
        } catch (e) {
          const err = clientFetchFailedMessage(e);
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, delivery_status: `failed: ${err}` } : m))
          );
          setError(err);
        }
      })();
    });

    setReplyTo(null);
    setDraft("");
  }

  function startForward(message: Msg) {
    setMenu(null);
    setForwardingMessage(message);
    setForwardModalOpen(true);
  }

  async function forwardToPeer(targetPeer: string) {
    const msg = forwardingMessage;
    if (!msg) return;
    setForwardModalOpen(false);
    setForwardingMessage(null);
    setError(null);

    const to = recipientE164(targetPeer);
    if (!isValidE164(to)) {
      setError("Enter a valid mobile with country code, e.g. +918489431508");
      return;
    }

    try {
      if (msg.media_url) {
        const cat = categorizeWhatsAppMedia(msg);
        const messageType = cat ?? "document";
        const mediaUrl = resolveWhatsAppMediaUrl(msg.media_url) ?? msg.media_url;
        if (!mediaUrl) {
          setError("Media URL is not available for forwarding.");
          return;
        }

        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            to,
            useTemplate: false,
            messageType,
            mediaUrl,
            mediaCaption:
              msg.body?.trim() && !msg.body.startsWith("[") ? msg.body.trim() : undefined,
            mediaFilename: mediaFilenameFromMessage(msg),
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error || "Forward failed");
      } else if (msg.body?.trim()) {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            to,
            useTemplate: false,
            messageType: "text",
            text: msg.body.trim(),
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(body.error || "Forward failed");
      } else {
        setError("Nothing to forward in this message.");
        return;
      }

      void loadConversations({ silent: true });
    } catch (e) {
      setError(clientFetchFailedMessage(e));
    }
  }

  async function sendMessage(payload: WhatsAppSendPayload) {
    const to = recipientE164(peer || newPhone);
    if (!isValidE164(to)) { setError("Enter a valid mobile with country code, e.g. +918489431508"); return; }
    const tpl = selectedTemplate;
    const varsForSend = (tpl ? templateVariables.slice(0, tpl.bodyParamCount) : templateVariables)
      .map((v) => v.trim());
    if (needsTemplate) {
      if (!tpl || varsForSend.length < tpl.bodyParamCount || varsForSend.some((v) => !v)) {
        setError("Fill in all template fields for the selected template.");
        return;
      }
    }

    const tempId = `optimistic-${crypto.randomUUID()}`;
    const previewBody = previewOutboundBody(payload, needsTemplate, tpl, varsForSend, draft);
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
    if (!peer) {
      peerRef.current = to;
      setPeer(to);
      setNewPhone("");
      setNewPhoneInput(false);
    }

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          to, useTemplate: needsTemplate,
          messageType: needsTemplate ? "template" : payload.messageType,
          text: payload.text ?? draft.trim(),
          ...(needsTemplate && tpl
            ? {
                templateName: tpl.name,
                templateLanguage: tpl.languageCode,
                templateVariables: varsForSend,
              }
            : {}),
          mediaUrl: payload.mediaUrl, mediaCaption: payload.mediaCaption,
          mediaFilename: payload.mediaFilename,
          ...(replyTo?.id && !replyTo.id.startsWith("optimistic-") ? { replyToId: replyTo.id } : {}),
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
      void loadMessages(threadPeer, { silent: true, force: true });
    } catch (e) {
      const err = clientFetchFailedMessage(e);
      setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, delivery_status: `failed: ${err}` } : m));
      setError(err);
    }
  }

  const selectPeer = switchToPeer;

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
          data-testid="wa-new-chat-btn"
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
              data-testid="wa-new-phone-input"
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
              data-testid="wa-open-phone-btn"
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
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.ods"
              className="hidden"
              onChange={(e) => void onPickImportFile(e.target.files)}
            />
            <button
              data-testid="wa-import-csv-btn"
              type="button"
              disabled={importBusy}
              onClick={() => importFileRef.current?.click()}
              className="btn-secondary gap-1.5 px-3 py-1.5 text-[12px]"
            >
              <IconUpload className="h-3.5 w-3.5" />
              {importBusy ? titleCase("Reading…") : titleCase("Import CSV / Excel")}
            </button>
            {importedPhones.length > 0 ? (
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-[11px]"
                onClick={() => setImportedPhones([])}
              >
                {titleCase("Clear import")}
              </button>
            ) : null}
          </div>
          {importError ? (
            <p className="mt-2 text-[11px] text-red-600 dark:text-red-400">{importError}</p>
          ) : null}
          {filteredImportedPhones.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                {titleCase("From file")} ({importedPhones.length})
              </p>
              <div className="max-h-36 space-y-0.5 overflow-y-auto">
                {filteredImportedPhones.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--color-surface-offset)]"
                    onClick={() => {
                      setError(null);
                      selectPeer(p);
                      setContactSearch("");
                    }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#128c7e] text-[11px] font-bold text-white">
                      {peerInitials(p)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text)]">
                      {formatPhone(p)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {contactList.length > 0 && (
            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <input
                className="input-field mb-2 w-full text-[12px]"
                placeholder={titleCase("Search saved contacts")}
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
              />
              <div className="max-h-40 space-y-0.5 overflow-y-auto">
                {filteredContactsForNewChat.map((c) => (
                  <button
                    key={c.peer_e164}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--color-surface-offset)]"
                    onClick={() => { setError(null); selectPeer(c.peer_e164); setContactSearch(""); }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[11px] font-bold text-white">
                      {peerInitials(c.peer_e164, c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{c.name}</span>
                      <span className="block truncate text-[11px] text-[var(--color-text-faint)]">{formatPhone(c.peer_e164)}</span>
                    </span>
                  </button>
                ))}
                {filteredContactsForNewChat.length === 0 && contactSearch.trim() && (
                  <p className="px-2 py-1 text-[12px] text-[var(--color-text-faint)]">{titleCase("No matching contacts")}</p>
                )}
              </div>
            </div>
          )}
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
          conversations.map((c) => {
            const unread = c.unread_count ?? 0;
            const hasUnread = unread > 0;
            return (
            <button
              key={c.peer_e164}
              data-testid={`wa-conversation-${c.peer_e164}`}
              type="button"
              onClick={() => selectPeer(c.peer_e164)}
              onMouseEnter={() => prefetchWhatsAppThreadIntent(c.peer_e164)}
              onMouseDown={() => prefetchWhatsAppThreadIntent(c.peer_e164)}
              className={cn(
                "flex w-full items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left transition-colors duration-100",
                peer === c.peer_e164
                  ? "bg-[var(--color-primary-tint)]"
                  : "hover:bg-[var(--color-surface-offset)]"
              )}
            >
              <span className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white",
                peer === c.peer_e164 ? "bg-[var(--color-primary)]" : "bg-[#25d366]"
              )}>
                {peerInitials(c.peer_e164, savedContactName(c.peer_e164))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn(
                    "truncate text-[14px]",
                    hasUnread && "font-semibold",
                    peer === c.peer_e164 ? "font-semibold text-[var(--color-primary)]" : "font-medium text-[var(--color-text)]"
                  )}>
                    {displayName(c.peer_e164)}
                  </span>
                  <span className={cn(
                    "shrink-0 text-[12px]",
                    hasUnread ? "font-semibold text-[#25d366]" : "text-[var(--color-text-faint)]"
                  )}>
                    {formatListTime(c.last_at)}
                  </span>
                </span>
                <span className={cn(
                  "mt-0.5 line-clamp-1 text-[13px]",
                  hasUnread ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                )}>
                  {c.last_dir === "outbound" ? "You: " : ""}{c.last_body || "—"}
                </span>
              </span>
              {hasUnread ? (
                <span className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </button>
          );
          })
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
          data-testid="wa-back-btn"
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] lg:hidden"
          onClick={() => setMobileShowThread(false)}
          aria-label="Back to chats"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5}><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {peer ? (
          <>
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-[13px] font-bold text-white transition-opacity hover:opacity-90"
              onClick={() => { setGalleryTab("image"); setGalleryOpen(true); }}
              title={titleCase("View media, links and docs")}
            >
              {peerInitials(peer, savedContactName(peer))}
            </button>
            <div
              className={cn("min-w-0 flex-1", editingName !== peer && "cursor-pointer")}
              onClick={() => { if (editingName !== peer) { setGalleryTab("image"); setGalleryOpen(true); } }}
              title={editingName !== peer ? titleCase("View media, links and docs") : undefined}
            >
              {editingName === peer ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => { e.preventDefault(); void saveName(peer, nameInput); }}
                >
                  <input
                    data-testid="wa-contact-name-input"
                    autoFocus
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder={formatPhone(peer)}
                    className="input-field h-7 flex-1 text-[13px]"
                    onKeyDown={(e) => { if (e.key === "Escape") { setEditingName(null); setNameInput(""); } }}
                  />
                  <button data-testid="wa-save-name-btn" type="submit" className="btn-primary h-7 px-2.5 text-[12px]">Save</button>
                  <button data-testid="wa-cancel-name-btn" type="button" className="btn-ghost h-7 px-2 text-[12px]" onClick={() => { setEditingName(null); setNameInput(""); }}>✕</button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold text-[var(--color-text)]">{displayName(peer)}</p>
                    {savedContactName(peer) && (
                      <p className="truncate text-[11px] text-[var(--color-text-faint)]">{formatPhone(peer)}</p>
                    )}
                  </div>
                  <button
                    data-testid="wa-edit-name-btn"
                    type="button"
                    className="shrink-0 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-faint)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
                    onClick={(e) => { e.stopPropagation(); setEditingName(peer); setNameInput(savedContactName(peer) || ""); }}
                  >
                    {savedContactName(peer) ? "Edit name" : "Save name"}
                  </button>
                </div>
              )}
              {sessionOpen !== null && editingName !== peer && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    sessionOpen
                      ? "bg-[#e7f8ef] text-[#075E54]"
                      : "bg-[var(--color-warning-light)] text-[var(--color-warning)]",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", sessionOpen ? "bg-[#25D366]" : "bg-[var(--color-warning)]")} />
                  {sessionOpen ? titleCase("Session open") : titleCase("Template required")}
                </span>
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
              disabled={selectedIds.length === 0}
              className="btn-ghost gap-1 px-2 py-1 text-[12px]"
              onClick={() => {
                const parts = messages.filter((m) => selectedIds.includes(m.id)).map((m) => m.body || "");
                void navigator.clipboard.writeText(parts.join("\n---\n"));
              }}
            >
              <IconCopy className="h-3.5 w-3.5" /> Copy
            </button>
            <button type="button" className="btn-ghost px-2 py-1 text-[12px]" onClick={() => { setSelectMode(false); setSelectedIds([]); }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {peer && (
              <button
                data-testid="wa-select-messages-btn"
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                onClick={() => { setSelectMode(true); setSelectedIds([]); }}
                title="Select messages"
              >
                <IconCheck className="h-4 w-4" />
              </button>
            )}
            <button
              data-testid="wa-refresh-btn"
              type="button"
              onClick={() => void loadConversations()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
              title={titleCase("Refresh")}
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

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
                      "relative max-w-[min(80%,34rem)] rounded-2xl px-3 py-2 text-[15px] leading-relaxed shadow-sm",
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

                    {/* Body — hide if it's just a media placeholder */}
                    {!isMediaPlaceholder(m.body) && (
                      <p className="whitespace-pre-wrap break-words [word-break:break-word]">{m.body}</p>
                    )}

                    {/* Media — opens in an in-app viewer (like WhatsApp Web),
                        not a new browser tab. */}
                    {(() => {
                      if (!m.media_url) return null;
                      const cat = categorizeWhatsAppMedia(m);
                      const asImage = cat === "image" || (!m.content_type && !!m.num_media);
                      if (asImage) {
                        return (
                          <button type="button" onClick={() => setViewer(m)} className="mt-1 block w-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={m.media_url} alt="" className="max-h-80 w-full cursor-pointer rounded-xl object-contain" />
                          </button>
                        );
                      }
                      if (cat === "video") {
                        return (
                          <button type="button" onClick={() => setViewer(m)} className="relative mt-1 block w-full overflow-hidden rounded-xl">
                            <video src={m.media_url} preload="metadata" className="max-h-80 w-full rounded-xl object-contain" />
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
                                <IconPlay className="h-6 w-6" />
                              </span>
                            </span>
                          </button>
                        );
                      }
                      if (cat === "audio") {
                        return <audio src={m.media_url} controls className="mt-1.5 w-full max-w-[260px]" />;
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => setViewer(m)}
                          className="mt-1.5 flex max-w-full items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-left text-[13px] font-medium text-zinc-700 hover:bg-black/10"
                        >
                          <IconFile className="h-4 w-4 shrink-0" />
                          <span className="truncate">{mediaFilenameFromMessage(m)}</span>
                        </button>
                      );
                    })()}

                    {/* Timestamp + ticks */}
                    <p className={cn(
                      "mt-1 flex items-center gap-1 text-[12px] text-zinc-500",
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

      {/* Media gallery drawer — opened by tapping the contact name/avatar.
          Tabs for Photos / Videos / Audio / Docs, like WhatsApp Web. */}
      {galleryOpen && peer && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[58] bg-black/30" aria-hidden onClick={() => setGalleryOpen(false)} />
          <div className="fixed inset-y-0 right-0 z-[59] flex w-full max-w-[420px] flex-col bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                onClick={() => setGalleryOpen(false)}
                aria-label={titleCase("Close")}
              >
                <IconX className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">{titleCase("Media, links and docs")}</p>
                <p className="truncate text-[11px] text-[var(--color-text-faint)]">{displayName(peer)}</p>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex shrink-0 border-b border-[var(--color-border)]">
              {([
                { key: "image", label: titleCase("Photos") },
                { key: "video", label: titleCase("Videos") },
                { key: "audio", label: titleCase("Audio") },
                { key: "document", label: titleCase("Docs") },
              ] as { key: WhatsAppMediaCategory; label: string }[]).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setGalleryTab(t.key)}
                  className={cn(
                    "flex-1 border-b-2 px-2 py-2.5 text-[12px] font-semibold transition-colors",
                    galleryTab === t.key
                      ? "border-[#25d366] text-[var(--color-text)]"
                      : "border-transparent text-[var(--color-text-faint)] hover:text-[var(--color-text-muted)]",
                  )}
                >
                  {t.label}
                  <span className="ml-1 text-[10px] opacity-60">{mediaGroups[t.key].length}</span>
                </button>
              ))}
            </div>
            {/* Content */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
              {mediaGroups[galleryTab].length === 0 ? (
                <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                  <IconFile className="h-8 w-8 text-[var(--color-text-faint)]" />
                  <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Nothing here yet")}</p>
                </div>
              ) : galleryTab === "image" || galleryTab === "video" ? (
                <div className="grid grid-cols-3 gap-1.5">
                  {mediaGroups[galleryTab].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setViewer(m)}
                      className="relative aspect-square overflow-hidden rounded-md bg-[var(--color-surface-offset)]"
                    >
                      {galleryTab === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.media_url!} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <>
                          <video src={m.media_url!} preload="metadata" className="h-full w-full object-cover" />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white">
                              <IconPlay className="h-4 w-4" />
                            </span>
                          </span>
                        </>
                      )}
                    </button>
                  ))}
                </div>
              ) : galleryTab === "audio" ? (
                <div className="flex flex-col gap-3">
                  {mediaGroups.audio.map((m) => (
                    <div key={m.id} className="rounded-lg border border-[var(--color-border)] p-2">
                      <p className="mb-1 truncate text-[12px] text-[var(--color-text-muted)]">{mediaFilenameFromMessage(m)}</p>
                      <audio src={m.media_url!} controls className="w-full" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {mediaGroups.document.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setViewer(m)}
                      className="flex items-center gap-2.5 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-left hover:bg-[var(--color-surface-offset)]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]">
                        <IconFile className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">{mediaFilenameFromMessage(m)}</span>
                        <span className="block text-[11px] text-[var(--color-text-faint)]">{formatDate(m.created_at)}</span>
                      </span>
                      <IconDownload className="h-4 w-4 shrink-0 text-[var(--color-text-faint)]" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* Media viewer (lightbox) — opens media inline instead of a new tab. */}
      {viewer && viewer.media_url && typeof document !== "undefined" && createPortal(
        (() => {
          const url = viewer.media_url!;
          const cat = categorizeWhatsAppMedia(viewer);
          const asImage = cat === "image" || (!viewer.content_type && !!viewer.num_media);
          const filename = mediaFilenameFromMessage(viewer);
          // Only PDFs render usefully in an <iframe>; Office/zip/etc. would show
          // a blank frame, so those get a download card instead.
          const previewable = /\.pdf$/i.test(filename) || (viewer.content_type ?? "").toLowerCase() === "application/pdf";
          const navList = cat ? mediaGroups[cat] : [];
          const navIdx = navList.findIndex((x) => x.id === viewer.id);
          const hasPrev = navIdx > 0;
          const hasNext = navIdx >= 0 && navIdx < navList.length - 1;
          return (
            <div
              className="fixed inset-0 z-[70] flex flex-col bg-black/90"
              onClick={() => setViewer(null)}
            >
              {/* Top bar */}
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
                <span className="truncate text-[13px] font-medium">{filename}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
                    title={titleCase("Download")}
                    onClick={(e) => { e.stopPropagation(); void downloadMedia(url, filename); }}
                  >
                    <IconDownload className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
                    onClick={() => setViewer(null)}
                    aria-label={titleCase("Close")}
                  >
                    <IconX className="h-5 w-5" />
                  </button>
                </div>
              </div>
              {/* Body */}
              <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                {hasPrev && (
                  <button
                    type="button"
                    onClick={() => navigateViewer(-1)}
                    className="absolute left-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                    aria-label={titleCase("Previous")}
                  >
                    <IconChevronLeft className="h-6 w-6" />
                  </button>
                )}
                {hasNext && (
                  <button
                    type="button"
                    onClick={() => navigateViewer(1)}
                    className="absolute right-2 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
                    aria-label={titleCase("Next")}
                  >
                    <IconChevronRight className="h-6 w-6" />
                  </button>
                )}
                {asImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={filename} className="max-h-full max-w-full object-contain" />
                ) : cat === "video" ? (
                  <video src={url} controls autoPlay className="max-h-full max-w-full" />
                ) : cat === "audio" ? (
                  <audio src={url} controls autoPlay className="w-full max-w-[480px]" />
                ) : previewable ? (
                  <div className="flex h-full w-full max-w-3xl flex-col items-stretch">
                    <iframe src={url} title={filename} className="h-full w-full rounded-lg bg-white" />
                    <button
                      type="button"
                      className="mt-3 self-center rounded-lg bg-white/15 px-4 py-2 text-[13px] font-medium text-white hover:bg-white/25"
                      onClick={(e) => { e.stopPropagation(); void downloadMedia(url, filename); }}
                    >
                      {titleCase("Download")} · {filename}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 rounded-2xl bg-white/10 px-8 py-10 text-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white">
                      <IconFile className="h-8 w-8" />
                    </span>
                    <div>
                      <p className="max-w-[280px] truncate text-[15px] font-medium text-white">{filename}</p>
                      <p className="mt-1 text-[12px] text-white/60">{titleCase("No preview available")}</p>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-[14px] font-semibold text-zinc-900 hover:bg-white/90"
                      onClick={(e) => { e.stopPropagation(); void downloadMedia(url, filename); }}
                    >
                      <IconDownload className="h-4 w-4" /> {titleCase("Download")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })(),
        document.body,
      )}

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
              { key: "forward", label: "Forward",      icon: IconForward, onClick: () => { startForward(menu.msg); } },
              { key: "pin",     label: menu.msg.is_pinned ? "Unpin" : "Pin", icon: IconPin, onClick: () => { void (async () => { try { await patchMessage(menu.msg.id, { is_pinned: !menu.msg.is_pinned }); if (peer) await loadMessages(peer, { silent: true }); } catch (e) { setError(clientFetchFailedMessage(e)); } finally { setMenu(null); } })(); } },
              { key: "star",    label: menu.msg.is_starred ? "Unstar" : "Star", icon: IconStar, onClick: () => { void (async () => { try { await patchMessage(menu.msg.id, { is_starred: !menu.msg.is_starred }); if (peer) await loadMessages(peer, { silent: true }); } catch (e) { setError(clientFetchFailedMessage(e)); } finally { setMenu(null); } })(); } },
              { key: "info",    label: "Message info", icon: IconInfo,    onClick: () => { setInfoMsg(menu.msg); setMenu(null); } },
              { key: "select",  label: "Select",       icon: IconCheck,   onClick: () => { setSelectMode(true); setSelectedIds([menu.msg.id]); setMenu(null); } },
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
          templates={availableTemplates}
          selectedTemplateName={selectedTemplate?.name ?? ""}
          onTemplateChange={handleTemplateChange}
          templateVariables={templateVariables}
          onTemplateVariablesChange={setTemplateVariables}
          forceTemplate={forceTemplate}
          onForceTemplateChange={setForceTemplate}
          recipientValid={isValidE164(recipientE164(peer || newPhone))}
          onInsertEmoji={insertAtCursor}
          onSend={(p) => void sendMessage(p)}
          onSendAttachments={sendAttachments}
          textareaRef={textareaRef}
        />
      </div>
    </main>
  );

  /* ── Shell ─────────────────────────────────────────────── */
  const shell = (
    <div
      className={cn(
        "flex flex-col overflow-hidden",
        fullPage
          ? "h-full flex-1 border-none rounded-none"
          : cn(
              "surface-card rounded-2xl",
              embedded
                ? "h-[min(680px,calc(100vh-12rem))]"
                : "h-[min(720px,calc(100vh-8rem))]",
            ),
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {sidebar}
        {thread}
      </div>
    </div>
  );

  if (fullPage || embedded) {
    return (
      <>
        {shell}
        <ForwardChatModal
          open={forwardModalOpen}
          contacts={contactList}
          onClose={() => {
            setForwardModalOpen(false);
            setForwardingMessage(null);
          }}
          onForward={(target) => void forwardToPeer(target)}
        />
      </>
    );
  }

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
              : titleCase("Not configured")}
          </p>
        </div>
      </div>
      {shell}
      <ForwardChatModal
        open={forwardModalOpen}
        contacts={contactList}
        onClose={() => {
          setForwardModalOpen(false);
          setForwardingMessage(null);
        }}
        onForward={(target) => void forwardToPeer(target)}
      />
    </div>
  );
}
