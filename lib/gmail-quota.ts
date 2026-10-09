import "server-only";

/**
 * Shared Gmail quota governor.
 *
 * Gmail bills *quota units*, not requests, against a per-user "units per
 * minute" ceiling (the 403 `rateLimitExceeded` / `Total Query Cost` error).
 * Before this module every subsystem enforced its own private concurrency
 * constant with nothing tracking the *sum*. Concurrency is the wrong knob
 * anyway: eight `threads.get` (10 units each) cost four times eight
 * `labels.get` (1 unit).
 *
 * So callers spend units through a token bucket keyed by mailbox, and the
 * bucket — not a per-caller constant — is what the quota sees.
 *
 * The bucket lives in process memory. It used to live in Upstash Redis so
 * several server instances shared one view of a mailbox's spend; that cost a
 * network round trip on every Gmail call and was dropped. The trade-off: N warm
 * instances serving the same mailbox each hold their own bucket, which is why
 * the budget below stays well under the real ceiling.
 */

/** Published unit costs of the Gmail methods this app calls. */
export const GMAIL_COST = {
  threadsList: 10,
  threadsGet: 10,
  threadsModify: 10,
  messagesList: 5,
  messagesGet: 5,
  messagesModify: 5,
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
 * Restored from 6,000 back to 15,000 units/min (reported by the project owner;
 * re-check Console if unsure). PEAK_UNITS_PER_SEC below was raised 45 -> 80 so a
 * 25-row search isn't spaced out at ~222ms per threads.get; earlier throttling
 * happened at 90 and 200, so if 403s return, lower GMAIL_PEAK_UNITS_PER_SEC.
 *
 * Originally: confirmed via Google Cloud Console → APIs & Services → Gmail API → Quotas
 * (not the generic 250/sec figure Gmail's docs describe — this project's own
 * enforced number, which is what actually matters). This project's real
 * per-user ceiling was 15,000 units/min; it has since been reduced by Google
 * to 6,000 units/min — almost certainly a consequence of the large synthetic
 * burst reproduction (500+ message runs) done earlier while diagnosing the
 * original throttling, which looks identical to abuse traffic from Google's
 * side. DO NOT repeat that kind of test against the real API again — it cost
 * real, lasting headroom. If this constant is out of date, re-check Console;
 * don't assume the generic Gmail docs number.
 */
const GMAIL_ACCOUNT_UNITS_PER_MIN = 15000;

/**
 * Was 200, then 90, then 45 units/sec — each still produced real
 * "rateLimitExceeded" 403s under ordinary interactive use (confirmed via the
 * logged reason, not guessed), even at 45/sec sustained = 2,700/min, well
 * under the confirmed 6,000/min ceiling above. That gap between "sustained
 * rate is comfortably under the confirmed ceiling" and "still throttled"
 * points at short bursts within a sub-minute window tripping something
 * stricter than the per-minute figure, not the sustained rate itself — so
 * the burst-side knobs (BURST_SECONDS, per-feature concurrency) matter as
 * much as this number. Kept at 45 as the sustained target; see BURST_SECONDS
 * below for the tightened burst-side change made alongside this.
 */
const PEAK_UNITS_PER_SEC = (() => {
  const n = parseInt(process.env.GMAIL_PEAK_UNITS_PER_SEC || "", 10);
  return Number.isFinite(n) && n >= 10 ? n : 80;
})();

/**
 * A bulk background job (the contact sync's mailbox backfill) has no one
 * watching a spinner — unlike opening an inbox, nothing about it needs to
 * finish in seconds. Racing it at the same rate as interactive traffic is
 * exactly what kept colliding with Gmail's real limit: a big, fast burst is
 * the shape of thing that limit exists to catch. Running batch work far
 * slower than interactive, deliberately, is how this is done elsewhere
 * (Attio and comparable tools don't out-clever the rate limit — they just
 * don't race it) rather than continuing to tune constants against an
 * undocumented ceiling. Interactive keeps its own separate, faster lane
 * (PEAK_UNITS_PER_SEC) since a person actually waiting on it is the traffic
 * worth protecting.
 */
const BATCH_UNITS_PER_SEC = 15;

export type GmailPriority = "interactive" | "batch";

function targetUnitsPerSec(priority: GmailPriority): number {
  return priority === "batch" ? BATCH_UNITS_PER_SEC : PEAK_UNITS_PER_SEC;
}

/**
 * Real headroom under the confirmed 6,000/min ceiling (see
 * GMAIL_ACCOUNT_UNITS_PER_MIN above), not the generic 250/sec docs figure —
 * that number stopped being true for this project once Google cut the real
 * quota. Held at 60% of the confirmed ceiling deliberately: this bucket lives
 * in one server instance's memory as a fallback (see spendViaMemory), so N
 * warm instances serving the same mailbox each hold their own, and the
 * confirmed ceiling has already been cut once — there is no margin left to
 * spend hugging it a second time.
 */
const MAX_UNITS_PER_MIN = Math.floor(GMAIL_ACCOUNT_UNITS_PER_MIN * 0.6);

/**
 * Units per minute we allow ourselves for interactive traffic. Batch traffic
 * ignores the env var entirely and derives straight from BATCH_UNITS_PER_SEC —
 * it's meant to stay patient regardless of how the interactive rate is tuned,
 * not inherit a knob meant for a different lane.
 */
function budgetPerMinute(priority: GmailPriority): number {
  if (priority === "batch") return BATCH_UNITS_PER_SEC * 60;
  const n = parseInt(process.env.GMAIL_QUOTA_UNITS_PER_MIN || String(MAX_UNITS_PER_MIN), 10);
  if (!Number.isFinite(n) || n < 100) return MAX_UNITS_PER_MIN;
  return Math.min(n, MAX_UNITS_PER_MIN);
}

const REFILL_WINDOW_MS = 60_000;

/**
 * How many seconds' worth of units the bucket may bank.
 *
 * This is the difference between the rate we intend and the rate Gmail actually
 * sees, so a bucket whose ceiling is a whole minute's budget hands out that
 * entire minute as fast as callers can spend it — a real burst even when the
 * per-minute figure looks conservative.
 *
 * Two things kept refilling that burst. A cold instance starts with a full
 * bucket, and every idle gap tops it back up — including the database and
 * enrichment work the contact sync does between pages, during which no Gmail
 * call is in flight. So each page began by dumping a banked burst at Gmail,
 * getting throttled, draining to zero and backing off.
 *
 * Lowered from 2s to 1s after real throttling persisted even with a sustained
 * rate well under the confirmed 6,000/min ceiling — a sub-minute burst, not
 * the sustained rate, is what was still tripping it. One second is enough to
 * absorb ordinary jitter without banking a burst large enough to matter.
 */
const BURST_SECONDS = 1;

/**
 * Ceiling on banked tokens. Floored at the priciest single call so an oversized
 * one (messages.send, 100 units) can still be granted rather than waiting on a
 * ceiling it can never reach. Batch never sends — its floor only needs to
 * cover its own calls (messages.get/list, history.list), so it gets a much
 * smaller, dedicated floor instead of inheriting interactive's 100-unit one.
 */
function burstCapacity(priority: GmailPriority): number {
  const target = targetUnitsPerSec(priority);
  const perSecond = budgetPerMinute(priority) / 60;
  // Draw across any one-second window is roughly the banked burst plus a second
  // of refill, so the burst gets whatever the sustained rate leaves under the
  // peak allowance. The higher the configured rate, the less banking it can
  // afford — at the clamp above, none at all.
  const headroom = target - perSecond;
  const floor = priority === "batch" ? GMAIL_COST.messagesList : GMAIL_COST.messagesSend;
  return Math.max(floor, Math.ceil(Math.min(perSecond * BURST_SECONDS, headroom)));
}

type Bucket = {
  tokens: number;
  lastRefillAt: number;
  /** When the last grant went out — see minGapMs below. */
  lastGrantAt: number;
  /** Serialises waiters so they wake in arrival order instead of all at once. */
  tail: Promise<void>;
};

const buckets = new Map<string, Bucket>();

/**
 * Per-key counters covering one batch's worth of calls, read and reset by the
 * contact sync's page loop (takeGmailQuotaStats). Until now a slow page was
 * unattributable: waiting on our OWN bucket (a budget that is set too low) and
 * waiting out Gmail's throttle (a real upstream limit) both just looked like
 * "the sync is slow", and the backoff below logged nothing at all.
 */
export type GmailQuotaStats = {
  calls: number;
  /** Total ms spent queued behind the bucket, summed across calls (so it exceeds wall-clock when calls overlap). */
  waitMs: number;
  rateLimitRetries: number;
  backoffMs: number;
};

const stats = new Map<string, GmailQuotaStats>();

function statsFor(key: string): GmailQuotaStats {
  let s = stats.get(key);
  if (!s) {
    s = { calls: 0, waitMs: 0, rateLimitRetries: 0, backoffMs: 0 };
    stats.set(key, s);
  }
  return s;
}

/** Reads the counters for `key` and clears them, so each caller sees only its own window. */
export function takeGmailQuotaStats(key: string): GmailQuotaStats {
  const s = stats.get(key) ?? { calls: 0, waitMs: 0, rateLimitRetries: 0, backoffMs: 0 };
  stats.delete(key);
  return s;
}

function bucketFor(key: string, priority: GmailPriority): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: burstCapacity(priority), lastRefillAt: Date.now(), lastGrantAt: 0, tail: Promise.resolve() };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket, priority: GmailPriority): void {
  const now = Date.now();
  const elapsed = now - b.lastRefillAt;
  if (elapsed <= 0) return;
  // Refills at the per-minute RATE but caps at the much smaller burst ceiling —
  // the two used to be the same number, which is what let a whole minute's
  // budget accumulate and then leave at once.
  b.tokens = Math.min(
    burstCapacity(priority),
    b.tokens + (elapsed * budgetPerMinute(priority)) / REFILL_WINDOW_MS
  );
  b.lastRefillAt = now;
}

