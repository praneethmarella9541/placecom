import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery, gmailDomainQuery } from "@/lib/gmail-address-query";
import { isResolveMailboxError, resolveMailboxForUser } from "@/lib/mailbox-context";
import { resolveMailboxGoogleAccessToken } from "@/lib/mailbox-google-access";
import type { AuthedRequest } from "@/lib/api-auth";
import type { MailboxOption } from "@/lib/mailbox-context-shared";

/**
 * The Mail tab of a contact: thread headers exchanged with one address, from the mailboxes the
 * viewer may read — their own individual mailbox and the common one, never anyone else's.
 *
 * Database first. contact_mail_threads (migration 0095) holds headers only — subject, sender,
 * participants, date, counts — never a snippet or body, the same stance as gmail_thread_meta
 * (0072). A (mailbox, contact) with no recent fetch recorded is read from Gmail, with that
 * mailbox's own token, and written back. Opening a thread still goes to Gmail, as everywhere.
 *
 * Who may see what is decided twice: `readable` below comes from resolveMailboxForUser (the one
 * rule every Gmail call uses), and the rows are read with the SIGNED-IN client so the database's
 * own RLS (user_can_read_mailbox_mail) has to agree. A bug in either one alone shows nothing
 * extra, not someone else's mail.
 */

/** A cached (mailbox, contact) older than this is read from Gmail again. */
export const CONTACT_MAIL_TTL_MS = 15 * 60 * 1000;
const MAX_THREADS = 50;
const RETENTION_DAYS = 90;
const PURGE_PROBABILITY = 0.01;

/**
 * What mail is looked up by: a person's address ("a@b.com") or a company's domain ("@b.com").
 * Stored in contact_mail_threads.contact_email as is.
 */
export function mailKeyQuery(key: string): string {
  return key.startsWith("@") ? gmailDomainQuery(key.slice(1)) : gmailAddressQuery(key);
}

/**
 * The mailboxes this user may read mail from — their own individual mailbox and the common one
 * (if they have access to it) — regardless of which one the account switcher is on. Never another
 * member's individual mailbox: resolveMailboxForUser only ever lists the caller's own.
 */
export async function readableMailboxes(
  svc: SupabaseClient,
  userId: string,
  orgOwnerId: string
): Promise<{ ok: true; options: MailboxOption[] } | { ok: false; status: number; error: string }> {
  const { data: profile } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
  const resolved = await resolveMailboxForUser(svc, {
    userId,
    role: (profile?.role as string) ?? "staff",
    orgOwnerId,
    requestedId: null,
  });
  if (isResolveMailboxError(resolved)) return { ok: false, status: resolved.status, error: resolved.error };
  return { ok: true, options: resolved.options };
}

export type ContactMailItem = {
  threadId: string;
  /** Which of the viewer's mailboxes the thread is in — pass it back when opening the thread. */
  mailboxId: string;
  mailboxType: "common" | "individual";
  subject: string;
  from: string;
  participants: string[];
  at: string | null;
  messageCount: number;
  hasAttachments: boolean;
};

/**
 * Mail with this contact that exists but isn't the viewer's to read. Says only THAT it exists —
 * no names, counts, dates or subjects — so the empty tab isn't mistaken for "no correspondence".
 */
export type HiddenMail = {
  /** The common mailbox has mail with them, and the viewer has no access to it. */
  common: boolean;
  /** Another member's individual mailbox has mail with them. */
  others: boolean;
};

export type ContactMailResult = {
  items: ContactMailItem[];
  hidden: HiddenMail;
  /** True when nothing was read from Gmail for this request. */
  fromCache: boolean;
  /** Mailboxes that couldn't be refreshed (disconnected, quota…). Their cached rows still show. */
  warnings: { mailboxType: "common" | "individual"; message: string }[];
};

type CacheRow = {
  mailbox_id: string;
  thread_id: string;
  subject: string;
  from_header: string;
  participants: string[] | null;
  last_date: string;
  last_date_at: string | null;
  message_count: number;
  has_attachments: boolean;
};

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

