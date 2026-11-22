import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/** PATCH /api/data/duplicate-rules/[id] (admin) — { active?: boolean, name?: string } */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { active?: unknown; name?: unknown } | null;
  const patch: Record<string, unknown> = {};
  if (body?.active !== undefined) patch.active = body.active === true;
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return NextResponse.json({ error: "Name must be 1 to 100 characters." }, { status: 400 });
    patch.name = name;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await svc.from("data_duplicate_rules").update(patch).eq("org_owner_id", orgOwnerId).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/data/duplicate-rules/[id] (admin) */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { error } = await svc.from("data_duplicate_rules").delete().eq("org_owner_id", orgOwnerId).eq("id", id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
