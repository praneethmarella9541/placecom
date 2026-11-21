import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectAccess, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { DEFAULT_STAGES, LIST_COLUMNS, slugify, type ListRow } from "@/lib/data-model/lists";
import { loadObject } from "@/lib/data-model/records";

export const runtime = "nodejs";

/** GET /api/data/lists[?object=people] — the org's lists. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  let q = svc
    .from("data_lists")
    .select(`${LIST_COLUMNS}, data_objects!inner(slug)`)
    .eq("org_owner_id", orgOwnerId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  const objectSlug = new URL(request.url).searchParams.get("object");
  if (objectSlug) q = q.eq("data_objects.slug", objectSlug);
  const { data, error } = await q;
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  // A list is as open as its object: hide the ones staff can't see.
  const { data: objs } = await svc.from("data_objects").select("id, staff_access").eq("org_owner_id", orgOwnerId);
  const hidden = new Set((objs ?? []).filter((o) => objectAccess(auth.ctx, { staff_access: o.staff_access as "none" | "read" | "write" | undefined }) === "none").map((o) => o.id as string));
  return NextResponse.json({ lists: (data ?? []).filter((l) => !hidden.has(l.object_id as string)) });
}

/** POST /api/data/lists  { object: "people", name, hasStages?, stages?: string[] } */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as
    | { object?: unknown; name?: unknown; hasStages?: unknown; stages?: unknown }
    | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || typeof body.object !== "string" || !name) {
    return NextResponse.json({ error: "object and name are required." }, { status: 400 });
  }
  if (name.length > 100) return NextResponse.json({ error: "Name is longer than 100 characters." }, { status: 400 });

  const object = await loadObject(svc, orgOwnerId, body.object);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return denied;

  const hasStages = body.hasStages !== false;
  const stageNames = hasStages
    ? (Array.isArray(body.stages) && body.stages.length ? body.stages : [...DEFAULT_STAGES])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 60))
        .slice(0, 30)
    : [];
  if (new Set(stageNames.map((s) => s.toLowerCase())).size !== stageNames.length) {
    return NextResponse.json({ error: "Stage names must be different from each other." }, { status: 400 });
  }

  // Slugs are unique per org; on a clash try name_2, name_3 ...
  const base = slugify(name);
  let list: ListRow | null = null;
  for (let attempt = 1; attempt <= 20 && !list; attempt++) {
    const slug = attempt === 1 ? base : `${base.slice(0, 36)}_${attempt}`;
    const { data, error } = await svc
      .from("data_lists")
      .insert({ org_owner_id: orgOwnerId, object_id: object.id, slug, name, has_stages: hasStages, created_by: userId })
      .select(LIST_COLUMNS)
      .single();
    if (!error) list = data as ListRow;
    else if (error.code !== "23505") return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  if (!list) return NextResponse.json({ error: "Couldn't find a free name for that list." }, { status: 409 });

  if (stageNames.length) {
    const { error } = await svc.from("data_list_stages").insert(
      stageNames.map((n, i) => ({
        org_owner_id: orgOwnerId,
        list_id: list!.id,
        name: n,
        position: i + 1,
        // The last default stage is where finished work ends up.
        is_closed: !body.stages && i === stageNames.length - 1,
      }))
    );
    if (error) {
      await svc.from("data_lists").delete().eq("org_owner_id", orgOwnerId).eq("id", list.id);
      return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
    }
  }
  return NextResponse.json({ list }, { status: 201 });
}
