import { NextResponse } from "next/server";

import { getProviderKey } from "@/lib/integrations/connections";
import { lushaIndustries, type LushaIndustry } from "@/lib/integrations/lusha";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";

let cached: { at: number; industries: LushaIndustry[] } | null = null;

/** GET /api/integrations/lusha/options?type=industries — Lusha's industry list, kept for a day. */
export async function GET(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  if (new URL(request.url).searchParams.get("type") !== "industries") return NextResponse.json({ industries: [] });
  if (cached && Date.now() - cached.at < 24 * 3_600_000) return NextResponse.json({ industries: cached.industries });

  const apiKey = await getProviderKey(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!apiKey) return NextResponse.json({ industries: [] });
  try {
    const industries = await lushaIndustries(apiKey);
    if (industries.length) cached = { at: Date.now(), industries };
    return NextResponse.json({ industries });
  } catch {
    return NextResponse.json({ industries: [] });
  }
}
