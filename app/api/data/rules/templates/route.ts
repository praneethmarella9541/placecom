import { NextResponse } from "next/server";
import { requireDataContext } from "@/lib/data-model/access";
import { RULE_TEMPLATES } from "@/lib/data-model/rule-templates";

export const runtime = "nodejs";

/** GET /api/data/rules/templates — starter formulas for the "new formula rule" form. Static; no object scope. */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ templates: RULE_TEMPLATES });
}
