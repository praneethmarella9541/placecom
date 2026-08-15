import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listMessageIdsPage,
  fetchGmailMessageHeadersByIds,
  fetchGmailHistoryId,
  fetchGmailHistoryPage,
  GmailHistoryExpiredError,
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

// Leaves margin under the route's `maxDuration = 300` — a batch call stops paging
// and persists its resume cursor once this budget is spent, rather than risking a
// mid-page timeout that would lose the in-flight page's work.
const BATCH_TIME_BUDGET_MS = 250_000;

type SyncStateRow = {
  mailbox_owner_id: string;
  status: "idle" | "running" | "paused" | "error";
  phase: "backfill" | "incremental" | null;
  page_token: string | null;
  oldest_scanned_internal_date: number | null;
  newest_scanned_internal_date: number | null;
  messages_scanned_total: number;
  contacts_found_total: number;
  last_progress: { scanned: number } | null;
  last_summary: string | null;
  started_at: string | null;
  updated_at: string;
  completed_backfill_at: string | null;
  error_message: string | null;
  /** Gmail history cursor captured once backfill completes — see runIncrementalPhase. */
  history_id: string | null;
};

export type ContactSyncBatchResult =
  | { status: "already_running" }
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

const ALREADY_RUNNING_STALE_MS = 6 * 60 * 1000;

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
  ownDomain: string | undefined,
  ownEmail: string | undefined,
  headers: GmailMessageHeaders[]
): Promise<string[]> {
  type ContactAgg = { displayName: string | null; domain: string; dates: number[]; hasOutbound: boolean };
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
      ...parseAddressHeader(msg.from).map((a) => ({ ...a, fromToOrCc: false as const })),
      ...parseAddressHeader(msg.to).map((a) => ({ ...a, fromToOrCc: true as const })),
      ...parseAddressHeader(msg.cc).map((a) => ({ ...a, fromToOrCc: true as const })),
    ];
    for (const { name, email, fromToOrCc } of addresses) {
      const domain = domainOf(email);
      if (!domain || domain === ownDomain) continue;
      if (isLikelyAutomatedAddress(email)) continue;

      const outboundHit = isOutboundMessage && fromToOrCc;
      const agg = pageContacts.get(email);
      if (agg) {
        agg.dates.push(msg.internalDate);
        if (!agg.displayName && name) agg.displayName = name;
        if (outboundHit) agg.hasOutbound = true;
      } else {
        pageContacts.set(email, { displayName: name, domain, dates: [msg.internalDate], hasOutbound: outboundHit });
      }
    }
  }

  const now = Date.now();
  const syncedAt = new Date().toISOString();
  const pageEmails = Array.from(pageContacts.keys());
  if (pageEmails.length === 0) return [];

  // has_outbound_contact must only ever flip false -> true, never back —
  // a contact proven "real" by an earlier page shouldn't regress just
  // because this page's messages happen not to show outbound evidence.
  const existingOutbound = new Map<string, boolean>();
  const { data: existingRows } = await supabase
    .from("synced_contacts")
    .select("email, has_outbound_contact")
    .eq("mailbox_owner_id", mailboxOwnerId)
    .in("email", pageEmails);
  for (const row of existingRows ?? []) {
    existingOutbound.set(row.email as string, Boolean(row.has_outbound_contact));
  }

  // Real company names (logo.dev, cached — falls back to the syntactic guess on
  // any failure). Resolved once per distinct domain in this page, not per contact.
  const companyNames = await resolveCompanyNames(
    supabase,
    Array.from(pageContacts.values()).map((agg) => agg.domain)
  );

  const pageRows = Array.from(pageContacts.entries()).map(([email, agg]) => {
    const lastMs = Math.max(...agg.dates);
    const lastInteractionAt = new Date(lastMs).toISOString();
    const recentCount90d = agg.dates.filter((d) => now - d <= NINETY_DAYS_MS).length;
    const connectionStrength = bucketEmailConnection({ lastInteractionAt, recentCount90d });
    return {
      email,
      display_name: agg.displayName,
      domain: agg.domain,
      company_name: companyNames.get(agg.domain) ?? agg.domain,
      last_interaction_at: lastInteractionAt,
      connection_strength: connectionStrength,
      message_count_90d: recentCount90d,
      message_count_total: agg.dates.length,
      has_outbound_contact: agg.hasOutbound || existingOutbound.get(email) === true,
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
  mailboxOwnerId: string
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
    } satisfies SyncStateRow);

  if (state.status === "running") {
    const staleMs = Date.now() - new Date(state.updated_at).getTime();
    if (staleMs < ALREADY_RUNNING_STALE_MS) {
      return { status: "already_running" };
    }
    // Previous run's process died mid-batch without updating the row — treat as
    // crashed and resume from its last persisted page_token rather than locking forever.
  }

  const ownDomain = gmailAddress ? domainOf(gmailAddress) : undefined;
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
        ownDomain,
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
      ownDomain,
      ownEmail,
      state,
      startedAt
    );
  } catch (err: unknown) {
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
  ownDomain: string | undefined,
  ownEmail: string | undefined,
  state: SyncStateRow,
  startedAt: number
): Promise<ContactSyncBatchResult> {
  const seenEmailsThisRun = new Set<string>();
  let pageToken = state.page_token ?? undefined;
  let messagesScannedThisRun = 0;
  let newestSeen = state.newest_scanned_internal_date ?? 0;
  let oldestSeen = state.oldest_scanned_internal_date ?? Number.MAX_SAFE_INTEGER;
  let messagesScannedTotal = state.messages_scanned_total;
  let doneAllPages = false;

  while (Date.now() - startedAt < BATCH_TIME_BUDGET_MS) {
    const { messageIds, nextPageToken } = await listMessageIdsPage(accessToken, {
      maxResults: 500,
      pageToken,
      q: "",
    });

    if (messageIds.length > 0) {
      const headers = await fetchGmailMessageHeadersByIds(accessToken, messageIds);
      for (const msg of headers) {
        if (!msg.internalDate) continue;
        newestSeen = Math.max(newestSeen, msg.internalDate);
        oldestSeen = Math.min(oldestSeen, msg.internalDate);
      }
      const upserted = await processHeadersPage(
        supabase,
        syncedByUserId,
        mailboxOwnerId,
        ownDomain,
        ownEmail,
        headers
      );
      for (const email of upserted) seenEmailsThisRun.add(email);
      messagesScannedThisRun += headers.length;
      messagesScannedTotal += headers.length;
    }

    pageToken = nextPageToken;

    // Persist the resume cursor after every page — a mid-batch crash or timeout
    // only ever costs the current (small) page, never the whole run.
    await supabase
      .from("contact_sync_state")
      .update({
        page_token: pageToken ?? null,
        oldest_scanned_internal_date: oldestSeen === Number.MAX_SAFE_INTEGER ? null : oldestSeen,
        newest_scanned_internal_date: newestSeen || null,
        messages_scanned_total: messagesScannedTotal,
        last_progress: { scanned: messagesScannedTotal },
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);

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
    // Backfill's fully caught up — capture the mailbox's current historyId so the
    // next call can switch straight to exact, cheap incremental sync from here.
    const historyId = await fetchGmailHistoryId(accessToken);
    const summary = `Synced ${messagesScannedThisRun} emails — found ${seenEmailsThisRun.size} contacts this run.`;
    await supabase
      .from("contact_sync_state")
      .update({
        status: "idle",
        page_token: null,
        history_id: historyId,
        contacts_found_total: contactsFoundTotal ?? 0,
        last_summary: summary,
        completed_backfill_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);
  } else {
    // Time budget hit mid-backfill — leave status "running" so the caller (client
    // batch loop) knows to invoke again immediately; page_token was already persisted.
    await supabase
      .from("contact_sync_state")
      .update({ contacts_found_total: contactsFoundTotal ?? 0, updated_at: new Date().toISOString() })
      .eq("mailbox_owner_id", mailboxOwnerId);
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
  ownDomain: string | undefined,
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
      .update({ status: "idle", history_id: historyId, updated_at: new Date().toISOString() })
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

      if (page.messagesAdded.length > 0) {
        const ids = page.messagesAdded.map((m) => m.id);
        const headers = await fetchGmailMessageHeadersByIds(accessToken, ids);
        const upserted = await processHeadersPage(
          supabase,
          syncedByUserId,
          mailboxOwnerId,
          ownDomain,
          ownEmail,
          headers
        );
        for (const email of upserted) seenEmailsThisRun.add(email);
        messagesScannedThisRun += headers.length;
      }

      if (page.historyId) latestHistoryId = page.historyId;
      pageToken = page.nextPageToken;

      await supabase
        .from("contact_sync_state")
        .update({
          page_token: pageToken ?? null,
          messages_scanned_total: state.messages_scanned_total + messagesScannedThisRun,
          updated_at: new Date().toISOString(),
        })
        .eq("mailbox_owner_id", mailboxOwnerId);

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
    const q = afterSeconds ? `after:${afterSeconds}` : "";
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
          ownDomain,
          ownEmail,
          headers
        );
        for (const email of upserted) seenEmailsThisRun.add(email);
        messagesScannedThisRun += headers.length;
      }
      catchUpToken = nextPageToken;
    } while (catchUpToken && Date.now() - startedAt < BATCH_TIME_BUDGET_MS);

    latestHistoryId = (await fetchGmailHistoryId(accessToken)) ?? latestHistoryId;
    doneAllPages = !catchUpToken;
    await supabase
      .from("contact_sync_state")
      .update({
        page_token: catchUpToken ?? null,
        newest_scanned_internal_date: newestSeen || null,
        messages_scanned_total: state.messages_scanned_total + messagesScannedThisRun,
        updated_at: new Date().toISOString(),
      })
      .eq("mailbox_owner_id", mailboxOwnerId);
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
    // Time budget hit mid-page: leave status "running", cursor already persisted;
    // history_id NOT advanced yet (only advances once this batch's pages are done)
    // so a resumed call re-reads from the same startHistoryId — safe, since the
    // upserts above are idempotent either way.
    await supabase
      .from("contact_sync_state")
      .update({ contacts_found_total: contactsFoundTotal ?? 0, updated_at: new Date().toISOString() })
      .eq("mailbox_owner_id", mailboxOwnerId);
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
