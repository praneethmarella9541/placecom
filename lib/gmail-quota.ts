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
 * Units per minute we allow ourselves, below Gmail's own per-user ceiling
 * (6,000 for this project). Two different things eat that margin:
 *
 *  - This bucket lives in one server instance's memory, so N warm instances
 *    serving the same mailbox each hold their own. Their sum is what Gmail
 *    actually sees, and `fetchGmail`'s backoff covers whatever slips past.
 *  - Gmail's own accounting is not perfectly synchronous with ours.
 *
 * It used to sit at 4,000 — 2,000 units/min permanently unspent purely so an
 * interactive request would find room. That headroom is now dynamic (see
 * INTERACTIVE_RESERVE), so the static margin can be smaller and the batch jobs
 * get the difference back.
 */
function budgetPerMinute(): number {
  const n = parseInt(process.env.GMAIL_QUOTA_UNITS_PER_MIN || "5200", 10);
  if (!Number.isFinite(n) || n < 100) return 5200;
  return n;
}

/**
 * Units held back from batch work while a person is actively using the app.
 * Enough for an inbox list page plus its thread opens without ever queueing
 * behind a 500-message sync page.
 */
function interactiveReserve(): number {
  const n = parseInt(process.env.GMAIL_QUOTA_INTERACTIVE_RESERVE || "1200", 10);
  if (!Number.isFinite(n) || n < 0) return 1200;
  return Math.min(n, Math.floor(budgetPerMinute() / 2));
}

/**
 * How long after an interactive call we keep reserving for it. A person reading
 * mail makes bursty, gappy requests — expiring the reserve the instant one
 * finishes would let a sync refill the bucket during the gap between opening
 * two threads, which is exactly when it must not.
 */
const INTERACTIVE_ACTIVE_MS = 20_000;

/**
 * Batch work yields to people. `interactive` is anything a user is waiting on;
 * `batch` is background scanning (contact sync, CRM evidence, bulk fetch,
 * sequence sends) that should soak up spare capacity and get out of the way.
 */
export type GmailPriority = "interactive" | "batch";

const REFILL_WINDOW_MS = 60_000;

type Bucket = {
  tokens: number;
  lastRefillAt: number;
  /**
   * One queue per lane, so a waiting batch call can never sit in front of an
   * interactive one. A single shared chain made this FIFO across both lanes —
   * an inbox request could land behind a contact sync's 500-message page and
   * wait out the whole thing, which is the head-of-line blocking the reserve
   * exists to prevent. Within a lane, arrival order still holds.
   */
  tailInteractive: Promise<void>;
  tailBatch: Promise<void>;
  /** When an interactive caller last spent — drives the reserve's activation. */
  lastInteractiveAt: number;
};

const buckets = new Map<string, Bucket>();

function bucketFor(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = {
      tokens: budgetPerMinute(),
      lastRefillAt: Date.now(),
      tailInteractive: Promise.resolve(),
      tailBatch: Promise.resolve(),
      lastInteractiveAt: 0,
    };
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
 * Interactive callers spend down to zero. Batch callers must leave
 * INTERACTIVE_RESERVE untouched, but ONLY while someone is actually using the
 * app — a static split would cap a sync at (budget - reserve) forever, even at
 * 3am with nobody logged in, which is slower than having no lanes at all. The
 * reserve is a yield, not a quota.
 *
 * A cost larger than the whole budget would otherwise wait forever, so it is
 * clamped — one oversized call is allowed through and simply drains the bucket.
 */
export async function spendGmailQuota(
  key: string,
  cost: number,
  priority: GmailPriority = "interactive"
): Promise<void> {
  const b = bucketFor(key);
  const want = Math.min(Math.max(cost, 0), budgetPerMinute());
  const isBatch = priority === "batch";

  // Claim the reserve up front, not inside the waiter: a batch call already
  // queued must start yielding the moment a person shows up, rather than only
  // after it reaches the head of its own queue.
  if (!isBatch) b.lastInteractiveAt = Date.now();

  const run = async () => {
    for (;;) {
      refill(b);
      const reserve =
        isBatch && Date.now() - b.lastInteractiveAt < INTERACTIVE_ACTIVE_MS
          ? interactiveReserve()
          : 0;
      if (b.tokens - reserve >= want) {
        b.tokens -= want;
        return;
      }
      const deficit = want - (b.tokens - reserve);
      const ms = Math.ceil((deficit * REFILL_WINDOW_MS) / budgetPerMinute());
      await new Promise((r) => setTimeout(r, Math.min(Math.max(ms, 5), REFILL_WINDOW_MS)));
    }
  };

  const wait = isBatch ? b.tailBatch.then(run) : b.tailInteractive.then(run);

  // The queue advances even when a waiter throws, so one failure can't wedge
  // every later caller behind a rejected tail.
  if (isBatch) b.tailBatch = wait.catch(() => {});
  else b.tailInteractive = wait.catch(() => {});
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
  /** Defaults to "interactive" — background scans must opt into yielding. */
  priority?: GmailPriority;
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
    if (key) await spendGmailQuota(key, cost, opts?.priority);
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
