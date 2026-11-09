/**
 * Application-enforced session limits (CASA 2.2.1: sessions must expire, not only end on sign-out).
 *
 * Supabase's own inactivity timeout and time-box are Pro-plan settings, so the application
 * enforces both itself. A signed, HttpOnly cookie records when the current Supabase session was
 * first seen and when it was last used:
 *
 *  - idle limit: no request for SESSION_IDLE_MINUTES (default 480) ends the session;
 *  - absolute limit: SESSION_MAX_HOURS (default 168, seven days) after it began ends it,
 *    however active it is.
 *
 * Ending a session means the middleware revokes it at Supabase (global sign-out, so every refresh
 * token goes) and clears the cookies; the next request is signed out. The cookie is bound to the
 * Supabase session id, so a new sign-in starts a fresh clock, and signed with HMAC-SHA256, so the
 * browser cannot extend its own session by editing it. Web Crypto only: this runs in the Edge
 * middleware.
 */

export const SESSION_ACTIVITY_COOKIE = "nu-session";
/** Cookie is rewritten at most this often, so busy pages don't set it on every request. */
const REFRESH_AFTER_MS = 60_000;

export type SessionLimits = { idleMs: number; maxMs: number };

export function sessionLimitsFromEnv(env: Record<string, string | undefined> = process.env): SessionLimits {
  const idleMin = parseInt(env.SESSION_IDLE_MINUTES ?? "", 10);
  const maxHours = parseInt(env.SESSION_MAX_HOURS ?? "", 10);
  return {
    idleMs: (Number.isFinite(idleMin) && idleMin > 0 ? idleMin : 480) * 60_000,
    maxMs: (Number.isFinite(maxHours) && maxHours > 0 ? maxHours : 168) * 3_600_000,
  };
}

export function sessionSecretFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  return env.SESSION_ACTIVITY_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || null;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  let s = "";
  for (const b of mac) s += b.toString(16).padStart(2, "0");
  return s;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export type SessionVerdict =
  | { state: "expired"; reason: "idle" | "max" }
  | { state: "ok"; setCookie: string | null };

/**
 * Decide what to do with a signed-in request. `bindTo` is the Supabase session id (user id when the
 * token carries none). A missing, malformed, forged or other-session cookie starts a new clock,
 * which is what a first request after sign-in looks like.
 */
export async function evaluateSession(opts: {
  cookie: string | undefined;
  bindTo: string;
  secret: string;
  limits: SessionLimits;
  now?: number;
}): Promise<SessionVerdict> {
  const now = opts.now ?? Date.now();
  const fresh = async () => ({
    state: "ok" as const,
    setCookie: `${now}.${now}.${await sign(opts.secret, `${opts.bindTo}.${now}.${now}`)}`,
  });

  const parts = (opts.cookie ?? "").split(".");
  if (parts.length !== 3) return fresh();
  const [startedS, lastS, mac] = parts;
  const started = Number(startedS);
  const last = Number(lastS);
  if (!Number.isFinite(started) || !Number.isFinite(last)) return fresh();
  if (!safeEqual(mac, await sign(opts.secret, `${opts.bindTo}.${started}.${last}`))) return fresh();

  if (now - started > opts.limits.maxMs) return { state: "expired", reason: "max" };
  if (now - last > opts.limits.idleMs) return { state: "expired", reason: "idle" };
  if (now - last < REFRESH_AFTER_MS) return { state: "ok", setCookie: null };
  return { state: "ok", setCookie: `${started}.${now}.${await sign(opts.secret, `${opts.bindTo}.${started}.${now}`)}` };
}
