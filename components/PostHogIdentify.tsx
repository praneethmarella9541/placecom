"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { fetchSessionUser } from "@/lib/client-auth";
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
    fetchSessionUser().then((user) => {
      if (cancelled || !user) return;
      posthog.identify(user.id, {
        email: me.sessionEmail ?? user.email ?? undefined,
        name: me.displayUsername ?? undefined,
        role: me.role,
        group_name: me.groupName ?? undefined,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  // The reset on sign-out lives in signOutClient() (lib/client-auth.ts), which every
  // sign-out button goes through: the session is an HttpOnly cookie now, so there is no
  // browser-side auth event to listen for.

  return null;
}
