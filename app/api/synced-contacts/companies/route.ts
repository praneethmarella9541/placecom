import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isByomEnabled } from "@/lib/mailbox-context";
import { loadContactSourceFlags, orgOwnerIdForUser } from "@/lib/contact-source-flags";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { getAllCachedLogos } from "@/lib/company-enrichment";
import { bucketEmailConnection, type EmailConnectionStrength } from "@/lib/email-connection-strength";
import { getConnectionStrengthSettings } from "@/lib/connection-strength-settings";
import { isLikelyAutomatedAddress } from "@/lib/mail-noise-filter";
import { isPersonalEmailDomain, personalEmailCompanyLabel } from "@/lib/personal-email-domains";
import { dbErrorMessage } from "@/lib/api-error";

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
  /**
   * BYOM only: whether anyone at this domain was seen in the common mailbox / in any individual
   * mailbox. Absent when the module is off. Never says whose.
   */
  sources?: { common: boolean; byom: boolean };
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
  message_count_90d: number | null;
  message_count_total: number | null;
  has_outbound_contact?: boolean | null;
  has_direct_contact?: boolean | null;
  recent_message_dates?: number[] | null;
};

const SELECT_COLUMNS =
  "email, domain, company_name, last_interaction_at, connection_strength, message_count_90d, message_count_total, has_outbound_contact, has_direct_contact, recent_message_dates";

/**
 * Recomputes connection_strength per row against the caller's own thresholds
 * before grouping, so bestConnectionStrength reflects their personal
 * settings rather than whatever lib/people-mailbox-sync.ts last stored using
 * the default thresholds — see app/api/synced-contacts/route.ts's twin of
 * this function.
 */
function withLiveStrength(
  rows: Row[],
  settings: Awaited<ReturnType<typeof getConnectionStrengthSettings>>
): Row[] {
  return rows.map((row) => ({
    ...row,
    connection_strength: bucketEmailConnection(
      {
        lastInteractionAt: row.last_interaction_at,
        messageDates: Array.isArray(row.recent_message_dates) ? row.recent_message_dates : [],
        recentCount90dFallback: row.message_count_90d ?? 0,
        hasOutboundContact: Boolean(row.has_outbound_contact),
        hasDirectContact: row.has_direct_contact !== false,
      },
      settings
    ),
  }));
}

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
        // gmail.com / outlook.com / … are piles of unrelated individuals, not
        // orgs — label them "<Provider> (personal)" so they don't read as the
        // company that runs the mail service. Still grouped per-domain.
        companyName: personalEmailCompanyLabel(domain) || row.company_name || domain,
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
    // Personal-webmail "companies" (Gmail/Outlook/…) sink below real orgs —
    // they're big by headcount but aren't a relationship with one entity.
    const aPersonal = isPersonalEmailDomain(a.domain);
    const bPersonal = isPersonalEmailDomain(b.domain);
    if (aPersonal !== bPersonal) return aPersonal ? 1 : -1;
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
  // Grouped from the org's shared contact book — see app/api/synced-contacts. Shared by every
  // member, whether or not they can open the common mailbox.

  // `email` is unique on this table (migration 0037) — a stable, total sort
  // key on its own, needed so fetchAllRows' page boundaries don't skip or
  // duplicate rows. The thresholds don't depend on those rows, so that lookup
  // runs alongside the first page rather than ahead of it.
  const [settings, { data, error }] = await Promise.all([
    getConnectionStrengthSettings(supabase, user.id),
    fetchAllRows<Row>((from, to) =>
      supabase
        .from("synced_contacts")
        .select(SELECT_COLUMNS)
        .order("email", { ascending: true })
        .range(from, to)
    ),
  ]);

  // BYOM: a company is "common" / "BYOM" when any person at its domain is. Org-level facts only.
  const svc = createServiceSupabase();
  const orgOwnerId = (await isByomEnabled(svc)) ? await orgOwnerIdForUser(user.id) : null;
  const sourceByEmail = orgOwnerId ? await loadContactSourceFlags(orgOwnerId, user.id) : null;
  function withSources(companies: SyncedCompanyRow[], rows: Row[]): SyncedCompanyRow[] {
    if (!sourceByEmail) return companies;
    const byDomain = new Map<string, { common: boolean; byom: boolean }>();
    for (const r of rows) {
      const flags = sourceByEmail.get(r.email);
      if (!flags || !r.domain) continue;
      const cur = byDomain.get(r.domain) ?? { common: false, byom: false };
      cur.common ||= flags.common;
      cur.byom ||= flags.mine || flags.others;
      byDomain.set(r.domain, cur);
    }
    // A domain whose contacts have no source row yet (synced before 0095's next sync) reads as common.
    return companies.map((c) => ({ ...c, sources: byDomain.get(c.domain) ?? { common: true, byom: false } }));
  }

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
          .select("email, domain, company_name, last_interaction_at, connection_strength, message_count_90d, message_count_total")
          .order("email", { ascending: true })
          .range(from, to)
      );
      if (fallback.error) return NextResponse.json({ error: dbErrorMessage({ message: fallback.error }) }, { status: 500 });
      return NextResponse.json({ companies: withSources(await withLogos(groupByDomain(withLiveStrength(fallback.data, settings))), fallback.data) });
    }
    return NextResponse.json({ error: dbErrorMessage({ message: error }) }, { status: 500 });
  }

  return NextResponse.json({ companies: withSources(await withLogos(groupByDomain(withLiveStrength(data, settings))), data) });
}
