import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttributeDef, ObjectDef, RecordFilter, RecordRow } from "./types";
import { nextPosition } from "./lists";
import { checkRecordRules, applyDefaults } from "./rules";
import { loadRecordRules } from "./rules-server";
import { extractKeys, validateRecordInput, type RecordInput } from "./values";

/**
 * Database operations for records. Every query is scoped by `org` (from lib/data-model/access.ts);
 * the tables have no RLS policies, so that scoping is the only thing keeping orgs apart.
 *
 * supabase-js has no transactions, so a write that touches several tables orders its steps so a
 * failure part-way leaves nothing half-done that matters: keys are claimed before the record
 * changes, and a failed create removes the record it just made.
 */

export type DbFailure = { ok: false; status: number; error: string; errors?: string[]; existingId?: string };
export type Result<T> = ({ ok: true } & T) | DbFailure;

const SLUG = /^[a-z][a-z0-9_]{0,39}$/;
export const PAGE_SIZE_MAX = 100;

const RECORD_COLUMNS = "id, object_id, name, values, created_at, updated_at";

/**
 * Objects and their fields change rarely and are read by every request, so they are kept for a few
 * seconds per server instance. Anything that changes them calls invalidateModelCache(); another
 * instance can show the old list for up to META_TTL_MS, which is fine for a list of fields.
 */
const META_TTL_MS = 10_000;
const metaCache = new Map<string, { at: number; value: unknown }>();
function metaGet<T>(key: string): T | undefined {
  const hit = metaCache.get(key);
  return hit && Date.now() - hit.at < META_TTL_MS ? (hit.value as T) : undefined;
}
function metaSet(key: string, value: unknown): void {
  if (metaCache.size > 500) metaCache.clear();
  metaCache.set(key, { at: Date.now(), value });
}
export function invalidateModelCache(): void {
  metaCache.clear();
}

// Every column, so settings added by later migrations (staff_access, highlights) arrive as soon as
// their migration is applied and nothing breaks before it is.
async function selectObject(svc: SupabaseClient, org: string, column: "slug" | "id", value: string): Promise<ObjectDef | null> {
  const key = `o:${org}:${column}:${value}`;
  const hit = metaGet<ObjectDef | null>(key);
  if (hit !== undefined) return hit;
  const { data } = await svc.from("data_objects").select("*").eq("org_owner_id", org).eq(column, value).maybeSingle();
  const object = (data as unknown as ObjectDef | null) ?? null;
  // A missing object is never remembered: setup may be about to create it.
  if (object) metaSet(key, object);
  return object;
}

export async function loadObject(svc: SupabaseClient, org: string, slug: string): Promise<ObjectDef | null> {
  if (!SLUG.test(slug)) return null;
  return selectObject(svc, org, "slug", slug);
}

export async function loadObjectById(svc: SupabaseClient, org: string, id: string): Promise<ObjectDef | null> {
  return selectObject(svc, org, "id", id);
}

const ATTRIBUTE_COLUMNS =
  "id, slug, name, type, is_multi, config, is_system, is_required, is_unique, position, archived_at, list_id";

