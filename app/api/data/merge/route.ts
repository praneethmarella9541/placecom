import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { objectDenied, requireDataContext } from "@/lib/data-model/access";
import { mergeValues } from "@/lib/data-model/merge-values";
import { getRecord, loadAttributes, loadObjectById } from "@/lib/data-model/records";
import { isId } from "@/lib/data-model/route-helpers";
import { extractKeys } from "@/lib/data-model/values";
import type { AttributeConfig } from "@/lib/data-model/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MERGEABLE = new Set(["people", "companies"]);
const MAX_REPOINT = 2000;

/**
 * POST /api/data/merge  { winnerId, loserId }
 * Folds the loser into the winner: the winner's values win clashes, multi-value fields (emails,
 * phones, domains) are combined, the loser's matching keys, list entries, notes and tasks move
 * across, anything that pointed at the loser (a person's company, a deal's company) is repointed,
 * and the loser is removed (soft-deleted, so history still reads). People and Companies only.
 *
 * No transactions in supabase-js, so the steps run in an order where a failure part-way leaves both
 * records intact: the winner is only changed after the loser's keys are safely moved, and the loser
 * is only removed at the very end.
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { winnerId?: unknown; loserId?: unknown } | null;
  if (!body || !isId(body.winnerId) || !isId(body.loserId)) return NextResponse.json({ error: "winnerId and loserId are required." }, { status: 400 });
  if (body.winnerId === body.loserId) return NextResponse.json({ error: "Pick two different records." }, { status: 400 });

  const [winner, loser] = await Promise.all([getRecord(svc, orgOwnerId, body.winnerId), getRecord(svc, orgOwnerId, body.loserId)]);
  if (!winner || !loser) return NextResponse.json({ error: "One of those records doesn't exist." }, { status: 404 });
  if (winner.object_id !== loser.object_id) return NextResponse.json({ error: "Only two records of the same kind can be merged." }, { status: 400 });
  const object = await loadObjectById(svc, orgOwnerId, winner.object_id);
  if (!object || !MERGEABLE.has(object.slug)) return NextResponse.json({ error: "Only people and companies can be merged." }, { status: 400 });
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return denied;

  const attrs = await loadAttributes(svc, orgOwnerId, object.id);
  const values = mergeValues(attrs, winner.values, loser.values);
  const name = winner.name.trim() ? winner.name : loser.name;

  // 1. The loser's matching keys move to the winner (they can't clash: a key is unique per object).
  const moved = await svc.from("data_record_keys").update({ record_id: winner.id }).eq("org_owner_id", orgOwnerId).eq("record_id", loser.id);
  if (moved.error) return NextResponse.json({ error: dbErrorMessage(moved.error) }, { status: 500 });

  // 2. The winner takes the combined values.
  const upd = await svc.from("data_records").update({ name, values, updated_by: userId, updated_at: new Date().toISOString() }).eq("org_owner_id", orgOwnerId).eq("id", winner.id);
  if (upd.error) {
    await svc.from("data_record_keys").update({ record_id: loser.id }).eq("org_owner_id", orgOwnerId).in("value", extractKeys(attrs, loser.values).map((k) => k.value)).eq("record_id", winner.id);
    return NextResponse.json({ error: dbErrorMessage(upd.error) }, { status: 500 });
  }

  // 3. List entries: keep the winner's where both are on the same list, move the rest.
  const [loserEntries, winnerEntries] = await Promise.all([
    svc.from("data_list_entries").select("id, list_id").eq("org_owner_id", orgOwnerId).eq("record_id", loser.id),
    svc.from("data_list_entries").select("list_id").eq("org_owner_id", orgOwnerId).eq("record_id", winner.id),
  ]);
  const onWinner = new Set((winnerEntries.data ?? []).map((e) => e.list_id as string));
  for (const e of loserEntries.data ?? []) {
    if (onWinner.has(e.list_id as string)) await svc.from("data_list_entries").delete().eq("org_owner_id", orgOwnerId).eq("id", e.id as string);
    else await svc.from("data_list_entries").update({ record_id: winner.id }).eq("org_owner_id", orgOwnerId).eq("id", e.id as string);
  }

  // 4. Notes and tasks.
  await svc.from("data_notes").update({ record_id: winner.id }).eq("org_owner_id", orgOwnerId).eq("record_id", loser.id);
  await svc.from("data_tasks").update({ record_id: winner.id }).eq("org_owner_id", orgOwnerId).eq("record_id", loser.id);

  // 5. Anything that pointed at the loser now points at the winner.
  const { data: refAttrs } = await svc.from("data_attributes").select("slug, config").eq("org_owner_id", orgOwnerId).eq("type", "record_ref").is("list_id", null);
  let repointed = 0;
  for (const a of (refAttrs ?? []).filter((x) => (x.config as AttributeConfig | null)?.target_object === object.slug)) {
    const { data: rows } = await svc
      .from("data_records")
      .select("id, values")
      .eq("org_owner_id", orgOwnerId)
      .is("deleted_at", null)
      .filter(`values->>${a.slug as string}`, "eq", loser.id)
      .limit(MAX_REPOINT);
    for (const row of rows ?? []) {
      await svc.from("data_records").update({ values: { ...(row.values as Record<string, unknown>), [a.slug as string]: winner.id } }).eq("org_owner_id", orgOwnerId).eq("id", row.id as string);
      repointed++;
    }
  }

  // 6. The loser goes (soft), and history records both sides.
  await svc.from("data_records").update({ deleted_at: new Date().toISOString(), updated_by: userId }).eq("org_owner_id", orgOwnerId).eq("id", loser.id);
  await svc.from("data_record_history").insert([
    { org_owner_id: orgOwnerId, record_id: winner.id, attribute_slug: null, action: "update", old_value: null, new_value: { merged_in: loser.name }, actor_id: userId, source: "merge" },
    { org_owner_id: orgOwnerId, record_id: loser.id, attribute_slug: null, action: "delete", old_value: { name: loser.name, merged_into: winner.id }, new_value: null, actor_id: userId, source: "merge" },
  ]);

  return NextResponse.json({ ok: true, winnerId: winner.id, repointed });
}
