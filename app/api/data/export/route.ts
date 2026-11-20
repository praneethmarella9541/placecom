import { NextResponse } from "next/server";
import { missingTableResponse, objectDenied, requireDataContext } from "@/lib/data-model/access";
import { csvRow } from "@/lib/data-model/csv";
import { listRecords, loadAttributes, loadObject, parseSourceParam } from "@/lib/data-model/records";
import type { AttributeDef, FilterOp, RecordFilter } from "@/lib/data-model/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ROWS = 50_000;
const PAGE = 1000;
const OPS = new Set<FilterOp>(["eq", "neq", "contains", "before", "after", "empty", "not_empty"]);

function plain(attr: AttributeDef, v: unknown, names: Map<string, string>): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => plain(attr, x, names)).join("; ");
  if (attr.type === "record_ref" || attr.type === "member") return names.get(String(v)) ?? String(v);
  return String(v);
}

/**
 * GET /api/data/export?object=people&q=&sort=&direction=&filter=...&columns=slug,slug
 * The records a table is showing (every page of them), as CSV. Names stand in for links and team
 * members. Capped at 50,000 rows.
 */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const params = new URL(request.url).searchParams;
  const object = await loadObject(svc, orgOwnerId, params.get("object") ?? "");
  if (!object) return NextResponse.json({ error: "Unknown object." }, { status: 404 });
  const denied = objectDenied(auth.ctx, object, "read");
  if (denied) return denied;
  const attrs = (await loadAttributes(svc, orgOwnerId, object.id)).filter((a) => !a.archived_at);

  const wanted = params.get("columns");
  const columns = wanted ? wanted.split(",").map((s) => attrs.find((a) => a.slug === s)).filter((a): a is AttributeDef => !!a) : attrs;

  const filters: RecordFilter[] = [];
  for (const raw of params.getAll("filter").slice(0, 10)) {
    const [attribute, op, ...rest] = raw.split(":");
    if (!attribute || !OPS.has(op as FilterOp)) return NextResponse.json({ error: "Bad filter." }, { status: 400 });
    filters.push({ attribute, op: op as FilterOp, value: rest.join(":") || undefined });
  }

  const lines = [csvRow(["Name", ...columns.map((c) => c.name)])];
  const refTargets = columns.filter((c) => c.type === "record_ref" && c.config.target_object);
  const hasMembers = columns.some((c) => c.type === "member");
  const names = new Map<string, string>();
  if (hasMembers) {
    const { data } = await svc.from("profiles").select("id, display_username").or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`);
    for (const m of data ?? []) names.set(m.id as string, ((m.display_username as string | null) ?? "").trim() || "Unnamed");
  }

  for (let page = 1; (page - 1) * PAGE < MAX_ROWS; page++) {
    const result = await listRecords(svc, orgOwnerId, object, attrs, {
      q: params.get("q") ?? undefined,
      sort: params.get("sort") ?? "name",
      direction: params.get("direction") === "desc" ? "desc" : "asc",
      page,
      pageSize: PAGE,
      filters,
      source: parseSourceParam(params.get("source"), object.slug),
    });
    if (!result.ok) return missingTableResponse(result.error) ?? NextResponse.json({ error: result.status >= 500 ? "Something went wrong. Please try again." : result.error }, { status: result.status });

    // Names for this page's links, one query per linked object.
    for (const col of refTargets) {
      const ids = [...new Set(result.records.map((r) => r.values[col.slug]).filter((v): v is string => typeof v === "string" && !names.has(v)))];
      if (!ids.length) continue;
      const target = await loadObject(svc, orgOwnerId, col.config.target_object!);
      if (!target) continue;
      const { data } = await svc.from("data_records").select("id, name").eq("org_owner_id", orgOwnerId).eq("object_id", target.id).in("id", ids);
      for (const row of data ?? []) names.set(row.id as string, row.name as string);
    }

    for (const rec of result.records) lines.push(csvRow([rec.name, ...columns.map((c) => plain(c, rec.values[c.slug], names))]));
    if (result.records.length < PAGE) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${object.slug}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
