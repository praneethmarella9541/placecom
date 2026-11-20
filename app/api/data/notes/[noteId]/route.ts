import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { objectDenied, requireDataContext } from "@/lib/data-model/access";
import { getRecord, loadObjectById } from "@/lib/data-model/records";
import { isId } from "@/lib/data-model/route-helpers";

export const runtime = "nodejs";

/** DELETE /api/data/notes/[noteId] — the author, or an admin. */
export async function DELETE(request: Request, props: { params: Promise<{ noteId: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId, isAdmin } = auth.ctx;
  const { noteId } = await props.params;
  if (!isId(noteId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: note } = await svc.from("data_notes").select("id, record_id, created_by").eq("org_owner_id", orgOwnerId).eq("id", noteId).maybeSingle();
  if (!note) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const record = await getRecord(svc, orgOwnerId, note.record_id as string);
  const object = record ? await loadObjectById(svc, orgOwnerId, record.object_id) : null;
  if (!object) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return denied;
  if (!isAdmin && note.created_by !== userId) return NextResponse.json({ error: "Only the author or an admin can delete a note." }, { status: 403 });

  const { error } = await svc.from("data_notes").delete().eq("org_owner_id", orgOwnerId).eq("id", noteId);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
