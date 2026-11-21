"use client";

import { useState } from "react";
import { titleCase } from "@/lib/title-case";
import { GOOGLE_OAUTH_SCOPES } from "@/lib/google-config";
import { createClient } from "@/lib/supabase";
import { clearClientData } from "@/lib/clear-client-data";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { hiddenFeatureSet } from "@/lib/module-visibility";

/**
 * Profile → "Own mailbox" (BYOM). Connects the member's own Gmail through the same Google
 * sign-in the login page uses, marked as a connect request first so the callback attaches it
 * (lib/byom-onboarding.ts); or disconnects it. Hidden for admins — their Gmail is the common
 * mailbox — and when the module is off.
 */
export function OwnMailboxField({ role }: { role: string }) {
  const { me } = useMeMailbox();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (role === "admin" || !me || hiddenFeatureSet(me).has("byom")) return null;
  const own = me.mailboxes?.find((m) => m.type === "individual") ?? null;

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me/mailboxes/connect", { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not start connecting");
      const { error } = await createClient().auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/inbox")}`,
          scopes: GOOGLE_OAUTH_SCOPES,
          // Same as the login page: consent re-issues the refresh token the mailbox needs.
          queryParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent" },
        },
      });
      if (error) throw error;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start connecting");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect your own mailbox?\n\nThis revokes The Nucleus's access to your Gmail and stops any scheduled sends from it. The common mailbox is not affected."
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me/mailboxes", { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not disconnect");
      clearClientData();
      window.location.assign("/profile");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not disconnect");
      setBusy(false);
    }
  }

  return (
    <div>
      <dt className="text-xs font-bold text-[var(--color-text)]">{titleCase("Own mailbox")}</dt>
      <dd className="mt-0.5 text-[var(--color-text)]">{own?.address || titleCase("Not connected")}</dd>
      <div className="mt-1.5">
        {own ? (
          <button
            type="button"
            onClick={() => void disconnect()}
            disabled={busy}
            className="text-xs font-semibold text-[var(--color-danger)] hover:underline disabled:opacity-60"
          >
            {busy ? titleCase("Disconnecting…") : titleCase("Disconnect own mailbox")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="text-xs font-semibold text-[var(--color-copper)] hover:underline disabled:opacity-60"
          >
            {busy ? titleCase("Opening Google…") : titleCase("Connect with Google")}
          </button>
        )}
        {msg && (
          <p className="mt-1 text-xs text-[var(--color-danger)]" role="status">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