/** Attributes of the record itself (listId null) or of one list's entries. */
export async function loadAttributes(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  listId: string | null = null
): Promise<AttributeDef[]> {
  const key = `a:${org}:${objectId}:${listId ?? ""}`;
  const hit = metaGet<AttributeDef[]>(key);
  if (hit) return hit;
  let q = svc
    .from("data_attributes")
    .select(ATTRIBUTE_COLUMNS)
    .eq("org_owner_id", org)
    .eq("object_id", objectId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  q = listId ? q.eq("list_id", listId) : q.is("list_id", null);
  const { data } = await q;
  const attributes = (data ?? []) as AttributeDef[];
  metaSet(key, attributes);
  return attributes;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type ListQuery = {
  q?: string;
  sort?: string;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  filters?: RecordFilter[];
  /** Fetch exactly these records (used to show the names behind reference cells). */
  ids?: string[];
};

/** A search term made safe for a PostgREST `ilike` value: no wildcards or filter punctuation. */
function likeTerm(raw: string): string {
  return raw.replace(/[%_\\,()*]/g, " ").trim().slice(0, 100);
}

export async function listRecords(
  svc: SupabaseClient,
  org: string,
  object: ObjectDef,
  attrs: AttributeDef[],
  query: ListQuery
): Promise<Result<{ records: RecordRow[]; total: number; page: number; pageSize: number }>> {
  const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 50) || 50, 1), PAGE_SIZE_MAX);
  const page = Math.max(Math.trunc(query.page ?? 1) || 1, 1);
  const known = new Set(attrs.filter((a) => !a.archived_at).map((a) => a.slug));

  let q = svc
    .from("data_records")
    .select(RECORD_COLUMNS, { count: "exact" })
    .eq("org_owner_id", org)
    .eq("object_id", object.id)
    .is("deleted_at", null);

  if (query.ids) q = q.in("id", query.ids);

  const term = query.q ? likeTerm(query.q) : "";
  if (term) q = q.ilike("name", `%${term}%`);

  for (const f of query.filters ?? []) {
    if (!known.has(f.attribute)) return { ok: false, status: 400, error: `Unknown attribute "${f.attribute.slice(0, 40)}".` };
    const path = `values->>${f.attribute}`;
    // Multi-value attributes are arrays, which ->> returns as JSON text; "contains" still matches.
    if (f.op === "empty") q = q.is(path, null);
    else if (f.op === "not_empty") q = q.not(path, "is", null);
    else {
      const raw = (f.value ?? "").trim();
      if (!raw) return { ok: false, status: 400, error: "A filter needs a value." };
      if (f.op === "before" || f.op === "after") {
        // Dates and timestamps are ISO text, which sorts the same as time, so a text comparison is right.
        const attr = attrs.find((a) => a.slug === f.attribute);
        if (!attr || (attr.type !== "date" && attr.type !== "timestamp")) return { ok: false, status: 400, error: "Before and after only work on dates." };
        if (!/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(Date.parse(raw))) return { ok: false, status: 400, error: "Use a date like 2026-12-31." };
        q = f.op === "before" ? q.lt(path, raw) : q.gt(path, raw);
      } else if (f.op === "eq") q = q.eq(path, raw);
      else if (f.op === "neq") {
        // "Is not" should keep records where the field is empty; a plain neq drops them (NULL).
        if (/[,()"\\]/.test(raw)) return { ok: false, status: 400, error: "\"Is not\" can't be used with a value containing commas, brackets or quotes." };
        q = q.or(`${path}.neq.${raw},${path}.is.null`);
      }
      else {
        const v = likeTerm(raw);
        if (!v) return { ok: false, status: 400, error: "A filter needs a value." };
        q = q.ilike(path, `%${v}%`);
      }
    }
  }

  const direction = query.direction === "desc" ? "desc" : "asc";
  const sort = query.sort ?? "created_at";
  if (sort === "name" || sort === "created_at" || sort === "updated_at") {
    q = q.order(sort, { ascending: direction === "asc" });
  } else if (known.has(sort)) {
    q = q.order(`values->>${sort}`, { ascending: direction === "asc", nullsFirst: false });
  } else {
    return { ok: false, status: 400, error: `Can't sort by "${sort.slice(0, 40)}".` };
  }
  // Stable paging: ties on the sort column must not reshuffle between pages.
  q = q.order("id", { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1);

  const { data, error, count } = await q;
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, records: (data ?? []) as RecordRow[], total: count ?? 0, page, pageSize };
}

