import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { kickWorkflows } from "@/lib/data-model/events";
import { getRecord, loadObjectById } from "@/lib/data-model/records";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/**
 * POST /api/workflows/[id]/run  { recordId }
 * Starts the LIVE version by hand, for a workflow whose trigger is "Manual", on one record of the
 * object it names. Only this workflow runs (not every manual workflow on that object).
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const { id } = await props.params;
  if (!isId(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { recordId?: unknown } | null;
  if (!body || !isId(body.recordId)) return NextResponse.json({ error: "Choose a record." }, { status: 400 });

  const { data: wf } = await svc.from("workflows").select("id, status, live_version_id").eq("org_owner_id", orgOwnerId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!wf) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (wf.status !== "live" || !wf.live_version_id) return NextResponse.json({ error: "Publish and turn the workflow on first." }, { status: 400 });
  const { data: ver } = await svc.from("workflow_versions").select("trigger_type, trigger_config").eq("id", wf.live_version_id).maybeSingle();
  if (ver?.trigger_type !== "manual") return NextResponse.json({ error: 'Only a workflow whose trigger is "Manual" can be run by hand.' }, { status: 400 });

  const record = await getRecord(svc, orgOwnerId, body.recordId);
  const object = record ? await loadObjectById(svc, orgOwnerId, record.object_id) : null;
  if (!record || !object) return NextResponse.json({ error: "That record doesn't exist." }, { status: 404 });
  if (object.slug !== (ver.trigger_config as { object?: string }).object) return NextResponse.json({ error: `This workflow runs on ${(ver.trigger_config as { object?: string }).object}, not ${object.slug}.` }, { status: 400 });

  const { data: run, error } = await svc
    .from("workflow_runs")
    .insert({ org_owner_id: orgOwnerId, workflow_id: id, version_id: wf.live_version_id, record_id: record.id, status: "queued", context: { trigger: { event: { type: "manual", actor_kind: "user", started_by: userId } } } })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  kickWorkflows(orgOwnerId);
  return NextResponse.json({ ok: true, runId: run.id }, { status: 201 });
}
