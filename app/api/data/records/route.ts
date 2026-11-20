import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { createRecord, listRecords, loadAttributes, loadObject } from "@/lib/data-model/records";
import type { FilterOp, RecordFilter } from "@/lib/data-model/types";

export const runtime = "nodejs";

const OPS = new Set<FilterOp>(["eq", "neq", "contains", "before", "after", "empty", "not_empty"]);

/**
 * Filters arrive as repeated `filter=slug:op:value` parameters (value optional for empty and
 * not_empty), e.g. ?filter=job_title:contains:manager&filter=company:not_empty.
 */
function parseFilters(params: URLSearchParams): RecordFilter[] | string {
  const out: RecordFilter[] = [];
  for (const raw of params.getAll("filter").slice(0, 10)) {
    const [attribute, op, ...rest] = raw.split(":");
    if (!attribute || !OPS.has(op as FilterOp)) return `Bad filter "${raw.slice(0, 60)}".`;
    out.push({ attribute, op: op as FilterOp, value: rest.join(":") || undefined });
  }
  return out;
}

/** GET /api/data/records?object=people&q=&sort=name&direction=asc&page=1&pageSize=50&filter=... */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const params = new URL(request.url).searchParams;
  const object = await loadObject(svc, orgOwnerId, params.get("object") ?? "");
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "read");
  if (denied) return denied;

  const filters = parseFilters(params);
  if (typeof filters === "string") return NextResponse.json({ error: filters }, { status: 400 });

  const rawIds = params.get("ids");
  const idList = rawIds
    ? rawIds.split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)).slice(0, 100)
    : undefined;
  if (rawIds && !idList?.length) return NextResponse.json({ records: [], total: 0, page: 1, pageSize: 0 });

  const attrs = await loadAttributes(svc, orgOwnerId, object.id);
  const result = await listRecords(svc, orgOwnerId, object, attrs, {
    q: params.get("q") ?? undefined,
    sort: params.get("sort") ?? undefined,
    direction: params.get("direction") === "desc" ? "desc" : "asc",
    page: Number(params.get("page") ?? 1),
    pageSize: Number(params.get("pageSize") ?? 50),
    filters,
    ids: idList,
  });
  if (!result.ok) {
    if (result.status >= 500) {
      return missingTableResponse(result.error) ?? NextResponse.json({ error: dbErrorMessage({ message: result.error }) }, { status: 500 });
    }
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // The names behind this page's link and team-member cells, so the screen doesn't need a second
  // round trip to show them.
  const linkIds = new Set<string>();
  const memberIds = new Set<string>();
  for (const a of attrs) {
    if (a.archived_at || (a.type !== "record_ref" && a.type !== "member")) continue;
    for (const rec of result.records) {
      const v = rec.values[a.slug];
      if (typeof v === "string") (a.type === "member" ? memberIds : linkIds).add(v);
    }
  }
  const names: Record<string, string> = {};
  await Promise.all([
    linkIds.size
      ? svc.from("data_records").select("id, name").eq("org_owner_id", orgOwnerId).in("id", [...linkIds]).then(({ data }) => {
          for (const row of data ?? []) names[row.id as string] = row.name as string;
        })
      : null,
    memberIds.size
      ? svc.from("profiles").select("id, display_username").in("id", [...memberIds]).then(({ data }) => {
          for (const row of data ?? []) names[row.id as string] = ((row.display_username as string | null) ?? "").trim() || "Unnamed";
        })
      : null,
  ]);
  return NextResponse.json({ records: result.records, total: result.total, page: result.page, pageSize: result.pageSize, names });
}

/** POST /api/data/records  { object: "people", name, values: { email_addresses: [...] } } */
export async function POST(request: Request) {
  const auth = await requireDataContext(request, "write");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;

  const body = (await request.json().catch(() => null)) as { object?: unknown; name?: unknown; values?: Record<string, unknown> } | null;
  if (!body || typeof body.object !== "string") return NextResponse.json({ error: "object is required." }, { status: 400 });

  const object = await loadObject(svc, orgOwnerId, body.object);
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "write");
  if (denied) return denied;

  const attrs = await loadAttributes(svc, orgOwnerId, object.id);
  const result = await createRecord(svc, { userId, org: orgOwnerId }, object, attrs, { name: body.name, values: body.values });
  if (!result.ok) {
    if (result.status >= 500) return NextResponse.json({ error: dbErrorMessage({ message: result.error }) }, { status: 500 });
    return NextResponse.json({ error: result.error, errors: result.errors, existingId: result.existingId }, { status: result.status });
  }
  return NextResponse.json({ record: result.record }, { status: 201 });
}