/**
 * Floor on the gap between two grants, at PEAK_UNITS_PER_SEC.
 *
 * Token availability alone isn't enough to bound the real, instantaneous rate
 * Gmail sees: a cold or just-refilled bucket can hold burstCapacity() tokens
 * (~134 by default) all at once, and under concurrency those grants resolve
 * back-to-back through the tail chain with no delay between them — draining
 * the whole bank in well under 100ms. That's over 1,000 units/sec for that
 * instant, comfortably past Gmail's real 250/sec ceiling, even though the
 * bucket's steady-state refill rate is a safe ~67/sec. Sizing the burst
 * smaller (BURST_SECONDS) bounds how MUCH can go out at once; it does nothing
 * to bound how FAST, which is the actual thing Gmail measures. This spacing
 * is what turns the bucket from "bursty, bounded in size" into "genuinely
 * rate-limited" — the missing half of the per-second fix.
 */
function minGapMs(cost: number, priority: GmailPriority): number {
  return (cost / targetUnitsPerSec(priority)) * 1000;
}

/**
 * Waits until `want` units are available for `key` and spends them, spacing grants
 * at least `minGapMs` apart so the real instantaneous rate stays bounded.
 */
function spendViaMemory(key: string, want: number, priority: GmailPriority): Promise<void> {
  const queuedAt = Date.now();
  const bucketKey = `${key}:${priority}`;
  const b = bucketFor(bucketKey, priority);

  const wait = b.tail.then(async () => {
    for (;;) {
      refill(b, priority);
      const sinceLastGrant = Date.now() - b.lastGrantAt;
      const gapNeeded = minGapMs(want, priority);
      if (b.tokens >= want && sinceLastGrant >= gapNeeded) {
        b.tokens -= want;
        b.lastGrantAt = Date.now();
        const s = statsFor(key);
        s.calls += 1;
        s.waitMs += Date.now() - queuedAt;
        return;
      }
      if (b.tokens < want) {
        const deficit = want - b.tokens;
        const ms = Math.ceil((deficit * REFILL_WINDOW_MS) / budgetPerMinute(priority));
        await new Promise((r) => setTimeout(r, Math.min(ms, REFILL_WINDOW_MS)));
        continue;
      }
      await new Promise((r) => setTimeout(r, gapNeeded - sinceLastGrant));
    }
  });

  b.tail = wait.catch(() => {});
  return wait;
}

