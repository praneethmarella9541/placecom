"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { fetchAuthSession } from "@/lib/client-auth";
import { useMeMailbox } from "@/lib/use-me-mailbox";

/**
 * Ties PostHog events to the signed-in Supabase user instead of an anonymous
 * visitor — mounted once in AppShell, alongside MailboxSessionSync. Uses the
 * Supabase auth user id (stable, globally unique) as the PostHog distinct_id,
 * with role/name/team as person properties from useMeMailbox (already
 * cached/shared across the app, no extra request).
 */
export function PostHogIdentify() {
  const { me } = useMeMailbox();

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void fetchAuthSession().then((s) => {
      if (cancelled || !s.signedIn) return;
      posthog.identify(s.id, {
        email: me.sessionEmail ?? s.email ?? undefined,
        name: me.displayUsername ?? undefined,
        role: me.role,
        group_name: me.groupName ?? undefined,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  // The PostHog reset on sign-out lives in signOutOnServer (lib/client-auth.ts), which every
  // sign-out button goes through.

  return null;
}
