"use client";

import { Suspense, useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider, usePostHog } from "posthog-js/react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Initializes PostHog once for the whole app. `capture_pageview: false` here
 * because Next.js App Router doesn't fire router events the way Pages Router
 * did — PageViewTracker below captures $pageview manually on each route
 * change instead (the standard PostHog recipe for App Router).
 *
 * `person_profiles: "identified_only"` — this is an internal, login-gated
 * tool, so the only pre-login traffic is the sign-in screen itself; no need
 * to spend a person-profile on that. Real tracking starts once
 * PostHogIdentify (mounted in AppShell) calls identify() after sign-in.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
    });
  }, []);

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (!pathname || !ph) return;
    let url = window.origin + pathname;
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
    ph.capture("$pageview", { $current_url: url });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams.toString(), ph]);

  return null;
}
