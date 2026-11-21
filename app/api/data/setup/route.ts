import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, requireDataContext } from "@/lib/data-model/access";
import { invalidateModelCache } from "@/lib/data-model/records";

export const runtime = "nodejs";
// The copy reads every contact of the org; give it room on a large address book.
export const maxDuration = 60;

/**
 * POST /api/data/setup  (admin only)
 *   { "action": "seed" }                          create People, Companies, Deals and their attributes
 *   { "action": "backfill", "dryRun": true }      count what copying the old contacts in would do; writes nothing
 *   { "action": "backfill", "dryRun": false }     copy them in (the old tables are never changed)
 *   { "action": "backfill_leads", "dryRun": true|false }   same, for the CRM pipeline -> a Leads list + notes
 *
 * dryRun defaults to true: leaving it out can never write anything.
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  invalidateModelCache(); // setup creates objects and fields
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; dryRun?: unknown };

  if (body.action === "seed") {
    const { error } = await svc.rpc("data_model_seed", { p_org: orgOwnerId });
    if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
    invalidateModelCache();
    return NextResponse.json({ ok: true });
  }

  if (body.action === "backfill") {
    const dryRun = body.dryRun !== false;
    const { data, error } = await svc.rpc("data_model_backfill", { p_org: orgOwnerId, p_dry_run: dryRun });
    if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
    invalidateModelCache();
    return NextResponse.json({ ok: true, result: data });
  }

  if (body.action === "backfill_leads") {
    const dryRun = body.dryRun !== false;
    const { data, error } = await svc.rpc("data_model_backfill_leads", { p_org: orgOwnerId, p_dry_run: dryRun });
    if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
    invalidateModelCache();
    return NextResponse.json({ ok: true, result: data });
  }

  return NextResponse.json({ error: 'action must be "seed", "backfill" or "backfill_leads".' }, { status: 400 });
}
