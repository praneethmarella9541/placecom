"use client";

import posthog from "posthog-js";

/**
 * Browser side of auth. The session cookie is HttpOnly, so the browser never sees the
 * session: these helpers ask the server instead (`/auth/whoami`, `/auth/establish`,
 * `/auth/signout`).
 */

export type AuthSession =
  | { signedIn: false }
  | { signedIn: true; id: string; email: string | null; mustSetPassword: boolean };

export async function fetchAuthSession(): Promise<AuthSession> {
  try {
    const res = await fetch("/auth/whoami", { cache: "no-store" });
    if (!res.ok) return { signedIn: false };
    const j = (await res.json()) as { user?: { id: string; email: string | null; mustSetPassword: boolean } | null };
    return j.user ? { signedIn: true, ...j.user } : { signedIn: false };
  } catch {
    return { signedIn: false };
  }
}

/**
 * Signs in against Supabase directly from this browser with a client that stores nothing (so
 * Supabase's per-IP rate limiting sees the real client), then hands the resulting tokens to the
 * server, which validates them and writes the HttpOnly session cookie (and enforces that admin
 * accounts don't get a password session — see app/auth/establish/route.ts).
 *
 * Returns null on success, or the error to show.
 */
export async function signInWithPasswordOnServer(
  email: string,
  password: string
): Promise<{ message: string } | null> {
  const { createTransientClient } = await import("@/lib/supabase-transient");
  const { data, error } = await createTransientClient().auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return { message: error?.message ?? "Couldn't sign you in. Try again." };
  }
  try {
    const res = await fetch("/auth/establish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }),
    });
    if (res.ok) return null;
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { message: j.error || "Couldn't sign you in. Try again." };
  } catch {
    return { message: "Couldn't sign you in. Check your connection and try again." };
  }
}

/** Revokes the session on the server and clears its cookies. Callers still navigate afterwards. */
export async function signOutOnServer(): Promise<void> {
  // Don't let the next person on a shared machine inherit this user's PostHog identity.
  try {
    posthog.reset();
  } catch {
    /* analytics not initialised */
  }
  await fetch("/auth/signout", { method: "POST" }).catch(() => {});
}
