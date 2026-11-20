import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { objectDenied, requireDataContext } from "@/lib/data-model/access";
import { getRecord, loadObjectById } from "@/lib/data-model/records";
import { isId } from "@/lib/data-model/route-helpers";

export const runtime = "nodejs";

const COLUMNS = "id, record_id, title, due_date, assignee_id, done_at, created_by, created_at";

async function load(request: Request, taskId: string) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return { response: auth.response } as const;
  if (!isId(taskId)) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const { data: task } = await auth.ctx.svc.from("data_tasks").select(COLUMNS).eq("org_owner_id", auth.ctx.orgOwnerId).eq("id", taskId).maybeSingle();
  if (!task) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const record = await getRecord(auth.ctx.svc, auth.ctx.orgOwnerId, task.record_id as string);
  const object = record ? await loadObjectById(auth.ctx.svc, auth.ctx.orgOwnerId, record.object_id) : null;
  if (!object) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return { response: denied } as const;
  return { ctx: auth.ctx, task } as const;
}

/** PATCH /api/data/tasks/[taskId]  { title?, dueDate?: string|null, assigneeId?: string|null, done?: boolean } */
export async function PATCH(request: Request, props: { params: Promise<{ taskId: string }> }) {
  const found = await load(request, (await props.params).taskId);
  if ("response" in found) return found.response;
  const { svc, orgOwnerId } = found.ctx;

  const body = (await request.json().catch(() => null)) as { title?: unknown; dueDate?: unknown; assigneeId?: unknown; done?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  const patch: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 300) return NextResponse.json({ error: "A task needs a title of up to 300 characters." }, { status: 400 });
    patch.title = title;
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === "") patch.due_date = null;
    else if (typeof body.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) && !Number.isNaN(Date.parse(body.dueDate))) patch.due_date = body.dueDate;
    else return NextResponse.json({ error: "Due date must look like 2026-12-31." }, { status: 400 });
  }
  if (body.assigneeId !== undefined) {
    if (body.assigneeId === null || body.assigneeId === "") patch.assignee_id = null;
    else {
      if (!isId(body.assigneeId)) return NextResponse.json({ error: "Unknown team member." }, { status: 400 });
      const { data: m } = await svc.from("profiles").select("id").eq("id", body.assigneeId).or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`).maybeSingle();
      if (!m) return NextResponse.json({ error: "That person isn't on your team." }, { status: 400 });
      patch.assignee_id = body.assigneeId;
    }
  }
  if (body.done !== undefined) patch.done_at = body.done === true ? new Date().toISOString() : null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await svc.from("data_tasks").update(patch).eq("org_owner_id", orgOwnerId).eq("id", found.task.id as string).select(COLUMNS).single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ task: data });
}

/** DELETE /api/data/tasks/[taskId] — the creator, or an admin. */
export async function DELETE(request: Request, props: { params: Promise<{ taskId: string }> }) {
  const found = await load(request, (await props.params).taskId);
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId, isAdmin } = found.ctx;
  if (!isAdmin && found.task.created_by !== userId) return NextResponse.json({ error: "Only the person who made a task, or an admin, can delete it." }, { status: 403 });
  const { error } = await svc.from("data_tasks").delete().eq("org_owner_id", orgOwnerId).eq("id", found.task.id as string);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