export async function getRecord(svc: SupabaseClient, org: string, id: string): Promise<RecordRow | null> {
  const { data } = await svc
    .from("data_records")
    .select(RECORD_COLUMNS)
    .eq("org_owner_id", org)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as RecordRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

type Actor = { userId: string; org: string; source?: string };

async function writeHistory(
  svc: SupabaseClient,
  actor: Actor,
  recordId: string,
  rows: { slug: string | null; action: "create" | "update" | "delete" | "restore" | "import"; oldValue?: unknown; newValue?: unknown }[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await svc.from("data_record_history").insert(
    rows.map((r) => ({
      org_owner_id: actor.org,
      record_id: recordId,
      attribute_slug: r.slug,
      action: r.action,
      old_value: r.oldValue === undefined ? null : r.oldValue,
      new_value: r.newValue === undefined ? null : r.newValue,
      actor_id: actor.userId,
      source: actor.source ?? "app",
    }))
  );
  // History must never block the change it describes; the failure is logged for the operator.
  if (error) console.error("[data-model] history write failed:", error.code, error.message);
}

/** record_ref values must name a live record of the right object in this org; members must be on its team. */
export async function checkReferences(
  svc: SupabaseClient,
  org: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>
): Promise<string[]> {
  const errors: string[] = [];

  // A "member" must be someone on this org's team.
  for (const attr of attrs) {
    if (attr.type !== "member" || typeof values[attr.slug] !== "string") continue;
    const id = values[attr.slug] as string;
    const { data } = await svc
      .from("profiles")
      .select("id")
      .eq("id", id)
      .or(`id.eq.${org},mailbox_owner_id.eq.${org}`)
      .maybeSingle();
    if (!data) errors.push(`${attr.name}: that person isn't on your team.`);
  }

  const wanted = new Map<string, { attr: AttributeDef; ids: string[] }>();
  for (const attr of attrs) {
    if (attr.type !== "record_ref" || values[attr.slug] === undefined) continue;
    const raw = values[attr.slug];
    wanted.set(attr.slug, { attr, ids: (Array.isArray(raw) ? raw : [raw]).filter((x): x is string => typeof x === "string") });
  }
  if (!wanted.size) return errors;
  const all = [...new Set([...wanted.values()].flatMap((w) => w.ids))];
  if (!all.length) return errors;
  const { data } = await svc
    .from("data_records")
    .select("id, data_objects!inner(slug)")
    .eq("org_owner_id", org)
    .is("deleted_at", null)
    .in("id", all);
  const found = new Map<string, string>();
  for (const row of (data ?? []) as unknown as { id: string; data_objects: { slug: string } | { slug: string }[] }[]) {
    const obj = Array.isArray(row.data_objects) ? row.data_objects[0] : row.data_objects;
    if (obj) found.set(row.id, obj.slug);
  }
  for (const { attr, ids } of wanted.values()) {
    for (const id of ids) {
      const slug = found.get(id);
      if (!slug) errors.push(`${attr.name}: that record doesn't exist.`);
      else if (attr.config.target_object && attr.config.target_object !== slug) {
        errors.push(`${attr.name}: must be a ${attr.config.target_object} record.`);
      }
    }
  }
  return errors;
}

/** Claims matching keys for a record. A key already held by another record is refused. */
async function claimKeys(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  recordId: string,
  keys: { kind: "email" | "domain"; value: string }[]
): Promise<DbFailure | null> {
  if (!keys.length) return null;
  const { error } = await svc.from("data_record_keys").insert(
    keys.map((k) => ({ org_owner_id: org, object_id: objectId, record_id: recordId, kind: k.kind, value: k.value }))
  );
  if (!error) return null;
  if (error.code === "23505") {
    // Say which one, and point at the record that holds it, so the caller can open or merge it.
    const { data: held } = await svc
      .from("data_record_keys")
      .select("kind, value, record_id")
      .eq("org_owner_id", org)
      .eq("object_id", objectId)
      .in("value", keys.map((k) => k.value))
      .neq("record_id", recordId)
      .limit(1)
      .maybeSingle();
    return {
      ok: false,
      status: 409,
      error: held ? `${held.value} already belongs to another record.` : "That email or domain already belongs to another record.",
      existingId: (held?.record_id as string | undefined) ?? undefined,
    };
  }
  return { ok: false, status: 500, error: error.message };
}

export async function createRecord(
  svc: SupabaseClient,
  actor: Actor,
  object: ObjectDef,
  attrs: AttributeDef[],
  input: RecordInput
): Promise<Result<{ record: RecordRow }>> {
  // Fields the input leaves out start from their default.
  const valid = validateRecordInput(attrs, { ...input, values: applyDefaults(attrs, input.values ?? {}) }, "create");
  if (!valid.ok) return { ok: false, status: 400, error: valid.errors[0], errors: valid.errors };
  const refErrors = await checkReferences(svc, actor.org, attrs, valid.values);
  if (refErrors.length) return { ok: false, status: 400, error: refErrors[0], errors: refErrors };
  const ruleErrors = checkRecordRules(await loadRecordRules(svc, actor.org, object.id), attrs, valid.values, valid.name);
  if (ruleErrors.length) return { ok: false, status: 422, error: ruleErrors[0], errors: ruleErrors };

  const { data: row, error } = await svc
    .from("data_records")
    .insert({
      org_owner_id: actor.org,
      object_id: object.id,
      name: valid.name ?? "",
      values: valid.values,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select(RECORD_COLUMNS)
    .single();
  if (error || !row) return { ok: false, status: 500, error: error?.message ?? "Could not create the record." };
  const record = row as RecordRow;

  const claimed = await claimKeys(svc, actor.org, object.id, record.id, extractKeys(attrs, valid.values));
  if (claimed) {
    await svc.from("data_records").delete().eq("org_owner_id", actor.org).eq("id", record.id);
    return claimed;
  }

  if (object.slug === "deals") await addToDealsPipeline(svc, actor.org, record.id, actor.userId);

  await writeHistory(svc, actor, record.id, [
    { slug: null, action: "create", newValue: { name: record.name } },
    ...Object.entries(valid.values).map(([slug, v]) => ({ slug, action: "create" as const, newValue: v })),
  ]);
  return { ok: true, record };
}

/** A new deal starts in the first stage of the org's Deals pipeline, if it has one. Best effort. */
async function addToDealsPipeline(svc: SupabaseClient, org: string, recordId: string, userId: string): Promise<void> {
  const { data: list } = await svc.from("data_lists").select("id").eq("org_owner_id", org).eq("slug", "deals_pipeline").is("archived_at", null).maybeSingle();
  if (!list) return;
  const { data: stage } = await svc.from("data_list_stages").select("id").eq("org_owner_id", org).eq("list_id", list.id).order("position", { ascending: true }).limit(1).maybeSingle();
  const { error } = await svc.from("data_list_entries").insert({
    org_owner_id: org,
    list_id: list.id,
    record_id: recordId,
    stage_id: stage?.id ?? null,
    added_by: userId,
    position: await nextPosition(svc, "data_list_entries", org, list.id as string, (stage?.id as string | undefined) ?? null),
  });
  if (error) console.error("[data-model] couldn't add the deal to its pipeline:", error.code, error.message);
}

export async function updateRecord(
  svc: SupabaseClient,
  actor: Actor,
  object: ObjectDef,
  attrs: AttributeDef[],
  existing: RecordRow,
  input: RecordInput
): Promise<Result<{ record: RecordRow }>> {
  const valid = validateRecordInput(attrs, input, "update");
  if (!valid.ok) return { ok: false, status: 400, error: valid.errors[0], errors: valid.errors };
  const refErrors = await checkReferences(svc, actor.org, attrs, valid.values);
  if (refErrors.length) return { ok: false, status: 400, error: refErrors[0], errors: refErrors };

  const nextValues: Record<string, unknown> = { ...existing.values, ...valid.values };
  for (const slug of valid.cleared) delete nextValues[slug];
  const nextName = valid.name ?? existing.name;

  // Rules are checked against the whole record as it would be after this save. Records that
  // already break a newer rule are not flagged until someone next saves them.
  const ruleErrors = checkRecordRules(await loadRecordRules(svc, actor.org, object.id), attrs, nextValues, nextName);
  if (ruleErrors.length) return { ok: false, status: 422, error: ruleErrors[0], errors: ruleErrors };

  // Keys first: if one is taken, nothing about the record has changed yet.
  const before = new Set(extractKeys(attrs, existing.values).map((k) => `${k.kind}:${k.value}`));
  const after = extractKeys(attrs, nextValues);
  const added = after.filter((k) => !before.has(`${k.kind}:${k.value}`));
  const afterIds = new Set(after.map((k) => `${k.kind}:${k.value}`));
  const removed = [...before].filter((id) => !afterIds.has(id)).map((id) => ({ kind: id.slice(0, id.indexOf(":")), value: id.slice(id.indexOf(":") + 1) }));

  const claimed = await claimKeys(svc, actor.org, object.id, existing.id, added);
  if (claimed) return claimed;

  const { data: row, error } = await svc
    .from("data_records")
    .update({ name: nextName, values: nextValues, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq("org_owner_id", actor.org)
    .eq("id", existing.id)
    .is("deleted_at", null)
    .select(RECORD_COLUMNS)
    .maybeSingle();
  if (error || !row) {
    // Give back the keys just claimed so the record isn't left owning something it doesn't use.
    for (const k of added) {
      await svc.from("data_record_keys").delete().eq("org_owner_id", actor.org).eq("object_id", object.id).eq("kind", k.kind).eq("value", k.value).eq("record_id", existing.id);
    }
    return error ? { ok: false, status: 500, error: error.message } : { ok: false, status: 404, error: "Not found." };
  }

  for (const k of removed) {
    await svc.from("data_record_keys").delete().eq("org_owner_id", actor.org).eq("object_id", object.id).eq("kind", k.kind).eq("value", k.value).eq("record_id", existing.id);
  }

  const changes: { slug: string | null; action: "update"; oldValue: unknown; newValue: unknown }[] = [];
  if (nextName !== existing.name) changes.push({ slug: null, action: "update", oldValue: { name: existing.name }, newValue: { name: nextName } });
  for (const slug of new Set([...Object.keys(valid.values), ...valid.cleared])) {
    const oldV = existing.values[slug] ?? null;
    const newV = nextValues[slug] ?? null;
    if (JSON.stringify(oldV) !== JSON.stringify(newV)) changes.push({ slug, action: "update", oldValue: oldV, newValue: newV });
  }
  await writeHistory(svc, actor, existing.id, changes);
  return { ok: true, record: row as RecordRow };
}

/** Soft delete: the row stays (history keeps pointing at it); its keys are freed for reuse. */
export async function deleteRecord(
  svc: SupabaseClient,
  actor: Actor,
  object: ObjectDef,
  existing: RecordRow
): Promise<Result<object>> {
  const { error, data } = await svc
    .from("data_records")
    .update({ deleted_at: new Date().toISOString(), updated_by: actor.userId })
    .eq("org_owner_id", actor.org)
    .eq("id", existing.id)
    .is("deleted_at", null)
    .select("id");
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data?.length) return { ok: false, status: 404, error: "Not found." };
  await svc.from("data_record_keys").delete().eq("org_owner_id", actor.org).eq("record_id", existing.id);
  // A list entry for a deleted record would point at nothing; drop them with it.
  await svc.from("data_list_entries").delete().eq("org_owner_id", actor.org).eq("record_id", existing.id);
  await writeHistory(svc, actor, existing.id, [{ slug: null, action: "delete", oldValue: { name: existing.name } }]);
  return { ok: true };
}
