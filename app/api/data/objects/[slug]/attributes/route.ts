import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { createAttribute } from "@/lib/data-model/attributes";
import { loadObject } from "@/lib/data-model/records";

export const runtime = "nodejs";

/**
 * POST /api/data/objects/[slug]/attributes  (admin)
 *   { name, type, isMulti?, options?: string[], targetObject?, currency? }
 * Adds a field to an object. Existing records simply have no value for it.
 */
export async function POST(request: Request, props: { params: Promise<{ slug: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const object = await loadObject(svc, orgOwnerId, (await props.params).slug);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });

  const result = await createAttribute(svc, orgOwnerId, object.id, null, await request.json().catch(() => null));
  return result.ok
    ? NextResponse.json({ attribute: result.attribute }, { status: 201 })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
