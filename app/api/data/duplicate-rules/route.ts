import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { loadAttributes, loadObject } from "@/lib/data-model/records";

export const runtime = "nodejs";

const COLUMNS = "id, object_id, name, fields, match_type, action, active, created_at";
const MAX_RULES = 20;
const MATCH_TYPES = new Set(["exact", "normalized"]);
const ACTIONS = new Set(["block", "warn", "report_only"]);
const SLUG = /^[a-z][a-z0-9_]{0,39}$/;

/** GET /api/data/duplicate-rules?object=people — the duplicate-matching rules on an object. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const params = new URL(request.url).searchParams;

  const object = await loadObject(svc, orgOwnerId, params.get("object") ?? "");
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "read");
  if (denied) return denied;

  const { data, error } = await svc
    .from("data_duplicate_rules")
    .select(COLUMNS)
    .eq("org_owner_id", orgOwnerId)
    .eq("object_id", object.id)
    .order("created_at", { ascending: true });
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ rules: data ?? [] });
}

/**
 * POST /api/data/duplicate-rules  (admin)
 *   { object, name, fields: string[], matchType?: "exact"|"normalized", action?: "block"|"warn"|"report_only" }
 * Detection only — matching records are flagged, never merged (see migration 0102).
 */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || !name || name.length > 100) return NextResponse.json({ error: "Give the rule a name of up to 100 characters." }, { status: 400 });

  const object = typeof body.object === "string" ? await loadObject(svc, orgOwnerId, body.object) : null;
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });

  const attrs = await loadAttributes(svc, orgOwnerId, object.id);
  const slugs = new Set(["name", ...attrs.filter((a) => !a.archived_at).map((a) => a.slug)]);
  const fields = Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === "string" && SLUG.test(f) && slugs.has(f)) : [];
  if (!fields.length || fields.length > 10) return NextResponse.json({ error: "Choose 1 to 10 real fields to match on." }, { status: 400 });

  const matchType = typeof body.matchType === "string" && MATCH_TYPES.has(body.matchType) ? body.matchType : "normalized";
  const action = typeof body.action === "string" && ACTIONS.has(body.action) ? body.action : "warn";

  const { count } = await svc.from("data_duplicate_rules").select("id", { count: "exact", head: true }).eq("org_owner_id", orgOwnerId).eq("object_id", object.id);
  if ((count ?? 0) >= MAX_RULES) return NextResponse.json({ error: `You can have up to ${MAX_RULES} duplicate rules per object.` }, { status: 400 });

  const { data, error } = await svc
    .from("data_duplicate_rules")
    .insert({ org_owner_id: orgOwnerId, object_id: object.id, name, fields: [...new Set(fields)], match_type: matchType, action, created_by: userId })
    .select(COLUMNS)
    .single();
  if (error) return missingTableResponse(error.message) ?? NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ rule: data }, { status: 201 });
}
