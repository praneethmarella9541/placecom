import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import {
  applyProposals,
  estimateCredits,
  fillBlanksOnly,
  planBulk,
  proposeUpdates,
  splitCredits,
  type EnrichableContact,
} from "@/lib/integrations/enrichment";
import { LushaError, lushaSearchAndEnrich, type LushaPerson, type LushaReveal } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Most contacts one request will take. Bigger lists are done in a few runs, each confirmed. */
const MAX_BULK = 300;
const BATCH = 100;

/**
 * POST /api/integrations/lusha/bulk { contactIds, reveal, dryRun? }
 *
 * Find emails and/or phones for many contacts at once. The work is cut down before any credit is
 * spent: people who already have what is being asked for are skipped, people Lusha could not
 * identify from their card are skipped with the reason, and anyone revealed earlier is filled in
 * from the stored result for free. Lusha is then asked in batches of up to 100.
 *
 * A bulk run only ever fills blanks. It never overwrites a value already on a card, and a number
 * marked do-not-call is left out; replacing something is a decision made one contact at a time.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError; // narrowed once here, so the helper below keeps the type

  const body = (await request.json().catch(() => ({}))) as { contactIds?: unknown; reveal?: unknown; dryRun?: unknown };
  const ids = Array.from(new Set((Array.isArray(body.contactIds) ? body.contactIds : []).filter((v): v is string => typeof v === "string" && !!v)));
  const wanted = (Array.isArray(body.reveal) ? body.reveal : []).filter((v): v is LushaReveal => v === "emails" || v === "phones");
  if (ids.length === 0) return NextResponse.json({ error: "Select some contacts first." }, { status: 400 });
  if (ids.length > MAX_BULK) {
    return NextResponse.json({ error: `Select at most ${MAX_BULK} contacts at a time.` }, { status: 400 });
  }
  if (wanted.length === 0) return NextResponse.json({ error: "Choose what to find: emails, phone numbers, or both." }, { status: 400 });

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json(
      { error: "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.", code: "not_connected" },
      { status: 400 },
    );
  }

  const { data: rows } = await ctx.supabase
    .from("directory_contacts")
    .select("id, name, company, title, email, phone, linkedin_url, location")
    .in("id", ids);
  const contacts = (rows ?? []) as EnrichableContact[];

  // Earlier paid-for reveals, newest first, so they are used before anything new is bought.
  const { data: priorRows } = await ctx.svc
    .from("contact_enrichments")
    .select("contact_id, revealed, created_at")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .eq("kind", "reveal")
    .in("outcome", ["found", "partial"])
    .in("contact_id", ids)
    .order("created_at", { ascending: false });
  const priorByContact = new Map<string, { person: LushaPerson }>();
  for (const r of (priorRows ?? []) as { contact_id: string; revealed: { person?: LushaPerson } | null }[]) {
    if (r.revealed?.person && !priorByContact.has(r.contact_id)) priorByContact.set(r.contact_id, { person: r.revealed.person });
  }

  const { skipped, reuse, groups } = planBulk(contacts, wanted, priorByContact);
  const jobs = Array.from(groups.values()).flat();
  for (const id of ids) {
    if (!contacts.some((c) => c.id === id)) skipped.push({ id, name: "Unknown contact", reason: "No longer in the directory" });
  }

  const pricing = connection.usage?.pricing;
  const estimated = Array.from(groups.values()).reduce((sum, g) => sum + estimateCredits(pricing, g[0].reveal, g.length), 0);

  const plan = {
    requested: ids.length,
    toLookUp: jobs.length,
    reusedFree: reuse.length,
    skipped: skipped.length,
    skippedSample: skipped.slice(0, 25),
    estimatedCredits: estimated,
  };
  if (body.dryRun === true) return NextResponse.json({ plan });

  if (jobs.length === 0 && reuse.length === 0) {
    return NextResponse.json({ error: "Nothing to look up: every selected contact was skipped.", plan }, { status: 422 });
  }

  const spend = jobs.length > 0 ? await prepareSpend(ctx, estimated) : null;
  if (spend && !spend.ok) return NextResponse.json({ error: spend.error, code: spend.code, plan }, { status: spend.status });
  const apiKey = spend && spend.ok ? spend.apiKey : "";

  const summary = {
    requested: ids.length,
    found: 0,
    notFound: 0,
    updated: 0,
    reusedFree: 0,
    creditsCharged: 0,
    skipped,
    notSaved: [] as { id: string; name: string; reason: string }[],
    stopped: null as null | { code: string; message: string },
  };

  async function save(contact: EnrichableContact, person: LushaPerson): Promise<boolean> {
    const fills = fillBlanksOnly(proposeUpdates(contact, person));
    if (fills.length === 0) return false;
    const result = await applyProposals(ctx.supabase, contact.id, ctx.userId, fills.map((f) => ({ field: f.field, value: f.proposed })));
    if (!result.ok) {
      summary.notSaved.push({ id: contact.id, name: contact.name, reason: result.error });
      return false;
    }
    return result.applied.length > 0;
  }

  for (const { contact, person } of reuse) {
    if (await save(contact, person)) {
      summary.updated += 1;
      summary.reusedFree += 1;
    }
  }

  outer: for (const group of Array.from(groups.values())) {
    for (let i = 0; i < group.length; i += BATCH) {
      const batch = group.slice(i, i + BATCH);
      let result;
      try {
        result = await lushaSearchAndEnrich(apiKey, batch.map((j) => j.identifier), batch[0].reveal);
      } catch (e) {
        if (summary.creditsCharged === 0 && summary.found === 0 && summary.updated === 0) return lushaFailure(ctx, e);
        const err = e instanceof LushaError ? e : null;
        summary.stopped = { code: err?.code ?? "unexpected", message: err?.message ?? "Lusha stopped answering." };
        break outer;
      }

      const byRef = new Map(result.people.filter((p) => p.ref).map((p) => [p.ref as string, p]));
      const total = result.billing.creditsCharged;
      const shares = splitCredits(total, batch.length);
      summary.creditsCharged += total;

      for (const [index, job] of batch.entries()) {
        const person = byRef.get(job.contact.id) ?? null;
        const failed = !person || !!person.error;
        const got = !!person && (person.emails.length > 0 || person.phones.length > 0);
        const outcome = failed ? "not_found" : got ? "found" : "partial";
        const share = shares[index];
        await logEnrichment(ctx.svc, {
          ownerId: ctx.mailboxOwnerId,
          userId: ctx.userId,
          contactId: job.contact.id,
          kind: "reveal",
          outcome,
          creditsCharged: share,
          revealed: failed ? null : { person, basis: "bulk", reveal: job.reveal },
        });
        if (failed || !person) {
          summary.notFound += 1;
          continue;
        }
        summary.found += got ? 1 : 0;
        if (await save(job.contact, person)) summary.updated += 1;
      }

      if (result.outOfCredits) {
        summary.stopped = { code: "no_credits", message: "Lusha ran out of credits partway through." };
        break outer;
      }
    }
  }

  return NextResponse.json({ summary });
}
