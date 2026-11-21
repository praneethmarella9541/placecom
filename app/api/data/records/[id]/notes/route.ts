import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { memberNames, withRecord } from "@/lib/data-model/route-helpers";

export const runtime = "nodejs";

const KINDS = new Set(["note", "call", "email", "meeting"]);
const COLUMNS = "id, kind, body, created_by, created_at";

/** GET /api/data/records/[id]/notes — newest first. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;

  const { data, error } = await svc
    .from("data_notes")
    .select(COLUMNS)
    .eq("org_owner_id", orgOwnerId)
    .eq("record_id", found.record.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  const names = await memberNames(svc, (data ?? []).map((n) => n.created_by as string | null));
  return NextResponse.json({
    notes: (data ?? []).map((n) => ({ ...n, author: n.created_by ? (n.created_by === userId ? "You" : (names.get(n.created_by as string) ?? "A teammate")) : "Imported", mine: n.created_by === userId })),
  });
}

/** POST /api/data/records/[id]/notes  { body, kind? } */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "write");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId, userId } = found.ctx;

  const body = (await request.json().catch(() => null)) as { body?: unknown; kind?: unknown } | null;
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: "A note can be up to 10,000 characters." }, { status: 400 });
  const kind = typeof body?.kind === "string" && KINDS.has(body.kind) ? body.kind : "note";

  const { data, error } = await svc
    .from("data_notes")
    .insert({ org_owner_id: orgOwnerId, record_id: found.record.id, kind, body: text, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ note: { ...data, author: "You", mine: true } }, { status: 201 });
}
