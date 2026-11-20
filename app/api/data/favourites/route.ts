import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectAccess, requireDataContext } from "@/lib/data-model/access";
import { isUuid, loadList } from "@/lib/data-model/lists";
import { getRecord, loadObjectById } from "@/lib/data-model/records";

export const runtime = "nodejs";

/** GET /api/data/favourites — the caller's starred records and lists, with names. Anything they can no longer see is left out. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const { data, error } = await svc.from("data_favourites").select("kind, ref_id, created_at").eq("org_owner_id", orgOwnerId).eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  const items = await Promise.all(
    (data ?? []).map(async (f) => {
      if (f.kind === "record") {
        const rec = await getRecord(svc, orgOwnerId, f.ref_id as string);
        const obj = rec ? await loadObjectById(svc, orgOwnerId, rec.object_id) : null;
        if (!rec || !obj || objectAccess(auth.ctx, obj) === "none") return null;
        return { kind: "record" as const, id: rec.id, name: rec.name || "Unnamed", object: obj.slug };
      }
      const list = await loadList(svc, orgOwnerId, f.ref_id as string);
      const obj = list ? await loadObjectById(svc, orgOwnerId, list.object_id) : null;
      if (!list || !obj || objectAccess(auth.ctx, obj) === "none") return null;
      return { kind: "list" as const, id: list.id, name: list.name, object: obj.slug };
    })
  );
  return NextResponse.json({ favourites: items.filter((i): i is NonNullable<typeof i> => i !== null) });
}

/** POST /api/data/favourites  { kind: "record"|"list", id, on: boolean } — star or unstar. */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { kind?: unknown; id?: unknown; on?: unknown } | null;
  if (!body || (body.kind !== "record" && body.kind !== "list") || !isUuid(body.id)) return NextResponse.json({ error: "kind and id are required." }, { status: 400 });

  if (body.on === false) {
    const { error } = await svc.from("data_favourites").delete().eq("org_owner_id", orgOwnerId).eq("user_id", userId).eq("kind", body.kind).eq("ref_id", body.id);
    if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
    return NextResponse.json({ ok: true, on: false });
  }

  // Only things this person can see (and that belong to their org) can be starred.
  const ok = body.kind === "record" ? !!(await getRecord(svc, orgOwnerId, body.id)) : !!(await loadList(svc, orgOwnerId, body.id));
  if (!ok) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { error } = await svc.from("data_favourites").upsert({ org_owner_id: orgOwnerId, user_id: userId, kind: body.kind, ref_id: body.id }, { onConflict: "user_id,kind,ref_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true, on: true });
}
