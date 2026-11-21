import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { isId } from "@/lib/data-model/route-helpers";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

const PAGE = 50;

/** GET /api/workflows/[id]/runs?status=failed&page=1 — a workflow's runs, newest first. Works for deleted workflows too. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isId(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.trunc(Number(params.get("page") ?? 1)) || 1);
  const status = params.get("status");

  let q = svc
    .from("workflow_runs")
    .select("id, status, record_id, attempt_no, error, outcome, started_at, finished_at, created_at, next_run_at, version:workflow_versions(version_no)", { count: "exact" })
    .eq("org_owner_id", orgOwnerId)
    .eq("workflow_id", id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status && ["queued", "running", "waiting", "succeeded", "failed", "cancelled"].includes(status)) q = q.eq("status", status);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  const recordIds = [...new Set((data ?? []).map((r) => r.record_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (recordIds.length) {
    const { data: recs } = await svc.from("data_records").select("id, name").eq("org_owner_id", orgOwnerId).in("id", recordIds);
    for (const r of recs ?? []) names.set(r.id as string, (r.name as string) || "Unnamed");
  }
  type Ver = { version_no: number } | { version_no: number }[] | null;
  return NextResponse.json({
    total: count ?? 0,
    page,
    pageSize: PAGE,
    runs: (data ?? []).map((r) => {
      const v = r.version as unknown as Ver;
      return { ...r, version: undefined, version_no: (Array.isArray(v) ? v[0]?.version_no : v?.version_no) ?? null, record_name: r.record_id ? (names.get(r.record_id as string) ?? null) : null };
    }),
  });
}
