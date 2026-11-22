import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { isUuid, loadList, loadStage } from "@/lib/data-model/lists";
import { loadAttributes, loadObject } from "@/lib/data-model/records";
import { isFormulaEngineEnabled } from "@/lib/data-model/rule-flags";
import { apiNameTaken, validateFormulaRule } from "@/lib/data-model/rule-formula-validate";
import { sanitizeRule } from "@/lib/data-model/rules";

export const runtime = "nodejs";

const COLUMNS =
  "id, kind, object_id, list_id, stage_id, name, condition, requirements, active, created_at, " +
  "format, api_name, description, applies_on, mode, error_location, message, expression_source, order_index, admin_bypass, version";
const LEGACY_COLUMNS = "id, kind, object_id, list_id, stage_id, name, condition, requirements, active, created_at";
const MAX_RULES = 50;

function isMissingColumn(message: string | undefined): boolean {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

/** GET /api/data/rules?object=deals  or  ?list=<id> — the rules on an object's records, or on a list's stages. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const params = new URL(request.url).searchParams;

  const scope = async (columns: string) => {
    let q = svc.from("data_validation_rules").select(columns).eq("org_owner_id", orgOwnerId).order("order_index", { ascending: true }).order("created_at", { ascending: true });
    if (params.get("list")) {
      if (!isUuid(params.get("list"))) return { notFound: true } as const;
      q = q.eq("kind", "stage").eq("list_id", params.get("list")!);
    } else {
      const object = await loadObject(svc, orgOwnerId, params.get("object") ?? "");
      if (!object) return { notFound: true } as const;
      const denied = objectDenied(auth.ctx, object, "read");
      if (denied) return { denied } as const;
      q = q.eq("kind", "record").eq("object_id", object.id);
    }
    return { result: await q } as const;
  };

  const first = await scope(COLUMNS);
  if ("notFound" in first) return NextResponse.json({ error: params.get("list") ? "Not found." : "Unknown object." }, { status: 404 });
  if ("denied" in first) return first.denied;
  if (!first.result.error) return NextResponse.json({ rules: first.result.data ?? [] });
  if (!isMissingColumn(first.result.error.message)) {
    return missingTableResponse(first.result.error.message) ?? NextResponse.json({ error: dbErrorMessage(first.result.error) }, { status: 500 });
  }

  // 0101 isn't applied yet on this database: fall back so existing rules still show.
  const fallback = await scope(LEGACY_COLUMNS);
  if ("notFound" in fallback) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if ("denied" in fallback) return fallback.denied;
  if (fallback.result.error) return missingTableResponse(fallback.result.error.message) ?? NextResponse.json({ error: dbErrorMessage(fallback.result.error) }, { status: 500 });
  return NextResponse.json({ rules: fallback.result.data ?? [] });
}

/**
 * POST /api/data/rules  (admin)
 *   legacy record rule:  { kind: "record", object, name, condition?, requirements: [{ attribute, kind }] }
 *   legacy stage rule:   { kind: "stage", listId, stageId, name, requirements }
 *   formula rule (either kind): add `format: "formula"` and, instead of condition/requirements:
 *     { apiName, description?, appliesOn?, mode?, errorLocation?, message?, expressionSource }
 *   A formula rule needs the workspace's formula-engine flag on (lib/data-model/rule-flags.ts) —
 *   with it off there is no evaluator that would ever read expression_source, so refusing to save
 *   one is better than silently saving a rule that can never fire.
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || !name || name.length > 100) return NextResponse.json({ error: "Give the rule a name of up to 100 characters." }, { status: 400 });

  const { count } = await svc.from("data_validation_rules").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId);
  if ((count ?? 0) >= MAX_RULES) return NextResponse.json({ error: `You can have up to ${MAX_RULES} rules.` }, { status: 400 });

  let scope: { kind: "record" | "stage"; object_id: string; list_id?: string; stage_id?: string };
  if (body.kind === "stage") {
    if (!isUuid(body.listId) || !isUuid(body.stageId)) return NextResponse.json({ error: "Choose a list and a stage." }, { status: 400 });
    const list = await loadList(svc, orgOwnerId, body.listId);
    const stage = list ? await loadStage(svc, orgOwnerId, list.id, body.stageId) : null;
    if (!list || !stage) return NextResponse.json({ error: "Unknown stage." }, { status: 404 });
    scope = { kind: "stage", object_id: list.object_id, list_id: list.id, stage_id: stage.id };
  } else if (body.kind === "record") {
    const object = typeof body.object === "string" ? await loadObject(svc, orgOwnerId, body.object) : null;
    if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
    scope = { kind: "record", object_id: object.id };
  } else {
    return NextResponse.json({ error: 'kind must be "record" or "stage".' }, { status: 400 });
  }

  let row: Record<string, unknown>;
  if (body.format === "formula") {
    if (!(await isFormulaEngineEnabled(svc, orgOwnerId))) {
      return NextResponse.json({ error: "Formula rules aren't turned on for this workspace yet." }, { status: 403 });
    }
    const attrs = await loadAttributes(svc, orgOwnerId, scope.object_id);
    const validated = await validateFormulaRule(svc, orgOwnerId, attrs, body);
    if (!validated.ok) return NextResponse.json({ error: validated.error, pos: validated.pos }, { status: 400 });
    if (await apiNameTaken(svc, orgOwnerId, scope.object_id, validated.row.api_name)) {
      return NextResponse.json({ error: `"${validated.row.api_name}" is already used by another rule on this object.` }, { status: 409 });
    }
    row = { ...scope, condition: scope.kind === "stage" ? null : null, requirements: [], admin_bypass: body.adminBypass === true, ...validated.row };
  } else {
    const shape = sanitizeRule(body);
    if (!shape.ok) return NextResponse.json({ error: shape.error }, { status: 400 });
    row = { ...scope, condition: scope.kind === "stage" ? null : shape.condition, requirements: shape.requirements, admin_bypass: body.adminBypass === true };
  }

  const { data, error } = await svc
    .from("data_validation_rules")
    .insert({ ...row, org_owner_id: orgOwnerId, name, created_by: userId, updated_by: userId })
    .select(COLUMNS)
    .single();
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}
