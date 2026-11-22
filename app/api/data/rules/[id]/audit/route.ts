import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";
import { listRuleAuditLog } from "@/lib/data-model/rule-audit";

export const runtime = "nodejs";

/** GET /api/data/rules/[id]/audit (admin) — the most recent times this rule blocked, warned, or was bypassed. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const entries = await listRuleAuditLog(svc, orgOwnerId, id);
  return NextResponse.json({ entries });
}
