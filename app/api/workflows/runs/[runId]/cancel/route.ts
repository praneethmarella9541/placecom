import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/** POST /api/workflows/runs/[runId]/cancel — stops a queued, waiting or running run. Work already done is not undone. */
export async function POST(request: Request, props: { params: Promise<{ runId: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { runId } = await props.params;
  if (!isId(runId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data, error } = await svc
    .from("workflow_runs")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), error: "Cancelled by an admin.", claimed_at: null, claim_token: null })
    .eq("org_owner_id", orgOwnerId)
    .eq("id", runId)
    .in("status", ["queued", "waiting", "running"])
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  if (!data) return NextResponse.json({ error: "That run isn't in progress." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
