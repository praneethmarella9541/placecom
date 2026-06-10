/**
 * Session-scoped prefetch for WhatsApp, Calendar, and Forms.
 * Runs after mail + drive warm on login; pages read caches for instant paint (SWR).
 */

import type { FeatureKey } from "@/lib/feature-access";
import { prefetchDriveListViews } from "@/lib/drive-list-prefetch";
import { prefetchMailListViews } from "@/lib/inbox-list-prefetch";

/* ─── WhatsApp ─────────────────────────────────────────────── */

export type WhatsAppPrefetchConversation = {
  peer_e164: string;
  last_body: string | null;
  last_at: string;
  last_dir: string;
  unread_count?: number;
};

export type WhatsAppPrefetchStatus = {
  provider?: string;
  sendConfigured?: boolean;
  apiHost?: string;
  businessLine?: string | null;
  lineError?: string | null;
  templates?: unknown[];
  defaultTemplate?: unknown;
  sandbox?: boolean;
  fromPreview?: string | null;
  suggestedInboundWebhookUrl?: string | null;
  migrationHint?: string;
};

export type WhatsAppPrefetchSnapshot = {
  status: WhatsAppPrefetchStatus | null;
  conversations: WhatsAppPrefetchConversation[];
  contacts: Record<string, string>;
};

let whatsappCache: WhatsAppPrefetchSnapshot | null = null;

export function getWhatsAppPrefetchCache(): WhatsAppPrefetchSnapshot | null {
  return whatsappCache;
}

export function setWhatsAppPrefetchCache(snapshot: WhatsAppPrefetchSnapshot): void {
  whatsappCache = snapshot;
}

export function patchWhatsAppPrefetchCache(
  patch: Partial<WhatsAppPrefetchSnapshot>
): void {
  whatsappCache = { ...(whatsappCache ?? { status: null, conversations: [], contacts: {} }), ...patch };
}

async function prefetchWhatsAppData(signal?: AbortSignal): Promise<void> {
  const [statusRes, convRes, contactsRes] = await Promise.all([
    fetch("/api/whatsapp/status", { cache: "no-store", signal }),
    fetch("/api/whatsapp/conversations", { cache: "no-store", signal }),
    fetch("/api/whatsapp/contacts", { cache: "no-store", signal }),
  ]);

  if (signal?.aborted) return;

  let status: WhatsAppPrefetchStatus | null = null;
  if (statusRes.ok) {
    status = (await statusRes.json()) as WhatsAppPrefetchStatus;
  }

  let conversations: WhatsAppPrefetchConversation[] = [];
  if (convRes.ok) {
    const body = (await convRes.json()) as { conversations?: WhatsAppPrefetchConversation[] };
    conversations = body.conversations ?? [];
  }

  const contacts: Record<string, string> = {};
  if (contactsRes.ok) {
    const body = (await contactsRes.json()) as { contacts?: { peer_e164: string; name: string }[] };
    for (const c of body.contacts ?? []) {
      if (c.peer_e164) contacts[c.peer_e164] = c.name;
    }
  }

  if (signal?.aborted) return;
  setWhatsAppPrefetchCache({ status, conversations, contacts });
}

/* ─── Calendar ─────────────────────────────────────────────── */

export type CalendarPrefetchEvent = Record<string, unknown>;
export type CalendarPrefetchRecruiter = { email: string; name: string };
export type CalendarPrefetchContact = { email: string; displayName?: string };

export type CalendarPrefetchSnapshot = {
  events: CalendarPrefetchEvent[];
  recruiters: CalendarPrefetchRecruiter[];
  googleContacts: CalendarPrefetchContact[];
};

let calendarCache: CalendarPrefetchSnapshot | null = null;

export function getCalendarPrefetchCache(): CalendarPrefetchSnapshot | null {
  return calendarCache;
}

export function setCalendarPrefetchCache(snapshot: CalendarPrefetchSnapshot): void {
  calendarCache = snapshot;
}

export function patchCalendarPrefetchCache(
  patch: Partial<CalendarPrefetchSnapshot>
): void {
  calendarCache = {
    ...(calendarCache ?? { events: [], recruiters: [], googleContacts: [] }),
    ...patch,
  };
}

/** Default visible window when the calendar has not reported a range yet. */
export function defaultCalendarRangeIso(): { timeMin: string; timeMax: string } {
  return {
    timeMin: new Date(Date.now() - 30 * 86400000).toISOString(),
    timeMax: new Date(Date.now() + 90 * 86400000).toISOString(),
  };
}

