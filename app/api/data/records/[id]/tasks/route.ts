import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId, memberNames, withRecord } from "@/lib/data-model/route-helpers";

export const runtime = "nodejs";

const COLUMNS = "id, title, due_date, assignee_id, done_at, created_by, created_at";

/** GET /api/data/records/[id]/tasks — open tasks first (soonest due), then done ones. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId } = found.ctx;

  const { data, error } = await svc.from("data_tasks").select(COLUMNS).eq("org_owner_id", orgOwnerId).eq("record_id", found.record.id).limit(300);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  const names = await memberNames(svc, (data ?? []).map((t) => t.assignee_id as string | null));
  const rows = (data ?? [])
    .map((t) => ({ ...t, assignee_name: t.assignee_id ? (names.get(t.assignee_id as string) ?? "A teammate") : null }))
    .sort((a, b) => {
      if (!!a.done_at !== !!b.done_at) return a.done_at ? 1 : -1;
      if (a.due_date && b.due_date) return String(a.due_date).localeCompare(String(b.due_date));
      if (a.due_date || b.due_date) return a.due_date ? -1 : 1;
      return String(b.created_at).localeCompare(String(a.created_at));
    });
  return NextResponse.json({ tasks: rows });
}

/** POST /api/data/records/[id]/tasks  { title, dueDate?: "YYYY-MM-DD", assigneeId? } */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "write");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;

  const body = (await request.json().catch(() => null)) as { title?: unknown; dueDate?: unknown; assigneeId?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 300) return NextResponse.json({ error: "A task needs a title of up to 300 characters." }, { status: 400 });
  const due = typeof body?.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) && !Number.isNaN(Date.parse(body.dueDate)) ? body.dueDate : null;
  if (body?.dueDate && !due) return NextResponse.json({ error: "Due date must look like 2026-12-31." }, { status: 400 });

  let assignee: string | null = null;
  if (body?.assigneeId) {
    if (!isId(body.assigneeId)) return NextResponse.json({ error: "Unknown team member." }, { status: 400 });
    const { data: m } = await svc.from("profiles").select("id").eq("id", body.assigneeId).or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`).maybeSingle();
    if (!m) return NextResponse.json({ error: "That person isn't on your team." }, { status: 400 });
    assignee = body.assigneeId;
  }

  const { data, error } = await svc
    .from("data_tasks")
    .insert({ org_owner_id: orgOwnerId, record_id: found.record.id, title, due_date: due, assignee_id: assignee, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  const names = await memberNames(svc, [assignee]);
  return NextResponse.json({ task: { ...data, assignee_name: assignee ? (names.get(assignee) ?? null) : null } }, { status: 201 });
}
