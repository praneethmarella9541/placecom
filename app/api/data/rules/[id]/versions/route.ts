import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";
import { listRuleVersions } from "@/lib/data-model/rule-audit";

export const runtime = "nodejs";

/** GET /api/data/rules/[id]/versions (admin) — every stored snapshot of this rule, newest first. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const versions = await listRuleVersions(svc, orgOwnerId, id);
  return NextResponse.json({ versions });
}
