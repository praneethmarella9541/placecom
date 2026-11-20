import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { createAttribute } from "@/lib/data-model/attributes";
import { loadList } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/** POST /api/data/lists/[id]/attributes (admin) — a field on this list's entries, e.g. "Expected salary". */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const result = await createAttribute(svc, orgOwnerId, list.object_id, list.id, await request.json().catch(() => null));
  return result.ok
    ? NextResponse.json({ attribute: result.attribute }, { status: 201 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
