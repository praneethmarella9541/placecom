import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { objectDenied, requireDataContext } from "@/lib/data-model/access";
import { mergeValues } from "@/lib/data-model/merge-values";
import { checkRecordWrite, createRecord, getRecord, loadAttributes, loadObject, updateRecord } from "@/lib/data-model/records";
import { isId } from "@/lib/data-model/route-helpers";
import { extractKeys, validateRecordInput } from "@/lib/data-model/values";
import type { AttributeDef, ObjectDef } from "@/lib/data-model/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS_PER_CALL = 100;

type RowIn = { name?: unknown; values?: Record<string, unknown> };
type RowOut = { row: number; status: "created" | "updated" | "duplicate" | "error"; error?: string; id?: string; possibleDuplicates?: { rule: string; records: { id: string; name: string }[] }[] };

/** Turns a person's name or a company name typed in a cell into the id the field stores. */
async function resolveLinks(
  svc: SupabaseClient,
  org: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  team: Map<string, string>,
  dryRun: boolean,
  userId: string,
  counters: { linkedCreated: number }
): Promise<{ values: Record<string, unknown> } | { error: string }> {
  const out = { ...values };
  for (const attr of attrs) {
    const raw = out[attr.slug];
    if ((attr.type !== "record_ref" && attr.type !== "member") || typeof raw !== "string" || !raw.trim() || isId(raw.trim())) continue;
    const text = raw.trim();

    if (attr.type === "member") {
      const id = team.get(text.toLowerCase());
      if (!id) return { error: `${attr.name}: "${text.slice(0, 40)}" isn't on your team.` };
      out[attr.slug] = id;
      continue;
    }

    const target = await loadObject(svc, org, attr.config.target_object ?? "");
    if (!target) return { error: `${attr.name}: its target object is missing.` };
    const { data: hit } = await svc
      .from("data_records")
      .select("id")
      .eq("org_owner_id", org)
      .eq("object_id", target.id)
      .is("deleted_at", null)
      .ilike("name", text.replace(/[%_\\]/g, (c) => `\\${c}`))
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (hit) {
      out[attr.slug] = hit.id;
      continue;
    }
    // No match: make the linked record (a company named in a candidates sheet, say).
    counters.linkedCreated++;
    if (dryRun) {
      delete out[attr.slug];
      continue;
    }
    const attrsOfTarget = await loadAttributes(svc, org, target.id);
    const made = await createRecord(svc, { userId, org, source: "import" }, target, attrsOfTarget, { name: text, values: {} });
    if (!made.ok) return { error: `${attr.name}: couldn't create "${text.slice(0, 40)}".` };
    out[attr.slug] = made.record.id;
  }
  return { values: out };
}

