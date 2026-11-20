import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { objectDenied, requireDataContext, type DataContext } from "./access";
import { getRecord, loadObjectById } from "./records";
import type { ListRow } from "./lists";
import type { ObjectDef, RecordRow } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The signed-in context plus a live record of this org, or the response to send back. */
export async function withRecord(
  request: Request,
  id: string,
  need: "read" | "write"
): Promise<{ ctx: DataContext; record: RecordRow; object: ObjectDef } | { response: NextResponse }> {
  const auth = await requireDataContext(request, need);
  if (!auth.ok) return { response: auth.response };
  const notFound = { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  if (!isId(id)) return notFound;
  const record = await getRecord(auth.ctx.svc, auth.ctx.orgOwnerId, id);
  const object = record ? await loadObjectById(auth.ctx.svc, auth.ctx.orgOwnerId, record.object_id) : null;
  if (!record || !object) return notFound;
  const denied = objectDenied(auth.ctx, object, need);
  if (denied) return { response: denied };
  return { ctx: auth.ctx, record, object };
}

/** Display names for team members (profiles.display_username), by id. */
export async function memberNames(svc: SupabaseClient, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!want.length) return out;
  const { data } = await svc.from("profiles").select("id, display_username").in("id", want);
  for (const p of data ?? []) out.set(p.id as string, ((p.display_username as string | null) ?? "").trim() || "A teammate");
  return out;
}

/** A list is as open as the object it is built on. Returns the refusal to send, or null. */
export async function listDenied(ctx: DataContext, list: Pick<ListRow, "object_id">, need: "read" | "write"): Promise<NextResponse | null> {
  const object = await loadObjectById(ctx.svc, ctx.orgOwnerId, list.object_id);
  if (!object) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return objectDenied(ctx, object, need);
}
