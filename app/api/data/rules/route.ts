import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { isUuid, loadList, loadStage } from "@/lib/data-model/lists";
import { loadObject } from "@/lib/data-model/records";
import { sanitizeRule } from "@/lib/data-model/rules";

export const runtime = "nodejs";

const COLUMNS = "id, kind, object_id, list_id, stage_id, name, condition, requirements, active, created_at";
const MAX_RULES = 50;

/** GET /api/data/rules?object=deals  or  ?list=<id> — the rules on an object's records, or on a list's stages. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const params = new URL(request.url).searchParams;

  let q = svc.from("data_validation_rules").select(COLUMNS).eq("org_owner_id", orgOwnerId).order("created_at", { ascending: true });
  if (params.get("list")) {
    if (!isUuid(params.get("list"))) return NextResponse.json({ error: "Not found." }, { status: 404 });
    q = q.eq("kind", "stage").eq("list_id", params.get("list")!);
  } else {
    const object = await loadObject(svc, orgOwnerId, params.get("object") ?? "");
    if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
    const denied = objectDenied(auth.ctx, object, "read");
    if (denied) return denied;
    q = q.eq("kind", "record").eq("object_id", object.id);
  }
  const { data, error } = await q;
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

/**
 * POST /api/data/rules  (admin)
 *   record rule: { kind: "record", object, name, condition?, requirements: [{ attribute, kind }] }
 *   stage rule:  { kind: "stage", listId, stageId, name, requirements }
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || !name || name.length > 100) return NextResponse.json({ error: "Give the rule a name of up to 100 characters." }, { status: 400 });
  const shape = sanitizeRule(body);
  if (!shape.ok) return NextResponse.json({ error: shape.error }, { status: 400 });

  const { count } = await svc.from("data_validation_rules").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId);
  if ((count ?? 0) >= MAX_RULES) return NextResponse.json({ error: `You can have up to ${MAX_RULES} rules.` }, { status: 400 });

  let row: Record<string, unknown>;
  if (body.kind === "stage") {
    if (!isUuid(body.listId) || !isUuid(body.stageId)) return NextResponse.json({ error: "Choose a list and a stage." }, { status: 400 });
    const list = await loadList(svc, orgOwnerId, body.listId);
    const stage = list ? await loadStage(svc, orgOwnerId, list.id, body.stageId) : null;
    if (!list || !stage) return NextResponse.json({ error: "Unknown stage." }, { status: 404 });
    // A stage rule has no condition: entering the stage is the condition.
    row = { kind: "stage", object_id: list.object_id, list_id: list.id, stage_id: stage.id, condition: null };
  } else if (body.kind === "record") {
    const object = typeof body.object === "string" ? await loadObject(svc, orgOwnerId, body.object) : null;
    if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
    row = { kind: "record", object_id: object.id, condition: shape.condition };
  } else return NextResponse.json({ error: 'kind must be "record" or "stage".' }, { status: 400 });

  const { data, error } = await svc
    .from("data_validation_rules")
    .insert({ ...row, org_owner_id: orgOwnerId, name, requirements: shape.requirements, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}
