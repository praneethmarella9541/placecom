import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getThreadMessages, type ThreadListItem, type ThreadMessageView } from "@/lib/gmail-inbox";
import { allRecipients, isBounceSender, isDelayNotice } from "@/lib/email-message-classify";
export { recipientAddresses } from "@/lib/email-message-classify";

/**
 * Flags an ordinary (non-campaign) sent email as bounced when its delivery-
 * failure notice turns up — the same outcome mass sending gets from its report.
 *
 * Gmail's "Address not found" notices usually arrive as a brand-new thread
 * from mailer-daemon/postmaster, not inside the conversation that bounced.
 * Previously one was only noticed if the *sender* opened that notice; in a
 * shared mailbox it's often someone else, or nobody, so the email never showed
 * "Bounced". Now:
 *  - notices are spotted in the inbox list the app already loads (no extra
 *    Gmail call to find them), and read once each;
 *  - they're matched against emails sent by anyone on the mailbox's team.
 */

/** How far back a notice (and the email it reports) is worth matching. */
const LOOKBACK_DAYS = 30;

/**
 * Notice threads already read by this server instance, so one sitting in the
 * inbox isn't re-read on every list load. A notice that recorded a bounce is
 * done for good (6h here); one that matched nothing is retried after 15
 * minutes, in case its email simply wasn't tracked yet.
 */
const handledNotices = new Map<string, number>();
const MATCHED_TTL_MS = 6 * 60 * 60 * 1000;
const UNMATCHED_TTL_MS = 15 * 60 * 1000;

function rememberHandled(threadId: string, matched: boolean) {
  handledNotices.set(threadId, Date.now() + (matched ? MATCHED_TTL_MS : UNMATCHED_TTL_MS));
  if (handledNotices.size > 2000) {
    const now = Date.now();
    handledNotices.forEach((until, id) => {
      if (until < now) handledNotices.delete(id);
    });
  }
}

function alreadyHandled(threadId: string): boolean {
  const until = handledNotices.get(threadId);
  return until !== undefined && Date.now() < until;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The address a delivery-failure notice is about, out of `addresses`. Matched as
 * a whole address — "bob@x.com" must not match inside "jbob@x.com" — and the
 * longest wins if several appear.
 */
export function addressNamedInNotice(notices: ThreadMessageView[], addresses: string[]): string | null {
  const text = notices.map((m) => `${m.subject || ""} ${m.body || ""}`).join("\n").toLowerCase();
  const hits = addresses.filter((addr) =>
    new RegExp(`(^|[^a-z0-9._%+-])${escapeRegExp(addr)}($|[^a-z0-9.-])`).test(text)
  );
  if (hits.length === 0) return null;
  return hits.sort((a, b) => b.length - a.length)[0];
}

/** Everyone whose sent email can bounce into this mailbox: the owner and the staff linked to them. */
export async function mailboxTeamUserIds(svc: SupabaseClient, mailboxOwnerId: string): Promise<string[]> {
  const { data } = await svc
    .from("profiles")
    .select("id")
    .or(`id.eq.${mailboxOwnerId},mailbox_owner_id.eq.${mailboxOwnerId}`);
  const ids = (data ?? []).map((p) => p.id as string);
  return ids.includes(mailboxOwnerId) ? ids : [mailboxOwnerId, ...ids];
}

/**
 * Reads a notice's messages and marks the email it reports as bounced: the
 * most recent still-undecided email to that address sent before the notice
 * arrived, by anyone on the team. Returns whether something was marked.
 */
type TrackedEmail = {
  id: string;
  to_address: string | null;
  cc_address?: string | null;
  bcc_address?: string | null;
  bounced_recipients?: string[] | null;
  bounced?: boolean | null;
  sent_at: string;
};

/** Recent team emails a notice could be about. Falls back to the pre-0071 columns when that migration isn't applied yet. */
async function recentTeamEmails(svc: SupabaseClient, teamUserIds: string[]): Promise<{ rows: TrackedEmail[]; perAddress: boolean }> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const full = await svc
    .from("email_tracking")
    .select("id, to_address, cc_address, bcc_address, bounced_recipients, bounced, sent_at")
    .in("user_id", teamUserIds)
    .gte("sent_at", since);
  if (!full.error) return { rows: (full.data ?? []) as TrackedEmail[], perAddress: true };

  // Without per-address columns an email can only be bounced once, as a whole.
  const legacy = await svc
    .from("email_tracking")
    .select("id, to_address, sent_at")
    .in("user_id", teamUserIds)
    .eq("bounced", false)
    .gte("sent_at", since);
  return { rows: (legacy.data ?? []) as TrackedEmail[], perAddress: false };
}

