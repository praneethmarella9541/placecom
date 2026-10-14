import type { LushaCompanyFilters, LushaContactFilters } from "@/lib/integrations/lusha";
import { splitCompanies } from "@/lib/integrations/enrichment";
import {
  LUSHA_BUSINESS_MODELS,
  LUSHA_COMPANY_TYPES,
  LUSHA_DATA_POINTS,
  LUSHA_SENIORITY,
  LUSHA_FUNDING_ROUNDS,
  LUSHA_REVENUES,
  LUSHA_SIZES,
  rangeKey,
} from "@/lib/integrations/lusha-filters";

export function strList(v: unknown, max = 20): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, max);
}

function intList(v: unknown, max = 100): number[] {
  return (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, max);
}

export function parseLocations(v: unknown): Record<string, string>[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 10)
    .map((l) => {
      const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const loc: Record<string, string> = {};
      for (const k of ["continent", "country", "state", "city"]) if (typeof o[k] === "string" && o[k]) loc[k] = String(o[k]).slice(0, 100);
      return loc;
    })
    .filter((l) => l.country || l.continent);
}

/** Only the size and revenue bands Lusha actually offers are accepted. */
function bands(v: unknown, allowed: { min?: number; max?: number }[]): { min?: number; max?: number }[] {
  const ok = new Set(allowed.map(rangeKey));
  return (Array.isArray(v) ? v : [])
    .map((r) => {
      const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      return { ...(typeof o.min === "number" ? { min: o.min } : {}), ...(typeof o.max === "number" ? { max: o.max } : {}) };
    })
    .filter((r) => ok.has(rangeKey(r)));
}

function year(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1800 && n <= 2100 ? n : undefined;
}

/** Reads the company filters out of a request body, keeping only values Lusha accepts. */
export function parseCompanyFilters(raw: unknown): LushaCompanyFilters {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const { names, domains } = splitCompanies(strList(o.companies));
  const min = year(o.foundedMin);
  const max = year(o.foundedMax);
  return {
    names,
    domains,
    locations: parseLocations(o.companyLocations),
    mainIndustryIds: intList(o.mainIndustryIds),
    subIndustryIds: intList(o.subIndustryIds),
    sizes: bands(o.sizes, LUSHA_SIZES),
    revenues: bands(o.revenues, LUSHA_REVENUES),
    technologies: strList(o.technologies, 20),
    technologiesAll: o.technologiesAll === true,
    foundedYear: min !== undefined || max !== undefined ? { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } : undefined,
    businessModel: strList(o.businessModel, 3).filter((b) => LUSHA_BUSINESS_MODELS.includes(b)),
    companyType: strList(o.companyType, 5).filter((b) => LUSHA_COMPANY_TYPES.includes(b)),
    keywords: strList(o.keywords, 10),
    fundingRounds: strList(o.fundingRounds, 10).filter((r) => LUSHA_FUNDING_ROUNDS.some((f) => f.id === r)),
    fundingIpo: o.fundingIpo === true,
  };
}

/** True when the company side has something to search on. */
export function hasCompanyFilter(c: LushaCompanyFilters): boolean {
  return Boolean(
    c.names?.length || c.domains?.length || c.locations?.length || c.mainIndustryIds?.length || c.subIndustryIds?.length ||
      c.sizes?.length || c.revenues?.length || c.technologies?.length || c.foundedYear || c.businessModel?.length ||
      c.companyType?.length || c.keywords?.length || c.fundingRounds?.length || c.fundingIpo,
  );
}

/** Reads the people filters out of a request body, keeping only values Lusha accepts. */
export function parseContactFilters(raw: unknown): LushaContactFilters {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const dataPointIds = new Set(LUSHA_DATA_POINTS.map((d) => d.id));
  return {
    jobTitles: strList(o.jobTitles),
    countries: strList(o.countries, 10),
    names: strList(o.names),
    departments: strList(o.departments, 16),
    seniorityIds: (Array.isArray(o.seniorityIds) ? o.seniorityIds : []).map(Number).filter((n) => LUSHA_SENIORITY.some((s) => s.id === n)),
    existingDataPoints: strList(o.existingDataPoints, 10).filter((d) => dataPointIds.has(d)),
    existingDataPointsAll: o.existingDataPointsAll === true,
    locations: parseLocations(o.locations),
    jobChangedAfterDate: typeof o.jobChangedAfterDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.jobChangedAfterDate) ? o.jobChangedAfterDate : undefined,
    skills: strList(o.skills, 10),
    previousJobTitles: strList(o.previousJobTitles, 10),
  };
}

/** True when the people side has something to search on (a date or data-point filter alone isn't enough). */
export function hasContactBase(c: LushaContactFilters): boolean {
  return Boolean(
    c.jobTitles?.length || c.countries?.length || c.names?.length || c.departments?.length || c.seniorityIds?.length ||
      c.locations?.length || c.skills?.length || c.previousJobTitles?.length,
  );
}
