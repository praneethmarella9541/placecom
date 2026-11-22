import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { listDenied } from "@/lib/data-model/route-helpers";
import { ENTRY_COLUMNS, isUuid, loadList, loadStage, nextPosition, type EntryRow } from "@/lib/data-model/lists";
import { checkStageRulesV2 } from "@/lib/data-model/rule-engine-bridge";
import { recordStageChange } from "@/lib/data-model/rules-server";
import { emitEvents } from "@/lib/data-model/events";
import { checkReferences, getRecord, loadAttributes } from "@/lib/data-model/records";
import { validateRecordInput } from "@/lib/data-model/values";

export const runtime = "nodejs";

async function loadEntry(svc: import("@supabase/supabase-js").SupabaseClient, org: string, listId: string, entryId: string) {
  if (!isUuid(entryId)) return null;
  const { data } = await svc
    .from("data_list_entries")
    .select(ENTRY_COLUMNS)
    .eq("org_owner_id", org)
    .eq("list_id", listId)
    .eq("id", entryId)
    .maybeSingle();
  return (data as EntryRow | null) ?? null;
}

/**
 * PATCH /api/data/lists/[id]/entries/[entryId]  { stageId?, position?, values? }
 * Moving to another stage records when it happened. With no `position`, the entry goes to the
 * bottom of the stage it lands in.
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; entryId: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id, entryId } = await props.params;

  const list = await loadList(svc, orgOwnerId, id);
  const entry = list ? await loadEntry(svc, orgOwnerId, list.id, entryId) : null;
  if (!list || !entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as
    | { stageId?: unknown; position?: unknown; values?: Record<string, unknown> }
    | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.stageId !== undefined) {
    if (!list.has_stages) return NextResponse.json({ error: "This list has no stages." }, { status: 400 });
    const stage = await loadStage(svc, orgOwnerId, list.id, String(body.stageId));
    if (!stage) return NextResponse.json({ error: "Unknown stage." }, { status: 400 });
    if (stage.id !== entry.stage_id) {
      // Rules for entering this stage, checked against the record the card stands for.
      const record = await getRecord(svc, orgOwnerId, entry.record_id);
      if (record) {
        const recordAttrs = await loadAttributes(svc, orgOwnerId, list.object_id);
        const rules = await checkStageRulesV2(svc, orgOwnerId, stage.id, recordAttrs, record.values, record.name, auth.ctx.userId);
        if (rules.errors.length) return NextResponse.json({ error: rules.errors[0], errors: rules.errors }, { status: 422 });
        if (rules.warnings.length) console.warn("[data] warn-mode stage rule(s) matched (not yet surfaced to the user — phase 6):", rules.warnings);
      }
      patch.stage_id = stage.id;
      patch.stage_entered_at = new Date().toISOString();
      patch.position =
        typeof body.position === "number" && Number.isFinite(body.position)
          ? body.position
          : await nextPosition(svc, "data_list_entries", orgOwnerId, list.id, stage.id);
    }
  }
  if (patch.position === undefined && typeof body.position === "number" && Number.isFinite(body.position)) {
    patch.position = body.position;
  }

  if (body.values !== undefined) {
    const attrs = await loadAttributes(svc, orgOwnerId, list.object_id, list.id);
    const valid = validateRecordInput(attrs, { values: body.values }, "update");
    if (!valid.ok) return NextResponse.json({ error: valid.errors[0], errors: valid.errors }, { status: 400 });
    const refErrors = await checkReferences(svc, orgOwnerId, attrs, valid.values);
    if (refErrors.length) return NextResponse.json({ error: refErrors[0], errors: refErrors }, { status: 400 });
    const next = { ...entry.values, ...valid.values };
    for (const slug of valid.cleared) delete next[slug];
    patch.values = next;
  }

  const { data, error } = await svc
    .from("data_list_entries")
    .update(patch)
    .eq("org_owner_id", orgOwnerId)
    .eq("id", entry.id)
    .select(ENTRY_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  if (patch.stage_id) await recordStageChange(svc, orgOwnerId, list.id, entry.id, entry.stage_id, patch.stage_id as string, auth.ctx.userId);
  {
    const actor = { userId: auth.ctx.userId };
    const events = [];
    if (patch.stage_id) events.push({ org: orgOwnerId, type: "list.entry_updated" as const, listId: list.id, entryId: entry.id, recordId: entry.record_id, attributeSlug: "stage", oldValue: entry.stage_id, newValue: patch.stage_id, actor });
    if (patch.values) {
      const next = patch.values as Record<string, unknown>;
      for (const slug of new Set([...Object.keys(next), ...Object.keys(entry.values)])) {
        if (JSON.stringify(next[slug] ?? null) !== JSON.stringify(entry.values[slug] ?? null)) {
          events.push({ org: orgOwnerId, type: "list.entry_updated" as const, listId: list.id, entryId: entry.id, recordId: entry.record_id, attributeSlug: slug, oldValue: entry.values[slug] ?? null, newValue: next[slug] ?? null, actor });
        }
      }
    }
    await emitEvents(svc, events);
  }
  return NextResponse.json({ entry: data });
}

/** DELETE /api/data/lists/[id]/entries/[entryId] — takes the record off the list; the record stays. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string; entryId: string }> }) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id, entryId } = await props.params;

  const list = await loadList(svc, orgOwnerId, id);
  const entry = list ? await loadEntry(svc, orgOwnerId, list.id, entryId) : null;
  if (!list || !entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "write");
  if (denied) return denied;

  const { error } = await svc.from("data_list_entries").delete().eq("org_owner_id", orgOwnerId).eq("id", entry.id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
