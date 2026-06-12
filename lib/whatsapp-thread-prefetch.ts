/**
 * Session-scoped prefetch for WhatsApp thread messages.
 * Mirrors Placecom mobile whatsapp-thread-cache (memory-only on web).
 */

import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";

const FRESH_MS = 45_000;
const PREFETCH_CONCURRENCY = 4;

export type WhatsAppPrefetchMessage = {
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

type MemoryEntry = { messages: WhatsAppPrefetchMessage[]; fetchedAt: number };

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<WhatsAppPrefetchMessage[] | null>>();

function isFresh(entry: MemoryEntry | undefined): boolean {
  return !!entry && Date.now() - entry.fetchedAt < FRESH_MS;
}

export function getCachedWhatsAppMessages(peer: string): WhatsAppPrefetchMessage[] | null {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;
  const entry = memory.get(key);
  return entry?.messages ?? null;
}

export function writeWhatsAppThreadCache(peer: string, messages: WhatsAppPrefetchMessage[]): void {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return;
  memory.set(key, { messages, fetchedAt: Date.now() });
}

async function fetchThread(peer: string): Promise<WhatsAppPrefetchMessage[] | null> {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/whatsapp/messages?peer=${encodeURIComponent(key)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { messages?: WhatsAppPrefetchMessage[]; error?: string };
      if (!res.ok) return null;
      return data.messages ?? [];
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export async function warmWhatsAppThread(
  peer: string,
  opts?: { force?: boolean }
): Promise<WhatsAppPrefetchMessage[] | null> {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;

  if (!opts?.force && isFresh(memory.get(key))) {
    return memory.get(key)!.messages;
  }

  const messages = await fetchThread(key);
  if (messages) writeWhatsAppThreadCache(key, messages);
  return messages;
}

export function prefetchWhatsAppThreadIntent(peer: string): void {
  void warmWhatsAppThread(peer);
}

export async function prefetchWhatsAppThreads(
  peers: string[],
  opts?: { limit?: number; force?: boolean }
): Promise<void> {
  const limit = opts?.limit ?? 24;
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const p of peers) {
    const key = canonicalWhatsAppPeer(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!opts?.force && isFresh(memory.get(key))) continue;
    unique.push(key);
    if (unique.length >= limit) break;
  }

  for (let i = 0; i < unique.length; i += PREFETCH_CONCURRENCY) {
    const batch = unique.slice(i, i + PREFETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (peer) => {
        const messages = await fetchThread(peer);
        if (messages) writeWhatsAppThreadCache(peer, messages);
      })
    );
  }
}

export function clearWhatsAppThreadPrefetchCache(): void {
  memory.clear();
  inflight.clear();
}