/**
 * Block until `cost` units are available for `key`, then spend them.
 *
 * A cost larger than the whole budget would otherwise wait forever, so it is
 * clamped — one oversized call is allowed through and simply drains the bucket.
 *
 * `priority` defaults to "interactive" — background jobs must opt into the
 * slower "batch" lane explicitly (see lib/people-mailbox-sync.ts), the same
 * way a caller has to opt into anything non-default.
 */
export async function spendGmailQuota(
  key: string,
  cost: number,
  priority: GmailPriority = "interactive"
): Promise<void> {
  const want = Math.min(Math.max(cost, 0), burstCapacity(priority));

  await spendViaMemory(key, want, priority);
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

/**
 * Which ceiling actually tripped. These are NOT interchangeable:
 * - rateLimitExceeded: the per-second moving-average ceiling (Gmail's documented
 *   250 units/sec/user) — a pacing problem, fixable by this module's own bucket.
 * - userRateLimitExceeded: the separate "queries per 100 seconds per user" quota
 *   configured in Google Cloud Console → APIs & Services → Gmail API → Quotas.
 *   That default is often far below 250/sec sustained — no amount of per-second
 *   pacing here can satisfy it; the only fix is requesting a higher quota there.
 * - dailyLimitExceeded / quotaExceeded: a longer-window cap, same fix as above.
 * Logged so the next throttling report says which one, instead of guessing.
 */
function rateLimitReason(bodyText: string): string {
  const m = /"reason"\s*:\s*"([^"]+)"/i.exec(bodyText);
  return m ? m[1] : "unknown";
}

