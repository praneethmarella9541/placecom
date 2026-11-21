import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { listDenied } from "@/lib/data-model/route-helpers";
import { loadList, nextPosition, STAGE_COLUMNS } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/** POST /api/data/lists/[id]/stages  { name, color?, isClosed? } — appended after the last stage. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;
  if (!list.has_stages) return NextResponse.json({ error: "This list has no stages." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { name?: unknown; color?: unknown; isClosed?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 60) return NextResponse.json({ error: "Name must be 1 to 60 characters." }, { status: 400 });
  const color = typeof body?.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null;

  const { data, error } = await svc
    .from("data_list_stages")
    .insert({
      org_owner_id: orgOwnerId,
      list_id: list.id,
      name,
      color,
      is_closed: body?.isClosed === true,
      position: await nextPosition(svc, "data_list_stages", orgOwnerId, list.id),
    })
    .select(STAGE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This list already has a stage with that name." }, { status: 409 });
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ stage: data }, { status: 201 });
}
