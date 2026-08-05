import "server-only";

import {
  getExotelApiHostCandidates,
  getExotelBasicAuthHeader,
  getExotelCredentials,
} from "@/lib/exotel-config";
import { normalizePhone, phoneMatches } from "@/lib/phone";

const CACHE_MS = 10 * 60 * 1000;
const MAX_PAGES = 20;

let cache: { numbers: string[]; expiresAt: number } | null = null;
let inflight: Promise<string[]> | null = null;

/** Numbers from EXOTEL_VIRTUAL_NUMBERS / EXOTEL_VIRTUAL_NUMBER (fallback when API unavailable). */
function listEnvExotelNumbers(): string[] {
  const out: string[] = [];
  const multi = process.env.EXOTEL_VIRTUAL_NUMBERS?.trim();
  if (multi) {
    for (const part of multi.split(/[,;\s]+/)) {
      const n = normalizePhone(part.trim());
      if (n && !out.some((existing) => phoneMatches(existing, n))) out.push(n);
    }
  } else {
    const single = process.env.EXOTEL_VIRTUAL_NUMBER?.trim();
    if (single) {
      const n = normalizePhone(single);
      if (n) out.push(n);
    }
  }
  return out;
}

function isIndiaNumber(e164: string): boolean {
  return normalizePhone(e164).startsWith("+91");
}

/**
 * Only these lines are shown/assignable — the Exotel account can carry old/
 * deprovisioned numbers that still show up in the API listing but no longer
 * route calls. Add to this list (no env var needed) as new lines go live.
 */
const ACTIVE_VIRTUAL_NUMBERS = ["+917314624915"];

function applyActiveNumberFilter(numbers: string[]): string[] {
  if (ACTIVE_VIRTUAL_NUMBERS.length === 0) return numbers;
  const active = ACTIVE_VIRTUAL_NUMBERS.map((s) => normalizePhone(s)).filter(Boolean);
  return numbers.filter((n) => active.some((a) => phoneMatches(a, n)));
}

function mergeUniqueNumbers(lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const n = normalizePhone(raw);
      if (!n || !isIndiaNumber(n)) continue;
      if (!out.some((existing) => phoneMatches(existing, n))) out.push(n);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function extractPhoneNumbersFromJson(json: unknown): string[] {
  const out: string[] = [];
  if (!json || typeof json !== "object") return out;
  const o = json as Record<string, unknown>;

  const betaList = o.incoming_phone_numbers;
  if (Array.isArray(betaList)) {
    for (const item of betaList) {
      if (item && typeof item === "object") {
        const pn = (item as { phone_number?: string }).phone_number;
        if (pn?.trim()) out.push(pn.trim());
      }
    }
  }

  const response = o.response;
  if (Array.isArray(response)) {
    for (const entry of response) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const data = row.data;
      if (data && typeof data === "object") {
        const pn = (data as { phone_number?: string }).phone_number;
        if (pn?.trim()) out.push(pn.trim());
      }
      const direct = row.phone_number;
      if (typeof direct === "string" && direct.trim()) out.push(direct.trim());
    }
  }

  return out;
}

async function fetchIncomingPhoneNumbersPage(
  host: string,
  creds: { sid: string; apiKey: string; apiToken: string },
  page: number,
  path: "v2_beta" | "v2"
): Promise<{ numbers: string[]; hasMore: boolean }> {
  const base =
    path === "v2_beta"
      ? `https://${host}/v2_beta/Accounts/${encodeURIComponent(creds.sid)}/IncomingPhoneNumbers`
      : `https://${host}/v2/accounts/${encodeURIComponent(creds.sid)}/incoming-phone-numbers`;
  const url = `${base}?Page=${page}&PageSize=50`;
  const res = await fetch(url, {
    headers: { Authorization: getExotelBasicAuthHeader(creds) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Exotel IncomingPhoneNumbers ${res.status} (${host}, ${path})`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const numbers = extractPhoneNumbersFromJson(json);
  const hasMore =
    typeof json.next_page_uri === "string" &&
    json.next_page_uri.trim().length > 0 &&
    numbers.length > 0;
  return { numbers, hasMore };
}

async function fetchAllFromHost(
  host: string,
  creds: { sid: string; apiKey: string; apiToken: string },
  path: "v2_beta" | "v2"
): Promise<string[]> {
  const all: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { numbers, hasMore } = await fetchIncomingPhoneNumbersPage(host, creds, page, path);
    all.push(...numbers);
    if (!hasMore) break;
  }
  return all;
}

async function fetchFromExotelApi(): Promise<string[]> {
  const creds = getExotelCredentials();
  if (!creds) return [];

  const hosts = getExotelApiHostCandidates();
  let lastErr: Error | null = null;

  for (const host of hosts) {
    for (const path of ["v2_beta", "v2"] as const) {
      try {
        const raw = await fetchAllFromHost(host, creds, path);
        const india = mergeUniqueNumbers([raw]);
        if (india.length > 0) return india;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  if (lastErr) throw lastErr;
  return [];
}

/**
 * India (+91) ExoPhones from the Exotel account (cached). Unioned with env fallback.
 * Used for Admin → Team dropdowns and assignment validation.
 */
export async function getExotelVirtualNumbers(opts?: {
  force?: boolean;
}): Promise<string[]> {
  const now = Date.now();
  if (!opts?.force && cache && cache.expiresAt > now) {
    return cache.numbers;
  }
  if (!opts?.force && inflight) return inflight;

  inflight = (async () => {
    try {
      let fromApi: string[] = [];
      try {
        fromApi = await fetchFromExotelApi();
      } catch (e) {
        console.warn(
          "[exotel-numbers] API list failed, using env fallback:",
          e instanceof Error ? e.message : e
        );
      }
      const env = listEnvExotelNumbers();
      const numbers = applyActiveNumberFilter(mergeUniqueNumbers([fromApi, env]));
      cache = { numbers, expiresAt: Date.now() + CACHE_MS };
      return numbers;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Sync snapshot for call routing — returns cache when warm, else env-only +91 numbers.
 * Prefer `getExotelVirtualNumbers()` when you can await (admin UI, webhooks).
 */
export function listConfiguredExotelNumbers(): string[] {
  if (cache && cache.expiresAt > Date.now()) return cache.numbers;
  return applyActiveNumberFilter(mergeUniqueNumbers([listEnvExotelNumbers()]));
}
