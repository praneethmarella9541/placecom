import "server-only";

/**
 * Lusha API client.
 *
 * Every account brings its own key (see integration_connections), so nothing here reads a
 * platform-wide credential — the key is passed in per call. Lusha's terms don't allow exposing its
 * API or data through a third party without consent, which is the reason for that design.
 *
 * Docs: https://docs.lusha.com — base URL https://api.lusha.com/v3, key in the `api_key` header.
 */

const DEFAULT_BASE_URL = "https://api.lusha.com/v3";
/** Overridable so the client can be exercised against a local stub; unset in production. */
export function lushaBaseUrl(): string {
  return (process.env.LUSHA_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export type LushaErrorCode =
  | "invalid_key" // 401 — Lusha does not recognise the key
  | "inactive" // 403 — account inactive, or the plan lacks this feature
  | "no_credits" // 402 — the credit pool is empty
  | "rate_limited" // 429 — per-minute/hour/day limit hit
  | "unavailable" // network failure, timeout or a 5xx from Lusha
  | "unexpected"; // anything else

export class LushaError extends Error {
  readonly code: LushaErrorCode;
  readonly status?: number;
  /** Seconds Lusha asked us to wait, when it said. */
  readonly retryAfterSec?: number;

  constructor(code: LushaErrorCode, message: string, opts: { status?: number; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "LushaError";
    this.code = code;
    this.status = opts.status;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;

type RequestOptions = { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number };

/** One call to Lusha, with a hard timeout and Lusha's status codes turned into typed errors. */
export async function lushaRequest<T>(apiKey: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = `${lushaBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        api_key: apiKey,
        Accept: "application/json",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new LushaError(
      "unavailable",
      timedOut ? "Lusha took too long to answer." : "Could not reach Lusha.",
    );
  }

  if (res.ok) {
    return (await res.json().catch(() => ({}))) as T;
  }

  const detail = await res
    .json()
    .then((j: unknown) => {
      const o = j as { message?: unknown; error?: unknown };
      return typeof o?.message === "string" ? o.message : typeof o?.error === "string" ? o.error : "";
    })
    .catch(() => "");

  switch (res.status) {
    case 401:
      throw new LushaError("invalid_key", "Lusha did not accept this API key.", { status: 401 });
    case 402:
      throw new LushaError("no_credits", "This Lusha account is out of credits.", { status: 402 });
    case 403:
      throw new LushaError(
        "inactive",
        "Lusha says this account is inactive or its plan does not include API access.",
        { status: 403 },
      );
    case 429: {
      const retry = Number(res.headers.get("retry-after"));
      throw new LushaError("rate_limited", "Lusha's rate limit was reached. Try again in a minute.", {
        status: 429,
        retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : undefined,
      });
    }
    default:
      if (res.status >= 500) {
        throw new LushaError("unavailable", "Lusha is having trouble right now.", { status: res.status });
      }
      throw new LushaError("unexpected", detail || `Lusha returned an unexpected response (${res.status}).`, {
        status: res.status,
      });
  }
}

type RateWindow = { limit: number; used: number; remaining: number; resetsAt: string | null } | null;

export type LushaUsage = {
  credits: { total: number; used: number; remaining: number };
  rateLimits: { daily: RateWindow; hourly: RateWindow; minute: RateWindow };
  plan: { category: string | null; renewalType: string | null; startDate: string | null; endDate: string | null };
  /** What each action costs on this plan, keyed by Lusha's own action names; shown, never hardcoded. */
  pricing: Record<string, { credits: number; perQuantity: number }>;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function window(v: unknown): RateWindow {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return { limit: num(o.limit), used: num(o.used), remaining: num(o.remaining), resetsAt: str(o.resetsAt) };
}

/** Shape the account-usage response defensively: Lusha has changed field names between docs versions. */
export function parseLushaUsage(raw: unknown): LushaUsage {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const credits = (o.credits && typeof o.credits === "object" ? o.credits : {}) as Record<string, unknown>;
  const rate = (o.rateLimits && typeof o.rateLimits === "object" ? o.rateLimits : {}) as Record<string, unknown>;
  const plan = (o.plan && typeof o.plan === "object" ? o.plan : {}) as Record<string, unknown>;

  const pricing: LushaUsage["pricing"] = {};
  if (o.pricing && typeof o.pricing === "object") {
    for (const [key, value] of Object.entries(o.pricing as Record<string, unknown>)) {
      const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      pricing[key] = { credits: num(v.credits), perQuantity: num(v.perQuantity) || 1 };
    }
  }

  return {
    credits: { total: num(credits.total), used: num(credits.used), remaining: num(credits.remaining) },
    rateLimits: { daily: window(rate.daily), hourly: window(rate.hourly), minute: window(rate.minute) },
    plan: {
      category: str(plan.category),
      renewalType: str(plan.renewalType),
      startDate: str(plan.startDate),
      endDate: str(plan.endDate),
    },
    pricing,
  };
}

/**
 * Credits, rate limits and plan for a key. Spends no credits, which makes it the right way to check
 * a pasted key is real. Lusha limits it to 5 calls a minute, so callers cache the result.
 */
export async function fetchLushaUsage(apiKey: string): Promise<LushaUsage> {
  return parseLushaUsage(await lushaRequest<unknown>(apiKey, "/account/usage"));
}

// ─── Finding and revealing people ────────────────────────────────────────────

export type LushaReveal = "emails" | "phones";

/** How to point Lusha at one person: an id, an email, a LinkedIn URL, or name plus company. */
export type LushaIdentifier = {
  clientReferenceId?: string;
  id?: string;
  linkedinUrl?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
};

export type LushaEmail = { email: string; type: string; confidence: string | null };
export type LushaPhone = { number: string; type: string; doNotCall: boolean };

/** One person as Lusha returned them, reduced to what the workspace uses. */
export type LushaPerson = {
  /** The reference we sent, echoed back; results are not guaranteed to arrive in order. */
  ref: string | null;
  id: string | null;
  fullName: string;
  firstName: string;
  lastName: string;
  title: string | null;
  company: string | null;
  domain: string | null;
  location: string | null;
  linkedin: string | null;
  emails: LushaEmail[];
  phones: LushaPhone[];
  /** What it would cost to reveal, per field, when the person came from a search (0 = already paid for). */
  canReveal: { field: string; credits: number }[];
  /** Set instead of profile data when Lusha could not find or reveal this person. */
  error: { code: string; message: string } | null;
};

export type LushaBilling = { creditsCharged: number; resultsReturned: number };

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A Lusha person record, whether from search, prospecting or enrich — they share most fields. */
export function parseLushaPerson(raw: unknown): LushaPerson {
  const o = obj(raw);
  const job = obj(o.jobTitle);
  const company = obj(o.company);
  const loc = obj(o.location);
  const social = obj(o.socialLinks);
  const err = obj(o.error);

  const firstName = str(o.firstName) ?? "";
  const lastName = str(o.lastName) ?? "";
  const place = [str(loc.city), str(loc.state), str(loc.country)].filter(Boolean).join(", ");

  return {
    ref: str(o.clientReferenceId),
    id: o.id === undefined || o.id === null ? null : String(o.id),
    fullName: str(o.fullName) ?? `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    title: str(job.title),
    company: str(company.name),
    domain: str(company.domain),
    location: place || null,
    linkedin: str(social.linkedin),
    emails: arr(o.emails)
      .map(obj)
      .filter((e) => typeof e.email === "string" && e.email)
      .map((e) => ({ email: String(e.email).trim().toLowerCase(), type: str(e.type) ?? "unknown", confidence: str(e.confidence) })),
    phones: arr(o.phones)
      .map(obj)
      .filter((p) => typeof p.number === "string" && p.number)
      .map((p) => ({ number: String(p.number).trim(), type: str(p.type) ?? "unknown", doNotCall: p.doNotCall === true })),
    canReveal: arr(o.canReveal)
      .map(obj)
      .filter((c) => typeof c.field === "string")
      .map((c) => ({ field: String(c.field), credits: num(c.credits) })),
    error: str(err.code) ? { code: String(err.code), message: str(err.message) ?? "Lusha could not find this person." } : null,
  };
}

function parseBilling(raw: unknown): LushaBilling {
  const b = obj(obj(raw).billing);
  return { creditsCharged: num(b.creditsCharged), resultsReturned: num(b.resultsReturned) };
}

/** What the response says about running out of credits part-way through a request. */
function ranOutOfCredits(raw: unknown): boolean {
  const status = str(obj(raw).status);
  return status === "OUT_OF_CREDITS" || status === "PARTIAL_OUT_OF_CREDITS";
}

export type LushaRevealResult = { people: LushaPerson[]; billing: LushaBilling; outOfCredits: boolean };

/**
 * Find people by identifier and reveal their email and/or phone in one call (up to 100). Charges the
 * search plus each revealed field, and reports what it charged. Anything Lusha cannot match comes
 * back as a person with `error` set rather than failing the whole request.
 */
export async function lushaSearchAndEnrich(
  apiKey: string,
  contacts: LushaIdentifier[],
  reveal: LushaReveal[],
): Promise<LushaRevealResult> {
  if (contacts.length === 0) return { people: [], billing: { creditsCharged: 0, resultsReturned: 0 }, outOfCredits: false };
  const raw = await lushaRequest<unknown>(apiKey, "/contacts/search-and-enrich", {
    method: "POST",
    body: { contacts: contacts.slice(0, 100), reveal, options: { includePartialProfiles: true } },
    timeoutMs: 45_000,
  });
  return {
    people: arr(obj(raw).results).map(parseLushaPerson),
    billing: parseBilling(raw),
    outOfCredits: ranOutOfCredits(raw),
  };
}

/** Reveal email and/or phone for people already found by a search (their Lusha ids), up to 100. */
export async function lushaEnrichByIds(apiKey: string, ids: string[], reveal: LushaReveal[]): Promise<LushaRevealResult> {
  if (ids.length === 0) return { people: [], billing: { creditsCharged: 0, resultsReturned: 0 }, outOfCredits: false };
  const raw = await lushaRequest<unknown>(apiKey, "/contacts/enrich", {
    method: "POST",
    body: { ids: ids.slice(0, 100), reveal },
    timeoutMs: 45_000,
  });
  return {
    people: arr(obj(raw).results).map(parseLushaPerson),
    billing: parseBilling(raw),
    outOfCredits: ranOutOfCredits(raw),
  };
}

/** Company-side filters, used by both the people search and the company search. */
export type LushaCompanyFilters = {
  names?: string[];
  domains?: string[];
  locations?: Record<string, string>[];
  mainIndustryIds?: number[];
  subIndustryIds?: number[];
  sizes?: { min?: number; max?: number }[];
  revenues?: { min?: number; max?: number }[];
  technologies?: string[];
  /** true: uses all the chosen technologies; false: any of them. */
  technologiesAll?: boolean;
  foundedYear?: { min?: number; max?: number };
  businessModel?: string[];
  companyType?: string[];
  keywords?: string[];
  /** People search only: the company's funding stage. */
  fundingRounds?: string[];
  fundingIpo?: boolean;
};

function companyInclude(c: LushaCompanyFilters | undefined, forPeople: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!c) return out;
  if (c.names?.length) out.names = c.names;
  if (c.domains?.length) out.domains = c.domains;
  if (c.locations?.length) out.locations = c.locations;
  if (c.mainIndustryIds?.length) out.mainIndustriesIds = c.mainIndustryIds;
  if (c.subIndustryIds?.length) out.subIndustriesIds = c.subIndustryIds;
  if (c.sizes?.length) out.sizes = c.sizes;
  if (c.revenues?.length) out.revenues = c.revenues;
  if (c.technologies?.length) {
    out.technologies = c.technologies;
    out.technologiesCondition = c.technologiesAll ? "and" : "or";
  }
  if (c.foundedYear && (c.foundedYear.min !== undefined || c.foundedYear.max !== undefined)) out.foundedYear = [c.foundedYear];
  if (c.businessModel?.length) out.businessModel = c.businessModel;
  if (c.companyType?.length) out.companyType = c.companyType;
  if (c.keywords?.length) out.keywords = c.keywords;
  if (forPeople && (c.fundingRounds?.length || c.fundingIpo)) {
    out.funding = {
      ...(c.fundingRounds?.length ? { rounds: c.fundingRounds.map((round) => ({ coverage: "last_round", round })) } : {}),
      ...(c.fundingIpo ? { isIpo: true } : {}),
    };
  }
  return out;
}

/** People-side filters, used by the people search and (to find companies with matching people) the company search. */
export type LushaContactFilters = {
  jobTitles?: string[];
  countries?: string[];
  names?: string[];
  departments?: string[];
  seniorityIds?: number[];
  existingDataPoints?: string[];
  /** true: must have all the chosen details; false: any of them. */
  existingDataPointsAll?: boolean;
  locations?: Record<string, string>[];
  /** "YYYY-MM-DD": only people who changed jobs on or after this day. */
  jobChangedAfterDate?: string;
  /** Skills, previous job titles. */
  skills?: string[];
  previousJobTitles?: string[];
};

function contactInclude(f: LushaContactFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.jobTitles?.length) out.jobTitles = f.jobTitles;
  if (f.countries?.length) out.countries = f.countries;
  if (f.names?.length) out.names = f.names;
  if (f.departments?.length) out.departments = f.departments;
  if (f.seniorityIds?.length) out.seniorityIds = f.seniorityIds;
  if (f.locations?.length) out.locations = f.locations;
  if (f.existingDataPoints?.length) {
    out.existingDataPoints = f.existingDataPoints;
    out.existingDataPointsCondition = f.existingDataPointsAll ? "and" : "or";
  }
  if (f.jobChangedAfterDate) out.jobChangedAfterDate = f.jobChangedAfterDate;
  if (f.skills?.length) out.skills = f.skills;
  if (f.previousJobTitles?.length) out.previousJobTitle = f.previousJobTitles;
  return out;
}

export type LushaProspectFilters = LushaContactFilters & {
  company?: LushaCompanyFilters;
  /** Caps how many people come back per company (1–20). */
  maxPerCompany?: number;
  excludeDnc?: boolean;
};

export type LushaProspectResult = {
  people: LushaPerson[];
  total: number;
  page: number;
  billing: LushaBilling;
};

/**
 * Search Lusha's database for people by company and job title. Returns previews only — no email or
 * phone. Lusha charges at the plan's search rate (see searchRate in enrichment.ts), so `size` sets the
 * most this call can cost; the exact figure is in `billing` on the way back.
 */
export async function lushaProspect(
  apiKey: string,
  filters: LushaProspectFilters,
  opts: { page?: number; size?: number } = {},
): Promise<LushaProspectResult> {
  const contactsInclude = contactInclude(filters);
  const companiesInclude = companyInclude(filters.company, true);

  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const size = Math.min(100, Math.max(10, Math.floor(opts.size ?? 25)));
  const raw = await lushaRequest<unknown>(apiKey, "/contacts/prospecting", {
    method: "POST",
    body: {
      pagination: { page, size },
      filters: {
        ...(Object.keys(contactsInclude).length ? { contacts: { include: contactsInclude } } : {}),
        ...(Object.keys(companiesInclude).length ? { companies: { include: companiesInclude } } : {}),
      },
      options: {
        includePartialProfiles: true,
        ...(filters.excludeDnc ? { excludeDnc: true } : {}),
        ...(filters.maxPerCompany ? { maxContactsPerCompany: filters.maxPerCompany } : {}),
      },
    },
    timeoutMs: 30_000,
  });
  const pagination = obj(obj(raw).pagination);
  return {
    people: arr(obj(raw).results).map(parseLushaPerson),
    total: num(pagination.total),
    page: num(pagination.page),
    billing: parseBilling(raw),
  };
}

/** Pulls display strings out of a filter-values answer, whose shape varies by filter type. */
export function parseFilterValues(raw: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s && !seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  };
  const visit = (v: unknown) => {
    if (typeof v === "string") return add(v);
    if (Array.isArray(v)) return v.forEach(visit);
    const o = obj(v);
    for (const k of ["name", "label", "displayName", "text", "value"]) {
      if (typeof o[k] === "string") return add(o[k]);
    }
  };
  const top = obj(raw);
  visit("values" in top ? top.values : raw);
  return out;
}

/**
 * Valid values for one filter (company names, countries), to suggest while someone types. These
 * lookups don't return people, so they aren't a reveal or search.
 */
export async function lushaFilterValues(
  apiKey: string,
  scope: "companies" | "contacts",
  filterType: string,
  query?: string,
): Promise<string[]> {
  const q = query ? `?query=${encodeURIComponent(query)}` : "";
  const raw = await lushaRequest<unknown>(apiKey, `/${scope}/prospecting/filters/${filterType}${q}`, { timeoutMs: 6_000 });
  return parseFilterValues(raw);
}

export type LushaCompanySuggestion = { name: string; domain: string | null; logoUrl: string | null };

/** Company-name lookup: name, website and logo for each match, so the screen can show them. */
export async function lushaCompanySuggestions(apiKey: string, query: string): Promise<LushaCompanySuggestion[]> {
  const raw = await lushaRequest<unknown>(apiKey, `/companies/prospecting/filters/names?query=${encodeURIComponent(query)}`, { timeoutMs: 6_000 });
  const top = obj(raw);
  const out: LushaCompanySuggestion[] = [];
  for (const v of arr("values" in top ? top.values : raw)) {
    const o = obj(v);
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) continue;
    const domain = [o.domains_homepage, o.fqdn].find((d): d is string => typeof d === "string" && d.trim() !== "") ?? null;
    const logo = typeof o.logoUrl === "string" && /^https:\/\/logo\.lusha\.co\//.test(o.logoUrl) ? o.logoUrl : null;
    out.push({ name, domain: domain ? domain.replace(/^www\./, "").toLowerCase() : null, logoUrl: logo });
  }
  return out;
}

