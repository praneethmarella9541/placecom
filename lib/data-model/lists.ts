import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lists, stages and entries. Same rule as records.ts: every query is scoped by `org`. */

export type ListRow = {
  id: string;
  object_id: string;
  slug: string;
  name: string;
  has_stages: boolean;
  created_at: string;
  archived_at: string | null;
};

export type StageRow = { id: string; list_id: string; name: string; color: string | null; position: number; is_closed: boolean; target_days: number | null };

export type EntryRow = {
  id: string;
  list_id: string;
  record_id: string;
  stage_id: string | null;
  values: Record<string, unknown>;
  position: number;
  stage_entered_at: string;
  created_at: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const LIST_COLUMNS = "id, object_id, slug, name, has_stages, created_at, archived_at";
export const STAGE_COLUMNS = "id, list_id, name, color, position, is_closed, target_days";
export const ENTRY_COLUMNS = "id, list_id, record_id, stage_id, values, position, stage_entered_at, created_at";

/** A short url-safe name for a list: "Campus drive 2026!" -> "campus_drive_2026". */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return /^[a-z]/.test(base) ? base : `l_${base}`.slice(0, 40).replace(/_+$/, "") || "list";
}

export const DEFAULT_STAGES = ["New", "In progress", "Done"] as const;

export async function loadList(svc: SupabaseClient, org: string, id: string): Promise<ListRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await svc
    .from("data_lists")
    .select(LIST_COLUMNS)
    .eq("org_owner_id", org)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  return (data as ListRow | null) ?? null;
}

export async function loadStages(svc: SupabaseClient, org: string, listId: string): Promise<StageRow[]> {
  const { data } = await svc
    .from("data_list_stages")
    .select(STAGE_COLUMNS)
    .eq("org_owner_id", org)
    .eq("list_id", listId)
    .order("position", { ascending: true });
  return (data ?? []) as StageRow[];
}

export async function loadStage(svc: SupabaseClient, org: string, listId: string, stageId: string): Promise<StageRow | null> {
  if (!isUuid(stageId)) return null;
  const { data } = await svc
    .from("data_list_stages")
    .select(STAGE_COLUMNS)
    .eq("org_owner_id", org)
    .eq("list_id", listId)
    .eq("id", stageId)
    .maybeSingle();
  return (data as StageRow | null) ?? null;
}

/** Position after the last row in `table` for this scope: boards sort by it, gaps don't matter. */
export async function nextPosition(
  svc: SupabaseClient,
  table: "data_list_stages" | "data_list_entries",
  org: string,
  listId: string,
  stageId?: string | null
): Promise<number> {
  let q = svc.from(table).select("position").eq("org_owner_id", org).eq("list_id", listId);
  if (table === "data_list_entries") q = stageId ? q.eq("stage_id", stageId) : q.is("stage_id", null);
  const { data } = await q.order("position", { ascending: false }).limit(1).maybeSingle();
  return ((data?.position as number | undefined) ?? 0) + 1;
}
