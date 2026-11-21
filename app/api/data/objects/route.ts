import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectAccess, requireDataContext } from "@/lib/data-model/access";
import { slugify } from "@/lib/data-model/lists";
import { invalidateModelCache, loadAttributes } from "@/lib/data-model/records";
import type { ObjectDef } from "@/lib/data-model/types";

export const runtime = "nodejs";

/** GET /api/data/objects — the objects this person may see, with their fields. Empty until an admin sets the model up. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const res = await svc.from("data_objects").select("*").eq("org_owner_id", orgOwnerId).order("position", { ascending: true });
  if (res.error) return missingTableResponse(res.error.message) ?? NextResponse.json({ error: dbErrorMessage(res.error) }, { status: 500 });

  // Objects hidden from staff aren't listed at all.
  const visible = ((res.data ?? []) as unknown as ObjectDef[]).filter((o) => objectAccess(auth.ctx, o) !== "none");
  const objects = await Promise.all(
    visible.map(async (o) => ({
      ...o,
      // What this person may do here; admins also see (and set) the staff setting itself.
      access: objectAccess(auth.ctx, o),
      attributes: await loadAttributes(svc, orgOwnerId, o.id),
    }))
  );
  return NextResponse.json({ objects, canWrite: auth.ctx.canWrite, isAdmin: auth.ctx.isAdmin, userId: auth.ctx.userId });
}

const MAX_OBJECTS = 20;

/**
 * POST /api/data/objects  (admin)  { singularName, pluralName }
 * Creates a custom object, for example Colleges. It starts with just a name; add fields with
 * /api/data/objects/[slug]/attributes.
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { singularName?: unknown; pluralName?: unknown } | null;
  const singular = typeof body?.singularName === "string" ? body.singularName.trim() : "";
  const plural = typeof body?.pluralName === "string" ? body.pluralName.trim() : "";
  if (!singular || !plural || singular.length > 40 || plural.length > 40) {
    return NextResponse.json({ error: "Give a singular and a plural name of up to 40 characters, for example College and Colleges." }, { status: 400 });
  }

  const { data: existing, error: listError } = await svc.from("data_objects").select("position").eq("org_owner_id", orgOwnerId);
  if (listError) return missingTableResponse(listError.message) ?? NextResponse.json({ error: dbErrorMessage(listError) }, { status: 500 });
  if ((existing?.length ?? 0) >= MAX_OBJECTS) return NextResponse.json({ error: `You can have up to ${MAX_OBJECTS} objects.` }, { status: 400 });
  const position = Math.max(0, ...(existing ?? []).map((o) => (o.position as number) ?? 0)) + 1;

  const base = slugify(plural);
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base.slice(0, 36)}_${attempt}`;
    const { data, error } = await svc
      .from("data_objects")
      .insert({ org_owner_id: orgOwnerId, slug, singular_name: singular, plural_name: plural, is_system: false, position })
      .select("id, slug, singular_name, plural_name, is_system, position")
      .single();
    if (!error) {
      invalidateModelCache();
      return NextResponse.json({ object: { ...data, attributes: [] } }, { status: 201 });
    }
    if (error.code !== "23505") return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ error: "Couldn't find a free name for that object." }, { status: 409 });
}
