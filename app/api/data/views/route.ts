import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { loadObject } from "@/lib/data-model/records";
import { sanitizeViewConfig } from "@/lib/data-model/view-config";

export const runtime = "nodejs";

const COLUMNS = "id, object_id, name, config, is_shared, created_by, created_at, updated_at";

/** GET /api/data/views?object=people — the shared views plus the caller's own. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const object = await loadObject(svc, orgOwnerId, new URL(request.url).searchParams.get("object") ?? "");
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "read");
  if (denied) return denied;

  const { data, error } = await svc
    .from("data_views")
    .select(COLUMNS)
    .eq("org_owner_id", orgOwnerId)
    .eq("object_id", object.id)
    .or(`is_shared.eq.true,created_by.eq.${userId}`)
    .order("is_shared", { ascending: false })
    .order("name", { ascending: true });
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ views: (data ?? []).map((v) => ({ ...v, mine: v.created_by === userId })) });
}

/** POST /api/data/views  { object, name, config, shared? } — sharing with the team is admin only. */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId, isAdmin } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { object?: unknown; name?: unknown; config?: unknown; shared?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || typeof body.object !== "string" || !name || name.length > 60) {
    return NextResponse.json({ error: "A view needs an object and a name of up to 60 characters." }, { status: 400 });
  }
  if (body.shared === true && !isAdmin) return NextResponse.json({ error: "Only an admin can share a view with the team." }, { status: 403 });

  const object = await loadObject(svc, orgOwnerId, body.object);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "read");
  if (denied) return denied;
  const config = sanitizeViewConfig(body.config);
  if (!config.ok) return NextResponse.json({ error: config.error }, { status: 400 });

  const { count } = await svc.from("data_views").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId).eq("object_id", object.id).eq("created_by", userId);
  if ((count ?? 0) >= 50) return NextResponse.json({ error: "You can keep up to 50 views per object." }, { status: 400 });

  const { data, error } = await svc
    .from("data_views")
    .insert({ org_owner_id: orgOwnerId, object_id: object.id, name, config: config.config, is_shared: body.shared === true, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "You already have a view with that name." }, { status: 409 });
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ view: { ...data, mine: true } }, { status: 201 });
}
