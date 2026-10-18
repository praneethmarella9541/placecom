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
export type ResponseRow = {
  user_id: string;
  received_at: string;
  /** Which conversation it answers, and who wrote it. The company breakdown reads both. */
  gmail_thread_id?: string | null;
  from_address?: string | null;
};

import { allRecipients, recipientAddresses } from "@/lib/email-message-classify";

/** Supabase returns a to-one embed as an object, or as a one-item array depending on the client's inference. */
type Embedded<T> = T | T[] | null;

export type SequenceSendRow = {
  id: string;
  enrollment_id: string;
  created_at: string;
  tracking_id: string | null;
  gmail_thread_id?: string | null;
  sequence_enrollments: Embedded<{ enrolled_by: string | null; status: string | null; last_sent_at: string | null; email?: string | null }>;
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

/** What one member's emails to one company came to. `domain` is null for emails with no recipient on record. */
export type CompanyEmailCounts = {
  domain: string | null;
  /** Emails that went to at least one address at this company. */
  sent: number;
  /** Of those, opened. A shared email's open counts for each company on it: the pixel can't say who opened. */
  opened: number;
  openTracked: number;
  /** Replies received from this company in the range (each message counts). */
  replied: number;
  /** Addresses at this company that couldn't be delivered to. */
  bounced: number;
  /** Addresses at this company emailed (the bounce rate's base). */
  recipients: number;
};

export type CompanyBreakdown = {
  companies: CompanyEmailCounts[];
  /** Emails counted, the same figure as the member's emails sent. */
  emails: number;
  /** Of those, emails that went to more than one company, and so appear under each. */
  multiCompanyEmails: number;
};

function domainOf(address: string): string | null {
  const d = address.split("@")[1]?.trim().toLowerCase().replace(/^www\./, "");
  return d || null;
}

/**
 * One member's emails broken down by the recipient's company (email domain),
 * from the same rows and crediting rules as countEmailsByMember. An email
 * counts under every company it went to (three people at one company is still
 * one email to it), so the companies add up to more than the member's total
 * when some emails went to several; `multiCompanyEmails` reconciles the two.
 * Only the To line counts — CC and BCC are ignored. Bounces go to the company
 * whose To address failed. Composer rows saved before
 * recipients were recorded (0071) land under domain null.
 */
export function countEmailsByCompany(opts: {
  userId: string;
  mailboxOwnerId: string;
  tracking: TrackingRow[];
  sequenceSends: SequenceSendRow[];
  /** Replies received in the range. */
  responses?: ResponseRow[];
  windowEndIso?: string;
}): CompanyBreakdown {
  const out = new Map<string | null, CompanyEmailCounts>();
  let emails = 0;
  let multiCompanyEmails = 0;
  /** conversation -> companies we wrote to in it, so a reply lands on the company that was emailed. */
  const threadDomains = new Map<string, Set<string>>();
  const noteThread = (threadId: string | null | undefined, domain: string | null) => {
    if (!threadId || !domain) return;
    const set = threadDomains.get(threadId) ?? new Set<string>();
    set.add(domain);
    threadDomains.set(threadId, set);
  };
  const add = (domain: string | null, flags: { opened: boolean; openTracked: boolean; bounced: number; recipients: number }) => {
    const c = out.get(domain) ?? { domain, sent: 0, opened: 0, openTracked: 0, replied: 0, bounced: 0, recipients: 0 };
    c.sent += 1;
    if (flags.opened) c.opened += 1;
    if (flags.openTracked) c.openTracked += 1;
    c.bounced += flags.bounced;
    c.recipients += flags.recipients;
    out.set(domain, c);
  };

  const covered = new Set(opts.sequenceSends.map((s) => s.tracking_id).filter((id): id is string => !!id));
  for (const row of opts.tracking) {
    if (row.user_id !== opts.userId || covered.has(row.id)) continue;
    const byDomain = new Map<string | null, { recipients: number; bounced: number }>();
    // Only the To line: CC and BCC are people copied in, not who the email was sent to.
    for (const addr of recipientAddresses(row.to_address)) {
      const d = domainOf(addr);
      const entry = byDomain.get(d) ?? { recipients: 0, bounced: 0 };
      entry.recipients += 1;
      byDomain.set(d, entry);
    }
    for (const addr of row.bounced_recipients ?? []) {
      const entry = byDomain.get(domainOf(addr.toLowerCase()));
      if (entry) entry.bounced += 1; // a failed CC/BCC address isn't part of this breakdown
    }
    if (byDomain.size === 0) byDomain.set(null, { recipients: 1, bounced: 0 });
    // An older bounce with no list of failed addresses: credit it only where there's no doubt whose it was.
    if (row.bounced && !row.bounced_recipients?.length && byDomain.size === 1) {
      byDomain.forEach((e) => { e.bounced = Math.max(e.bounced, 1); });
    }
    emails += 1;
    if (byDomain.size > 1) multiCompanyEmails += 1;
    byDomain.forEach((e, d) => {
      noteThread(row.gmail_thread_id, d);
      add(d, { opened: !!row.opened, openTracked: true, bounced: e.bounced, recipients: e.recipients });
    });
  }

  const sequenceBounced = sequenceBouncedSendIds(opts.sequenceSends, opts.windowEndIso);
  for (const row of opts.sequenceSends) {
    if (sequenceSendOwner(row, opts.mailboxOwnerId) !== opts.userId) continue;
    const email = one(row.sequence_enrollments)?.email;
    emails += 1;
    noteThread(row.gmail_thread_id, email ? domainOf(email) : null);
    add(email ? domainOf(email) : null, {
      opened: !!one(row.email_tracking)?.opened,
      openTracked: !!row.tracking_id,
      bounced: sequenceBounced.has(row.id) ? 1 : 0,
      recipients: 1,
    });
  }

  // Each reply goes to the company whose email it answered. Where that email
  // went to several companies, the replier's own domain picks among them; a
  // reply to an email from before the range falls back to the replier's domain.
  for (const r of opts.responses ?? []) {
    if (r.user_id !== opts.userId) continue;
    const from = r.from_address ? domainOf(r.from_address.toLowerCase()) : null;
    const candidates = r.gmail_thread_id ? Array.from(threadDomains.get(r.gmail_thread_id) ?? []) : [];
    const domain = (from && candidates.includes(from) ? from : candidates[0]) ?? from;
    const c = out.get(domain) ?? { domain, sent: 0, opened: 0, openTracked: 0, replied: 0, bounced: 0, recipients: 0 };
    c.replied += 1;
    out.set(domain, c);
  }

  return {
    companies: Array.from(out.values()).sort((a, b) => b.sent - a.sent || (a.domain ?? "~").localeCompare(b.domain ?? "~")),
    emails,
    multiCompanyEmails,
  };
}
