import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId } from "@/lib/data-model/route-helpers";
import { missingWorkflowTables, requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/** GET /api/workflows/notifications — the signed-in person's notifications from workflows, newest first. */
export async function GET(request: Request) {
  const auth = await requireWorkflowContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const { data, error } = await svc.from("workflow_notifications").select("id, title, body, link, read_at, created_at").eq("org_owner_id", orgOwnerId).eq("user_id", userId).order("created_at", { ascending: false }).limit(50);
  if (error) return missingWorkflowTables(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [], unread: (data ?? []).filter((n) => !n.read_at).length });
}

/** POST /api/workflows/notifications  { id } or { all: true } — mark as read. */
export async function POST(request: Request) {
  const auth = await requireWorkflowContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const body = (await request.json().catch(() => null)) as { id?: unknown; all?: unknown } | null;
  let q = svc.from("workflow_notifications").update({ read_at: new Date().toISOString() }).eq("org_owner_id", orgOwnerId).eq("user_id", userId).is("read_at", null);
  if (body?.all !== true) {
    if (!isId(body?.id)) return NextResponse.json({ error: "id or all is required." }, { status: 400 });
    q = q.eq("id", body.id as string);
  }
  const { error } = await q;
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
