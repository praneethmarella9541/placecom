import "server-only";

/**
 * Shared Gmail quota governor.
 *
 * Gmail bills *quota units*, not requests, against a per-user "units per
 * minute" ceiling (the 403 `rateLimitExceeded` / `Total Query Cost` error).
 * Before this module every subsystem enforced its own private concurrency
 * constant — 12 in the inbox body prefetch, 8 in folder-counts, 5 in
 * last-mail-interaction, 4 in crm-evidence, 12 in the contact sync — with
 * nothing tracking the *sum*. Concurrency is the wrong knob anyway: eight
 * `threads.get` (10 units each) cost four times eight `labels.get` (1 unit).
 *
 * So callers spend units through a token bucket keyed by mailbox, and the
 * bucket — not a per-caller constant — is what the quota sees.
 */

/** Published unit costs of the Gmail methods this app calls. */
export const GMAIL_COST = {
  threadsList: 10,
  threadsGet: 10,
  threadsModify: 10,
  messagesList: 5,
  messagesGet: 5,
  messagesSend: 100,
  attachmentsGet: 5,
  draftsList: 5,
  draftsGet: 5,
  draftsCreate: 10,
  draftsUpdate: 15,
  labelsList: 1,
  labelsGet: 1,
  historyList: 2,
  getProfile: 1,
} as const;

/**
 * Units per minute we allow ourselves. Deliberately below Gmail's own ceiling:
 * this bucket lives in one server instance's memory, so N warm instances serving
 * the same mailbox each hold their own. The headroom is what keeps their sum
 * under the real limit; `fetchGmail`'s backoff covers whatever slips past.
 */
function budgetPerMinute(): number {
  const n = parseInt(process.env.GMAIL_QUOTA_UNITS_PER_MIN || "4000", 10);
  if (!Number.isFinite(n) || n < 100) return 4000;
  return n;
}

const REFILL_WINDOW_MS = 60_000;

type Bucket = {
  tokens: number;
  lastRefillAt: number;
  /** Serialises waiters so they wake in arrival order instead of all at once. */
  tail: Promise<void>;
};

const buckets = new Map<string, Bucket>();

function bucketFor(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: budgetPerMinute(), lastRefillAt: Date.now(), tail: Promise.resolve() };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket): void {
  const now = Date.now();
  const elapsed = now - b.lastRefillAt;
  if (elapsed <= 0) return;
  const capacity = budgetPerMinute();
  b.tokens = Math.min(capacity, b.tokens + (elapsed * capacity) / REFILL_WINDOW_MS);
  b.lastRefillAt = now;
}

/**
 * Block until `cost` units are available for `key`, then spend them.
 *
 * A cost larger than the whole budget would otherwise wait forever, so it is
 * clamped — one oversized call is allowed through and simply drains the bucket.
 */
export async function spendGmailQuota(key: string, cost: number): Promise<void> {
  const b = bucketFor(key);
  const want = Math.min(Math.max(cost, 0), budgetPerMinute());

  const wait = b.tail.then(async () => {
    for (;;) {
      refill(b);
      if (b.tokens >= want) {
        b.tokens -= want;
        return;
      }
      const deficit = want - b.tokens;
      const ms = Math.ceil((deficit * REFILL_WINDOW_MS) / budgetPerMinute());
      await new Promise((r) => setTimeout(r, Math.min(ms, REFILL_WINDOW_MS)));
    }
  });

  // The queue advances even when a waiter throws, so one failure can't wedge
  // every later caller behind a rejected tail.
  b.tail = wait.catch(() => {});
  return wait;
}

/** Retries exhausted against a quota error — the caller should back off, not fail outright. */
export class GmailRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailRateLimitError";
  }
}

export function isRateLimitedResponse(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  // Gmail's older quota system reports this as 403 with one of these reasons rather than 429.
  if (status === 403) return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(bodyText);
  return false;
}

// Once the per-user window is exhausted nothing succeeds until it rolls over, so
// the backoff has to be able to outlast a full minute: ~1s, 2s, 4s, 8s, 16s, 32s.
const RATE_LIMIT_MAX_ATTEMPTS = 7;
const RATE_LIMIT_MAX_BACKOFF_MS = 60_000;

export type GmailFetchOptions = {
  /** Mailbox this call is billed to — Gmail's quota is per user, so the bucket is too. */
  mailboxKey?: string;
  /** Quota units this call costs; see GMAIL_COST. */
  cost?: number;
};

/**
 * The single entry point every Gmail HTTP call should go through: spends the
 * call's quota units first, then retries with exponential backoff + jitter on
 * 429 and the 403-with-rate-limit-reason variant. Non-quota failures (401, 404,
 * insufficient scope, …) return immediately for the caller's own handling.
 */
export async function fetchGmail(
  url: string,
  init: RequestInit,
  opts?: GmailFetchOptions
): Promise<Response> {
  const cost = opts?.cost ?? 5;
  const key = opts?.mailboxKey;

  for (let attempt = 0; ; attempt++) {
    if (key) await spendGmailQuota(key, cost);
    const res = await fetch(url, init);
    if (res.ok || attempt >= RATE_LIMIT_MAX_ATTEMPTS - 1) return res;

    const bodyText = await res.clone().text();
    if (!isRateLimitedResponse(res.status, bodyText)) return res;

    // We were throttled despite the bucket — another instance (or another app)
    // is spending the same user's quota. Drain our own bucket so every sibling
    // call in this instance backs off too instead of each discovering the wall
    // one at a time.
    if (key) {
      const b = bucketFor(key);
      refill(b);
      b.tokens = 0;
    }

    const retryAfterHeader = res.headers.get("Retry-After");
    // Jitter is a full second rather than 250ms because every in-flight worker
    // hits the quota wall at once — without spreading them out they all wake
    // together and re-exhaust the next window as a thundering herd.
    const backoffMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : Math.min(RATE_LIMIT_MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.random() * 1000;
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}
