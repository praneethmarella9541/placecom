import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingWorkflowTables, requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

const COLUMNS = "id, name, description, owner_id, status, live_version_id, flagged_at, flag_reason, created_at, updated_at";

/** GET /api/workflows — every workflow with its trigger, state, and how its last runs went. */
export async function GET(request: Request) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const { data, error } = await svc.from("workflows").select(COLUMNS).eq("org_owner_id", orgOwnerId).is("deleted_at", null).order("created_at", { ascending: false });
  if (error) return missingWorkflowTables(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  const ids = (data ?? []).map((w) => w.id as string);
  if (!ids.length) return NextResponse.json({ workflows: [] });

  const [versions, runs] = await Promise.all([
    svc.from("workflow_versions").select("workflow_id, is_draft, version_no, trigger_type, published_at").in("workflow_id", ids),
    svc.from("workflow_runs").select("workflow_id, status, created_at").in("workflow_id", ids).gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(5000),
  ]);

  const draft = new Map<string, { trigger_type: string | null }>();
  const live = new Map<string, number>();
  for (const v of versions.data ?? []) {
    if (v.is_draft) draft.set(v.workflow_id as string, { trigger_type: v.trigger_type as string | null });
    else live.set(`${v.workflow_id}:${v.version_no}`, v.version_no as number);
  }
  const stats = new Map<string, { last: string | null; week: number; failed: number }>();
  for (const r of runs.data ?? []) {
    const s = stats.get(r.workflow_id as string) ?? { last: null, week: 0, failed: 0 };
    s.last ??= r.status as string;
    s.week++;
    if (r.status === "failed") s.failed++;
    stats.set(r.workflow_id as string, s);
  }
  return NextResponse.json({
    workflows: (data ?? []).map((w) => ({ ...w, trigger_type: draft.get(w.id as string)?.trigger_type ?? null, last_run_status: stats.get(w.id as string)?.last ?? null, runs_7d: stats.get(w.id as string)?.week ?? 0, failed_7d: stats.get(w.id as string)?.failed ?? 0, published: !!w.live_version_id })),
  });
}

/** POST /api/workflows  { name } — a new workflow with an empty draft, owned by you. */
export async function POST(request: Request) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return NextResponse.json({ error: "Give the workflow a name of up to 100 characters." }, { status: 400 });

  const { count } = await svc.from("workflows").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId).is("deleted_at", null);
  if ((count ?? 0) >= 100) return NextResponse.json({ error: "You can have up to 100 workflows." }, { status: 400 });

  const { data: wf, error } = await svc.from("workflows").insert({ org_owner_id: orgOwnerId, name, owner_id: userId, created_by: userId }).select(COLUMNS).single();
  if (error || !wf) return missingWorkflowTables(error?.message) ?? NextResponse.json({ error: dbErrorMessage(error ?? { message: "insert failed" }) }, { status: 500 });
  const { error: vErr } = await svc.from("workflow_versions").insert({ org_owner_id: orgOwnerId, workflow_id: wf.id, is_draft: true, version_no: 0 });
  if (vErr) {
    await svc.from("workflows").delete().eq("id", wf.id);
    return NextResponse.json({ error: dbErrorMessage(vErr) }, { status: 500 });
  }
  return NextResponse.json({ workflow: wf }, { status: 201 });
}
