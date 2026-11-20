import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { kickWorkflows } from "@/lib/data-model/events";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/**
 * POST /api/workflows/runs/[runId]/retry  { from: "start" | "failed" }
 * Runs a failed or cancelled run again on the SAME version it began with, as a new attempt on the
 * same run: from the first block, or from the block that failed.
 */
export async function POST(request: Request, props: { params: Promise<{ runId: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { runId } = await props.params;
  if (!isId(runId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { from?: unknown } | null;
  const from = body?.from === "failed" ? "failed" : "start";

  const { data: run } = await svc.from("workflow_runs").select("id, workflow_id, status, cursor, context, attempt_no").eq("org_owner_id", orgOwnerId).eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (run.status !== "failed" && run.status !== "cancelled") return NextResponse.json({ error: "Only a failed or cancelled run can be retried." }, { status: 400 });
  const { data: wf } = await svc.from("workflows").select("deleted_at").eq("id", run.workflow_id).maybeSingle();
  if (!wf || wf.deleted_at) return NextResponse.json({ error: "This workflow was deleted." }, { status: 400 });

  const context = (run.context as Record<string, unknown>) ?? {};
  const keepTrigger = { trigger: (context.trigger as Record<string, unknown>) ?? {} };
  const failedKey = (run.cursor as { blockKey?: string | null })?.blockKey;
  if (from === "failed" && !failedKey) return NextResponse.json({ error: "There is no failed block to resume from. Retry from the start." }, { status: 400 });

  const { error } = await svc
    .from("workflow_runs")
    .update({
      status: "queued",
      attempt_no: (run.attempt_no as number) + 1,
      cursor: from === "failed" ? { blockKey: failedKey, steps: (run.cursor as { steps?: number })?.steps ?? 0, tries: 0 } : {},
      // From the failed block, what earlier blocks produced is kept; from the start it is not.
      context: from === "failed" ? context : keepTrigger,
      error: null,
      outcome: null,
      finished_at: null,
      next_run_at: new Date().toISOString(),
      claimed_at: null,
      claim_token: null,
    })
    .eq("id", runId);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  kickWorkflows(orgOwnerId);
  return NextResponse.json({ ok: true });
}
