import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";
import { sanitizeViewConfig } from "@/lib/data-model/view-config";

export const runtime = "nodejs";

const COLUMNS = "id, object_id, name, config, is_shared, created_by, created_at, updated_at";

/** A view may be changed by its creator; a shared one by any admin. */
async function loadEditable(request: Request, id: string) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return { response: auth.response } as const;
  const { svc, orgOwnerId, userId, isAdmin } = auth.ctx;
  if (!isUuid(id)) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;

  const { data: view } = await svc.from("data_views").select(COLUMNS).eq("org_owner_id", orgOwnerId).eq("id", id).maybeSingle();
  const visible = view && (view.is_shared || view.created_by === userId);
  if (!view || !visible) return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) } as const;
  if (!(view.created_by === userId || (view.is_shared && isAdmin))) {
    return { response: NextResponse.json({ error: "Only the person who made this view, or an admin, can change it." }, { status: 403 }) } as const;
  }
  return { ctx: auth.ctx, view } as const;
}

/** PATCH /api/data/views/[id]  { name?, config?, shared? } */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await loadEditable(request, (await props.params).id);
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, isAdmin } = found.ctx;

  const body = (await request.json().catch(() => null)) as { name?: unknown; config?: unknown; shared?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return NextResponse.json({ error: "Name must be 1 to 60 characters." }, { status: 400 });
    patch.name = name;
  }
  if (body.config !== undefined) {
    const config = sanitizeViewConfig(body.config);
    if (!config.ok) return NextResponse.json({ error: config.error }, { status: 400 });
    patch.config = config.config;
  }
  if (body.shared !== undefined) {
    if (!isAdmin) return NextResponse.json({ error: "Only an admin can share a view with the team." }, { status: 403 });
    patch.is_shared = body.shared === true;
  }

  const { data, error } = await svc.from("data_views").update(patch).eq("org_owner_id", orgOwnerId).eq("id", found.view.id).select(COLUMNS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A view with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ view: { ...data, mine: data.created_by === found.ctx.userId } });
}

/** DELETE /api/data/views/[id] */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await loadEditable(request, (await props.params).id);
  if ("response" in found) return found.response;
  const { error } = await found.ctx.svc.from("data_views").delete().eq("org_owner_id", found.ctx.orgOwnerId).eq("id", found.view.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