async function prefetchCalendarData(signal?: AbortSignal): Promise<void> {
  const { timeMin, timeMax } = defaultCalendarRangeIso();
  const eventsUrl = `/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=500`;

  const [eventsRes, recruitersRes, contactsRes] = await Promise.all([
    fetch(eventsUrl, { cache: "no-store", signal }),
    fetch("/api/recruiters", { cache: "no-store", signal }),
    fetch("/api/gmail/contacts", { cache: "no-store", signal }),
  ]);

  if (signal?.aborted) return;

  let events: CalendarPrefetchEvent[] = [];
  if (eventsRes.ok) {
    const body = (await eventsRes.json()) as { events?: CalendarPrefetchEvent[] };
    events = body.events ?? [];
  }

  let recruiters: CalendarPrefetchRecruiter[] = [];
  if (recruitersRes.ok) {
    const body = (await recruitersRes.json()) as { recruiters?: CalendarPrefetchRecruiter[] };
    recruiters = body.recruiters ?? [];
  }

  let googleContacts: CalendarPrefetchContact[] = [];
  if (contactsRes.ok) {
    const body = (await contactsRes.json()) as { contacts?: CalendarPrefetchContact[] };
    googleContacts = body.contacts ?? [];
  }

  if (signal?.aborted) return;
  setCalendarPrefetchCache({ events, recruiters, googleContacts });
}

/* ─── Forms ────────────────────────────────────────────────── */

export type FormsPrefetchForm = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  formTitle?: string | null;
};

export type FormsPrefetchSnapshot = {
  forms: FormsPrefetchForm[];
  nextPageToken?: string;
};

let formsCache: FormsPrefetchSnapshot | null = null;

export function getFormsPrefetchCache(): FormsPrefetchSnapshot | null {
  return formsCache;
}

export function setFormsPrefetchCache(snapshot: FormsPrefetchSnapshot): void {
  formsCache = snapshot;
}

async function prefetchFormsData(signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/forms?pageSize=30", { cache: "no-store", signal });
  if (signal?.aborted) return;
  if (!res.ok) return;

  const data = (await res.json()) as {
    forms?: FormsPrefetchForm[];
    nextPageToken?: string;
  };

  if (signal?.aborted) return;
  setFormsPrefetchCache({
    forms: data.forms ?? [],
    nextPageToken: data.nextPageToken,
  });
}

/* ─── Login chain (mail + drive, then WhatsApp → Calendar → Forms) ─ */

export async function prefetchSecondaryFeaturesInOrder(opts?: {
  restrictedFeatures?: readonly string[];
  signal?: AbortSignal;
}): Promise<void> {
  const restricted = new Set(opts?.restrictedFeatures ?? []);
  const signal = opts?.signal;

  if (!restricted.has("whatsapp")) {
    await prefetchWhatsAppData(signal);
  }
  if (signal?.aborted) return;

  if (!restricted.has("calendar")) {
    await prefetchCalendarData(signal);
  }
  if (signal?.aborted) return;

  if (!restricted.has("forms")) {
    await prefetchFormsData(signal);
  }
}

/**
 * Full login warm: mail + drive in parallel, then WhatsApp → Calendar → Forms.
 * Best-effort; never throws.
 */
export async function runLoginPrefetchChain(opts?: {
  restrictedFeatures?: readonly string[];
  signal?: AbortSignal;
  mailConcurrency?: number;
  driveConcurrency?: number;
}): Promise<void> {
  const signal = opts?.signal;
  try {
    await Promise.all([
      prefetchMailListViews({
        signal,
        concurrency: opts?.mailConcurrency ?? 3,
      }),
      prefetchDriveListViews({
        signal,
        concurrency: opts?.driveConcurrency ?? 2,
      }),
    ]);
    if (signal?.aborted) return;
    await prefetchSecondaryFeaturesInOrder({
      restrictedFeatures: opts?.restrictedFeatures,
      signal,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return;
    /* prefetch is best-effort */
  }
}

/** Clear secondary feature caches (e.g. on sign-out if needed later). */
export function clearSecondaryFeaturePrefetchCache(): void {
  whatsappCache = null;
  calendarCache = null;
  formsCache = null;
}

export function isFeatureRestricted(
  restricted: readonly string[] | undefined,
  feature: FeatureKey
): boolean {
  return new Set(restricted ?? []).has(feature);
}
