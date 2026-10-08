/**
 * Who sent how many emails, and what became of them, per member and per day,
 * for the admin analytics.
 *
 * Two sources, merged per member into one "emails sent" figure:
 *  - email_tracking: one row per message sent from the composer, written under
 *    the signed-in user (app/api/gmail/send). It carries opened / replied /
 *    bounced flags.
 *  - sequence_sends: one row per sequence step Gmail accepted. A sequence mails
 *    from cron, so there is no signed-in user; the email is credited to the
 *    member who enrolled the recipient, else the member who created the
 *    sequence, else the mailbox owner. Opens come from the linked tracking row;
 *    replies and bounces from the recipient's enrollment.
 *
 * Only sends that actually went out are counted. A sequence stops sending the
 * moment its exit rule is met (reply, bounce, removal), so the steps that never
 * went out have no "sent" row and are not counted.
 *
 * Opens and bounces belong to the email, so they count on the day the email was
 * SENT ("of the emails sent in this range, how many were opened / bounced").
 * Responses are different: every reply a recipient sends is its own event
 * (email_responses, 0070), counted on the day it ARRIVED — three replies are
 * three, whatever conversation they're in.
 */

export type TrackingRow = {
  id: string;
  user_id: string;
  sent_at: string;
  gmail_thread_id?: string | null;
  opened: boolean | null;
  bounced: boolean | null;
  /** 0071: everyone it went to and which addresses failed. Absent before that migration. */
  to_address?: string | null;
  cc_address?: string | null;
  bcc_address?: string | null;
  bounced_recipients?: string[] | null;
};

/** One reply received from a recipient, already credited to a member. */
export type ResponseRow = { user_id: string; received_at: string };

import { allRecipients } from "@/lib/email-message-classify";

/** Supabase returns a to-one embed as an object, or as a one-item array depending on the client's inference. */
type Embedded<T> = T | T[] | null;

export type SequenceSendRow = {
  id: string;
  enrollment_id: string;
  created_at: string;
  tracking_id: string | null;
  sequence_enrollments: Embedded<{ enrolled_by: string | null; status: string | null; last_sent_at: string | null }>;
  sequences: Embedded<{ created_by: string | null }>;
  email_tracking: Embedded<{ opened: boolean | null }>;
};

/** What happened to a group of emails. */
export type Outcomes = {
  sent: number;
  opened: number;
  /** Emails whose opens can be measured at all (they carry a tracking pixel). The open rate's denominator. */
  openTracked: number;
  /** Replies received from recipients (each message counts). */
  replied: number;
  /** Addresses that couldn't be delivered to (one email to three people can add up to 3). */
  bounced: number;
  /** Addresses emailed (To + CC + BCC) — the bounce rate's denominator. */
  recipients: number;
};

export type MemberEmailCounts = Outcomes & {
  /** YYYY-MM-DD (UTC) → that day's counts. */
  perDay: Map<string, Outcomes>;
  /** ISO time of the most recent email in the range, or null when there are none. */
  lastEmailAt: string | null;
};

function one<T>(v: Embedded<T>): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

const zero = (): Outcomes => ({ sent: 0, opened: 0, openTracked: 0, replied: 0, bounced: 0, recipients: 0 });

/** The member a sequence send is credited to. */
export function sequenceSendOwner(row: SequenceSendRow, mailboxOwnerId: string): string {
  return one(row.sequence_enrollments)?.enrolled_by ?? one(row.sequences)?.created_by ?? mailboxOwnerId;
}

/**
 * A sequence records a bounce once per recipient, on the enrollment. Credit it
 * to the email that bounced — the recipient's latest send in the range — unless
 * the enrollment's real last send is past the range.
 */
function sequenceBouncedSendIds(sends: SequenceSendRow[], windowEndIso?: string): Set<string> {
  const latestByEnrollment = new Map<string, SequenceSendRow>();
  for (const s of sends) {
    const best = latestByEnrollment.get(s.enrollment_id);
    if (!best || s.created_at > best.created_at) latestByEnrollment.set(s.enrollment_id, s);
  }
  const bounced = new Set<string>();
  latestByEnrollment.forEach((send) => {
    const enrollment = one(send.sequence_enrollments);
    if (!enrollment || enrollment.status !== "bounced") return;
    if (windowEndIso && enrollment.last_sent_at && enrollment.last_sent_at >= windowEndIso) return;
    bounced.add(send.id);
  });
  return bounced;
}

export function countEmailsByMember(opts: {
  userIds: string[];
  mailboxOwnerId: string;
  tracking: TrackingRow[];
  sequenceSends: SequenceSendRow[];
  /** Replies received in the range. */
  responses?: ResponseRow[];
  /** Exclusive upper bound of the range, so a bounce of an email after the range isn't credited inside it. */
  windowEndIso?: string;
}): Map<string, MemberEmailCounts> {
  const out = new Map<string, MemberEmailCounts>(
    opts.userIds.map((id) => [id, { ...zero(), perDay: new Map(), lastEmailAt: null }])
  );

  const add = (
    userId: string,
    iso: string,
    flags: { opened: boolean; openTracked: boolean; bounced: number; recipients: number }
  ) => {
    const member = out.get(userId);
    if (!member) return; // someone outside the roster being reported
    const day = iso.slice(0, 10);
    const dayCounts = member.perDay.get(day) ?? zero();
    for (const target of [member, dayCounts]) {
      target.sent += 1;
      if (flags.opened) target.opened += 1;
      if (flags.openTracked) target.openTracked += 1;
      target.bounced += flags.bounced;
      target.recipients += flags.recipients;
    }
    member.perDay.set(day, dayCounts);
    if (!member.lastEmailAt || iso > member.lastEmailAt) member.lastEmailAt = iso;
  };

  // A sequence with open-tracking writes a tracking row *and* a send row for the
  // same email; the send row is the one that knows who it belongs to.
  const covered = new Set(opts.sequenceSends.map((s) => s.tracking_id).filter((id): id is string => !!id));

  for (const row of opts.tracking) {
    if (covered.has(row.id)) continue;
    // Failed addresses when known (0071); an older bounced email counts as one.
    const failed = row.bounced_recipients?.length ? row.bounced_recipients.length : row.bounced ? 1 : 0;
    add(row.user_id, row.sent_at, {
      opened: !!row.opened,
      openTracked: true,
      bounced: failed,
      recipients: Math.max(1, allRecipients(row).length, failed),
    });
  }

  const sequenceBounced = sequenceBouncedSendIds(opts.sequenceSends, opts.windowEndIso);
  for (const row of opts.sequenceSends) {
    add(sequenceSendOwner(row, opts.mailboxOwnerId), row.created_at, {
      opened: !!one(row.email_tracking)?.opened,
      openTracked: !!row.tracking_id,
      bounced: sequenceBounced.has(row.id) ? 1 : 0,
      recipients: 1,
    });
  }

  // Each reply received counts once, on the day it arrived.
  for (const r of opts.responses ?? []) {
    const member = out.get(r.user_id);
    if (!member) continue;
    const day = r.received_at.slice(0, 10);
    const dayCounts = member.perDay.get(day) ?? zero();
    member.replied += 1;
    dayCounts.replied += 1;
    member.perDay.set(day, dayCounts);
  }
  return out;
}
