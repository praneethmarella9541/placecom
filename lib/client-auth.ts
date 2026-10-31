"use client";

import posthog from "posthog-js";

/**
 * Browser side of auth. The session cookie is HttpOnly, so the browser never sees the
 * session: these helpers ask the server instead.
 */

export type AuthSession =
  | { signedIn: false }
  | { signedIn: true; id: string; email: string | null; mustSetPassword: boolean };

export async function fetchAuthSession(): Promise<AuthSession> {
  try {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return { signedIn: false };
    return (await res.json()) as AuthSession;
  } catch {
    return { signedIn: false };
  }
}

/** Returns null on success, or the error to show. */
export async function signInWithPasswordOnServer(
  email: string,
  password: string
): Promise<{ message: string } | null> {
  try {
    const res = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { message: data.error || "Couldn't sign in. Try again." };
  } catch {
    return { message: "Couldn't sign in. Check your connection and try again." };
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
  await fetch("/api/auth/signout", { method: "POST" }).catch(() => {});
}
