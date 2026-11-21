import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { updateAttribute } from "@/lib/data-model/attributes";
import { loadObject } from "@/lib/data-model/records";

export const runtime = "nodejs";

/**
 * PATCH /api/data/objects/[slug]/attributes/[attrSlug]  (admin)
 *   { name?, archived?: boolean }
 * Renames a field or hides it. Archiving keeps every stored value, so un-archiving brings it back.
 * Built-in fields can't be changed: screens refer to them by name.
 */
export async function PATCH(request: Request, props: { params: Promise<{ slug: string; attrSlug: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { slug, attrSlug } = await props.params;

  const object = await loadObject(svc, orgOwnerId, slug);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });

  const result = await updateAttribute(svc, orgOwnerId, object.id, null, attrSlug, await request.json().catch(() => null));
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: result.status });
}
