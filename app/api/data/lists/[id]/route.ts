import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { listDenied } from "@/lib/data-model/route-helpers";
import { deleteForbiddenResponse } from "@/lib/delete-access";
import { ENTRY_COLUMNS, loadList, loadStages, type EntryRow } from "@/lib/data-model/lists";
import { loadAttributes } from "@/lib/data-model/records";

export const runtime = "nodejs";

/**
 * GET /api/data/lists/[id]?stage=<id|none>&page=1&pageSize=50
 * The list, its stages, its own attributes, and a page of entries with the record each points at.
 * A board loads one page per stage by passing `stage`.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "read");
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const pageSize = Math.min(Math.max(Math.trunc(Number(params.get("pageSize") ?? 50)) || 50, 1), 100);
  const page = Math.max(Math.trunc(Number(params.get("page") ?? 1)) || 1, 1);
  const stage = params.get("stage");

  let q = svc
    .from("data_list_entries")
    .select(`${ENTRY_COLUMNS}, record:data_records!inner(id, name, values, deleted_at)`, { count: "exact" })
    .eq("org_owner_id", orgOwnerId)
    .eq("list_id", list.id)
    .is("record.deleted_at", null)
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (stage === "none") q = q.is("stage_id", null);
  else if (stage) q = q.eq("stage_id", stage);

  const [stages, attributes, entries] = await Promise.all([
    loadStages(svc, orgOwnerId, list.id),
    loadAttributes(svc, orgOwnerId, list.object_id, list.id),
    q,
  ]);
  if (entries.error) return NextResponse.json({ error: dbErrorMessage(entries.error) }, { status: 500 });
  return NextResponse.json({
    list,
    stages,
    attributes,
    entries: (entries.data ?? []) as unknown as (EntryRow & { record: { id: string; name: string; values: Record<string, unknown> } })[],
    total: entries.count ?? 0,
    page,
    pageSize,
  });
}

/** PATCH /api/data/lists/[id]  { name } — rename. */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 100) return NextResponse.json({ error: "Name must be 1 to 100 characters." }, { status: 400 });
  const { error } = await svc.from("data_lists").update({ name }).eq("org_owner_id", orgOwnerId).eq("id", list.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ list: { ...list, name } });
}

/** DELETE /api/data/lists/[id] — archives the list; its entries are kept and the records are untouched. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const forbidden = await deleteForbiddenResponse();
  if (forbidden) return forbidden;
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;
  const { error } = await svc
    .from("data_lists")
    .update({ archived_at: new Date().toISOString() })
    .eq("org_owner_id", orgOwnerId)
    .eq("id", list.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
