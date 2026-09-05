import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getThreadMessages, listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery, gmailDomainQuery } from "@/lib/gmail-address-query";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { isPersonalEmailDomain } from "@/lib/personal-email-domains";

export type EvidenceItem = {
  channel: "mail" | "whatsapp" | "note";
  direction: "in" | "out" | "unknown";
  date: string;
  /** What the classifier sees. For mail this is "subject — snippet". */
  text: string;
  /** Display-only extras, populated for mail so the UI can open the real thread. */
  threadId?: string;
  subject?: string;
  snippet?: string;
};

export type LeadEvidence = {
  items: EvidenceItem[];
  /** True when nothing at all was found in the window — the classifier is told this explicitly. */
  empty: boolean;
};

/**
 * Per-lead caps. The defaults are tuned for the prompt: enough signal to place
 * a lead, small enough that cost stays flat per lead. The lead detail view
 * passes larger limits — a human reading the evidence wants the whole story,
 * and that read costs nothing.
 */
export type EvidenceLimits = {
  maxMail: number;
  maxWhatsapp: number;
  maxNotes: number;
  maxTextChars: number;
  /**
   * How many of the newest threads to open in full. Gmail's thread *list* only
   * carries one snippet per thread — the latest message — so without this the
   * model saw "they replied" but never what anyone actually said. Each expanded
   * thread is one extra Gmail call, so this trades latency for the back-and-forth
   * that stage classification actually depends on.
   */
  expandThreads: number;
  /** Messages read from each expanded thread, newest first. */
  maxMessagesPerThread: number;
};

/** Threads opened in parallel per lead. Small on purpose — see mailEvidence. */
const THREAD_FETCH_CONCURRENCY = 4;

export const PROMPT_EVIDENCE_LIMITS: EvidenceLimits = {
  maxMail: 25,
  maxWhatsapp: 25,
  maxNotes: 10,
  maxTextChars: 280,
  expandThreads: 8,
  maxMessagesPerThread: 10,
};

export const DISPLAY_EVIDENCE_LIMITS: EvidenceLimits = {
  maxMail: 60,
  maxWhatsapp: 100,
  maxNotes: 50,
  maxTextChars: 1000,
  // The detail view links out to the real thread, so there's nothing to gain
  // from paying for N thread fetches just to render a list.
  expandThreads: 0,
  maxMessagesPerThread: 0,
};

function clipper(maxChars: number) {
  return (s: string | null | undefined): string => {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
  };
}

/**
 * Drops quoted reply chains and the usual signature/footer cruft from a plain
 * text mail body.
 *
 * Without this, expanding a thread is close to worthless: each reply embeds
 * every message before it, so the newest message alone can carry the entire
 * conversation. That both explodes the token bill and buries the one or two
 * new sentences that actually say where the deal stands.
 */
