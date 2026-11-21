import { NextResponse } from "next/server";
import { withRecord } from "@/lib/data-model/route-helpers";
import { isByomEnabled } from "@/lib/mailbox-context";
import { bucketEmailConnection, type EmailConnectionStrength } from "@/lib/email-connection-strength";
import { getConnectionStrengthSettings } from "@/lib/connection-strength-settings";

export const runtime = "nodejs";

const RANK: Record<string, number> = { Good: 3, Weak: 2, "Very weak": 1, "No communication": 0 };
type Source = "all" | "common" | "byom" | "mine";
const SOURCES = new Set<Source>(["all", "common", "byom", "mine"]);

type SourceRow = {
  email: string;
  mailbox_id: string;
  owner_user_id: string;
  last_interaction_at: string | null;
  message_count_total: number;
  message_count_90d: number;
  recent_message_dates: number[] | null;
  has_outbound_contact: boolean | null;
  has_direct_contact: boolean | null;
};

/**
 * GET /api/data/records/[id]/interaction[?source=all|common|byom|mine]
 * Read-only, computed fields for a person or company, taken from the contacts the mailbox sync
 * already built: when you last had mail with them, how strong that connection is, and how much mail
 * there has been. For a company the figures cover everyone at its domains and the strongest
 * connection is the best of them.
 *
 * `all` (the default) is the merged contact, as before. With BYOM on, the same figures can be
 * taken from one kind of mailbox — the common mailbox, individual (BYOM) mailboxes combined, or
 * the viewer's own — from synced_contact_sources. Members' individual mailboxes are only ever
 * combined, never named: the block says "BYOM mailboxes", not whose.
 *
 * Values are as of the last contact sync (they are not recomputed here), and never edited by hand.
 * Shared by the whole org, like the contact book itself — figures only, never mail.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;
  const { record, object } = found;

  const rawSource = new URL(request.url).searchParams.get("source") as Source | null;
  const requested: Source = rawSource && SOURCES.has(rawSource) ? rawSource : "all";
  const byom = await isByomEnabled(svc);

  const list = (slug: string) => {
    const v = record.values[slug];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === "string");
  };
  const emails = object.slug === "people" ? list("email_addresses") : [];
  const domains = object.slug === "companies" ? list("domains") : [];
  if (object.slug === "people" ? !emails.length : object.slug === "companies" ? !domains.length : true) {
    return NextResponse.json({ available: false });
  }

  // Which sources the viewer can pick from: the merged view, the common mailbox, individual
  // mailboxes combined, and their own if they have one.
  let options: Source[] | undefined;
  let mailboxes: { id: string; mailbox_type: string; owner_user_id: string }[] = [];
  if (byom) {
    const { data } = await svc.from("mailboxes").select("id, mailbox_type, owner_user_id, status").eq("org_owner_id", orgOwnerId);
    mailboxes = (data ?? []).filter((m) => m.mailbox_type === "common" || m.status === "active") as typeof mailboxes;
    const hasOwn = mailboxes.some((m) => m.mailbox_type === "individual" && m.owner_user_id === userId);
    options = hasOwn ? ["all", "common", "byom", "mine"] : ["all", "common", "byom"];
  }
  const source: Source = options && options.includes(requested) ? requested : "all";

  if (source === "all") {
    let q = svc
      .from("synced_contacts")
      .select("email, last_interaction_at, connection_strength, message_count_90d, message_count_total, synced_at")
      .eq("mailbox_owner_id", orgOwnerId);
    q = object.slug === "people" ? q.in("email", emails) : q.in("domain", domains).limit(2000);
    const { data } = await q;
    const rows = data ?? [];
    if (!rows.length) return NextResponse.json({ available: true, contacts: 0, source, options });
    const last = rows.map((r) => r.last_interaction_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null;
    const strongest = rows.map((r) => r.connection_strength as string | null).filter((x): x is string => !!x).sort((a, b) => (RANK[b] ?? -1) - (RANK[a] ?? -1))[0] ?? null;
    return NextResponse.json({
      available: true,
      source,
      options,
      contacts: rows.length,
      last_interaction_at: last,
      connection_strength: strongest,
      message_count_90d: rows.reduce((t, r) => t + ((r.message_count_90d as number) ?? 0), 0),
      message_count_total: rows.reduce((t, r) => t + ((r.message_count_total as number) ?? 0), 0),
      as_of: rows.map((r) => r.synced_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null,
    });
  }

  // One kind of mailbox: the rows its sync recorded for these addresses.
  const commonIds = new Set(mailboxes.filter((m) => m.mailbox_type === "common").map((m) => m.id));
  const wanted = (r: SourceRow) => {
    const isCommon = commonIds.has(r.mailbox_id);
    if (source === "common") return isCommon;
    if (source === "byom") return !isCommon;
    return !isCommon && r.owner_user_id === userId;
  };
  const columns = "email, mailbox_id, owner_user_id, last_interaction_at, message_count_total, message_count_90d, recent_message_dates, has_outbound_contact, has_direct_contact";
  let q = svc.from("synced_contact_sources").select(columns).eq("org_owner_id", orgOwnerId);
  if (object.slug === "people") q = q.in("email", emails.map((e) => e.trim().toLowerCase()));
  else {
    // Domains come from the record, but still go into a filter string: keep to hostname characters.
    const safe = domains.map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+$/.test(d));
    if (!safe.length) return NextResponse.json({ available: false });
    q = q.or(safe.map((d) => `email.ilike.%@${d}`).join(",")).limit(5000);
  }
  const { data } = await q;
  const rows = ((data ?? []) as SourceRow[]).filter(wanted);
  if (!rows.length) return NextResponse.json({ available: true, source, options, contacts: 0 });

  // One person can be in several individual mailboxes: fold them into one before judging strength.
  const byEmail = new Map<string, { last: string | null; total: number; d90: number; dates: Set<number>; outbound: boolean; direct: boolean }>();
  for (const r of rows) {
    const cur = byEmail.get(r.email) ?? { last: null, total: 0, d90: 0, dates: new Set<number>(), outbound: false, direct: false };
    if (r.last_interaction_at && (!cur.last || r.last_interaction_at > cur.last)) cur.last = r.last_interaction_at;
    cur.total += r.message_count_total ?? 0;
    cur.d90 += r.message_count_90d ?? 0;
    for (const d of Array.isArray(r.recent_message_dates) ? r.recent_message_dates : []) cur.dates.add(d);
    cur.outbound ||= Boolean(r.has_outbound_contact);
    cur.direct ||= r.has_direct_contact !== false;
    byEmail.set(r.email, cur);
  }
  const settings = await getConnectionStrengthSettings(svc, userId);
  let last: string | null = null;
  let best: EmailConnectionStrength | null = null;
  let total = 0;
  let d90 = 0;
  for (const c of byEmail.values()) {
    if (c.last && (!last || c.last > last)) last = c.last;
    total += c.total;
    d90 += c.d90;
    const strength = bucketEmailConnection(
      {
        lastInteractionAt: c.last,
        messageDates: [...c.dates].sort((a, b) => b - a),
        recentCount90dFallback: c.d90,
        hasOutboundContact: c.outbound,
        hasDirectContact: c.direct,
      },
      settings
    );
    if (!best || (RANK[strength] ?? -1) > (RANK[best] ?? -1)) best = strength;
  }
  return NextResponse.json({
    available: true,
    source,
    options,
    contacts: byEmail.size,
    last_interaction_at: last,
    connection_strength: best,
    message_count_90d: d90,
    message_count_total: total,
    as_of: null,
  });
}
