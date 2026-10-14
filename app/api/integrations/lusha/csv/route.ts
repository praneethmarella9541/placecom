import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import {
  estimateCredits,
  fillBlanksOnly,
  planBulk,
  proposeUpdates,
  splitCredits,
  type EnrichableContact,
} from "@/lib/integrations/enrichment";
import { LushaError, lushaSearchAndEnrich, type LushaReveal } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_ROWS = 300;
const BATCH = 100;

type InRow = { n?: unknown; name?: unknown; firstName?: unknown; lastName?: unknown; company?: unknown; email?: unknown; phone?: unknown; linkedin?: unknown };

export type CsvRowResult = {
  n: number;
  status: "found" | "not_found" | "skipped" | "not_run";
  reason?: string;
  email?: string;
  phone?: string;
  title?: string;
  company?: string;
  location?: string;
  linkedin?: string;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");

/**
 * POST /api/integrations/lusha/csv { rows, reveal, dryRun? }
 *
 * Find emails and/or phones for the people in an uploaded list. Nothing is saved to the contact
 * book: the answers come back row by row to be downloaded as a CSV. Rows that already have what is
 * asked for, or that Lusha could not identify, are skipped before any credit is spent; the dry run
 * shows that plan and the most it can cost.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const body = (await request.json().catch(() => ({}))) as { rows?: unknown; reveal?: unknown; dryRun?: unknown };
  const input = (Array.isArray(body.rows) ? body.rows : []) as InRow[];
  const wanted = (Array.isArray(body.reveal) ? body.reveal : []).filter((v): v is LushaReveal => v === "emails" || v === "phones");
  if (input.length === 0) return NextResponse.json({ error: "The list has no rows." }, { status: 400 });
  if (input.length > MAX_ROWS) return NextResponse.json({ error: `Use at most ${MAX_ROWS} rows at a time. Split the file and run each part.` }, { status: 400 });
  if (wanted.length === 0) return NextResponse.json({ error: "Choose what to find: emails, phone numbers, or both." }, { status: 400 });

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json(
      { error: "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.", code: "not_connected" },
      { status: 400 },
    );
  }

  // Each row becomes a contact-shaped record so the same skip rules as the contact list apply.
  const contacts: EnrichableContact[] = input.map((r, i) => {
    const n = Number.isInteger(Number(r.n)) ? Number(r.n) : i;
    const name = text(r.name) || `${text(r.firstName)} ${text(r.lastName)}`.trim();
    return {
      id: String(n),
      name: name || "(no name)",
      company: text(r.company) || null,
      title: null,
      email: text(r.email) || null,
      phone: text(r.phone) || null,
      linkedin_url: text(r.linkedin) || null,
      location: null,
    };
  });

  const { skipped, groups } = planBulk(contacts, wanted, new Map());
  const jobs = Array.from(groups.values()).flat();
  const pricing = connection.usage?.pricing;
  const estimated = Array.from(groups.values()).reduce((sum, g) => sum + estimateCredits(pricing, g[0].reveal, g.length), 0);

  const plan = {
    requested: input.length,
    toLookUp: jobs.length,
    skipped: skipped.length,
    skippedSample: skipped.slice(0, 25).map((s) => ({ n: Number(s.id), name: s.name, reason: s.reason })),
    estimatedCredits: estimated,
  };
  if (body.dryRun === true) return NextResponse.json({ plan });
  if (jobs.length === 0) return NextResponse.json({ error: "Nothing to look up: every row was skipped.", plan }, { status: 422 });

  const spend = await prepareSpend(ctx, estimated);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code, plan }, { status: spend.status });

  const results = new Map<number, CsvRowResult>();
  for (const s of skipped) results.set(Number(s.id), { n: Number(s.id), status: "skipped", reason: s.reason });
  let creditsCharged = 0;
  let found = 0;
  let stopped: null | { code: string; message: string } = null;

  outer: for (const group of Array.from(groups.values())) {
    for (let i = 0; i < group.length; i += BATCH) {
      const batch = group.slice(i, i + BATCH);
      let result;
      try {
        result = await lushaSearchAndEnrich(spend.apiKey, batch.map((j) => j.identifier), batch[0].reveal);
      } catch (e) {
        if (creditsCharged === 0 && found === 0) return lushaFailure(ctx, e);
        const err = e instanceof LushaError ? e : null;
        stopped = { code: err?.code ?? "unexpected", message: err?.message ?? "Lusha stopped answering." };
        break outer;
      }
      const byRef = new Map(result.people.filter((p) => p.ref).map((p) => [p.ref as string, p]));
      const total = result.billing.creditsCharged;
      const shares = splitCredits(total, batch.length);
      creditsCharged += total;

      for (const [index, job] of batch.entries()) {
        const n = Number(job.contact.id);
        const person = byRef.get(job.contact.id) ?? null;
        const failed = !person || !!person.error;
        const got = !!person && (person.emails.length > 0 || person.phones.length > 0);
        await logEnrichment(ctx.svc, {
          ownerId: ctx.mailboxOwnerId,
          userId: ctx.userId,
          contactId: null,
          kind: "reveal",
          outcome: failed ? "not_found" : got ? "found" : "partial",
          creditsCharged: shares[index],
          revealed: null,
        });
        if (failed || !person) {
          results.set(n, { n, status: "not_found", reason: "Lusha couldn't find this person" });
          continue;
        }
        // Everything Lusha knows, never leaving out a number marked do-not-call.
        const blank = { ...job.contact, email: null, phone: null };
        const fields = new Map(fillBlanksOnly(proposeUpdates(blank, person)).map((f) => [f.field, f.proposed]));
        if (got) found += 1;
        results.set(n, {
          n,
          status: got ? "found" : "not_found",
          ...(got ? {} : { reason: "Lusha found them but has no email or phone to show" }),
          email: fields.get("email") ?? undefined,
          phone: fields.get("phone") ?? undefined,
          title: fields.get("title") ?? undefined,
          company: fields.get("company") ?? undefined,
          location: fields.get("location") ?? undefined,
          linkedin: fields.get("linkedin_url") ?? undefined,
        });
      }
      if (result.outOfCredits) {
        stopped = { code: "no_credits", message: "Lusha ran out of credits partway through." };
        break outer;
      }
    }
  }

  const all: CsvRowResult[] = contacts.map((c) => results.get(Number(c.id)) ?? { n: Number(c.id), status: "not_run", reason: "Not looked up: the run stopped before this row" });
  return NextResponse.json({ results: all, found, creditsCharged, stopped });
}