/** Places matching what was typed: countries, states and cities, as Lusha spells them. */
export async function lushaLocationSuggestions(
  apiKey: string,
  query: string,
  scope: "contacts" | "companies" = "contacts",
): Promise<Record<string, string>[]> {
  const raw = await lushaRequest<unknown>(apiKey, `/${scope}/prospecting/filters/locations?query=${encodeURIComponent(query)}`, { timeoutMs: 6_000 });
  const top = obj(raw);
  const out: Record<string, string>[] = [];
  for (const v of arr("values" in top ? top.values : raw)) {
    const o = obj(v);
    const loc: Record<string, string> = {};
    for (const k of ["continent", "country", "state", "city"]) if (typeof o[k] === "string" && o[k]) loc[k] = o[k] as string;
    if (loc.country || loc.continent) out.push(loc);
  }
  return out;
}

export type LushaCompany = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  employees: string | null;
  location: string | null;
  linkedin: string | null;
};

function employeeLabel(v: unknown): string | null {
  const e = obj(v);
  if (typeof e.exact === "number" && e.exact > 0) return e.exact.toLocaleString("en-US");
  const min = typeof e.min === "number" ? e.min : null;
  const max = typeof e.max === "number" ? e.max : null;
  if (min !== null && max !== null) return `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`;
  if (min !== null) return `${min.toLocaleString("en-US")}+`;
  return null;
}

