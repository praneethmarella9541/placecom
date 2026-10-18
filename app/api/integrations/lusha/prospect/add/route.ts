import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import {
  applyProposals,
  estimateRevealOnly,
  fillBlanksOnly,
  proposeUpdates,
  splitCredits,
  type EnrichableContact,
} from "@/lib/integrations/enrichment";
import { lushaEnrichByIds, type LushaPerson, type LushaReveal } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { getOrgContext, isOrgError } from "@/lib/org-context";
import { normalizeLinkedInUrl, isLikelyLinkedInUrl } from "@/lib/contact-directory";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_ADD = 50;

type Incoming = {
  id?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  title?: unknown;
  company?: unknown;
  location?: unknown;
  linkedin?: unknown;
  /** Already revealed in the results table: saved with the contact, no second reveal needed. */
  email?: unknown;
  phone?: unknown;
};

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * POST /api/integrations/lusha/prospect/add { people, reveal? }
 *
 * Add chosen search results to the contact directory, and optionally reveal their email and/or
 * phone. Adding costs nothing — the search already paid for the preview — so the contacts are
 * created first; only the optional reveal spends credits, and if it is blocked (cap, credits) the
 * contacts are still added and the response says why nothing was revealed.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const body = (await request.json().catch(() => ({}))) as { people?: unknown; reveal?: unknown };
  const incoming = (Array.isArray(body.people) ? body.people : []) as Incoming[];
  const reveal = (Array.isArray(body.reveal) ? body.reveal : []).filter((v): v is LushaReveal => v === "emails" || v === "phones");
  if (incoming.length === 0) return NextResponse.json({ error: "Choose at least one person." }, { status: 400 });
  if (incoming.length > MAX_ADD) return NextResponse.json({ error: `Add at most ${MAX_ADD} people at a time.` }, { status: 400 });

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Lusha isn't connected for your workspace.", code: "not_connected" }, { status: 400 });
  }

  // Skip anyone already in the directory (same LinkedIn link, or same name at the same company).
  const people = incoming
    .map((p) => ({
      lushaId: text(p.id),
      name: [text(p.firstName), text(p.lastName)].filter(Boolean).join(" "),
      title: text(p.title),
      company: text(p.company),
      location: text(p.location),
      linkedin: text(p.linkedin) ? normalizeLinkedInUrl(text(p.linkedin) as string) : null,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(p.email) ?? "") ? (text(p.email) as string) : null,
      phone: text(p.phone)?.slice(0, 40) ?? null,
    }))
    .filter((p) => p.name && p.lushaId);

  const links = people.map((p) => p.linkedin).filter((v): v is string => !!v);
  const [byLink, byName] = await Promise.all([
    links.length
      ? ctx.supabase.from("directory_contacts").select("id, name, company, linkedin_url").in("linkedin_url", links)
      : Promise.resolve({ data: [] }),
    people.length
      ? ctx.supabase.from("directory_contacts").select("id, name, company, linkedin_url").in("name", people.map((p) => p.name))
      : Promise.resolve({ data: [] }),
  ]);
  const existingRows = [...(byLink.data ?? []), ...(byName.data ?? [])];
  const existing = (existingRows ?? []) as { id: string; name: string; company: string | null; linkedin_url: string | null }[];
  const isDuplicate = (p: (typeof people)[number]) =>
    existing.some(
      (e) =>
        (p.linkedin && e.linkedin_url && e.linkedin_url.replace(/\/+$/, "").toLowerCase() === p.linkedin.replace(/\/+$/, "").toLowerCase()) ||
        (e.name.toLowerCase() === p.name.toLowerCase() && (e.company ?? "").toLowerCase() === (p.company ?? "").toLowerCase()),
    );

  const created: { id: string; lushaId: string; contact: EnrichableContact }[] = [];
  const skipped: string[] = [];
  for (const p of people) {
    if (isDuplicate(p)) {
      skipped.push(p.name);
      continue;
    }
    const linkedin = p.linkedin && isLikelyLinkedInUrl(p.linkedin) ? p.linkedin : null;
    const { data, error } = await ctx.supabase
      .from("directory_contacts")
      .insert({
        name: p.name,
        company: p.company,
        title: p.title,
        location: p.location,
        linkedin_url: linkedin,
        // Details the person already revealed in the results go straight onto the card.
        ...(p.email ? { email: p.email } : {}),
        ...(p.phone ? { phone: p.phone } : {}),
        created_by: ctx.userId,
        updated_by: ctx.userId,
        mailbox_owner_id: ctx.mailboxOwnerId,
      })
      .select("id, name, company, title, email, phone, linkedin_url, location")
      .single();
    if (error || !data) {
      skipped.push(p.name);
      continue;
    }
    created.push({ id: (data as EnrichableContact).id, lushaId: p.lushaId as string, contact: data as EnrichableContact });
  }

  const result = {
    added: created.length,
    skippedAlreadyThere: skipped,
    reveal: null as null | { found: number; updated: number; creditsCharged: number },
    revealBlocked: null as null | string,
  };
  if (reveal.length === 0 || created.length === 0) return NextResponse.json(result);

  const estimate = estimateRevealOnly(connection.usage?.pricing, reveal, created.length);
  const spend = await prepareSpend(ctx, estimate);
  if (!spend.ok) {
    result.revealBlocked = spend.error;
    return NextResponse.json(result);
  }

  let enriched;
  try {
    enriched = await lushaEnrichByIds(spend.apiKey, created.map((c) => c.lushaId), reveal);
  } catch (e) {
    const failure = await lushaFailure(ctx, e);
    const j = (await failure.json().catch(() => ({}))) as { error?: string };
    result.revealBlocked = j.error ?? "Lusha couldn't reveal contact details right now.";
    return NextResponse.json(result);
  }

  const byId = new Map<string, LushaPerson>(enriched.people.filter((p) => p.id).map((p) => [p.id as string, p]));
  const total = enriched.billing.creditsCharged;
  const shares = splitCredits(total, created.length);
  const summary = { found: 0, updated: 0, creditsCharged: total };

  for (const [index, c] of created.entries()) {
    const person = byId.get(c.lushaId) ?? null;
    const failed = !person || !!person.error;
    const got = !!person && (person.emails.length > 0 || person.phones.length > 0);
    const share = shares[index];
    await logEnrichment(ctx.svc, {
      ownerId: ctx.mailboxOwnerId,
      userId: ctx.userId,
      contactId: c.id,
      kind: "reveal",
      outcome: failed ? "not_found" : got ? "found" : "partial",
      creditsCharged: share,
      revealed: failed ? null : { person, basis: "prospect", reveal },
    });
    if (failed || !person) continue;
    if (got) summary.found += 1;
    const fills = fillBlanksOnly(proposeUpdates(c.contact, person)).filter((f) => f.field === "email" || f.field === "phone");
    if (fills.length > 0) {
      const applied = await applyProposals(ctx.supabase, c.id, ctx.userId, fills.map((f) => ({ field: f.field, value: f.proposed })));
      if (applied.ok && applied.applied.length > 0) summary.updated += 1;
    }
  }
  result.reveal = summary;
  return NextResponse.json(result);
}
