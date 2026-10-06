import "server-only";
import { Redis } from "@upstash/redis";

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
 *
 * The bucket lives in Upstash Redis, not process memory. Reproduced twice
 * against real Gmail before this existed: two independent buckets (two
 * concurrent server instances, or just two separate script runs seconds
 * apart) each reasoned correctly about *their own* traffic and still drove
 * the account past its real ceiling, because neither could see what the
 * other — or the account's own very recent history — had already spent. A
 * single shared bucket in Redis is what makes "how much has this mailbox
 * spent recently" an actual fact instead of a per-process guess. Falls back
 * to an in-memory bucket (the old behavior, same blind spot) when
 * UPSTASH_REDIS_REST_URL/_TOKEN aren't set, so local dev works without Redis.
 */

function getRedis(): Redis | null {
  // Vercel's own "KV" storage integration provisions Upstash under the hood
  // but injects it as KV_REST_API_URL/_TOKEN, not the raw Upstash names — this
  // project uses that path, so it's checked first; a directly-created Upstash
  // database (not through Vercel) would use the plain UPSTASH_* names instead.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Built once — the client itself is a stateless REST wrapper, safe to reuse. */
const redis = getRedis();

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
 * Confirmed via Google Cloud Console → APIs & Services → Gmail API → Quotas
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
const GMAIL_ACCOUNT_UNITS_PER_MIN = 6000;

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
const PEAK_UNITS_PER_SEC = 45;

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
 * Runs the whole check-refill-spend-with-pacing decision as one atomic Redis
 * operation. Doing this as a Lua script rather than separate GET/SET calls is
 * what makes it safe under real concurrency: two instances calling at the
 * same instant must not both read "tokens: 50, spend 40" and each decrement
 * from the same starting point — Redis runs one script to completion before
 * starting the next, so the read-modify-write is indivisible no matter how
 * many callers arrive together.
 *
 * Returns `{granted: true}` having already spent the tokens, or
 * `{granted: false, waitMs}` — the caller sleeps that long and calls again.
 * Mirrors the in-memory fallback's logic below field-for-field; keep both in
 * sync if the pacing/burst model ever changes.
 */
const SPEND_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local want = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local budget = tonumber(ARGV[4])
local window = tonumber(ARGV[5])
local minGap = tonumber(ARGV[6])
local ttlSeconds = tonumber(ARGV[7])

local data = redis.call('HMGET', key, 'tokens', 'lastRefillAt', 'lastGrantAt')
local tokens = tonumber(data[1])
local lastRefillAt = tonumber(data[2])
local lastGrantAt = tonumber(data[3])

if tokens == nil then
  tokens = burst
  lastRefillAt = now
  lastGrantAt = 0
end

local elapsed = now - lastRefillAt
if elapsed > 0 then
  tokens = math.min(burst, tokens + (elapsed * budget) / window)
  lastRefillAt = now
end

local sinceLastGrant = now - lastGrantAt

if tokens >= want and sinceLastGrant >= minGap then
  tokens = tokens - want
  lastGrantAt = now
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'lastRefillAt', tostring(lastRefillAt), 'lastGrantAt', tostring(lastGrantAt))
  redis.call('EXPIRE', key, ttlSeconds)
  return {1, 0}
end

local waitForTokens = 0
if tokens < want then
  waitForTokens = math.ceil(((want - tokens) * window) / budget)
end
local waitForGap = 0
if sinceLastGrant < minGap then
  waitForGap = minGap - sinceLastGrant
end

