import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { getAllCachedLogos } from "@/lib/company-enrichment";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
import { isLikelyAutomatedAddress } from "@/lib/mail-noise-filter";

export const runtime = "nodejs";

export type SyncedCompanyRow = {
  domain: string;
  companyName: string;
  contactCount: number;
  lastInteractionAt: string | null;
  bestConnectionStrength: EmailConnectionStrength;
  messageCountTotal: number;
  /** True once at least one person at this domain has ever been sent mail (not just received from). */
  hasOutboundContact: boolean;
  /** From company_enrichment_cache (lib/company-enrichment.ts) — null until the sync has resolved this domain. */
  logoUrl: string | null;
};

// Best-first, matching bucketEmailConnection's own ordering (lib/email-connection-strength.ts).
const STRENGTH_RANK: Record<EmailConnectionStrength, number> = {
  Good: 3,
  Weak: 2,
  "Very weak": 1,
  "No communication": 0,
};

type Row = {
  email: string;
  domain: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_total: number | null;
  has_outbound_contact?: boolean | null;
};

function groupByDomain(rows: Row[]): SyncedCompanyRow[] {
  const groups = new Map<string, SyncedCompanyRow>();
  for (const row of rows) {
    if (isLikelyAutomatedAddress(row.email)) continue;
    const domain = row.domain?.trim().toLowerCase();
    if (!domain) continue;

    const existing = groups.get(domain);
    const strength = row.connection_strength ?? "No communication";
    const lastAt = row.last_interaction_at;
    const outbound = Boolean(row.has_outbound_contact);

    if (!existing) {
      groups.set(domain, {
        domain,
        companyName: row.company_name || domain,
        contactCount: 1,
        lastInteractionAt: lastAt,
        bestConnectionStrength: strength,
        messageCountTotal: row.message_count_total ?? 0,
        hasOutboundContact: outbound,
        logoUrl: null,
      });
      continue;
    }

    existing.contactCount += 1;
    existing.messageCountTotal += row.message_count_total ?? 0;
    existing.hasOutboundContact = existing.hasOutboundContact || outbound;
    if (STRENGTH_RANK[strength] > STRENGTH_RANK[existing.bestConnectionStrength]) {
      existing.bestConnectionStrength = strength;
    }
    if (lastAt && (!existing.lastInteractionAt || lastAt > existing.lastInteractionAt)) {
      existing.lastInteractionAt = lastAt;
    }
  }

  // Real (two-way) companies first, then bigger relationships (more distinct
  // people you've exchanged mail with), then most recently active. Pure
  // recency alone previously let a single one-off automated sender that
  // slipped past the noise filter (see lib/mail-noise-filter.ts) sit above
  // companies you actually deal with.
  return Array.from(groups.values()).sort((a, b) => {
    if (a.hasOutboundContact !== b.hasOutboundContact) return a.hasOutboundContact ? -1 : 1;
    if (a.contactCount !== b.contactCount) return b.contactCount - a.contactCount;
    return (b.lastInteractionAt ?? "").localeCompare(a.lastInteractionAt ?? "");
  });
}

/**
 * GET /api/synced-contacts/companies — the same synced_contacts rows
 * (see lib/people-mailbox-sync.ts), grouped by domain. No enrichment API
 * calls: "company" here is just the domain-derived guess already stored on
 * each contact row (guessCompanyNameFromDomain), grouped and aggregated
 * in-process rather than via a DB view — fine at the row counts a single
 * shared mailbox produces; revisit with a Postgres view if this table grows
 * into the hundreds of thousands of rows.
 */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `email` is unique on this table (migration 0037) — a stable, total sort
  // key on its own, needed so fetchAllRows' page boundaries don't skip or
  // duplicate rows.
  const { data, error } = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("synced_contacts")
      .select("email, domain, company_name, last_interaction_at, connection_strength, message_count_total, has_outbound_contact")
      .order("email", { ascending: true })
      .range(from, to)
  );

  // Best-effort — logos are a nice-to-have; a missing/not-yet-migrated cache
  // table shouldn't break the whole company list.
  async function withLogos(companies: SyncedCompanyRow[]): Promise<SyncedCompanyRow[]> {
    try {
      const logos = await getAllCachedLogos(supabase);
      if (logos.size === 0) return companies;
      return companies.map((c) => ({ ...c, logoUrl: logos.get(c.domain) ?? null }));
    } catch {
      return companies;
    }
  }

  if (error) {
    if (/relation.*synced_contacts.*does not exist/i.test(error)) {
      return NextResponse.json({ companies: [] });
    }
    // has_outbound_contact may not exist yet on a pre-migration table — retry without it.
    if (/column.*has_outbound_contact.*does not exist/i.test(error)) {
      const fallback = await fetchAllRows<Row>((from, to) =>
        supabase
          .from("synced_contacts")
          .select("email, domain, company_name, last_interaction_at, connection_strength, message_count_total")
          .order("email", { ascending: true })
          .range(from, to)
      );
      if (fallback.error) return NextResponse.json({ error: fallback.error }, { status: 500 });
      return NextResponse.json({ companies: await withLogos(groupByDomain(fallback.data)) });
    }
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ companies: await withLogos(groupByDomain(data)) });
}