/**
 * Search Lusha's database for companies. Previews only; Lusha charges per result returned, so
 * `size` is also the most this call can cost.
 */
export async function lushaCompanyProspect(
  apiKey: string,
  company: LushaCompanyFilters,
  opts: { page?: number; size?: number } = {},
  /** Only companies that have people matching these. */
  contact: LushaContactFilters = {},
): Promise<{ companies: LushaCompany[]; total: number; page: number; billing: LushaBilling }> {
  const people = contactInclude(contact);
  const page = Math.max(0, Math.floor(opts.page ?? 0));
  const size = Math.min(100, Math.max(10, Math.floor(opts.size ?? 25)));
  const raw = await lushaRequest<unknown>(apiKey, "/companies/prospecting", {
    method: "POST",
    body: {
      pagination: { page, size },
      filters: {
        companies: { include: companyInclude(company, false) },
        ...(Object.keys(people).length ? { contacts: { include: people } } : {}),
      },
      options: { includePartialProfiles: true },
    },
    timeoutMs: 30_000,
  });
  const pagination = obj(obj(raw).pagination);
  const companies = arr(obj(raw).results).map((r): LushaCompany => {
    const o = obj(r);
    const loc = obj(o.location);
    const domain = str(o.domain);
    return {
      id: str(o.id) ?? "",
      name: str(o.name) ?? "",
      domain: domain ? domain.replace(/^www\./, "").toLowerCase() : null,
      industry: str(o.industry),
      employees: employeeLabel(o.employeeCount),
      location: [str(loc.city), str(loc.state), str(loc.country)].filter(Boolean).join(", ") || null,
      linkedin: str(obj(o.socialLinks).linkedin),
    };
  });
  return { companies: companies.filter((c) => c.id && c.name), total: num(pagination.total), page: num(pagination.page), billing: parseBilling(raw) };
}

export type LushaIndustry = { id: number; name: string; subs: { id: number; name: string }[] };

/** Lusha's industry list: each main industry with its sub-industries. */
export async function lushaIndustries(apiKey: string): Promise<LushaIndustry[]> {
  const raw = await lushaRequest<unknown>(apiKey, "/companies/prospecting/filters/industriesLabels", { timeoutMs: 8_000 });
  const top = obj(raw);
  return arr("values" in top ? top.values : raw)
    .map((v): LushaIndustry => {
      const o = obj(v);
      return {
        id: num(o.main_industry_id),
        name: str(o.main_industry) ?? "",
        subs: arr(o.sub_industries)
          .map((x) => ({ id: num(obj(x).id), name: str(obj(x).value) ?? "" }))
          .filter((x) => x.id && x.name),
      };
    })
    .filter((i) => i.id && i.name);
}
