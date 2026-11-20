import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/** GET /api/workflows/runs/[runId] — one run with every block's input, output and error, and the blocks of the version it ran. */
export async function GET(request: Request, props: { params: Promise<{ runId: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { runId } = await props.params;
  if (!isId(runId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: run } = await svc.from("workflow_runs").select("id, workflow_id, version_id, record_id, status, cursor, attempt_no, error, outcome, started_at, finished_at, created_at, next_run_at, context").eq("org_owner_id", orgOwnerId).eq("id", runId).maybeSingle();
  if (!run) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [steps, version, wf, rec] = await Promise.all([
    svc.from("workflow_run_steps").select("id, block_key, block_type, attempt, status, input, output, error, started_at, finished_at").eq("run_id", runId).order("id", { ascending: true }),
    svc.from("workflow_versions").select("version_no, graph, trigger_type, trigger_config").eq("id", run.version_id).maybeSingle(),
    svc.from("workflows").select("id, name, status, deleted_at").eq("id", run.workflow_id).maybeSingle(),
    run.record_id ? svc.from("data_records").select("id, name").eq("org_owner_id", orgOwnerId).eq("id", run.record_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (steps.error) return NextResponse.json({ error: dbErrorMessage(steps.error) }, { status: 500 });
  return NextResponse.json({ run, steps: steps.data ?? [], version: version.data, workflow: wf.data, record: rec.data });
}
