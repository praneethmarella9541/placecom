import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import {
  estimateCredits,
  identifierFromContact,
  proposeUpdates,
  type EnrichableContact,
} from "@/lib/integrations/enrichment";
import { lushaSearchAndEnrich, type LushaPerson, type LushaReveal } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONTACT_COLUMNS = "id, name, company, title, email, phone, linkedin_url, location";

function cleanReveal(input: unknown, contact: EnrichableContact): LushaReveal[] {
  const asked = Array.isArray(input) ? input.filter((v): v is LushaReveal => v === "emails" || v === "phones") : [];
  if (asked.length > 0) return Array.from(new Set(asked));
  // Not told what to reveal: look for whatever the card is missing.
  const missing: LushaReveal[] = [];
  if (!contact.email) missing.push("emails");
  if (!contact.phone) missing.push("phones");
  return missing;
}

type Stored = { person: LushaPerson; basis: string; reveal: LushaReveal[] };

/**
 * POST /api/integrations/lusha/reveal { contactId, reveal?, dryRun?, force? }
 *
 * Find one contact's email and/or phone with the account's own Lusha key.
 *
 * `dryRun` spends nothing: it says whether the card has enough to identify the person, what the
 * reveal could cost, and whether this contact was already revealed (in which case the stored result
 * is offered again instead of paying twice). Without it, credits are spent — only after the
 * workspace's guards (connected, enough credits, inside the person's monthly cap) have passed.
 */
export async function POST(request: Request) {
  const ctx = await getOrgContext(request);
  if (isOrgError(ctx)) return ctx;

  const body = (await request.json().catch(() => ({}))) as {
    contactId?: unknown;
    reveal?: unknown;
    dryRun?: unknown;
    force?: unknown;
  };
  const contactId = typeof body.contactId === "string" ? body.contactId : "";
  if (!contactId) return NextResponse.json({ error: "Which contact?" }, { status: 400 });

  const { data: contactRow } = await ctx.supabase
    .from("directory_contacts")
    .select(CONTACT_COLUMNS)
    .eq("id", contactId)
    .maybeSingle();
  if (!contactRow) return NextResponse.json({ error: "That contact no longer exists." }, { status: 404 });
  const contact = contactRow as EnrichableContact;

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json(
      {
        error:
          ctx.role === "admin"
            ? "Lusha isn't connected. Connect it under Connectors first."
            : "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.",
        code: "not_connected",
      },
      { status: 400 },
    );
  }

  const identified = identifierFromContact(contact);
  if ("reason" in identified) return NextResponse.json({ error: identified.reason, code: "not_enough_info" }, { status: 422 });

  const reveal = cleanReveal(body.reveal, contact);
  if (reveal.length === 0) {
    return NextResponse.json({ error: "This contact already has an email and a phone number.", code: "nothing_to_find" }, { status: 422 });
  }
  const estimate = estimateCredits(connection.usage?.pricing, reveal, 1);

  // Already revealed? Offer what was found rather than charging again.
  const { data: priorRow } = await ctx.svc
    .from("contact_enrichments")
    .select("id, created_at, outcome, revealed, applied_at, requested_by")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .eq("contact_id", contactId)
    .eq("kind", "reveal")
    .in("outcome", ["found", "partial"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prior = priorRow as
    | { id: string; created_at: string; outcome: string; revealed: Stored | null; applied_at: string | null; requested_by: string | null }
    | null;
  const priorPerson = prior?.revealed?.person ?? null;
  const priorOffer = prior && priorPerson
    ? {
        enrichmentId: prior.id,
        revealedAt: prior.created_at,
        applied: !!prior.applied_at,
        person: priorPerson,
        proposals: proposeUpdates(contact, priorPerson),
      }
    : null;

  if (body.dryRun === true) {
    const pricing = connection.usage?.pricing;
    return NextResponse.json({
      eligible: true,
      basis: identified.basis,
      reveal,
      estimatedCredits: estimate,
      // So the screen can update the figure as the person ticks Email and Phone.
      estimates: {
        emails: estimateCredits(pricing, ["emails"], 1),
        phones: estimateCredits(pricing, ["phones"], 1),
        both: estimateCredits(pricing, ["emails", "phones"], 1),
      },
      has: { email: !!contact.email, phone: !!contact.phone },
      prior: priorOffer,
    });
  }
  if (priorOffer && body.force !== true) {
    return NextResponse.json({ outcome: "found", creditsCharged: 0, enrichmentId: priorOffer.enrichmentId, person: priorOffer.person, proposals: priorOffer.proposals, reused: true });
  }

  const spend = await prepareSpend(ctx, estimate);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code }, { status: spend.status });

  let result;
  try {
    result = await lushaSearchAndEnrich(spend.apiKey, [identified.identifier], reveal);
  } catch (e) {
    return lushaFailure(ctx, e);
  }

  const person = result.people[0] ?? null;
  const credits = result.billing.creditsCharged;
  const failed = !person || !!person.error;
  const gotSomething = !!person && (person.emails.length > 0 || person.phones.length > 0);
  const outcome = failed ? (person?.error?.code === "NOT_FOUND" || !person ? "not_found" : "error") : gotSomething ? "found" : "partial";

  const enrichmentId = await logEnrichment(ctx.svc, {
    ownerId: ctx.mailboxOwnerId,
    userId: ctx.userId,
    contactId,
    kind: "reveal",
    outcome,
    creditsCharged: credits,
    revealed: failed ? null : ({ person, basis: identified.basis, reveal } satisfies Stored),
  });

  if (failed) {
    const compliance = person?.error?.code === "COMPLIANCE_RESTRICTED";
    return NextResponse.json({
      outcome,
      creditsCharged: credits,
      enrichmentId,
      message: compliance
        ? "Lusha can't share this person's details because of a compliance restriction."
        : "Lusha has no match for this person. You weren't charged for the lookup.",
      proposals: [],
    });
  }

  return NextResponse.json({
    outcome,
    creditsCharged: credits,
    enrichmentId,
    person,
    proposals: proposeUpdates(contact, person),
    outOfCredits: result.outOfCredits,
  });
}
