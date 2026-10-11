import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { setCachedThreadMeta, type ThreadMeta } from "@/lib/gmail-thread-meta-cache";

/**
 * Persistent, shared layer under the in-memory thread-meta cache
 * (lib/gmail-thread-meta-cache.ts). That cache is per server instance and lost on
 * every cold start, so each instance — and each teammate — re-fetched the same
 * threads at 10 quota units apiece. This stores the same rows in Postgres
 * (supabase/migrations/0072_gmail_thread_meta.sql), keyed by (mailbox, thread,
 * historyId): Gmail's list call returns the current historyId for free, so a stored
 * row whose historyId matches is exactly current, and a mismatch is simply a miss.
 *
 * Best effort throughout: if the table isn't there yet, the database is slow, or
 * anything else fails, the list falls back to fetching from Gmail as before.
 * Turn off with GMAIL_THREAD_META_STORE=0.
 */

const TABLE = "gmail_thread_meta";
const ENABLED = process.env.GMAIL_THREAD_META_STORE !== "0";
/** Rows not refreshed for this long are deleted — retention for data we keep about people's mail. */
const RETENTION_DAYS = 90;
/** Give up on a slow database rather than hold up the page. */
const READ_TIMEOUT_MS = 1500;
const WRITE_TIMEOUT_MS = 3000;
const IN_CHUNK = 100;
const UPSERT_CHUNK = 200;
/** Fraction of writes that also run the retention purge. */
const PURGE_PROBABILITY = 0.01;

let unavailable = false;
let lastWarnAt = 0;

type Row = {
  thread_id: string;
  history_id: string;
  subject: string;
  from_header: string;
  last_date: string;
  label_ids: string[];
  unread: boolean;
  starred: boolean;
  important: boolean;
  has_attachments: boolean;
  participants: string[];
  message_count: number;
};

export type StoredMetaItem = { threadId: string; historyId: string; meta: ThreadMeta };

function fail(e: unknown, what: string): void {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const code = (e as { code?: string } | null)?.code ?? "";
  // The migration hasn't been applied to this database — stop trying until restart.
  if (code === "42P01" || code === "PGRST205" || /gmail_thread_meta/i.test(msg) && /(does not exist|schema cache)/i.test(msg)) {
    unavailable = true;
    console.warn(`[thread-meta-store] ${TABLE} is missing — skipping the shared store until restart (apply migration 0072).`);
    return;
  }
  if (Date.now() - lastWarnAt > 60_000) {
    lastWarnAt = Date.now();
    console.warn(`[thread-meta-store] ${what} failed: ${msg}`);
  }
}

function rowToMeta(r: Row): ThreadMeta {
  return {
    subject: r.subject,
    from: r.from_header,
    date: r.last_date,
    labelIds: r.label_ids ?? [],
    unread: r.unread,
    starred: r.starred,
    important: r.important,
    hasAttachments: r.has_attachments,
    participants: r.participants ?? [],
    messageCount: r.message_count,
  };
}

function metaToRow(mailbox: string, it: StoredMetaItem) {
  const m = it.meta;
  return {
    mailbox_owner_id: mailbox,
    thread_id: it.threadId,
    history_id: it.historyId,
    subject: m.subject ?? "",
    from_header: m.from ?? "",
    last_date: m.date ?? "",
    label_ids: m.labelIds ?? [],
    unread: Boolean(m.unread),
    starred: Boolean(m.starred),
    important: Boolean(m.important),
    has_attachments: Boolean(m.hasAttachments),
    participants: m.participants ?? [],
    message_count: m.messageCount ?? 0,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Load the stored rows for a page of threads into the in-memory cache, so the
 * normal per-thread lookup hits. Only rows whose historyId equals the one Gmail
 * just reported are used.
 */
export async function hydrateThreadMetaFromStore(
  mailboxKey: string | undefined,
  threads: { id: string; historyId?: string }[]
): Promise<number> {
  if (!ENABLED || unavailable || !mailboxKey) return 0;
  const wanted = new Map<string, string>(); // thread id -> historyId
  for (const t of threads) if (t.historyId) wanted.set(t.id, t.historyId);
  if (wanted.size === 0) return 0;

  let hits = 0;
  try {
    const svc = createServiceSupabase();
    const ids = Array.from(wanted.keys());
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const { data, error } = await svc
        .from(TABLE)
        .select(
          "thread_id, history_id, subject, from_header, last_date, label_ids, unread, starred, important, has_attachments, participants, message_count"
        )
        .eq("mailbox_owner_id", mailboxKey)
        .in("thread_id", ids.slice(i, i + IN_CHUNK))
        .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
      if (error) throw error;
      for (const r of (data ?? []) as Row[]) {
        if (wanted.get(r.thread_id) !== r.history_id) continue; // thread changed since — a miss
        setCachedThreadMeta(mailboxKey, r.thread_id, r.history_id, rowToMeta(r));
        hits++;
      }
    }
  } catch (e) {
    fail(e, "read");
  }
  return hits;
}

/** Store rows just fetched from Gmail so other instances and teammates get them for free. */
export async function saveThreadMetaToStore(
  mailboxKey: string | undefined,
  items: StoredMetaItem[]
): Promise<void> {
  if (!ENABLED || unavailable || !mailboxKey || items.length === 0) return;
  try {
    const svc = createServiceSupabase();
    for (let i = 0; i < items.length; i += UPSERT_CHUNK) {
      const { error } = await svc
        .from(TABLE)
        .upsert(items.slice(i, i + UPSERT_CHUNK).map((it) => metaToRow(mailboxKey, it)), {
          onConflict: "mailbox_owner_id,thread_id",
        })
        .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
      if (error) throw error;
    }
    if (Math.random() < PURGE_PROBABILITY) void purgeStaleThreadMeta();
  } catch (e) {
    fail(e, "write");
  }
}

/** Retention: delete rows nobody has refreshed in RETENTION_DAYS. */
export async function purgeStaleThreadMeta(): Promise<void> {
  if (!ENABLED || unavailable) return;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    const { error } = await createServiceSupabase().from(TABLE).delete().lt("fetched_at", cutoff);
    if (error) throw error;
  } catch (e) {
    fail(e, "purge");
  }
}

/**
 * Collects rows as they are fetched from Gmail and saves them in small batches while
 * the page is still loading, instead of all at the end. That matters when two things
 * work on the same page — a background warm-up and the person who just opened it: the
 * warm-up re-reads the store between batches and skips what has already been saved.
 */
const SAVE_BATCH = 10;
export function createThreadMetaSaver(mailboxKey: string | undefined) {
  let pending: StoredMetaItem[] = [];
  const inflight: Promise<void>[] = [];
  let total = 0;
  const flushNow = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    inflight.push(saveThreadMetaToStore(mailboxKey, batch));
  };
  return {
    add(item: StoredMetaItem) {
      total++;
      pending.push(item);
      if (pending.length >= SAVE_BATCH) flushNow();
    },
    /** Save whatever is left and wait for every save to finish. */
    async done(): Promise<void> {
      flushNow();
      await Promise.all(inflight);
    },
    get count() {
      return total;
    },
  };
}
