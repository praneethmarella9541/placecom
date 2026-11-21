import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { deleteForbiddenResponse } from "@/lib/delete-access";
import { isId } from "@/lib/data-model/route-helpers";
import { missingWorkflowTables, requireWorkflowContext } from "@/lib/workflows/access";
import { validateGraph } from "@/lib/workflows/graph";
import { sanitizeTriggerDraft } from "@/lib/workflows/triggers";

export const runtime = "nodejs";

const COLUMNS = "id, name, description, owner_id, status, live_version_id, flagged_at, flag_reason, next_fire_at, created_at, updated_at";
const VERSION_COLUMNS = "id, version_no, is_draft, graph, trigger_type, trigger_config, published_at";

async function load(request: Request, id: string) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return { response: auth.response } as const;
  if (!isId(id)) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const { data: wf, error } = await auth.ctx.svc.from("workflows").select(COLUMNS).eq("org_owner_id", auth.ctx.orgOwnerId).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) return { response: missingWorkflowTables(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 }) } as const;
  if (!wf) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  return { ctx: auth.ctx, wf } as const;
}

/** GET /api/workflows/[id] — the workflow, its working draft, and the live version if there is one. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await load(request, (await props.params).id);
  if ("response" in found) return found.response;
  const { svc } = found.ctx;
  const [draft, live] = await Promise.all([
    svc.from("workflow_versions").select(VERSION_COLUMNS).eq("workflow_id", found.wf.id).eq("is_draft", true).maybeSingle(),
    found.wf.live_version_id ? svc.from("workflow_versions").select(VERSION_COLUMNS).eq("id", found.wf.live_version_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return NextResponse.json({ workflow: found.wf, draft: draft.data, live: live.data });
}

/**
 * PATCH /api/workflows/[id]
 *   { name?, description?, graph?, trigger? }   save the working draft (nothing live changes)
 *   { status: "live" | "off" }                   turn the published version on or off
 *   { ownerId }                                  who it acts as (an admin on this team)
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await load(request, (await props.params).id);
  if ("response" in found) return found.response;
  const { svc, orgOwnerId } = found.ctx;
  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown; graph?: unknown; trigger?: unknown; status?: unknown; ownerId?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const wfPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return NextResponse.json({ error: "Name must be 1 to 100 characters." }, { status: 400 });
    wfPatch.name = name;
  }
  if (body.description !== undefined) wfPatch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 1000) : null;

  if (body.ownerId !== undefined) {
    if (!isId(body.ownerId)) return NextResponse.json({ error: "Choose a person." }, { status: 400 });
    const { data: p } = await svc.from("profiles").select("id, role").eq("id", body.ownerId).or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`).maybeSingle();
    if (!p || p.role !== "admin") return NextResponse.json({ error: "A workflow acts as an admin, so it can only be given to one." }, { status: 400 });
    wfPatch.owner_id = body.ownerId;
  }

  if (body.status !== undefined) {
    if (body.status === "live") {
      if (!found.wf.live_version_id) return NextResponse.json({ error: "Publish the workflow first." }, { status: 400 });
      wfPatch.status = "live";
      wfPatch.flagged_at = null;
      wfPatch.flag_reason = null;
    } else if (body.status === "off") wfPatch.status = "off";
    else return NextResponse.json({ error: 'status must be "live" or "off".' }, { status: 400 });
  }

  // Draft changes: validated like a publish except that unfinished blocks are allowed.
  const draftPatch: Record<string, unknown> = {};
  if (body.graph !== undefined) {
    const g = validateGraph(body.graph, false);
    if (!g.ok) return NextResponse.json({ error: g.errors[0], errors: g.errors }, { status: 400 });
    draftPatch.graph = g.graph;
  }
  if (body.trigger !== undefined) {
    // A draft may hold an unfinished trigger; Publish checks it in full.
    const t = sanitizeTriggerDraft(body.trigger);
    if (!t.ok) return NextResponse.json({ error: t.error }, { status: 400 });
    draftPatch.trigger_type = t.trigger.type;
    draftPatch.trigger_config = t.trigger.config;
  }
  if (Object.keys(draftPatch).length) {
    const { error } = await svc.from("workflow_versions").update(draftPatch).eq("workflow_id", found.wf.id).eq("is_draft", true);
    if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }

  const { data, error } = await svc.from("workflows").update(wfPatch).eq("org_owner_id", orgOwnerId).eq("id", found.wf.id).select(COLUMNS).single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ workflow: data });
}

/** DELETE /api/workflows/[id] — removes it from the list and stops it; past runs stay readable. Behind "Allow delete". */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const forbidden = await deleteForbiddenResponse();
  if (forbidden) return forbidden;
  const found = await load(request, (await props.params).id);
  if ("response" in found) return found.response;
  const { svc, orgOwnerId } = found.ctx;
  const { error } = await svc.from("workflows").update({ deleted_at: new Date().toISOString(), status: "off", next_fire_at: null }).eq("org_owner_id", orgOwnerId).eq("id", found.wf.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  await svc.from("workflow_runs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: "The workflow was deleted." }).eq("workflow_id", found.wf.id).in("status", ["queued", "waiting"]);
  return NextResponse.json({ ok: true });
}
