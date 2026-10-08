import type { SupabaseClient } from "@supabase/supabase-js";
import { extractEmailAddress } from "@/lib/email-parse";
import { isBounceSender, looksAutomated } from "@/lib/email-message-classify";

/**
 * Records every reply a recipient sends back to the team (email_responses,
 * 0070), so analytics can count each one — three replies are three. Called
 * wherever the app already has a conversation's messages in hand: an inbox
 * thread being opened or hover-prefetched, and the sequence runner's reply
 * check. It never asks Gmail anything itself.
 */

/** The parts of a Gmail message this needs. */
export type ConversationMessage = { id: string; from: string; date: string; subject?: string | null };

/** One of our emails in the conversation, and who it is credited to. */
export type OutgoingEmail = { userId: string; sentAt: string };

export type ResponseToRecord = {
  gmailMessageId: string;
  fromAddress: string;
  receivedAt: string;
  userId: string;
};

/**
 * Which messages are recipient replies, and who each is credited to. A message
 * counts when it is from anyone but our own mailbox, isn't a bounce notice or an
 * auto-reply, and arrived after one of our emails in the conversation — the
 * member who sent the latest of ours before it gets the credit. Messages before
 * our first email (a conversation the contact started) are not responses.
 */
export function findResponses(
  messages: ConversationMessage[],
  outgoing: OutgoingEmail[],
  mailboxAddress: string | undefined
): ResponseToRecord[] {
  const ours = mailboxAddress?.trim().toLowerCase();
  // Without our own address there's no telling our messages from theirs.
  if (!ours || outgoing.length === 0) return [];

  const sent = outgoing
    .map((o) => ({ userId: o.userId, at: Date.parse(o.sentAt) }))
    .filter((o) => Number.isFinite(o.at))
    .sort((a, b) => a.at - b.at);

  const out: ResponseToRecord[] = [];
  for (const message of messages) {
    const from = extractEmailAddress(message.from).toLowerCase();
    if (!from || from === ours || isBounceSender(from)) continue;
    if (looksAutomated(message.subject ?? "")) continue;
    const at = Date.parse(message.date);
    if (!Number.isFinite(at)) continue;

    let creditTo: string | null = null;
    for (const o of sent) {
      if (o.at <= at) creditTo = o.userId;
      else break;
    }
    if (!creditTo) continue;

    out.push({ gmailMessageId: message.id, fromAddress: from, receivedAt: new Date(at).toISOString(), userId: creditTo });
  }
  return out;
}

type Embedded<T> = T | T[] | null;
function one<T>(v: Embedded<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/**
 * Looks up our emails in this conversation (composer sends and sequence sends)
 * and stores any recipient replies not stored yet. Best-effort: a missing table
 * (migration not applied) or any error is swallowed — this is bookkeeping and
 * must never break the inbox or the sequence runner.
 */
export async function recordThreadResponses(
  svc: SupabaseClient,
  opts: { threadId: string; messages: ConversationMessage[]; mailboxAddress: string | undefined; source: "inbox" | "sequence" }
): Promise<void> {
  if (!opts.threadId || opts.messages.length === 0 || !opts.mailboxAddress) return;
  try {
    const [trackingRes, sendsRes] = await Promise.all([
      svc.from("email_tracking").select("id, user_id, sent_at").eq("gmail_thread_id", opts.threadId),
      svc
        .from("sequence_sends")
        .select("created_at, tracking_id, mailbox_owner_id, sequence_enrollments(enrolled_by), sequences(created_by)")
        .eq("gmail_thread_id", opts.threadId)
        .eq("status", "sent"),
    ]);

    type SendRow = {
      created_at: string;
      tracking_id: string | null;
      mailbox_owner_id: string;
      sequence_enrollments: Embedded<{ enrolled_by: string | null }>;
      sequences: Embedded<{ created_by: string | null }>;
    };
    const sends = (sendsRes.data ?? []) as SendRow[];
    // A sequence email with open-tracking also has a tracking row (under the
    // mailbox owner); the send row knows who it really belongs to.
    const covered = new Set(sends.map((s) => s.tracking_id).filter((id): id is string => !!id));

    const outgoing: OutgoingEmail[] = [
      ...((trackingRes.data ?? []) as { id: string; user_id: string; sent_at: string }[])
        .filter((t) => !covered.has(t.id))
        .map((t) => ({ userId: t.user_id, sentAt: t.sent_at })),
      ...sends.map((s) => ({
        userId: one(s.sequence_enrollments)?.enrolled_by ?? one(s.sequences)?.created_by ?? s.mailbox_owner_id,
        sentAt: s.created_at,
      })),
    ];

    const responses = findResponses(opts.messages, outgoing, opts.mailboxAddress);
    if (responses.length === 0) return;

    await svc.from("email_responses").upsert(
      responses.map((r) => ({
        gmail_message_id: r.gmailMessageId,
        gmail_thread_id: opts.threadId,
        user_id: r.userId,
        from_address: r.fromAddress,
        received_at: r.receivedAt,
        source: opts.source,
      })),
      { onConflict: "gmail_message_id", ignoreDuplicates: true }
    );
  } catch {
    // Bookkeeping only.
  }
}
