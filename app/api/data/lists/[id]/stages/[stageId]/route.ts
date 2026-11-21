import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { listDenied } from "@/lib/data-model/route-helpers";
import { loadList, loadStage, STAGE_COLUMNS } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/**
 * PATCH /api/data/lists/[id]/stages/[stageId]  { name?, color?, targetDays?: number|null, isClosed? }
 * `targetDays` is how long a card may sit here before the board flags it as late.
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; stageId: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id, stageId } = await props.params;

  const list = await loadList(svc, orgOwnerId, id);
  const stage = list ? await loadStage(svc, orgOwnerId, list.id, stageId) : null;
  if (!list || !stage) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown; targetDays?: unknown; isClosed?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return NextResponse.json({ error: "Name must be 1 to 60 characters." }, { status: 400 });
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (body.color === null || body.color === "") patch.color = null;
    else if (typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color)) patch.color = body.color;
    else return NextResponse.json({ error: "Colour must look like #1a2b3c." }, { status: 400 });
  }
  if (body.targetDays !== undefined) {
    if (body.targetDays === null || body.targetDays === "") patch.target_days = null;
    else {
      const n = Number(body.targetDays);
      if (!Number.isInteger(n) || n < 1 || n > 3650) return NextResponse.json({ error: "Target must be a whole number of days from 1 to 3650." }, { status: 400 });
      patch.target_days = n;
    }
  }
  if (body.isClosed !== undefined) patch.is_closed = body.isClosed === true;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await svc.from("data_list_stages").update(patch).eq("org_owner_id", orgOwnerId).eq("id", stage.id).select(STAGE_COLUMNS).single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This list already has a stage with that name." }, { status: 409 });
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ stage: data });
}