/**
 * POST /api/data/import
 *   { object, rows: [{ name, values: { slug: "cell text" } }], dryRun?: boolean, onDuplicate?: "skip" | "update" }
 * At most 100 rows per call; the screen sends a file in batches. Each row is checked with the same
 * rules as a hand-made record. A row whose email or domain already belongs to a record is a duplicate:
 * skipped, or (update) merged into it, where an empty cell never clears data and several-value
 * fields add to what is there. Names typed in link and team-member cells are matched to records and
 * people (a missing record is created). dryRun checks everything and writes nothing.
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { object?: unknown; rows?: unknown; dryRun?: unknown; onDuplicate?: unknown } | null;
  if (!body || typeof body.object !== "string" || !Array.isArray(body.rows)) return NextResponse.json({ error: "object and rows are required." }, { status: 400 });
  if (body.rows.length > MAX_ROWS_PER_CALL) return NextResponse.json({ error: `Send at most ${MAX_ROWS_PER_CALL} rows at a time.` }, { status: 400 });

  const object: ObjectDef | null = await loadObject(svc, orgOwnerId, body.object);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return denied;
  const attrs = (await loadAttributes(svc, orgOwnerId, object.id)).filter((a) => !a.archived_at);
  const dryRun = body.dryRun !== false;
  const update = body.onDuplicate === "update";

  const team = new Map<string, string>();
  if (attrs.some((a) => a.type === "member")) {
    const { data } = await svc.from("profiles").select("id, display_username").or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`);
    for (const m of data ?? []) if ((m.display_username as string | null)?.trim()) team.set((m.display_username as string).trim().toLowerCase(), m.id as string);
  }

  const counters = { linkedCreated: 0 };
  const results: RowOut[] = [];
  const startRow = Number((body as { startRow?: unknown }).startRow) || 1;
  const asPossibleDuplicates = (dups: { rule: { name: string }; records: { id: string; name: string }[] }[]) =>
    dups.length ? dups.map((d) => ({ rule: d.rule.name, records: d.records })) : undefined;

  for (let i = 0; i < body.rows.length; i++) {
    const rowNo = startRow + i;
    const input = body.rows[i] as RowIn;
    const fail = (error: string) => results.push({ row: rowNo, status: "error", error });
    if (!input || typeof input !== "object") {
      fail("This row isn't valid.");
      continue;
    }

    const resolved = await resolveLinks(svc, orgOwnerId, attrs, input.values ?? {}, team, dryRun, userId, counters);
    if ("error" in resolved) {
      fail(resolved.error);
      continue;
    }
    const checked = validateRecordInput(attrs, { name: input.name, values: resolved.values }, "create");
    if (!checked.ok) {
      fail(checked.errors[0]);
      continue;
    }

    // Is this person or company already here (same email or domain)?
    let existingId: string | null = null;
    const keys = extractKeys(attrs, checked.values);
    if (keys.length) {
      const { data: held } = await svc
        .from("data_record_keys")
        .select("record_id")
        .eq("org_owner_id", orgOwnerId)
        .eq("object_id", object.id)
        .in("value", keys.map((k) => k.value))
        .limit(1)
        .maybeSingle();
      existingId = (held?.record_id as string | undefined) ?? null;
    }

    if (existingId) {
      if (!update) {
        results.push({ row: rowNo, status: "duplicate", id: existingId });
        continue;
      }
      const existing = await getRecord(svc, orgOwnerId, existingId);
      if (!existing) {
        fail("The matching record was removed meanwhile.");
        continue;
      }
      const merged = mergeValues(attrs, checked.values, existing.values);
      const sent: Record<string, unknown> = {};
      for (const slug of Object.keys(checked.values)) sent[slug] = merged[slug];

      // A dry run runs the exact same field, dependent-option, lookup-filter, rule and
      // duplicate-rule checks as the real write below — it just stops short of writing.
      if (dryRun) {
        const preview = await checkRecordWrite(svc, { userId, org: orgOwnerId, source: "import" }, object, attrs, { values: sent }, "update", existing);
        if (!preview.ok) fail(preview.error);
        else results.push({ row: rowNo, status: "updated", id: existingId, possibleDuplicates: asPossibleDuplicates(preview.duplicates) });
        continue;
      }
      const r = await updateRecord(svc, { userId, org: orgOwnerId, source: "import" }, object, attrs, existing, { values: sent });
      if (r.ok) results.push({ row: rowNo, status: "updated", id: existingId, possibleDuplicates: asPossibleDuplicates(r.duplicates ?? []) });
      else fail(r.error);
      continue;
    }

    if (dryRun) {
      const preview = await checkRecordWrite(svc, { userId, org: orgOwnerId, source: "import" }, object, attrs, { name: checked.name, values: checked.values }, "create");
      if (!preview.ok) {
        if (preview.status === 409 && preview.existingId) results.push({ row: rowNo, status: "duplicate", id: preview.existingId });
        else fail(preview.status >= 500 ? "Couldn't save this row. Try again." : preview.error);
      } else {
        results.push({ row: rowNo, status: "created", possibleDuplicates: asPossibleDuplicates(preview.duplicates) });
      }
      continue;
    }
    const r = await createRecord(svc, { userId, org: orgOwnerId, source: "import" }, object, attrs, { name: checked.name, values: checked.values });
    if (r.ok) results.push({ row: rowNo, status: "created", id: r.record.id, possibleDuplicates: asPossibleDuplicates(r.duplicates ?? []) });
    else if (r.status === 409 && r.existingId) results.push({ row: rowNo, status: "duplicate", id: r.existingId });
    else fail(r.status >= 500 ? "Couldn't save this row. Try again." : r.error);
  }

  const count = (s: RowOut["status"]) => results.filter((r) => r.status === s).length;
  return NextResponse.json({
    dryRun,
    summary: { created: count("created"), updated: count("updated"), duplicates: count("duplicate"), errors: count("error"), linkedRecordsCreated: counters.linkedCreated },
    // A plain "would create, nothing to flag" row is only interesting in the summary count; one
    // worth a second look (an error, an update, a duplicate, or a create with a possible-duplicate
    // match) is shown in full even in a dry run.
    results: results.filter((r) => r.status !== "created" || !dryRun || r.possibleDuplicates).slice(0, 300),
    errors: results.filter((r) => r.status === "error"),
  });
}
