"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { createClient } from "@/lib/supabase";
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
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled || !data.user) return;
      posthog.identify(data.user.id, {
        email: me.sessionEmail ?? data.user.email ?? undefined,
        name: me.displayUsername ?? undefined,
        role: me.role,
        group_name: me.groupName ?? undefined,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  // Reset on sign-out so the next person on a shared machine doesn't inherit
  // the previous user's identity — fires regardless of which UI element
  // triggered the sign-out.
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") posthog.reset();
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
