import { NextResponse } from "next/server";
import { withRecord } from "@/lib/data-model/route-helpers";
import { commonMailboxAccessForUser } from "@/lib/mailbox-context";

export const runtime = "nodejs";

const RANK: Record<string, number> = { Good: 3, Weak: 2, "Very weak": 1, "No communication": 0 };

/**
 * GET /api/data/records/[id]/interaction
 * Read-only, computed fields for a person or company, taken from the contacts the mailbox sync
 * already built (synced_contacts): when you last had mail with them, how strong that connection is,
 * and how much mail there has been. For a company the figures cover everyone at its domains and the
 * strongest connection is the best of them.
 *
 * Values are as of the last contact sync (they are not recomputed here), and never edited by hand.
 * Only for someone with access to the common mailbox those contacts were mined from.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;
  const { record, object } = found;

  if (!(await commonMailboxAccessForUser(svc, userId))) return NextResponse.json({ available: false });
  const list = (slug: string) => {
    const v = record.values[slug];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === "string");
  };

  let q = svc
    .from("synced_contacts")
    .select("email, last_interaction_at, connection_strength, message_count_90d, message_count_total, synced_at")
    .eq("mailbox_owner_id", orgOwnerId);
  if (object.slug === "people") {
    const emails = list("email_addresses");
    if (!emails.length) return NextResponse.json({ available: false });
    q = q.in("email", emails);
  } else if (object.slug === "companies") {
    const domains = list("domains");
    if (!domains.length) return NextResponse.json({ available: false });
    q = q.in("domain", domains).limit(2000);
  } else return NextResponse.json({ available: false });

  const { data } = await q;
  const rows = data ?? [];
  if (!rows.length) return NextResponse.json({ available: true, contacts: 0 });

  const last = rows.map((r) => r.last_interaction_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null;
  const strongest = rows.map((r) => r.connection_strength as string | null).filter((x): x is string => !!x).sort((a, b) => (RANK[b] ?? -1) - (RANK[a] ?? -1))[0] ?? null;
  return NextResponse.json({
    available: true,
    contacts: rows.length,
    last_interaction_at: last,
    connection_strength: strongest,
    message_count_90d: rows.reduce((t, r) => t + ((r.message_count_90d as number) ?? 0), 0),
    message_count_total: rows.reduce((t, r) => t + ((r.message_count_total as number) ?? 0), 0),
    as_of: rows.map((r) => r.synced_at as string | null).filter((x): x is string => !!x).sort().pop() ?? null,
  });
}
