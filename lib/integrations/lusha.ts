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
