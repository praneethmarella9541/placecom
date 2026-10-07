"use client";

import { useEffect, useState } from "react";
import { PlacecomLogo } from "@/components/PlacecomLogo";
import { createClient } from "@/lib/supabase";
import { NOT_IN_TEAM_MESSAGE } from "@/lib/team-membership";

/** Landing spot for a signed-in account that no admin has added to a team. */
export default function NoAccessPage() {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, [supabase]);

  async function signOut() {
    setBusy(true);
    await supabase.auth.signOut();
    window.location.replace("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-6">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm">
        <div className="mb-6 flex justify-center">
          <PlacecomLogo />
        </div>
        <h1 className="font-display text-xl font-bold text-[var(--color-text)]">You don&apos;t have access yet</h1>
        <p data-testid="no-access-message" className="mt-3 text-[14px] text-[var(--color-text-muted)]">
          {NOT_IN_TEAM_MESSAGE}
        </p>
        {email && (
          <p className="mt-3 text-[13px] text-[var(--color-text-faint)]">
            Signed in as <span className="font-medium text-[var(--color-text)]">{email}</span>
          </p>
        )}
        <button
          type="button"
          data-testid="no-access-signout"
          disabled={busy}
          onClick={() => void signOut()}
          className="btn-primary-copper mt-6 w-full"
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </main>
  );
}
