import { NextResponse } from "next/server";

import { applyProposals, type ProposalField } from "@/lib/integrations/enrichment";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";

const FIELDS: ProposalField[] = ["email", "phone", "title", "company", "linkedin_url", "location"];

/**
 * POST /api/integrations/lusha/apply { enrichmentId, fields: [{ field, value }] }
 *
 * Save chosen values from a reveal onto the contact. Nothing is spent here: the values come from a
 * reveal already paid for, and each is checked like an ordinary edit (valid email or number, real
 * LinkedIn link, no duplicate contact).
 */
export async function POST(request: Request) {
  const ctx = await getOrgContext(request);
  if (isOrgError(ctx)) return ctx;

  const body = (await request.json().catch(() => ({}))) as { enrichmentId?: unknown; fields?: unknown };
  const enrichmentId = typeof body.enrichmentId === "string" ? body.enrichmentId : "";
  const chosen = (Array.isArray(body.fields) ? body.fields : [])
    .map((f) => f as { field?: unknown; value?: unknown })
    .filter((f): f is { field: ProposalField; value: string } => FIELDS.includes(f.field as ProposalField) && typeof f.value === "string");
  if (!enrichmentId || chosen.length === 0) {
    return NextResponse.json({ error: "Choose at least one value to save." }, { status: 400 });
  }

  const { data: row } = await ctx.svc
    .from("contact_enrichments")
    .select("id, contact_id")
    .eq("id", enrichmentId)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .maybeSingle();
  const contactId = (row as { contact_id: string | null } | null)?.contact_id;
  if (!row || !contactId) return NextResponse.json({ error: "That reveal wasn't found." }, { status: 404 });

  const result = await applyProposals(ctx.supabase, contactId, ctx.userId, chosen);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await ctx.svc.from("contact_enrichments").update({ applied_at: new Date().toISOString() }).eq("id", enrichmentId);
  return NextResponse.json({ applied: result.applied });
}
