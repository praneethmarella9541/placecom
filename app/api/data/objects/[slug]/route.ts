import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { invalidateModelCache, loadAttributes, loadObject } from "@/lib/data-model/records";
import { deleteForbiddenResponse } from "@/lib/delete-access";

export const runtime = "nodejs";

/** PATCH /api/data/objects/[slug] (admin) { singularName?, pluralName?, staffAccess?: "none"|"read"|"write" } — the labels and who on staff may use it; the slug never changes. */
export async function PATCH(request: Request, props: { params: Promise<{ slug: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const object = await loadObject(svc, orgOwnerId, (await props.params).slug);
  if (!object) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { singularName?: unknown; pluralName?: unknown; staffAccess?: unknown; highlights?: unknown } | null;
  const patch: Record<string, string | string[]> = {};
  if (body?.highlights !== undefined) {
    const list = Array.isArray(body.highlights) ? body.highlights : null;
    if (!list || list.length > 6 || list.some((h) => typeof h !== "string")) return NextResponse.json({ error: "Pick up to six fields to highlight." }, { status: 400 });
    const known = new Set((await loadAttributes(svc, orgOwnerId, object.id)).filter((a) => !a.archived_at).map((a) => a.slug));
    const slugs = [...new Set(list as string[])];
    if (slugs.some((x) => !known.has(x))) return NextResponse.json({ error: "One of those fields doesn't exist." }, { status: 400 });
    patch.highlights = slugs;
  }
  if (body?.staffAccess !== undefined) {
    if (body.staffAccess !== "none" && body.staffAccess !== "read" && body.staffAccess !== "write") return NextResponse.json({ error: "Staff access must be none, read or write." }, { status: 400 });
    patch.staff_access = body.staffAccess;
  }
  for (const [key, column] of [["singularName", "singular_name"], ["pluralName", "plural_name"]] as const) {
    if (body?.[key] === undefined) continue;
    const v = typeof body[key] === "string" ? (body[key] as string).trim() : "";
    if (!v || v.length > 40) return NextResponse.json({ error: "Names must be 1 to 40 characters." }, { status: 400 });
    patch[column] = v;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { error } = await svc.from("data_objects").update(patch).eq("org_owner_id", orgOwnerId).eq("id", object.id);
  if (error && /staff_access|highlights/.test(error.message)) return NextResponse.json({ error: "Apply the latest data model migrations to use this setting." }, { status: 503 });
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  invalidateModelCache();
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/data/objects/[slug] (admin) — removes a custom object, but only an empty one: no
 * records (deleted ones included, so nothing is orphaned) and no lists. Built-in objects can't be
 * deleted. Behind the /configs "Allow delete" switch. Its fields, views and rules go with it.
 */
export async function DELETE(request: Request, props: { params: Promise<{ slug: string }> }) {
  const forbidden = await deleteForbiddenResponse();
  if (forbidden) return forbidden;
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const object = await loadObject(svc, orgOwnerId, (await props.params).slug);
  if (!object) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (object.is_system) return NextResponse.json({ error: "Built-in objects can't be deleted." }, { status: 400 });

  const [records, lists, links] = await Promise.all([
    svc.from("data_records").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId).eq("object_id", object.id).is("deleted_at", null),
    svc.from("data_lists").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId).eq("object_id", object.id).is("archived_at", null),
    svc.from("data_attributes").select("id, config").eq("org_owner_id", orgOwnerId).eq("type", "record_ref").is("archived_at", null),
  ]);
  if ((records.count ?? 0) > 0) return NextResponse.json({ error: `This object still has ${records.count} records. Delete them first.` }, { status: 409 });
  if ((lists.count ?? 0) > 0) return NextResponse.json({ error: `This object still has ${lists.count} lists. Archive them first.` }, { status: 409 });
  if ((links.data ?? []).some((a) => (a.config as { target_object?: string } | null)?.target_object === object.slug)) {
    return NextResponse.json({ error: "Another object has a link field pointing here. Hide that field first." }, { status: 409 });
  }

  // Soft-deleted records still reference the object; clear them so the object can go.
  await svc.from("data_records").delete().eq("org_owner_id", orgOwnerId).eq("object_id", object.id);
  const { error } = await svc.from("data_objects").delete().eq("org_owner_id", orgOwnerId).eq("id", object.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  invalidateModelCache();
  return NextResponse.json({ ok: true });
}