redis.call('HMSET', key, 'tokens', tostring(tokens), 'lastRefillAt', tostring(lastRefillAt), 'lastGrantAt', tostring(lastGrantAt))
redis.call('EXPIRE', key, ttlSeconds)
return {0, math.max(waitForTokens, waitForGap)}
`;

/** Idle keys expire rather than persisting forever — a mailbox that goes quiet just cold-starts next time, same as the in-memory fallback would. */
const BUCKET_TTL_SECONDS = 300;

/**
 * Batch gets its own key, not just its own rate — a shared key would mean an
 * idle interactive lane still lets batch's tokens refill at interactive's
 * faster rate (they'd be reading/writing the same banked total), silently
 * undoing the slower pace. Separate keys means the two lanes' worst case is
 * additive (interactive's peak + batch's peak) rather than reserved from one
 * shared pool — deliberately, since batch's target is small enough that even
 * both lanes maxed out at once stays well under Gmail's documented ceiling.
 */
function redisKeyFor(key: string, priority: GmailPriority): string {
  return `gmail-quota:bucket:${key}:${priority}`;
}

async function spendViaRedis(client: Redis, key: string, want: number, priority: GmailPriority): Promise<void> {
  const gapNeeded = minGapMs(want, priority);
  for (;;) {
    const [granted, waitMs] = (await client.eval(
      SPEND_SCRIPT,
      [redisKeyFor(key, priority)],
      [Date.now(), want, burstCapacity(priority), budgetPerMinute(priority), REFILL_WINDOW_MS, gapNeeded, BUCKET_TTL_SECONDS]
    )) as [number, number];
    if (granted === 1) return;
    await new Promise((r) => setTimeout(r, Math.max(1, Math.ceil(waitMs))));
  }
}

/**
 * In-memory bucket path — used both as the local-dev fallback (no Redis
 * configured) and as the resilience fallback when Redis itself is down or
 * over its own plan limit (see redisDown below). Same cross-instance/
 * cold-start blind spot Redis was added to close, but a degraded governor
 * that still paces THIS process is far better than every Gmail call 500ing.
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
 * Once Redis errors (plan limit hit, network blip, outage), every call would
 * otherwise retry it and fail again immediately — paying Redis's round-trip
 * latency for a request we already know will fail, on the hot path of every
 * single Gmail call. Back off from Redis entirely for a cooldown window and
 * run on the in-memory bucket instead; re-probe after it elapses in case the
 * plan limit reset (Upstash's is monthly) or the outage cleared.
 */
const REDIS_DOWN_COOLDOWN_MS = 60_000;
let redisDownUntil = 0;

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

  if (redis && Date.now() >= redisDownUntil) {
    try {
      const queuedAt = Date.now();
      await spendViaRedis(redis, key, want, priority);
      const s = statsFor(key);
      s.calls += 1;
      s.waitMs += Date.now() - queuedAt;
      return;
    } catch (e) {
      // Redis itself failed (plan limit, network, outage) — this must not
      // surface as a 500 to every Gmail caller. Fall through to the
      // in-memory bucket for this call, and skip Redis for a while so the
      // rest of this burst doesn't pay for the same failure one call at a time.
      redisDownUntil = Date.now() + REDIS_DOWN_COOLDOWN_MS;
      console.warn(
        `[gmail-quota] Redis unavailable, falling back to in-memory pacing for ${REDIS_DOWN_COOLDOWN_MS}ms: ${
          e instanceof Error ? e.message : e
        }`
      );
    }
  }

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
    // simply Gmail's own moving-average window still being hot from very
    // recent traffic). Draining now propagates to every instance sharing this
    // Redis key, not just siblings in this process — the whole reason this
    // moved out of local memory.
    if (key) {
      if (redis) {
        await redis
          .hset(redisKeyFor(key, priority), { tokens: "0", lastRefillAt: String(Date.now()) })
          .catch(() => {});
      } else {
        const b = bucketFor(`${key}:${priority}`, priority);
        refill(b, priority);
        b.tokens = 0;
      }
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
      `[gmail-quota] throttled by Gmail (${res.status} ${rateLimitReason(bodyText)}) on attempt ${attempt + 1}; ` +
        `backing off ${Math.round(backoffMs)}ms`
    );

    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}