async function refreshMailbox(
  svc: SupabaseClient,
  authed: AuthedRequest,
  option: MailboxOption & { id: string },
  orgOwnerId: string,
  email: string
): Promise<void> {
  // `email` is the lookup key — an address, or "@domain" for a company.
  // The token for THIS mailbox, resolved by the same access check as every Gmail call: it only
  // succeeds for a mailbox the caller is allowed in.
  const token = await resolveMailboxGoogleAccessToken(authed, option.id);
  if (!token.ok) throw new Error(token.message);
  if (token.mailboxId !== option.id) throw new Error("Mailbox mismatch");

  const page = await listThreadsPage(token.accessToken, {
    folder: "allmail",
    maxResults: MAX_THREADS,
    searchQuery: mailKeyQuery(email),
    mailboxKey: token.mailboxKey,
  });

  const fetchedAt = new Date().toISOString();
  const rows = page.threads.map((t) => ({
    mailbox_id: option.id,
    contact_email: email,
    thread_id: t.id,
    org_owner_id: orgOwnerId,
    owner_user_id: token.mailboxKey,
    history_id: t.historyId ?? null,
    subject: t.subject ?? "",
    from_header: t.from ?? "",
    participants: t.participants ?? [],
    last_date: t.date ?? "",
    last_date_at: parseDate(t.date),
    message_count: t.messageCount ?? 0,
    // A calendar invite is technically an attachment too; the list shows it differently.
    has_attachments: Boolean(t.hasAttachments && !t.hasCalendarInvite),
    fetched_at: fetchedAt,
  }));

  if (rows.length > 0) {
    const { error } = await svc.from("contact_mail_threads").upsert(rows, { onConflict: "mailbox_id,contact_email,thread_id" });
    if (error) throw new Error(error.message);
  }
  // The cache is the latest page; threads that fell out of it (moved, deleted) go too.
  let cleanup = svc.from("contact_mail_threads").delete().eq("mailbox_id", option.id).eq("contact_email", email);
  if (rows.length > 0) {
    cleanup = cleanup.not("thread_id", "in", `(${rows.map((r) => `"${r.thread_id.replace(/"/g, "")}"`).join(",")})`);
  }
  await cleanup;

  await svc
    .from("contact_mail_fetches")
    .upsert(
      { mailbox_id: option.id, contact_email: email, fetched_at: fetchedAt, thread_count: rows.length },
      { onConflict: "mailbox_id,contact_email" }
    );

  if (Math.random() < PURGE_PROBABILITY) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    await svc.from("contact_mail_threads").delete().lt("fetched_at", cutoff);
    await svc.from("contact_mail_fetches").delete().lt("fetched_at", cutoff);
  }
}

/**
 * Which kinds of mailbox have mail with these addresses/domains that the viewer can't read, from the
 * sync's source rows (contact metadata, no mail). Org-scoped; the viewer's own mailbox and the
 * ones they can read are never listed.
 */
async function hiddenMailFor(
  svc: SupabaseClient,
  orgOwnerId: string,
  readableIds: Set<string>,
  keys: string[]
): Promise<HiddenMail> {
  try {
    const emails = keys.filter((k) => !k.startsWith("@"));
    const domains = keys.filter((k) => k.startsWith("@") && /^@[a-z0-9.-]+$/.test(k));
    let q = svc
      .from("synced_contact_sources")
      .select("mailbox_id, owner_user_id")
      .eq("org_owner_id", orgOwnerId);
    const filters = [
      ...(emails.length ? [`email.in.(${emails.map((e) => `"${e.replace(/"/g, "")}"`).join(",")})`] : []),
      ...domains.map((d) => `email.ilike.%${d}`),
    ];
    if (filters.length === 0) return { common: false, others: false };
    q = q.or(filters.join(",")).limit(2000);
    const { data } = await q;
    const unreadable = (data ?? []).filter((r) => !readableIds.has(r.mailbox_id as string));
    if (unreadable.length === 0) return { common: false, others: false };

    const { data: boxes } = await svc
      .from("mailboxes")
      .select("id, mailbox_type")
      .in("id", Array.from(new Set(unreadable.map((r) => r.mailbox_id as string))));
    return {
      common: (boxes ?? []).some((b) => b.mailbox_type === "common"),
      others: (boxes ?? []).some((b) => b.mailbox_type === "individual"),
    };
  } catch {
    return { common: false, others: false };
  }
}

