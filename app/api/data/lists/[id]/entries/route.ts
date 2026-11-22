import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { listDenied } from "@/lib/data-model/route-helpers";
import { ENTRY_COLUMNS, isUuid, loadList, loadStage, loadStages, nextPosition } from "@/lib/data-model/lists";
import { checkStageRulesV2 } from "@/lib/data-model/rule-engine-bridge";
import { recordStageChange } from "@/lib/data-model/rules-server";
import { emitEvents } from "@/lib/data-model/events";
import { checkReferences, getRecord, loadAttributes } from "@/lib/data-model/records";
import { validateRecordInput } from "@/lib/data-model/values";

export const runtime = "nodejs";

/** POST /api/data/lists/[id]/entries  { recordId, stageId?, values? } — put a record on the list. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as
    | { recordId?: unknown; stageId?: unknown; values?: Record<string, unknown> }
    | null;
  if (!body || !isUuid(body.recordId)) return NextResponse.json({ error: "recordId is required." }, { status: 400 });

  // The record must exist in this org and be of the object this list holds.
  const record = await getRecord(svc, orgOwnerId, body.recordId);
  if (!record || record.object_id !== list.object_id) {
    return NextResponse.json({ error: "That record can't be added to this list." }, { status: 400 });
  }

  let stageId: string | null = null;
  if (list.has_stages) {
    if (body.stageId !== undefined && body.stageId !== null) {
      const stage = await loadStage(svc, orgOwnerId, list.id, String(body.stageId));
      if (!stage) return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
      stageId = stage.id;
    } else {
      stageId = (await loadStages(svc, orgOwnerId, list.id))[0]?.id ?? null;
    }
  } else if (body.stageId) {
    return NextResponse.json({ error: "This list has no stages." }, { status: 400 });
  }

  // Rules for entering this stage (a deal's value is required to enter Won, say).
  if (stageId) {
    const recordAttrs = await loadAttributes(svc, orgOwnerId, list.object_id);
    const rules = await checkStageRulesV2(svc, orgOwnerId, stageId, recordAttrs, record.values, record.name, userId);
    if (rules.errors.length) return NextResponse.json({ error: rules.errors[0], errors: rules.errors }, { status: 422 });
    if (rules.warnings.length) console.warn("[data] warn-mode stage rule(s) matched (not yet surfaced to the user — phase 6):", rules.warnings);
  }

  const listAttrs = await loadAttributes(svc, orgOwnerId, list.object_id, list.id);
  const valid = validateRecordInput(listAttrs, { values: body.values }, "update");
  if (!valid.ok) return NextResponse.json({ error: valid.errors[0], errors: valid.errors }, { status: 400 });
  const refErrors = await checkReferences(svc, orgOwnerId, listAttrs, valid.values);
  if (refErrors.length) return NextResponse.json({ error: refErrors[0], errors: refErrors }, { status: 400 });

  const { data, error } = await svc
    .from("data_list_entries")
    .insert({
      org_owner_id: orgOwnerId,
      list_id: list.id,
      record_id: record.id,
      stage_id: stageId,
      values: valid.values,
      position: await nextPosition(svc, "data_list_entries", orgOwnerId, list.id, stageId),
      added_by: userId,
    })
    .select(ENTRY_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That record is already on this list." }, { status: 409 });
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  await recordStageChange(svc, orgOwnerId, list.id, (data as { id: string }).id, null, stageId, userId);
  await emitEvents(svc, [{ org: orgOwnerId, type: "list.added", listId: list.id, entryId: (data as { id: string }).id, recordId: record.id, actor: { userId }, payload: { stage_id: stageId } }]);
  return NextResponse.json({ entry: data }, { status: 201 });
}
