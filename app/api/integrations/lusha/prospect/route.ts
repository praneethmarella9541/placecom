import { NextResponse } from "next/server";

import { getConnectionRow } from "@/lib/integrations/connections";
import { estimateCredits, splitCompanies } from "@/lib/integrations/enrichment";
import { lushaProspect, type LushaPerson } from "@/lib/integrations/lusha";
import { logEnrichment, lushaFailure, prepareSpend } from "@/lib/integrations/lusha-spend";
import { LUSHA_DATA_POINTS, LUSHA_SENIORITY } from "@/lib/integrations/lusha-filters";
import { getOrgContext, isOrgError } from "@/lib/org-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const SIZES = [10, 25, 50];

function list(v: unknown, max = 20): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** A search result, as the screen needs it: who they are and what revealing them would cost. */
export type ProspectPerson = {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  domain: string | null;
  location: string | null;
  linkedin: string | null;
  /** Credits to reveal each field, or null when Lusha didn't say. 0 means already paid for. */
  revealCost: { emails: number | null; phones: number | null };
  /** Set when this person is already a contact, so the screen can say so. */
  inContactId: string | null;
};

function cost(p: LushaPerson, field: string): number | null {
  const c = p.canReveal.find((x) => x.field === field);
  return c ? c.credits : null;
}

/**
 * POST /api/integrations/lusha/prospect { companies, jobTitles, countries?, size?, page?, dryRun? }
 *
 * Search Lusha for people by company and job title. Lusha charges for every result it returns, so
 * `size` is also the most a search can cost: the dry run shows that number, and the real search is
 * refused if the account or the person's monthly cap can't cover it. Results are previews only;
 * emails and phones are revealed separately, per person, once someone is chosen.
 */
export async function POST(request: Request) {
  const orgOrError = await getOrgContext(request);
  if (isOrgError(orgOrError)) return orgOrError;
  const ctx = orgOrError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const companies = splitCompanies(list(body.companies));
  const jobTitles = list(body.jobTitles);
  const countries = list(body.countries, 10);
  const contactNames = list(body.names);
  const departments = list(body.departments, 16);
  const seniorityIds = (Array.isArray(body.seniorityIds) ? body.seniorityIds : [])
    .map(Number)
    .filter((n) => LUSHA_SENIORITY.some((s) => s.id === n));
  const dataPointIds = new Set(LUSHA_DATA_POINTS.map((d) => d.id));
  const existingDataPoints = list(body.existingDataPoints, 10).filter((d) => dataPointIds.has(d));
  const locations = (Array.isArray(body.locations) ? body.locations : [])
    .slice(0, 10)
    .map((l) => {
      const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const loc: Record<string, string> = {};
      for (const k of ["continent", "country", "state", "city"]) if (typeof o[k] === "string" && o[k]) loc[k] = String(o[k]).slice(0, 100);
      return loc;
    })
    .filter((l) => l.country || l.continent);
  const jobChangedAfterDate = typeof body.jobChangedAfterDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.jobChangedAfterDate) ? body.jobChangedAfterDate : undefined;
  const hasBase =
    companies.names.length + companies.domains.length + jobTitles.length + contactNames.length + departments.length + seniorityIds.length + locations.length + countries.length > 0;
  if (!hasBase) {
    return NextResponse.json({ error: "Pick at least a company, job title, name, department, seniority or location." }, { status: 400 });
  }
  const size = SIZES.includes(Number(body.size)) ? Number(body.size) : 25;
  const page = Math.max(0, Math.min(1000, Math.floor(Number(body.page) || 0)));

  const connection = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!connection || connection.status !== "connected") {
    return NextResponse.json(
      { error: "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.", code: "not_connected" },
      { status: 400 },
    );
  }
  // The most a search can charge: its price per result, for every result on the page.
  const estimate = estimateCredits(connection.usage?.pricing, [], size);
  if (body.dryRun === true) return NextResponse.json({ size, estimatedCredits: estimate });

  const spend = await prepareSpend(ctx, estimate);
  if (!spend.ok) return NextResponse.json({ error: spend.error, code: spend.code }, { status: spend.status });

  let result;
  try {
    result = await lushaProspect(
      spend.apiKey,
      {
        companyNames: companies.names,
        companyDomains: companies.domains,
        jobTitles,
        countries,
        names: contactNames,
        departments,
        seniorityIds,
        locations,
        existingDataPoints,
        existingDataPointsAll: body.existingDataPointsAll === true,
        jobChangedAfterDate,
      },
      { page, size },
    );
  } catch (e) {
    return lushaFailure(ctx, e);
  }

  await logEnrichment(ctx.svc, {
    ownerId: ctx.mailboxOwnerId,
    userId: ctx.userId,
    contactId: null,
    kind: "search",
    outcome: result.people.length > 0 ? "found" : "not_found",
    creditsCharged: result.billing.creditsCharged,
    revealed: null,
  });

  // Who is already in the directory: by LinkedIn link, or the same name at the same company.
  const links = result.people.map((p) => p.linkedin).filter((v): v is string => !!v);
  const names = result.people.map((p) => p.fullName).filter(Boolean);
  const [byLink, byName] = await Promise.all([
    links.length ? ctx.supabase.from("directory_contacts").select("id, linkedin_url").in("linkedin_url", links) : Promise.resolve({ data: [] }),
    names.length ? ctx.supabase.from("directory_contacts").select("id, name, company").in("name", names) : Promise.resolve({ data: [] }),
  ]);
  const linkIndex = new Map(((byLink.data ?? []) as { id: string; linkedin_url: string }[]).map((c) => [c.linkedin_url.replace(/\/+$/, "").toLowerCase(), c.id]));
  const nameIndex = new Map(((byName.data ?? []) as { id: string; name: string; company: string | null }[]).map((c) => [`${c.name.toLowerCase()}|${(c.company ?? "").toLowerCase()}`, c.id]));

  const people: ProspectPerson[] = result.people
    .filter((p) => !p.error && p.id)
    .map((p) => ({
      id: p.id as string,
      fullName: p.fullName,
      firstName: p.firstName,
      lastName: p.lastName,
      title: p.title,
      company: p.company,
      domain: p.domain,
      location: p.location,
      linkedin: p.linkedin,
      revealCost: { emails: cost(p, "emails"), phones: cost(p, "phones") },
      inContactId:
        (p.linkedin ? linkIndex.get(p.linkedin.replace(/\/+$/, "").toLowerCase()) : undefined) ??
        nameIndex.get(`${p.fullName.toLowerCase()}|${(p.company ?? "").toLowerCase()}`) ??
        null,
    }));

  return NextResponse.json({ people, total: result.total, page: result.page, size, creditsCharged: result.billing.creditsCharged });
}