export async function loadContactMail(params: {
  /** The signed-in client: reads the cache under RLS. */
  userClient: SupabaseClient;
  authed: AuthedRequest;
  orgOwnerId: string;
  /** Mailboxes the viewer may read, from readableMailboxes(). */
  readable: MailboxOption[];
  /** Addresses ("a@b.com") and/or domains ("@b.com"); at most 5 are looked up. */
  keys: string[];
  refresh: boolean;
}): Promise<ContactMailResult> {
  const { userClient, authed, orgOwnerId, refresh } = params;
  const keys = Array.from(new Set(params.keys.map((k) => k.trim().toLowerCase()).filter(Boolean))).slice(0, 5);
  const readable = params.readable.filter((o): o is MailboxOption & { id: string } => Boolean(o.id));
  const warnings: ContactMailResult["warnings"] = [];
  const none: HiddenMail = { common: false, others: false };
  if (readable.length === 0 || keys.length === 0) return { items: [], hidden: none, fromCache: true, warnings };

  const svc = createServiceSupabase();
  const ids = readable.map((o) => o.id);

  const { data: fetches } = await svc
    .from("contact_mail_fetches")
    .select("mailbox_id, contact_email, fetched_at")
    .in("contact_email", keys)
    .in("mailbox_id", ids);
  const lastFetch = new Map(
    (fetches ?? []).map((f) => [`${f.mailbox_id as string}|${f.contact_email as string}`, Date.parse(f.fetched_at as string)])
  );
  const stale: { option: MailboxOption & { id: string }; key: string }[] = [];
  for (const option of readable) {
    for (const key of keys) {
      const at = lastFetch.get(`${option.id}|${key}`);
      if (refresh || at === undefined || Number.isNaN(at) || Date.now() - at > CONTACT_MAIL_TTL_MS) stale.push({ option, key });
    }
  }

  const results = await Promise.allSettled(stale.map((t) => refreshMailbox(svc, authed, t.option, orgOwnerId, t.key)));
  const warned = new Set<string>();
  results.forEach((r, i) => {
    if (r.status === "rejected" && !warned.has(stale[i].option.id)) {
      warned.add(stale[i].option.id);
      warnings.push({
        mailboxType: stale[i].option.type,
        message: r.reason instanceof Error ? r.reason.message : "Could not refresh this mailbox",
      });
    }
  });

  // Read under RLS, filtered to the same mailboxes: a second, independent gate.
  const { data, error } = await userClient
    .from("contact_mail_threads")
    .select("mailbox_id, thread_id, subject, from_header, participants, last_date, last_date_at, message_count, has_attachments")
    .in("contact_email", keys)
    .in("mailbox_id", ids)
    .order("last_date_at", { ascending: false, nullsFirst: false })
    .limit(MAX_THREADS * readable.length * keys.length);
  if (error) throw new Error(error.message);

  // A thread that matches several keys (two addresses of one person) is listed once.
  const typeById = new Map(readable.map((o) => [o.id, o.type]));
  const seen = new Set<string>();
  const items: ContactMailItem[] = [];
  for (const r of (data ?? []) as CacheRow[]) {
    const dedupe = `${r.mailbox_id}|${r.thread_id}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    items.push({
      threadId: r.thread_id,
      mailboxId: r.mailbox_id,
      mailboxType: typeById.get(r.mailbox_id) ?? "common",
      subject: r.subject,
      from: r.from_header,
      participants: r.participants ?? [],
      at: r.last_date_at ?? (r.last_date || null),
      messageCount: r.message_count,
      hasAttachments: r.has_attachments,
    });
  }
  const hidden = await hiddenMailFor(svc, orgOwnerId, new Set(ids), keys);
  return { items, hidden, fromCache: stale.length === 0, warnings };
}