/**
 * Gmail's own wording for the 403 — the reason alone ("rateLimitExceeded") is shared
 * by different limits. "Too many concurrent requests for user" means too many calls
 * in flight at once (fix: fewer in parallel); "User-rate limit exceeded" / "Rate Limit
 * Exceeded" means too many units per second (fix: a lower pace).
 */
function rateLimitMessage(bodyText: string): string {
  const m = /"message"\s*:\s*"([^"]+)"/i.exec(bodyText);
  return m ? m[1].slice(0, 140) : "";
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
  /** Defaults to "interactive" — a background job must opt into "batch" explicitly. */
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
  const priority = opts?.priority ?? "interactive";

  for (let attempt = 0; ; attempt++) {
    if (key) await spendGmailQuota(key, cost, priority);
    const res = await fetch(url, init);
    if (res.ok || attempt >= RATE_LIMIT_MAX_ATTEMPTS - 1) return res;

    const bodyText = await res.clone().text();
    if (!isRateLimitedResponse(res.status, bodyText)) return res;

    // We were throttled despite the bucket — the account's real usage ran
    // ahead of what this bucket knew about (another instance, another app, or
    // Gmail's own moving-average window still hot from recent traffic). Drain
    // it so the next calls wait instead of walking straight back into the wall.
    if (key) {
      const b = bucketFor(`${key}:${priority}`, priority);
      refill(b, priority);
      b.tokens = 0;
    }

    const retryAfterHeader = res.headers.get("Retry-After");
    // Jitter is a full second rather than 250ms because every in-flight worker
    // hits the quota wall at once — without spreading them out they all wake
    // together and re-exhaust the next window as a thundering herd.
    const backoffMs = retryAfterHeader
      ? Number(retryAfterHeader) * 1000
      : Math.min(RATE_LIMIT_MAX_BACKOFF_MS, 1000 * 2 ** attempt) + Math.random() * 1000;

    if (key) {
      const s = statsFor(key);
      s.rateLimitRetries += 1;
      s.backoffMs += backoffMs;
    }
    // Being throttled by Gmail while the local bucket still thinks it has room
    // is the single most useful thing to know about a slow sync, and it used to
    // happen entirely silently. The reason tells us WHICH ceiling this is —
    // see rateLimitReason's doc comment — since the fix differs by reason.
    console.warn(
      `[gmail-quota] throttled by Gmail (${res.status} ${rateLimitReason(bodyText)}: "${rateLimitMessage(bodyText)}") ` +
        `on attempt ${attempt + 1}; backing off ${Math.round(backoffMs)}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}
