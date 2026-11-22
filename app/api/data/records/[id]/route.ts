import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { objectDenied, requireDataContext } from "@/lib/data-model/access";
import { deleteForbiddenResponse } from "@/lib/delete-access";
import { deleteRecord, getRecord, loadAttributes, loadObjectById, updateRecord } from "@/lib/data-model/records";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(request: Request, id: string, need: "read" | "write") {
  const auth = await requireDataContext(request, need);
  if (!auth.ok) return { response: auth.response } as const;
  if (!UUID.test(id)) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const { svc, orgOwnerId } = auth.ctx;
  const record = await getRecord(svc, orgOwnerId, id);
  const object = record ? await loadObjectById(svc, orgOwnerId, record.object_id) : null;
  if (!record || !object) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  const denied = objectDenied(auth.ctx, object, need);
  if (denied) return { response: denied } as const;
  return { ctx: auth.ctx, record, object } as const;
}

/** GET /api/data/records/[id] — one record with its object's attributes. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await load(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const attributes = await loadAttributes(found.ctx.svc, found.ctx.orgOwnerId, found.object.id);
  return NextResponse.json({ record: found.record, object: found.object, attributes });
}

/** PATCH /api/data/records/[id]  { name?, values? } — a null or blank value clears that field. */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await load(request, (await props.params).id, "write");
  if ("response" in found) return found.response;
  const body = (await request.json().catch(() => null)) as { name?: unknown; values?: Record<string, unknown> } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { svc, orgOwnerId, userId } = found.ctx;
  const attrs = await loadAttributes(svc, orgOwnerId, found.object.id);
  const result = await updateRecord(svc, { userId, org: orgOwnerId }, found.object, attrs, found.record, {
    name: body.name,
    values: body.values,
  });
  if (!result.ok) {
    if (result.status >= 500) return NextResponse.json({ error: dbErrorMessage({ message: result.error }) }, { status: 500 });
    return NextResponse.json({ error: result.error, errors: result.errors, existingId: result.existingId }, { status: result.status });
  }
  return NextResponse.json({ record: result.record, duplicates: result.duplicates });
}

/** DELETE /api/data/records/[id] — soft delete. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  // Deleting a record removes it for everyone, so it stays behind the /configs "Allow delete" switch.
  const forbidden = await deleteForbiddenResponse();
  if (forbidden) return forbidden;
  const found = await load(request, (await props.params).id, "write");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;
  const result = await deleteRecord(svc, { userId, org: orgOwnerId }, found.object, found.record);
  if (!result.ok) {
    if (result.status >= 500) return NextResponse.json({ error: dbErrorMessage({ message: result.error }) }, { status: 500 });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