function stripQuotedReply(body: string): string {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith(">")) continue;
    // "On <date>, <someone> wrote:" — everything after this is the quoted copy.
    if (/^On .{6,80}\bwrote:\s*$/i.test(t)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) break;
    if (/^From:\s.+/i.test(t) && kept.length > 0) break;
    if (/^(--|__)\s*$/.test(t)) break; // signature delimiter
    if (/^(Sent from my |Get Outlook for )/i.test(t)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function domainOf(email: string | null): string | null {
  const at = (email ?? "").lastIndexOf("@");
  if (at < 0) return null;
  return email!.slice(at + 1).trim().toLowerCase() || null;
}

/** True if `email` appears in the cc header but not in to/from — addressed at the thread, not addressed to them. */
function isCcOnly(
  m: { from?: string; to?: string; cc?: string },
  email: string
): boolean {
  const has = (field: string | undefined) => (field ?? "").toLowerCase().includes(email);
  return has(m.cc) && !has(m.to) && !has(m.from);
}

/**
 * Gmail evidence for one lead. Searches the individual address first; for a
 * real company domain it falls back to a domain-wide search so a lead whose
 * named contact went quiet but whose colleagues are active still reads as
 * live. Personal webmail domains (gmail.com etc. — see
 * lib/personal-email-domains.ts) are never widened that way: "everyone on
 * Gmail" is not this lead's company.
 *
 * Both queries include cc: — from/to-only search silently dropped threads
 * where the lead was only ever cc'd, even though being looped into a live
 * negotiation is real signal. Expanded-thread messages where the lead was
 * cc'd rather than addressed directly get an explicit "(cc'd)" tag (see
 * isCcOnly) so the classifier doesn't read a cc the same as being written to.
 */
async function mailEvidence(
  accessToken: string,
  email: string | null,
  since: Date | null,
  ownAddress: string | undefined,
  limits: EvidenceLimits,
  mailboxKey: string | undefined
): Promise<EvidenceItem[]> {
  const clip = clipper(limits.maxTextChars);
  if (!email) return [];
  const domain = domainOf(email);
  const query =
    domain && !isPersonalEmailDomain(domain)
      ? gmailDomainQuery(domain, /* includeCc */ true)
      : gmailAddressQuery(email, /* includeCc */ true);
  const leadEmail = email.trim().toLowerCase();

  // Gmail's `after:` takes YYYY/MM/DD; narrowing server-side is far cheaper
  // than fetching everything and filtering here.
  const dated = since
    ? `${query} after:${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`
    : query;

  const page = await listThreadsPage(accessToken, {
    folder: "allmail",
    maxResults: limits.maxMail,
    searchQuery: dated,
    mailboxKey,
  });

  const me = ownAddress?.trim().toLowerCase();
  const directionOf = (from: string | null | undefined): EvidenceItem["direction"] =>
    me && (from ?? "").toLowerCase().includes(me) ? "out" : "in";

  const summaries: EvidenceItem[] = page.threads.map((t) => {
    const subject = t.subject || "(no subject)";
    return {
      channel: "mail" as const,
      direction: directionOf(t.from),
      date: t.date,
      text: clip(`${subject} — ${t.snippet || ""}`),
      threadId: t.id,
      subject,
      snippet: clip(t.snippet),
    };
  });

  if (limits.expandThreads <= 0) return summaries;

  // Open the newest threads properly. A classify run does this per lead, so
  // running them strictly one at a time would add seconds per lead across a
  // 60-lead re-classify; a small fixed width keeps that bounded without
  // bursting hard enough to hit Gmail's per-user rate limit.
  const expandedIds = new Set<string>();
  const expanded: EvidenceItem[] = [];
  const toExpand = page.threads.slice(0, limits.expandThreads);

  for (let i = 0; i < toExpand.length; i += THREAD_FETCH_CONCURRENCY) {
    const chunk = toExpand.slice(i, i + THREAD_FETCH_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (thread) => {
        try {
          const { messages } = await getThreadMessages(accessToken, thread.id, { mailboxKey });
          return { thread, messages };
        } catch {
          // One unreadable thread shouldn't cost us the rest of the evidence —
          // its list-level snippet is still included below.
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;
      const { thread, messages } = result;
      if (messages.length <= 1) continue; // Nothing the snippet didn't already say.
      expandedIds.add(thread.id);

      const subject = thread.subject || "(no subject)";
      for (const m of [...messages].reverse().slice(0, limits.maxMessagesPerThread)) {
        const body = clip(stripQuotedReply(m.body || ""));
        if (!body) continue;
        // Flagged rather than silently included: a lead looped in on cc is
        // real signal (the includeCc search above is what surfaces these
        // threads at all) but weaker than being written to directly, and the
        // classifier should be able to tell the two apart.
        const ccTag = isCcOnly(m, leadEmail) ? " (lead cc'd, not addressed directly)" : "";
        expanded.push({
          channel: "mail",
          direction: directionOf(m.from),
          date: m.date,
          text: `${subject}${ccTag} — ${body}`,
          threadId: thread.id,
          subject,
          snippet: body,
        });
      }
    }
  }

  // Expanded threads replace their own summary line; the rest keep theirs.
  return [...expanded, ...summaries.filter((s) => !s.threadId || !expandedIds.has(s.threadId))];
}

async function whatsappEvidence(
  supabase: SupabaseClient,
  phone: string | null,
  since: Date | null,
  limits: EvidenceLimits
): Promise<EvidenceItem[]> {
  const clip = clipper(limits.maxTextChars);
  if (!phone) return [];
  const variants = phoneLookupVariants(normalizePhone(phone));
  if (variants.length === 0) return [];

  let q = supabase
    .from("whatsapp_messages")
    .select("direction, body, created_at")
    .in("peer_e164", variants)
    .order("created_at", { ascending: false })
    .limit(limits.maxWhatsapp);
  if (since) q = q.gte("created_at", since.toISOString());

  const { data } = await q;
  return (data ?? [])
    .filter((m) => clip(m.body as string | null).length > 0)
    .map((m) => ({
      channel: "whatsapp" as const,
      direction: (m.direction === "outbound" ? "out" : "in") as EvidenceItem["direction"],
      date: m.created_at as string,
      text: clip(m.body as string | null),
    }));
}

async function noteEvidence(
  supabase: SupabaseClient,
  leadId: string,
  since: Date | null,
  limits: EvidenceLimits
): Promise<EvidenceItem[]> {
  const clip = clipper(limits.maxTextChars);
  let q = supabase
    .from("lead_interactions")
    .select("interaction_type, notes, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limits.maxNotes);
  if (since) q = q.gte("created_at", since.toISOString());

  const { data } = await q;
  return (data ?? [])
    .filter((n) => clip(n.notes as string | null).length > 0)
    .map((n) => ({
      channel: "note" as const,
      direction: "out" as const,
      date: n.created_at as string,
      text: clip(`[${n.interaction_type}] ${n.notes as string}`),
    }));
}

/**
 * Everything the classifier gets to see about one lead, newest first.
 *
 * Mail is fetched live from Gmail rather than read from a table — message
 * bodies are not stored anywhere in this app (synced_contacts keeps only
 * dates and counts), so there is no local corpus to read instead. A Gmail
 * failure is swallowed: WhatsApp-only evidence still beats refusing to
 * classify at all.
 */
export async function gatherLeadEvidence(
  supabase: SupabaseClient,
  lead: { id: string; email: string | null; phone: string | null },
  opts: {
    accessToken?: string;
    /** Mailbox the Gmail reads are billed to — scopes the shared quota bucket. */
    mailboxKey?: string;
    ownAddress?: string;
    seasonStart: string | null;
    limits?: EvidenceLimits;
  }
): Promise<LeadEvidence> {
  const since = opts.seasonStart ? new Date(`${opts.seasonStart}T00:00:00Z`) : null;
  const limits = opts.limits ?? PROMPT_EVIDENCE_LIMITS;

  const [mail, whatsapp, notes] = await Promise.all([
    opts.accessToken
      ? mailEvidence(
          opts.accessToken,
          lead.email,
          since,
          opts.ownAddress,
          limits,
          opts.mailboxKey
        ).catch(() => [])
      : Promise.resolve([]),
    whatsappEvidence(supabase, lead.phone, since, limits).catch(() => []),
    noteEvidence(supabase, lead.id, since, limits).catch(() => []),
  ]);

  const items = [...mail, ...whatsapp, ...notes].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );

  return { items, empty: items.length === 0 };
}

/** Compact, token-cheap rendering of the evidence for the prompt. */
export function renderEvidence(evidence: LeadEvidence): string {
  if (evidence.empty) return "(no mail, WhatsApp or notes found in this window)";
  return evidence.items
    .map((e) => {
      const when = (e.date ?? "").slice(0, 10);
      const dir = e.direction === "out" ? "we sent" : e.direction === "in" ? "they sent" : "—";
      return `- [${e.channel}, ${dir}, ${when}] ${e.text}`;
    })
    .join("\n");
}
