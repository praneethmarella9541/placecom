import { NextResponse } from "next/server";

import { getProviderKey } from "@/lib/integrations/connections";
import { lushaFilterValues } from "@/lib/integrations/lusha";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; values: string[] }>();

/**
 * GET /api/integrations/lusha/suggest?field=companies|countries&q=text
 *
 * Suggestions while typing in Find people. Never errors the screen: when Lusha can't answer, the
 * list is just empty and the person can keep typing.
 */
export async function GET(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  if ((field !== "companies" && field !== "countries") || q.length < 2) return NextResponse.json({ values: [] });

  const key = `${ctx.mailboxOwnerId}|${field}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ values: hit.values });

  const apiKey = await getProviderKey(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!apiKey) return NextResponse.json({ values: [] });

  try {
    let values: string[];
    if (field === "companies") {
      values = await lushaFilterValues(apiKey, "companies", "names", q);
    } else {
      const all = await lushaFilterValues(apiKey, "contacts", "countries");
      values = all.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
    }
    values = values.slice(0, 8);
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), values });
    return NextResponse.json({ values });
  } catch {
    return NextResponse.json({ values: [] });
  }
}
