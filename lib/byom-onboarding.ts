import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isByomEnabled } from "@/lib/mailbox-context";
import { invalidateMailboxTokenCache } from "@/lib/mailbox-google-token";
import { invalidateResolvedMailboxCache } from "@/lib/mailbox-google-access";
import { signupOrgForEmail } from "@/lib/byom-signup-domains";

/**
 * Bring Your Own Mailbox: what a Google sign-in does to the caller's mailboxes.
 * Runs in the OAuth callback (app/auth/callback/exchange) right after their
 * Google credentials are stored, with the service role — 0083 keeps
 * profiles.mailbox_owner_id out of the user's own reach.
 *
 *  - Already has an individual mailbox → reconnect it (address, status).
 *  - Not on any team, and their email's domain admits them (an admin-added
 *    sign-up domain, or the domain of the org's common mailbox — see
 *    lib/byom-signup-domains.ts) → join that org as staff with their own
 *    mailbox. No access to the common mailbox until an admin grants it (0084).
 *  - Already on a team (a staff member who signs in with a password today),
 *    and they asked to connect their mailbox from Settings → becomes theirs.
 *    Without that request, signing in with Google changes nothing for them.
 *  - Anyone else → nothing; a stranger still lands on /no-access.
 *
 * Admins are left alone: their Gmail is the common mailbox.
 *
 * A Google sign-in normally gets its profiles row from the on_auth_user_created
 * trigger (0015). If that row is missing, the account is treated as not on a
 * team, and joining creates the row.
 */

/** Set by POST /api/me/mailboxes/connect right before Settings starts the Google sign-in. */
export const BYOM_CONNECT_COOKIE = "nucleus_byom_connect";

export type OnboardingOutcome = "joined" | "connected" | "reconnected" | "skipped";

export async function attachIndividualMailbox(
  svc: SupabaseClient,
  params: { userId: string; email: string | null; connectRequested: boolean }
): Promise<OnboardingOutcome> {
  const { userId, email, connectRequested } = params;
  if (!(await isByomEnabled(svc))) return "skipped";

  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role === "admin") return "skipped";

  const done = (outcome: OnboardingOutcome) => {
    invalidateMailboxTokenCache(userId);
    invalidateResolvedMailboxCache(userId);
    return outcome;
  };

  const { data: existing, error: existingErr } = await svc
    .from("mailboxes")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("mailbox_type", "individual")
    .maybeSingle();
  if (existingErr) return "skipped"; // 0084 not applied
  if (existing) {
    await svc
      .from("mailboxes")
      .update({ status: "active", gmail_address: email, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return done("reconnected");
  }

  let orgOwnerId = (profile?.mailbox_owner_id as string | null) ?? null;
  let outcome: OnboardingOutcome = "connected";
  if (orgOwnerId) {
    if (!connectRequested) return "skipped";
  } else {
    orgOwnerId = await signupOrgForEmail(svc, email);
    if (!orgOwnerId) return "skipped";
    const now = new Date().toISOString();
    const { error: joinErr } = profile
      ? await svc
          .from("profiles")
          .update({ mailbox_owner_id: orgOwnerId, updated_at: now })
          .eq("id", userId)
          .is("mailbox_owner_id", null)
      : await svc.from("profiles").insert({
          id: userId,
          role: "staff",
          mailbox_owner_id: orgOwnerId,
          display_username: email ? email.split("@")[0] : null,
        });
    if (joinErr) {
      console.error("[byom-onboarding] could not join org", joinErr.message);
      return "skipped";
    }
    outcome = "joined";
  }

  const { error: insertErr } = await svc.from("mailboxes").insert({
    org_owner_id: orgOwnerId,
    mailbox_type: "individual",
    owner_user_id: userId,
    gmail_address: email,
  });
  if (insertErr) {
    console.error("[byom-onboarding] could not create individual mailbox", insertErr.message);
    return "skipped";
  }
  return done(outcome);
}

