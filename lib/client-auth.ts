import posthog from "posthog-js";

/**
 * Browser-side auth helpers. The Supabase session lives in HttpOnly cookies the page can't read
 * (lib/auth-cookies.ts), so everything here asks the server instead.
 */

export type SessionUser = { id: string; email: string | null; mustSetPassword: boolean };

/** The signed-in user, or null when there is no valid session. */
export async function fetchSessionUser(): Promise<SessionUser | null> {
  try {
    const res = await fetch("/auth/whoami", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const j = (await res.json()) as { user?: SessionUser | null };
    return j.user ?? null;
  } catch {
    return null;
  }
}

/** Hands freshly issued Supabase tokens to the server, which stores them as the HttpOnly session. */
export async function establishSession(tokens: {
  access_token: string;
  refresh_token: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/auth/establish", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokens),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error || "Couldn't sign you in. Try again." };
  } catch {
    return { ok: false, error: "Couldn't sign you in. Try again." };
  }
}

/**
 * Ends the session on the server (refresh tokens revoked, cookies cleared) and forgets the
 * PostHog identity so the next person on a shared machine doesn't inherit it. Every sign-out
 * button goes through here.
 */
export async function signOutClient(): Promise<void> {
  try {
    posthog.reset();
  } catch {
    /* analytics not initialised — nothing to reset */
  }
  await fetch("/auth/signout", { method: "POST", credentials: "same-origin" }).catch(() => {});
}
