import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { updateAttribute } from "@/lib/data-model/attributes";
import { loadList } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/** PATCH /api/data/lists/[id]/attributes/[attrSlug] (admin) — { name?, archived? } */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; attrSlug: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id, attrSlug } = await props.params;

  const list = await loadList(svc, orgOwnerId, id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const result = await updateAttribute(svc, orgOwnerId, list.object_id, list.id, attrSlug, await request.json().catch(() => null));
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
