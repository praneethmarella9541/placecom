import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";
import { validateGraph } from "@/lib/workflows/graph";
import { referenceProblems } from "@/lib/workflows/references";
import { nextFireAt, type ScheduleConfig } from "@/lib/workflows/schedule";
import { sanitizeTrigger } from "@/lib/workflows/triggers";

export const runtime = "nodejs";

/**
 * POST /api/workflows/[id]/publish
 * Checks the working draft in full (a trigger, a connected path, every block complete, everything it
 * names still exists), saves it as the next numbered version, and makes that the live one. Runs
 * already in progress finish on the version they began with.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const { id } = await props.params;
  if (!isId(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: wf } = await svc.from("workflows").select("id, owner_id, status").eq("org_owner_id", orgOwnerId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (!wf) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: draft } = await svc.from("workflow_versions").select("graph, trigger_type, trigger_config").eq("workflow_id", id).eq("is_draft", true).maybeSingle();
  if (!draft) return NextResponse.json({ error: "There is no draft to publish." }, { status: 400 });

  const errors: string[] = [];
  const trigger = sanitizeTrigger({ type: draft.trigger_type, config: draft.trigger_config });
  if (!trigger.ok) errors.push(trigger.error);
  else if (!trigger.trigger.type) errors.push("Choose what starts the workflow.");
  const graph = validateGraph(draft.graph, true);
  if (!graph.ok) errors.push(...graph.errors);
  if (!wf.owner_id) errors.push("The workflow has no owner.");
  if (errors.length || !trigger.ok || !graph.ok) return NextResponse.json({ error: errors[0], errors }, { status: 400 });

  const refs = await referenceProblems(svc, orgOwnerId, trigger.trigger, graph.graph);
  if (refs.length) return NextResponse.json({ error: refs[0], errors: refs }, { status: 400 });

  const { data: last } = await svc.from("workflow_versions").select("version_no").eq("workflow_id", id).eq("is_draft", false).order("version_no", { ascending: false }).limit(1).maybeSingle();
  const versionNo = ((last?.version_no as number | undefined) ?? 0) + 1;
  const now = new Date().toISOString();
  const { data: version, error } = await svc
    .from("workflow_versions")
    .insert({ org_owner_id: orgOwnerId, workflow_id: id, version_no: versionNo, is_draft: false, graph: graph.graph, trigger_type: trigger.trigger.type, trigger_config: trigger.trigger.config, published_by: userId, published_at: now })
    .select("id, version_no")
    .single();
  if (error || !version) return NextResponse.json({ error: dbErrorMessage(error ?? { message: "insert failed" }) }, { status: 500 });

  const next = trigger.trigger.type === "schedule" ? nextFireAt(trigger.trigger.config as unknown as ScheduleConfig, new Date()).toISOString() : null;
  const { error: upErr } = await svc.from("workflows").update({ live_version_id: version.id, status: "live", next_fire_at: next, flagged_at: null, flag_reason: null, updated_at: now }).eq("id", id);
  if (upErr) return NextResponse.json({ error: dbErrorMessage(upErr) }, { status: 500 });
  return NextResponse.json({ ok: true, version: version.version_no });
}