/**
 * Reads a notice's messages and records the failed address on the email it
 * belongs to: the most recent email sent before the notice that had that
 * address in To, CC or BCC and doesn't already have it recorded. Anyone on
 * the team may have sent it. Returns whether something was recorded.
 */
export async function markBounceFromNotice(
  svc: SupabaseClient,
  teamUserIds: string[],
  messages: ThreadMessageView[]
): Promise<boolean> {
  // Delay notices ("will keep trying") aren't failures — the email may still arrive.
  const notices = messages.filter((m) => isBounceSender(m.from.toLowerCase()) && !isDelayNotice(m));
  if (notices.length === 0 || teamUserIds.length === 0) return false;

  const { rows, perAddress } = await recentTeamEmails(svc, teamUserIds);
  if (rows.length === 0) return false;

  // Only notices that arrived after the oldest email in question can be about it.
  const oldest = Math.min(...rows.map((r) => Date.parse(r.sent_at) || Date.now()));
  const relevant = notices.filter((m) => (Date.parse(m.date) || Date.now()) >= oldest);
  const withRecipients = rows.map((r) => ({ ...r, recipients: allRecipients(r) }));
  const allAddresses = Array.from(new Set(withRecipients.flatMap((r) => r.recipients)));
  const failed = addressNamedInNotice(relevant, allAddresses);
  if (!failed) return false;

  const noticeAt = Math.max(...relevant.map((m) => Date.parse(m.date) || 0)) || Date.now();
  const target = withRecipients
    .filter((r) => r.recipients.includes(failed))
    .filter((r) => !(r.bounced_recipients ?? []).includes(failed))
    .filter((r) => (Date.parse(r.sent_at) || 0) <= noticeAt)
    .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
  if (!target) return false;

  const now = new Date().toISOString();
  const { error } = await svc
    .from("email_tracking")
    .update(
      perAddress
        ? { bounced: true, bounced_at: now, bounced_recipients: [...(target.bounced_recipients ?? []), failed] }
        : { bounced: true, bounced_at: now }
    )
    .eq("id", target.id);
  return !error;
}

/**
 * Looks through an inbox page the app just listed for delivery-failure notices
 * it hasn't handled yet, reads each (one thread fetch per new notice — rare),
 * and marks what bounced. Best-effort and never throws: the inbox must load
 * regardless.
 */
export async function sweepBounceNotices(
  svc: SupabaseClient,
  opts: { accessToken: string; mailboxOwnerId: string; threads: ThreadListItem[] }
): Promise<void> {
  try {
    const cutoff = Date.now() - LOOKBACK_DAYS * 86_400_000;
    const notices = opts.threads
      .filter((t) => !t.pending && isBounceSender(t.from.toLowerCase()))
      .filter((t) => (Date.parse(t.date) || Date.now()) >= cutoff)
      .filter((t) => !alreadyHandled(t.id))
      .slice(0, 5);
    if (notices.length === 0) return;

    const team = await mailboxTeamUserIds(svc, opts.mailboxOwnerId);
    for (const notice of notices) {
      try {
        const { messages } = await getThreadMessages(opts.accessToken, notice.id, {
          mailboxKey: opts.mailboxOwnerId,
          priority: "batch",
        });
        // A notice may name several failed addresses (several emails, or one
        // email's To/CC/BCC); record each until nothing more matches.
        let matched = false;
        for (let i = 0; i < 10 && (await markBounceFromNotice(svc, team, messages)); i++) matched = true;
        rememberHandled(notice.id, matched);
      } catch {
        // Unreadable right now — try again on a later list load.
        continue;
      }
    }
  } catch {
    // Bookkeeping only.
  }
}

