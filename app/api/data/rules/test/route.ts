import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid, loadList, loadStage } from "@/lib/data-model/lists";
import { loadAttributes, loadObject } from "@/lib/data-model/records";
import { testRuleAgainstValues } from "@/lib/data-model/rule-engine-bridge";
import { isFormulaEngineEnabled } from "@/lib/data-model/rule-flags";
import { validateFormulaRule } from "@/lib/data-model/rule-formula-validate";
import { sanitizeRule, type Rule } from "@/lib/data-model/rules";

export const runtime = "nodejs";

/**
 * POST /api/data/rules/test (admin) — the test panel (spec 3.12): does a rule — saved or still a
 * draft in the "new rule" form — match a made-up record? Nothing is read from or written to
 * data_validation_rules; the rule's shape comes entirely from the request body, compiled/validated
 * exactly as a real save would (so a bad formula is reported the same way here as on save).
 *
 *   { kind: "record", object, format, ...rule fields, values, name?, isNew? }
 *   { kind: "stage", listId, stageId, format, ...rule fields, values, name? }
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  let objectId: string;
  let isStageContext = false;
  if (body.kind === "stage") {
    if (!isUuid(body.listId) || !isUuid(body.stageId)) return NextResponse.json({ error: "Choose a list and a stage." }, { status: 400 });
    const list = await loadList(svc, orgOwnerId, body.listId as string);
    const stage = list ? await loadStage(svc, orgOwnerId, list.id, body.stageId as string) : null;
    if (!list || !stage) return NextResponse.json({ error: "Unknown stage." }, { status: 404 });
    objectId = list.object_id;
    isStageContext = true;
  } else if (body.kind === "record") {
    const object = typeof body.object === "string" ? await loadObject(svc, orgOwnerId, body.object) : null;
    if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
    objectId = object.id;
  } else {
    return NextResponse.json({ error: 'kind must be "record" or "stage".' }, { status: 400 });
  }

  const attrs = await loadAttributes(svc, orgOwnerId, objectId);

  let rule: Rule;
  if (body.format === "formula") {
    if (!(await isFormulaEngineEnabled(svc, orgOwnerId))) {
      return NextResponse.json({ error: "Formula rules aren't turned on for this workspace yet." }, { status: 403 });
    }
    const validated = await validateFormulaRule(svc, orgOwnerId, attrs, body);
    if (!validated.ok) return NextResponse.json({ error: validated.error, pos: validated.pos }, { status: 400 });
    rule = {
      id: "test",
      name: "Test",
      condition: null,
      requirements: [],
      format: "formula",
      appliesOn: validated.row.applies_on,
      mode: validated.row.mode,
      errorLocation: validated.row.error_location,
      message: validated.row.message,
      expressionAst: validated.row.expression_ast,
    };
  } else {
    const shape = sanitizeRule(body);
    if (!shape.ok) return NextResponse.json({ error: shape.error }, { status: 400 });
    rule = { id: "test", name: "Test", condition: isStageContext ? null : shape.condition, requirements: shape.requirements, mode: "block" };
  }

  const values = (body.values && typeof body.values === "object" ? (body.values as Record<string, unknown>) : {});
  const name = typeof body.name === "string" ? body.name : undefined;
  const isNew = body.isNew !== false;

  const result = await testRuleAgainstValues(svc, orgOwnerId, objectId, rule, values, name, isNew, isStageContext, userId);
  return NextResponse.json(result);
}
