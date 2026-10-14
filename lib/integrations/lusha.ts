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

export type LushaProspectFilters = {
  companyNames?: string[];
  companyDomains?: string[];
  jobTitles?: string[];
  countries?: string[];
};

export type LushaProspectResult = {
  people: LushaPerson[];
  total: number;
  page: number;
  billing: LushaBilling;
};

/**
 * Search Lusha's database for people by company and job title. Returns previews only — no email or
 * phone — and Lusha charges per result returned, so `size` is also the most this call can cost.
 */
export async function lushaProspect(
  apiKey: string,
  filters: LushaProspectFilters,
  opts: { page?: number; size?: number } = {},
): Promise<LushaProspectResult> {
  const contactsInclude: Record<string, unknown> = {};
  if (filters.jobTitles?.length) contactsInclude.jobTitles = filters.jobTitles;
  if (filters.countries?.length) contactsInclude.countries = filters.countries;
  const companiesInclude: Record<string, unknown> = {};
  if (filters.companyNames?.length) companiesInclude.names = filters.companyNames;
  if (filters.companyDomains?.length) companiesInclude.domains = filters.companyDomains;

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
      options: { includePartialProfiles: true },
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
