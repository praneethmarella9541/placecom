import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listMessageIdsPage,
  fetchGmailMessageHeadersByIds,
  fetchGmailHistoryId,
  fetchGmailHistoryPage,
  GmailHistoryExpiredError,
  GmailRateLimitError,
  type GmailMessageHeaders,
} from "@/lib/gmail";
import { bucketEmailConnection } from "@/lib/email-connection-strength";
import { resolveCompanyNames } from "@/lib/company-enrichment";
import { isLikelyAutomatedAddress } from "@/lib/mail-noise-filter";

type ParsedAddress = { name: string | null; email: string };

/** Splits a header address list on top-level commas (ignores commas inside quoted display names). */
function splitAddressList(header: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of header) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAddress(entry: string): ParsedAddress | null {
  const angleMatch = entry.match(/<([^<>]+)>/);
  let email: string;
  let name: string | null = null;
  if (angleMatch) {
    email = angleMatch[1].trim();
    name = entry.slice(0, angleMatch.index).replace(/"/g, "").trim() || null;
  } else {
    email = entry.trim();
  }
  email = email.toLowerCase();
  if (!EMAIL_RE.test(email)) return null;
  return { name, email };
}

function parseAddressHeader(header: string): ParsedAddress[] {
  if (!header) return [];
  return splitAddressList(header)
    .map(parseAddress)
    .filter((a): a is ParsedAddress => a !== null);
}

function domainOf(email: string): string {
  return email.slice(email.indexOf("@") + 1).toLowerCase();
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/** See migration 0053's comment for why 300 never causes a false negative in practice. */
const RECENT_DATES_CAP = 300;

// Leaves margin under the route's `maxDuration = 300` — a batch call stops paging
// and persists its resume cursor once this budget is spent, rather than risking a
// mid-page timeout that would lose the in-flight page's work.
const BATCH_TIME_BUDGET_MS = 250_000;

/**
 * Restricts the scan to genuine two-way correspondence: mail currently in the
 * Inbox plus everything sent. Deliberately NOT date-bounded — the full history
 * is scanned, however far back it goes.
 *
 * Each exclusion earns its place:
 *  - drafts   — never sent, so the addresses in them aren't proven contacts.
 *  - chats    — Google Chat messages 400 on `format=metadata` (see
 *               fetchGmailMessageHeadersByIds), so scanning them burns Gmail
 *               quota on messages that can only ever be skipped.
 *  - promotions / social — bulk senders. isLikelyAutomatedAddress already drops
 *               most of them *after* the fetch; filtering in the query means not
 *               paying the ~5 quota units per message to fetch them at all.
 *
 * Spam and Trash need no clause — Gmail's list API excludes them unless
 * `includeSpamTrash` is set, which listMessageIdsPage never does.
 *
 * NOTE: archived mail (received, then moved out of the Inbox) is excluded by
 * `in:inbox`. That is the intended scope, but it does mean contacts reachable
 * only through archived threads won't be discovered.
 */
const BACKFILL_QUERY =
  "(in:inbox OR in:sent) -in:drafts -in:chats -category:promotions -category:social";

/**
 * Bumped whenever BACKFILL_QUERY changes. A stored `page_token` is only
 * meaningful for the exact query that produced it, so a mismatch against the
 * persisted `query_version` restarts backfill from the top (see runBackfillPhase).
 */
// v2: the query now carries a `before:<backfill start>` bound, so tokens minted
// under v1 page a different result set and cannot be resumed against it.
const BACKFILL_QUERY_VERSION = "inbox-sent-v2";

// history.list takes no `q` — it's a raw changelog — so the incremental phase
// has to reproduce BACKFILL_QUERY's intent from each message's labels instead.
// Keep the two in sync: whatever the query above excludes, exclude here too.
const EXCLUDED_LABEL_IDS = new Set([
  "DRAFT",
  "CHAT",
  "SPAM",
  "TRASH",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
]);

/** Label-set equivalent of BACKFILL_QUERY, for messages arriving via history.list. */
function isSyncableLabelSet(labelIds: string[]): boolean {
  let inScope = false;
  for (const id of labelIds) {
    if (EXCLUDED_LABEL_IDS.has(id)) return false;
    if (id === "INBOX" || id === "SENT") inScope = true;
  }
  return inScope;
}

type SyncStateRow = {
  mailbox_owner_id: string;
  status: "idle" | "running" | "paused" | "error";
  phase: "backfill" | "incremental" | null;
  page_token: string | null;
  oldest_scanned_internal_date: number | null;
  newest_scanned_internal_date: number | null;
  messages_scanned_total: number;
  contacts_found_total: number;
  last_progress: { scanned: number; total?: number | null } | null;
  last_summary: string | null;
  started_at: string | null;
  updated_at: string;
  completed_backfill_at: string | null;
  error_message: string | null;
  /** Gmail history cursor captured once backfill completes — see runIncrementalPhase. */
  history_id: string | null;
  /** BACKFILL_QUERY_VERSION this row's page_token belongs to; a mismatch restarts backfill. */
  query_version: string | null;
};

export type ContactSyncBatchResult =
  | { status: "already_running" }
  /** The user stopped this sync; only an explicit resume (the UI's Sync button) restarts it. */
  | { status: "paused" }
  /** Gmail's per-minute quota is exhausted. Progress is saved — retry after a pause. */
  | { status: "rate_limited" }
  | {
      status: "ok";
      done: boolean;
      phase: "backfill" | "incremental";
      /** Scanned during just this one batch call (up to ~250s) — not the running total. */
      messagesScanned: number;
      /** Cumulative across the whole backfill/incremental run so far — what the UI should display. */
      messagesScannedTotal: number;
      contactsFound: number;
    }
  | { status: "error"; message: string };

// How long a "running" row is trusted before it's treated as a crashed process.
// Now that every batch releases the lock on its way out (see the not-done
// branches below), a row can only still read "running" here if another batch is
// genuinely mid-flight or its process died. A live batch re-stamps updated_at
// after every page — roughly every 10-15s — so this only needs enough headroom
// to cover one slow page including Gmail rate-limit backoff, not a whole batch.
const ALREADY_RUNNING_STALE_MS = 2 * 60 * 1000;

/**
 * Aggregates one page of message headers into per-contact rows and upserts them.
 * Shared by both phases — backfill and incremental page differently (search
 * pagination vs. history.list), but process the resulting headers identically.
 * Returns the emails actually upserted this call (empty on upsert failure).
 */
async function processHeadersPage(
  supabase: SupabaseClient,
  syncedByUserId: string,
  mailboxOwnerId: string,
  ownEmail: string | undefined,
  headers: GmailMessageHeaders[]
): Promise<string[]> {
  type ContactAgg = {
    displayName: string | null;
    domain: string;
    dates: number[];
    hasOutbound: boolean;
    /** Ever seen in From (inbound) or To (outbound) — false means every sighting so far was Cc-only. */
    hasDirect: boolean;
  };
  const pageContacts = new Map<string, ContactAgg>();

  for (const msg of headers) {
    if (!msg.internalDate) continue;

    // A message *we* sent (from === our own mailbox) means everyone in
    // its To/Cc got real, deliberate outreach — the strongest signal
    // that a contact is a genuine relationship rather than an
    // automated/notification sender we've only ever received from.
    const fromAddr = parseAddress(msg.from);
    const isOutboundMessage = !!ownEmail && fromAddr?.email.toLowerCase() === ownEmail;

    const addresses = [
      ...parseAddressHeader(msg.from).map((a) => ({ ...a, role: "from" as const })),
      ...parseAddressHeader(msg.to).map((a) => ({ ...a, role: "to" as const })),
      ...parseAddressHeader(msg.cc).map((a) => ({ ...a, role: "cc" as const })),
    ];
    for (const { name, email, role } of addresses) {
      const domain = domainOf(email);
      if (!domain) continue;
      // No domain-based exclusion at all: colleagues on the mailbox's own domain
      // are wanted here alongside everyone else. The only address dropped is the
      // mailbox owner's own — it appears in the From of every sent message and
      // the To of much of the rest, so it would top the list as a "contact" that
      // is just the user themselves.
      if (ownEmail && email === ownEmail) continue;
      if (isLikelyAutomatedAddress(email)) continue;

      const fromToOrCc = role !== "from";
      const outboundHit = isOutboundMessage && fromToOrCc;
      // Direct = they wrote it (From) or were actually addressed (To) —
      // being Cc'd on a thread doesn't count, that's the whole point of
      // this signal (see the migration adding has_direct_contact).
      const directHit = role !== "cc";
      const agg = pageContacts.get(email);
      if (agg) {
        agg.dates.push(msg.internalDate);
        if (!agg.displayName && name) agg.displayName = name;
        if (outboundHit) agg.hasOutbound = true;
        if (directHit) agg.hasDirect = true;
      } else {
        pageContacts.set(email, {
          displayName: name,
          domain,
          dates: [msg.internalDate],
          hasOutbound: outboundHit,
          hasDirect: directHit,
        });
      }
    }
  }

  const now = Date.now();
  const syncedAt = new Date().toISOString();
  const pageEmails = Array.from(pageContacts.keys());
  if (pageEmails.length === 0) return [];

  // Every stat below is MERGED with what's already stored, never replaced. A
  // contact who appears across many pages — i.e. anyone actually corresponded
  // with — would otherwise end up holding whatever the last page to touch them
  // happened to see, and since Gmail pages newest-first that last page is the
  // OLDEST slice of their mail. That's how a contact emailed yesterday, 400
  // messages deep, used to land in the directory reading "dormant, 3 messages".
  type ExistingStats = {
    hasOutbound: boolean;
    displayName: string | null;
    lastInteractionMs: number;
    messageCountTotal: number;
    messageCount90d: number;
    recentDates: number[];
  };
  const existingByEmail = new Map<string, ExistingStats>();
  const { data: existingRows } = await supabase
    .from("synced_contacts")
    .select(
      "email, display_name, has_outbound_contact, last_interaction_at, message_count_total, message_count_90d, recent_message_dates"
    )
    .eq("mailbox_owner_id", mailboxOwnerId)
    .in("email", pageEmails);
  for (const row of existingRows ?? []) {
    const parsedLast = row.last_interaction_at ? Date.parse(row.last_interaction_at as string) : 0;
    existingByEmail.set(row.email as string, {
      hasOutbound: Boolean(row.has_outbound_contact),
      displayName: (row.display_name as string | null) ?? null,
      lastInteractionMs: Number.isNaN(parsedLast) ? 0 : parsedLast,
      messageCountTotal: Number(row.message_count_total ?? 0),
      messageCount90d: Number(row.message_count_90d ?? 0),
      recentDates: Array.isArray(row.recent_message_dates) ? (row.recent_message_dates as number[]) : [],
    });
  }

  // Real company names (logo.dev, cached — falls back to the syntactic guess on
  // any failure). Resolved once per distinct domain in this page, not per contact.
  const companyNames = await resolveCompanyNames(
    supabase,
    Array.from(pageContacts.values()).map((agg) => agg.domain)
  );

  const pageRows = Array.from(pageContacts.entries()).map(([email, agg]) => {
    const existing = existingByEmail.get(email);

    // Newest wins, whichever page found it — safe to re-apply, so a replayed
    // page can't move this backwards.
    const lastMs = Math.max(...agg.dates, existing?.lastInteractionMs ?? 0);
    const lastInteractionAt = new Date(lastMs).toISOString();

    const pageRecent90d = agg.dates.filter((d) => now - d <= NINETY_DAYS_MS).length;
    // 90d is a *rolling* window, so a stored figure is only carried forward
    // while it can still be inside that window: once the contact's newest known
    // message has itself aged past 90 days, every message that figure counted
    // has too, and carrying it would leave a number that only ever grows.
    const carriedRecent90d =
      existing && now - existing.lastInteractionMs <= NINETY_DAYS_MS ? existing.messageCount90d : 0;
    const recentCount90d = carriedRecent90d + pageRecent90d;

    const hasOutboundContact = agg.hasOutbound || existing?.hasOutbound === true;
    // Deliberately NOT ORed with `existing` the way hasOutbound is. Every
    // pre-0051 row's stored has_direct_contact is a placeholder default
    // (true, "not yet disproven" — see that migration), not real evidence,
    // so ORing a fresh, accurate `false` against it would always lose to
    // the placeholder and the signal could never actually self-correct even
    // once a real resync determined the truth. agg.hasDirect alone is
    // authoritative for any contact this call actually touched — it already
    // accumulates correctly across every message seen in this one call.
    const hasDirectContact = agg.hasDirect;

    // Merge with whatever dates earlier syncs already found, dedupe, cap to
    // the most recent 300 (see migration 0053) — this is what lets the
    // bucketing rule compute "N messages in the last W days" for whatever W
    // each user configures, not just the fixed 90 message_count_90d rolls up.
    const mergedDates = Array.from(new Set([...(existing?.recentDates ?? []), ...agg.dates]))
      .sort((a, b) => b - a)
      .slice(0, RECENT_DATES_CAP);

    const connectionStrength = bucketEmailConnection({
      lastInteractionAt,
      messageDates: mergedDates,
      recentCount90dFallback: recentCount90d,
      hasOutboundContact,
      hasDirectContact,
    });
    return {
      email,
      // Keep a name an earlier page found rather than blanking it. Plenty of
      // messages carry a bare address with no display name — especially from
      // consumer accounts — so a plain overwrite meant one such message on a
      // later page could erase a perfectly good name, leaving the contact
      // showing only its email address.
      display_name: agg.displayName ?? existing?.displayName ?? null,
      domain: agg.domain,
      company_name: companyNames.get(agg.domain) ?? agg.domain,
      last_interaction_at: lastInteractionAt,
      connection_strength: connectionStrength,
      message_count_90d: recentCount90d,
      message_count_total: (existing?.messageCountTotal ?? 0) + agg.dates.length,
      has_outbound_contact: hasOutboundContact,
      has_direct_contact: hasDirectContact,
      recent_message_dates: mergedDates,
      synced_at: syncedAt,
      synced_by: syncedByUserId,
      mailbox_owner_id: mailboxOwnerId,
      updated_at: syncedAt,
    };
  });

  // One bulk upsert for the whole page instead of one awaited round-trip per
  // contact — with ~150-200 distinct contacts per 500-message page, that was
  // the dominant write cost of a sync, far more than the Gmail fetch itself.
  const { error } = await supabase
    .from("synced_contacts")
    .upsert(pageRows, { onConflict: "mailbox_owner_id,email" });
  return error ? [] : pageRows.map((r) => r.email);
}

/**
 * Runs one bounded chunk of a mailbox's contact sync and persists progress to
 * its `contact_sync_state` row (keyed by mailboxOwnerId — one admin mailbox's
 * cursor never touches another's) before returning, so a timeout never loses
 * work. Call again while `done: false` to continue (mirrors the existing
 * extraction_jobs batch-loop pattern in app/api/extract/route.ts).
 *
 * Backfill (first ever sync) pages through the WHOLE mailbox with no message cap —
 * once it completes, every later call runs a fast, exact incremental sync off
 * Gmail's history.list changelog instead of rescanning by date.
 */
export async function runContactSyncBatch(
  supabase: SupabaseClient,
  syncedByUserId: string,
  accessToken: string,
  gmailAddress: string | undefined,
  mailboxOwnerId: string,
  /**
   * Set by the UI's "Sync from Mailbox" button, which is the one caller allowed
   * to restart a sync the user stopped. Background drivers (cron) must leave a
   * paused row alone — otherwise Stop only holds until the next cron tick, or
   * until the next batch in a cron invocation that was already in progress.
   */
  options?: { resumePaused?: boolean }
): Promise<ContactSyncBatchResult> {
  const { data: existing, error: readError } = await supabase
    .from("contact_sync_state")
    .select("*")
    .eq("mailbox_owner_id", mailboxOwnerId)
    .maybeSingle();

  if (readError) return { status: "error", message: readError.message };

  const state: SyncStateRow =
    existing ??
    ({
      mailbox_owner_id: mailboxOwnerId,
      status: "idle",
      phase: null,
      page_token: null,
      oldest_scanned_internal_date: null,
      newest_scanned_internal_date: null,
      messages_scanned_total: 0,
      contacts_found_total: 0,
      last_progress: null,
      last_summary: null,
      started_at: null,
      updated_at: new Date().toISOString(),
      completed_backfill_at: null,
      error_message: null,
      history_id: null,
      query_version: null,
    } satisfies SyncStateRow);

  if (state.status === "paused" && !options?.resumePaused) {
    return { status: "paused" };
  }

  if (state.status === "running") {
    const staleMs = Date.now() - new Date(state.updated_at).getTime();
    if (staleMs < ALREADY_RUNNING_STALE_MS) {
      return { status: "already_running" };
    }
    // Previous run's process died mid-batch without updating the row — treat as
    // crashed and resume from its last persisted page_token rather than locking forever.
  }

  const ownEmail = gmailAddress?.trim().toLowerCase();
  const phase: "backfill" | "incremental" = state.completed_backfill_at ? "incremental" : "backfill";

  await supabase.from("contact_sync_state").upsert(
    {
      mailbox_owner_id: mailboxOwnerId,
      status: "running",
      phase,
      started_at: state.started_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    },
    { onConflict: "mailbox_owner_id" }
  );

  const startedAt = Date.now();

  try {
    if (phase === "backfill") {
      return await runBackfillPhase(
        supabase,
        accessToken,
        syncedByUserId,
        mailboxOwnerId,
        ownEmail,
        state,
        startedAt
      );
    }
    return await runIncrementalPhase(
      supabase,
      accessToken,
      syncedByUserId,
      mailboxOwnerId,
      ownEmail,
      state,
      startedAt
    );
  } catch (err: unknown) {
    if (err instanceof GmailRateLimitError) {
      // Not a failure — the mailbox is fine and the cursor was persisted after
      // the last completed page. Release the lock and report back so the caller
      // waits out the quota window and resumes, instead of parking the whole
      // sync in "error" and needing a manual restart.
      await supabase
        .from("contact_sync_state")
        .update({ status: "idle", updated_at: new Date().toISOString() })
        .eq("mailbox_owner_id", mailboxOwnerId)
        .eq("status", "running");
      return { status: "rate_limited" };
    }
    const message = err instanceof Error ? err.message : "Mailbox sync failed";
    await supabase
      .from("contact_sync_state")
      .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
      .eq("mailbox_owner_id", mailboxOwnerId);
    return { status: "error", message };
  }
}

async function runBackfillPhase(
  supabase: SupabaseClient,
  accessToken: string,
  syncedByUserId: string,
  mailboxOwnerId: string,
  ownEmail: string | undefined,
  state: SyncStateRow,
  startedAt: number
): Promise<ContactSyncBatchResult> {
  const seenEmailsThisRun = new Set<string>();

  // Gmail page tokens are bound to the query that produced them, so a token
  // stored under an older BACKFILL_QUERY can't be resumed against the current
  // one — restart from the top instead. Costs a re-scan, never correctness
  // (every write below is an idempotent upsert), and the running scanned count
  // resets with it so the progress figure keeps meaning "under this filter".
  const queryChanged = state.query_version !== BACKFILL_QUERY_VERSION;

  let pageToken = queryChanged ? undefined : state.page_token ?? undefined;

  // Every batch of one backfill must page the SAME result set. Gmail's search
  // pagination is not a snapshot: mail arriving mid-backfill shifts results
  // forward, so a message sitting near a page boundary can slide across it
  // between batches and never be returned at all — silently, and permanently,
  // because the old code captured its incremental cursor only at completion and
  // so never went back for it. Bounding the query at the instant the backfill
  // started freezes the set; anything newer is picked up by the incremental
  // phase instead, whose cursor is now taken BEFORE the first page is read.
  let backfillStartedAtMs = state.started_at ? Date.parse(state.started_at) : Date.now();
  let historyIdAtStart = state.history_id;

  if (pageToken === undefined) {
    backfillStartedAtMs = Date.now();
    // Taken before any scanning: the incremental phase resumes from here, so the
    // window it covers overlaps the backfill rather than starting after it. Re-
    // processing that overlap is free — every contact write is an idempotent
    // upsert — whereas a gap between the two phases loses mail outright.
    historyIdAtStart = await fetchGmailHistoryId(accessToken);

    await supabase
      .from("contact_sync_state")
      .update({
        started_at: new Date(backfillStartedAtMs).toISOString(),
        history_id: historyIdAtStart,
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);

    // message_count_* accumulate page by page (see processHeadersPage), so any
    // totals left by a previous partial or differently-scoped pass have to be
    // cleared or this pass adds on top of them. last_interaction_at is left
    // alone: it merges by max, so it can only improve.
    await supabase
      .from("synced_contacts")
      .update({ message_count_total: 0, message_count_90d: 0 })
      .eq("mailbox_owner_id", mailboxOwnerId);
  }

  // +1s so a message stamped in the same second as the start bound is included;
  // an overlap costs a duplicate upsert, a shortfall costs a message.
  const backfillQuery = `${BACKFILL_QUERY} before:${Math.ceil(backfillStartedAtMs / 1000) + 1}`;

  let messagesScannedThisRun = 0;
  let newestSeen = state.newest_scanned_internal_date ?? 0;
  let oldestSeen = state.oldest_scanned_internal_date ?? Number.MAX_SAFE_INTEGER;
  let messagesScannedTotal = queryChanged ? 0 : state.messages_scanned_total;
  let doneAllPages = false;

  // A cursor handed back to Gmail after a long gap (a pause held overnight, say)
  // is not guaranteed to still resolve. An expired one doesn't error — it comes
  // back as an empty page with no nextPageToken, which is indistinguishable from
  // "reached the end of the mailbox" unless we notice it happened on the very
  // first page of a resumed run. Treating that as completion would set
  // completed_backfill_at and permanently drop the sync into its incremental
  // phase with most of the mailbox never scanned.
  const resumedFromCursor = pageToken !== undefined;
  let pagesThisRun = 0;

  // Denominator for the progress bar. Deliberately treated as a moving target:
  // Gmail's resultSizeEstimate is rounded and often low, by an amount that
  // varies per mailbox, so it can only ever be a starting guess.
  //
  // Three things keep it honest:
  //   - seeded from last_progress.total, which a completed backfill overwrites
  //     with its EXACT final count — so the second run of a given mailbox starts
  //     from that mailbox's real size rather than a guess;
  //   - only the first non-zero estimate of a run is taken, because Gmail
  //     reports a shrinking estimate as it nears the end of a result set and
  //     following that would drive the bar backwards;
  //   - revised upward below whenever the scan approaches it with pages still
  //     outstanding, so a low estimate stretches instead of pinning at 99%.
  let totalEstimate = state.last_progress?.total ?? null;

  while (Date.now() - startedAt < BATCH_TIME_BUDGET_MS) {
    const { messageIds, nextPageToken, resultSizeEstimate } = await listMessageIdsPage(
      accessToken,
      {
        maxResults: 500,
        pageToken,
        q: backfillQuery,
      }
    );
    pagesThisRun += 1;

    if (totalEstimate === null && typeof resultSizeEstimate === "number" && resultSizeEstimate > 0) {
      totalEstimate = resultSizeEstimate;
    }

    if (resumedFromCursor && pagesThisRun === 1 && messageIds.length === 0 && !nextPageToken) {
      // Clearing query_version routes the next batch through the restart path
      // above, which drops the dead cursor, zeroes the counters and re-scans
      // from the top — rather than silently declaring the backfill finished.
      await supabase
        .from("contact_sync_state")
        .update({
          status: "idle",
          page_token: null,
          query_version: null,
          updated_at: new Date().toISOString(),
        })
        .eq("mailbox_owner_id", mailboxOwnerId)
        .eq("status", "running");

      return {
        status: "ok",
        done: false,
        phase: "backfill",
        messagesScanned: 0,
        messagesScannedTotal: state.messages_scanned_total,
        contactsFound: 0,
      };
    }

    if (messageIds.length > 0) {
      const headers = await fetchGmailMessageHeadersByIds(accessToken, messageIds);

      // messages_scanned_total counts headers actually retrieved, so a page that
      // yields fewer than it listed leaves the running total short of a round
      // multiple of the page size. That gap is the only outward sign that
      // something was skipped, so name it explicitly rather than leaving it to be
      // inferred from arithmetic. Only permanently-unreadable messages (4xx —
      // deleted, or Chat items) reach here; transient failures now propagate and
      // the page is retried instead.
      if (headers.length < messageIds.length) {
        console.warn(
          `[contact-sync] page listed ${messageIds.length} ids, ${headers.length} readable — ` +
            `${messageIds.length - headers.length} skipped as deleted/unreadable`
        );
      }

      for (const msg of headers) {
        if (!msg.internalDate) continue;
        newestSeen = Math.max(newestSeen, msg.internalDate);
        oldestSeen = Math.min(oldestSeen, msg.internalDate);
      }
      const upserted = await processHeadersPage(
        supabase,
        syncedByUserId,
        mailboxOwnerId,
        ownEmail,
        headers
      );
      for (const email of upserted) seenEmailsThisRun.add(email);
      messagesScannedThisRun += headers.length;
      messagesScannedTotal += headers.length;
    }

    // The scan has caught up with the estimate but Gmail still has pages to give:
    // the estimate was low. Push it out ahead of where we are rather than letting
    // the bar sit at its ceiling — an honest "still going" beats a stalled 99%.
    if (totalEstimate !== null && nextPageToken && messagesScannedTotal >= totalEstimate * 0.9) {
      totalEstimate = Math.ceil(messagesScannedTotal * 1.25);
    }

    pageToken = nextPageToken;

    // Persist the resume cursor after every page — a mid-batch crash or timeout
    // only ever costs the current (small) page, never the whole run. The row is
    // read back in the same round-trip so a Stop that landed mid-batch is noticed
    // here rather than up to ~250s later, when the budget finally expires.
    const { data: persisted } = await supabase
      .from("contact_sync_state")
      .update({
        page_token: pageToken ?? null,
        query_version: BACKFILL_QUERY_VERSION,
        oldest_scanned_internal_date: oldestSeen === Number.MAX_SAFE_INTEGER ? null : oldestSeen,
        newest_scanned_internal_date: newestSeen || null,
        messages_scanned_total: messagesScannedTotal,
        last_progress: { scanned: messagesScannedTotal, total: totalEstimate },
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId)
      .select("status")
      .maybeSingle();

    if (persisted && persisted.status !== "running") break; // stopped by the user

    if (!nextPageToken) {
      doneAllPages = true;
      break;
    }
  }

  const { count: contactsFoundTotal } = await supabase
    .from("synced_contacts")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_owner_id", mailboxOwnerId);

  if (doneAllPages) {
    // Keep the cursor taken at backfill START, not one taken now — anything that
    // arrived while the backfill was running was excluded by the `before:` bound
    // above, and this is what lets the incremental phase go back and collect it.
    // Re-deriving here is only a fallback for a start-time capture that failed.
    const historyId = historyIdAtStart ?? (await fetchGmailHistoryId(accessToken));
    // Cumulative, NOT this batch. A backfill spans however many batches its work
    // needs, and the final one is usually a short tail — reporting only that made
    // a 36,000-message backfill sign off as "Synced 486 emails". messagesScanned-
    // Total is the running count across every batch of this backfill, and
    // contactsFoundTotal is a live count of the contacts table.
    const summary = `Mailbox synced — ${messagesScannedTotal.toLocaleString()} emails scanned, ${(
      contactsFoundTotal ?? 0
    ).toLocaleString()} contacts found.`;
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        page_token: null,
        history_id: historyId,
        contacts_found_total: contactsFoundTotal ?? 0,
        last_summary: summary,
        // Replace the estimate with what the mailbox actually held. This is the
        // seed for the next backfill of this mailbox, so the guessing only ever
        // happens once — every subsequent run starts from a measured number.
        last_progress: { scanned: messagesScannedTotal, total: messagesScannedTotal },
        completed_backfill_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);
  } else {
    // Time budget hit mid-backfill. The lock MUST be released here even though
    // the work isn't finished: "running" means "a batch is executing right now",
    // and this one is about to return. Leaving it set made the caller's very next
    // POST — the continuation this branch exists to invite — collide with the
    // stale-lock check in runContactSyncBatch and 409 for ALREADY_RUNNING_STALE_MS
    // before any further progress was possible. page_token is already persisted,
    // so "unfinished" is expressed by that cursor, not by the lock.
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        contacts_found_total: contactsFoundTotal ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId)
      // Only release a lock we still hold: if Stop landed while this batch was
      // mid-flight the row now reads "paused", and releasing to "idle" would
      // resurrect a sync the user explicitly stopped.
      .eq("status", "running");
  }

  return {
    status: "ok",
    done: doneAllPages,
    phase: "backfill",
    messagesScanned: messagesScannedThisRun,
    messagesScannedTotal: messagesScannedTotal,
    contactsFound: seenEmailsThisRun.size,
  };
}

async function runIncrementalPhase(
  supabase: SupabaseClient,
  accessToken: string,
  syncedByUserId: string,
  mailboxOwnerId: string,
  ownEmail: string | undefined,
  state: SyncStateRow,
  startedAt: number
): Promise<ContactSyncBatchResult> {
  if (!state.history_id) {
    // Shouldn't normally happen (backfill always captures one) — re-derive from
    // "now" rather than fail outright; costs only the mail since this call.
    const historyId = await fetchGmailHistoryId(accessToken);
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        history_id: historyId,
        // Without this the UI keeps displaying whatever the previous run left
        // behind, so a sync that finished with nothing to do is indistinguishable
        // from one that never ran — which is exactly how this path looks from the
        // outside: the pill appears and vanishes within a second.
        last_summary: "Up to date.",
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);
    return {
      status: "ok",
      done: true,
      phase: "incremental",
      messagesScanned: 0,
      messagesScannedTotal: state.messages_scanned_total,
      contactsFound: 0,
    };
  }

  const seenEmailsThisRun = new Set<string>();
  let pageToken = state.page_token ?? undefined;
  let messagesScannedThisRun = 0;
  let latestHistoryId = state.history_id;
  let doneAllPages = false;
  let expired = false;

  try {
    while (Date.now() - startedAt < BATCH_TIME_BUDGET_MS) {
      const page = await fetchGmailHistoryPage(accessToken, state.history_id, pageToken);

      // Filtered by label rather than by query — history.list has no `q`, so
      // without this the incremental phase would keep re-admitting exactly the
      // drafts/chats/promotions/social BACKFILL_QUERY exists to keep out.
      const ids = page.messagesAdded.filter((m) => isSyncableLabelSet(m.labelIds)).map((m) => m.id);

      if (ids.length > 0) {
        const headers = await fetchGmailMessageHeadersByIds(accessToken, ids);
        const upserted = await processHeadersPage(
          supabase,
          syncedByUserId,
          mailboxOwnerId,
            ownEmail,
          headers
        );
        for (const email of upserted) seenEmailsThisRun.add(email);
        messagesScannedThisRun += headers.length;
      }

      if (page.historyId) latestHistoryId = page.historyId;
      pageToken = page.nextPageToken;

      const { data: persisted } = await supabase
        .from("contact_sync_state")
        .update({
          page_token: pageToken ?? null,
          messages_scanned_total: state.messages_scanned_total + messagesScannedThisRun,
          updated_at: new Date().toISOString(),
        })
        .eq("mailbox_owner_id", mailboxOwnerId)
        .select("status")
        .maybeSingle();

      if (persisted && persisted.status !== "running") break; // stopped by the user

      if (!pageToken) {
        doneAllPages = true;
        break;
      }
    }
  } catch (e) {
    if (!(e instanceof GmailHistoryExpiredError)) throw e;
    expired = true;
  }

  if (expired) {
    // historyId too old (>30 days idle) — bounded catch-up from the last known
    // watermark instead of a full rescan, then re-capture a fresh historyId.
    const afterSeconds = state.newest_scanned_internal_date
      ? Math.floor(state.newest_scanned_internal_date / 1000)
      : undefined;
    // Same scope as backfill, just bounded to mail newer than the watermark.
    const q = afterSeconds ? `${BACKFILL_QUERY} after:${afterSeconds}` : BACKFILL_QUERY;
    let catchUpToken: string | undefined;
    let newestSeen = state.newest_scanned_internal_date ?? 0;
    do {
      const { messageIds, nextPageToken } = await listMessageIdsPage(accessToken, {
        maxResults: 500,
        pageToken: catchUpToken,
        q,
      });
      if (messageIds.length > 0) {
        const headers = await fetchGmailMessageHeadersByIds(accessToken, messageIds);
        for (const msg of headers) {
          if (msg.internalDate) newestSeen = Math.max(newestSeen, msg.internalDate);
        }
        const upserted = await processHeadersPage(
          supabase,
          syncedByUserId,
          mailboxOwnerId,
            ownEmail,
          headers
        );
        for (const email of upserted) seenEmailsThisRun.add(email);
        messagesScannedThisRun += headers.length;
      }
      catchUpToken = nextPageToken;

      // Persisted per page, like the two loops above, rather than once after the
      // whole catch-up: message_count_* accumulate now, so a crash here would
      // otherwise replay every page since this batch began and count each of
      // those messages twice. Per-page persistence caps that at a single page.
      const { data: persisted } = await supabase
        .from("contact_sync_state")
        .update({
          page_token: catchUpToken ?? null,
          newest_scanned_internal_date: newestSeen || null,
          messages_scanned_total: state.messages_scanned_total + messagesScannedThisRun,
          updated_at: new Date().toISOString(),
        })
        .eq("mailbox_owner_id", mailboxOwnerId)
        .select("status")
        .maybeSingle();

      if (persisted && persisted.status !== "running") break; // stopped by the user
    } while (catchUpToken && Date.now() - startedAt < BATCH_TIME_BUDGET_MS);

    latestHistoryId = (await fetchGmailHistoryId(accessToken)) ?? latestHistoryId;
    doneAllPages = !catchUpToken;
  }

  const { count: contactsFoundTotal } = await supabase
    .from("synced_contacts")
    .select("id", { count: "exact", head: true })
    .eq("mailbox_owner_id", mailboxOwnerId);

  if (doneAllPages) {
    const summary =
      messagesScannedThisRun > 0
        ? `Synced ${messagesScannedThisRun} emails — found ${seenEmailsThisRun.size} contacts this run.`
        : "Up to date.";
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        page_token: null,
        history_id: latestHistoryId,
        contacts_found_total: contactsFoundTotal ?? 0,
        last_summary: summary,
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);
  } else {
    // Time budget hit mid-page. Lock released for the same reason as the backfill
    // branch above — the cursor, not the status, records that work remains.
    // history_id is NOT advanced yet (it only advances once this batch's pages are
    // done), so a resumed call re-reads from the same startHistoryId; page_token
    // keeps it from re-walking pages it already processed.
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        contacts_found_total: contactsFoundTotal ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId)
      // Only release a lock we still hold: if Stop landed while this batch was
      // mid-flight the row now reads "paused", and releasing to "idle" would
      // resurrect a sync the user explicitly stopped.
      .eq("status", "running");
  }

  return {
    status: "ok",
    done: doneAllPages,
    phase: "incremental",
    messagesScanned: messagesScannedThisRun,
    messagesScannedTotal: state.messages_scanned_total + messagesScannedThisRun,
    contactsFound: seenEmailsThisRun.size,
  };
}
