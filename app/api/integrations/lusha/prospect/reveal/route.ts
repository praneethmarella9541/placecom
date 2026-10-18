import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import { estimateRevealOnly, splitCredits } from "@/lib/integrations/enrichment";
import { lushaEnrichByIds, type LushaReveal } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_REVEAL = 50;

/** What one person's reveal came back with, as the results table shows it. */
export type RevealedPerson = {
  emails: string[];
  phones: string[];
  /** found: something came back; partial: the person exists but not the field asked for; not_found: Lusha had nothing. */
  status: "found" | "partial" | "not_found";
};

/**
 * POST /api/integrations/lusha/prospect/reveal { ids, reveal }
 *
 * Reveal the email and/or phone of people picked in the Find people results, right there in the
 * table, without adding them to the contact book. This is the step that spends credits (1 per email,
 * 5 per phone, only for what Lusha finds); adding people is a separate, free choice afterwards and
 * carries the revealed details with it. Refused if the account or the person's monthly cap can't
 * cover the most it could cost.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; reveal?: unknown };
  const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).filter((v): v is string => typeof v === "string" && v.trim() !== "")));
  const reveal = (Array.isArray(body.reveal) ? body.reveal : []).filter((v): v is LushaReveal => v === "emails" || v === "phones");
  if (ids.length === 0) return NextResponse.json({ error: "Choose at least one person." }, { status: 400 });
  if (reveal.length === 0) return NextResponse.json({ error: "Choose email, phone, or both to reveal." }, { status: 400 });
  if (ids.length > MAX_REVEAL) return NextResponse.json({ error: `Reveal at most ${MAX_REVEAL} people at a time.` }, { status: 400 });

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Lusha isn't connected for your workspace.", code: "not_connected" }, { status: 400 });
  }

  const estimate = estimateRevealOnly(connection.usage?.pricing, reveal, ids.length);
  const spend = await prepareSpend(ctx, estimate);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code }, { status: spend.status });

  let enriched;
  try {
    enriched = await lushaEnrichByIds(spend.apiKey, ids, reveal);
  } catch (e) {
    return lushaFailure(ctx, e);
  }

  const byId = new Map(enriched.people.filter((p) => p.id).map((p) => [p.id as string, p]));
  const total = enriched.billing.creditsCharged;
  const shares = splitCredits(total, ids.length);
  const revealed: Record<string, RevealedPerson> = {};

  for (const [index, id] of ids.entries()) {
    const person = byId.get(id) ?? null;
    const failed = !person || !!person.error;
    const emails = failed ? [] : person.emails.map((e) => e.email).filter(Boolean);
    const phones = failed ? [] : person.phones.map((ph) => ph.number).filter(Boolean);
    const got = emails.length > 0 || phones.length > 0;
    const status: RevealedPerson["status"] = failed ? "not_found" : got ? "found" : "partial";
    revealed[id] = { emails, phones, status };
    // Stored against no contact yet: adding the person later fills the card from what is shown here
    // instead of paying for it again, and the log keeps who spent what for the monthly cap.
    await logEnrichment(ctx.svc, {
      ownerId: ctx.mailboxOwnerId,
      userId: ctx.userId,
      contactId: null,
      kind: "reveal",
      outcome: status === "found" ? "found" : status === "partial" ? "partial" : "not_found",
      creditsCharged: shares[index],
      revealed: failed ? null : { person, basis: "prospect", reveal },
    });
  }

  return NextResponse.json({ revealed, creditsCharged: total, outOfCredits: enriched.outOfCredits });
}
