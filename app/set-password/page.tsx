"use client";

import { useEffect, useState } from "react";
import { PasswordInput } from "@/components/PasswordInput";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import { createClient } from "@/lib/supabase";
import { MIN_PASSWORD_LENGTH, mustSetPassword } from "@/lib/password-setup";
import { titleCase } from "@/lib/title-case";

/**
 * Where "Forgot password?" ends up: the sign-in link has just signed the person
 * in, so a new password can be set without the old one. Next time they can use
 * it on the login page.
 */
export default function SetPasswordPage() {
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      // Only reachable through a sign-in link; anyone else has nothing to reset.
      if (!user) {
        window.location.replace("/");
        return;
      }
      // Nothing to set: not signed in through a reset link (or already done).
      if (!mustSetPassword(user)) {
        window.location.replace("/inbox");
        return;
      }
      setEmail(user.email ?? null);
      setReady(true);
    });
  }, [supabase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/me/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setBusy(false);
      setError(data.error || "Couldn't save your password. Try again.");
      return;
    }
    setDone(true);
    // Changing the password ends the session, so go to sign-in with the new one
    // (signOut clears whatever is left of it in this browser).
    window.setTimeout(() => {
      void supabase.auth.signOut().finally(() => window.location.replace("/"));
    }, 1500);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.replace("/");
  }

  if (!ready) return <main className="min-h-screen bg-[var(--color-bg)]" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <div className="mb-6 flex justify-center">
          <PlacecomLogo />
        </div>
        <h1 className="text-center font-display text-xl font-bold text-[var(--color-text)]">
          {titleCase("Set a new password")}
        </h1>
        <p className="mt-2 text-center text-[13.5px] text-[var(--color-text-muted)]">
          {email ? (
            <>
              You&apos;re signed in as <span className="font-medium text-[var(--color-text)]">{email}</span>. Choose a
              password to use the next time you sign in.
            </>
          ) : (
            "Choose a password to continue. You'll use it the next time you sign in."
          )}
        </p>

        {done ? (
          <p
            data-testid="set-password-done"
            className="mt-6 rounded-lg bg-[var(--color-success)]/10 px-3 py-2.5 text-center text-sm font-medium text-[var(--color-success)]"
          >
            Password updated. Taking you to the sign-in page. Sign in with your new password.
          </p>
        ) : (
          <form className="mt-6 space-y-3" onSubmit={(e) => void submit(e)}>
            <PasswordInput
              data-testid="set-password-new"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={titleCase("New password")}
              className="landing-input"
            />
            <PasswordInput
              data-testid="set-password-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={titleCase("Confirm new password")}
              className="landing-input"
            />
            <p className="text-[12px] text-[var(--color-text-faint)]">At least {MIN_PASSWORD_LENGTH} characters.</p>
            {error && (
              <p
                data-testid="set-password-error"
                className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-3 py-2 text-[13px] text-[var(--color-danger)]"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              data-testid="set-password-submit"
              disabled={busy || !password || !confirm}
              className="btn-primary-copper w-full"
            >
              {busy ? titleCase("Saving…") : titleCase("Save password")}
            </button>
            <button
              type="button"
              data-testid="set-password-signout"
              onClick={() => void signOut()}
              className="block w-full text-center text-[13px] font-medium text-[var(--color-text-muted)] hover:underline"
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
