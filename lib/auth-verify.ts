import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is making this request — without a round trip to Supabase on every request.
 *
 * `auth.getUser()` asks Supabase's auth server "is this login still valid?" each time
 * (~200–300 ms away). The middleware did it and then each API route did it again, so
 * every request paid for two before any real work started.
 *
 * Unless AUTH_LOCAL_VERIFY=0, this checks the token inside the server instead:
 * `getClaims()` verifies its signature and expiry against the project's public signing
 * keys (a cached download, no per-request call). That proves Supabase issued the token
 * and it hasn't expired, but not that the user is still allowed: a banned or deleted
 * user's token stays valid until it expires. So a real `getUser()` still runs the first
 * time a session is seen and then every AUTH_RECHECK_SECONDS (default 300), and the user
 * it returned — its app_metadata flags such as must_set_password included — is what
 * requests in between get. A removed user is therefore stopped within one recheck
 * window, and a flag set on a new session is seen immediately (a new session has no
 * cached user, so its first request always does the full check).
 *
 * AUTH_LOCAL_VERIFY=0 = exactly the previous behaviour: getUser() on every call.
 * Anything unexpected — an unsupported key type, a failed key download — falls back to
 * getUser(), so this can only skip a check, never skip a rejection.
 */

export type VerifiedUser = { id: string; email?: string; app_metadata: Record<string, unknown> };

type AuthLike = Pick<SupabaseClient["auth"], "getUser" | "getClaims">;

const checked = new Map<string, { at: number; user: VerifiedUser }>();
const MAX_ENTRIES = 2000;

function slim(u: { id: string; email?: string; app_metadata?: unknown }): VerifiedUser {
  return { id: u.id, email: u.email, app_metadata: { ...((u.app_metadata as Record<string, unknown>) ?? {}) } };
}

async function serverCheck(auth: AuthLike): Promise<VerifiedUser | null> {
  const {
    data: { user },
    error,
  } = await auth.getUser();
  return error || !user ? null : slim(user);
}

/** Test hook. */
export function __resetAuthVerifyCache(): void {
  checked.clear();
}

export async function getVerifiedUser(auth: AuthLike): Promise<VerifiedUser | null> {
  if (process.env.AUTH_LOCAL_VERIFY === "0") return serverCheck(auth);

  let claims: { sub?: string; session_id?: string } | null = null;
  try {
    const { data, error } = await auth.getClaims();
    if (error) {
      // No session at all: nothing to verify, and nothing for the server to say either.
      if ((error as { name?: string }).name === "AuthSessionMissingError") return null;
    } else {
      claims = (data?.claims as { sub?: string; session_id?: string } | undefined) ?? null;
    }
  } catch {
    claims = null;
  }
  // Couldn't verify locally (or the token didn't pass): let the server decide.
  if (!claims?.sub) return serverCheck(auth);

  const key = claims.session_id ?? claims.sub;
  const configured = parseInt(process.env.AUTH_RECHECK_SECONDS ?? "", 10);
  // 0 is valid ("recheck every request"), so only a missing/garbage value falls back to 300.
  const recheckMs = Math.max(0, (Number.isFinite(configured) ? configured : 300) * 1000);
  const now = Date.now();
  const hit = checked.get(key);
  if (hit && hit.user.id === claims.sub && now - hit.at < recheckMs) return hit.user;

  const user = await serverCheck(auth);
  if (!user) {
    checked.delete(key);
    return null;
  }
  if (user.id !== claims.sub) return user; // shouldn't happen; don't cache a mismatch
  if (checked.size >= MAX_ENTRIES) {
    const oldest = checked.keys().next().value;
    if (oldest !== undefined) checked.delete(oldest);
  }
  checked.set(key, { at: now, user });
  return user;
}
