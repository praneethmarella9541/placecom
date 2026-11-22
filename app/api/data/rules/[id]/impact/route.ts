import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";
import { scanRuleImpact } from "@/lib/data-model/rule-engine-bridge";
import { isFormulaEngineEnabled } from "@/lib/data-model/rule-flags";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/data/rules/[id]/impact (admin) — how much of what's already there would fail this rule
 * right now, before an admin turns it on or tightens it. Capped at 1000 records; see
 * lib/data-model/rule-engine-bridge.ts's scanRuleImpact for why.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!(await isFormulaEngineEnabled(svc, orgOwnerId))) {
    return NextResponse.json({ error: "Turn on the formula engine for this workspace to run an impact scan." }, { status: 403 });
  }

  const result = await scanRuleImpact(svc, orgOwnerId, id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}
