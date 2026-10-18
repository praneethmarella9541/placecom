import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import { estimateCredits, searchRate } from "@/lib/integrations/enrichment";
import { lushaCompanyProspect } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { hasCompanyFilter, hasContactBase, parseCompanyFilters, parseContactFilters } from "@/lib/integrations/lusha-request";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const SIZES = [10, 25, 50];

/**
 * POST /api/integrations/lusha/prospect/companies { ...company and people filters, size?, page?, dryRun? }
 *
 * Search Lusha for companies. Like the people search, Lusha charges per result returned, so `size`
 * is the most a search can cost; the real search is refused if the account or the person's monthly
 * cap can't cover it.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const company = parseCompanyFilters(body);
  const contact = parseContactFilters(body);
  const size = SIZES.includes(Number(body.size)) ? Number(body.size) : 25;
  const page = Math.max(0, Math.min(1000, Math.floor(Number(body.page) || 0)));

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json(
      { error: "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.", code: "not_connected" },
      { status: 400 },
    );
  }
  const estimate = estimateCredits(connection.usage?.pricing, [], size);
  if (body.dryRun === true) return NextResponse.json({ size, estimatedCredits: estimate, rate: searchRate(connection.usage?.pricing, "company") });
  if (!hasCompanyFilter(company) && !hasContactBase(contact)) {
    return NextResponse.json({ error: "Pick at least one filter, such as a name, location, industry or job title." }, { status: 400 });
  }

  if (company.technologies?.length && (hasContactBase(contact) || contact.existingDataPoints?.length || contact.jobChangedAfterDate)) {
    return NextResponse.json(
      { error: "Lusha can't combine the Technology filter with contact filters in a company search. Remove one of them, or search on the Contacts tab." },
      { status: 400 },
    );
  }

  const spend = await prepareSpend(ctx, estimate);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code }, { status: spend.status });

  let result;
  try {
    result = await lushaCompanyProspect(spend.apiKey, company, { page, size }, contact);
  } catch (e) {
    return lushaFailure(ctx, e);
  }

  await logEnrichment(ctx.svc, {
    ownerId: ctx.mailboxOwnerId,
    userId: ctx.userId,
    contactId: null,
    kind: "search",
    outcome: result.companies.length > 0 ? "found" : "not_found",
    creditsCharged: result.billing.creditsCharged,
    revealed: null,
  });

  return NextResponse.json({ companies: result.companies, total: result.total, page: result.page, size, creditsCharged: result.billing.creditsCharged });
}
