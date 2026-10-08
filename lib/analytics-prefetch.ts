"use client";

/**
 * A short-lived, in-browser share of analytics answers, so a request started
 * early can be picked up by the page that needs it:
 *  - hovering "View analytics" on the Team page starts loading before the click;
 *  - the analytics home's answer for a range also serves a member's page for
 *    that range (it already contains every member), so opening one is instant.
 *
 * Entries count as fresh for 20 seconds, and the Team page clears them whenever
 * the team changes, so a member just added is never hidden behind an old answer.
 */

const FRESH_MS = 20_000;

type Entry = { at: number; promise: Promise<unknown> };
const entries = new Map<string, Entry>();

/** `qs` is the query string including "?", e.g. "?from=2026-09-25&to=2026-10-08" or "?allTime=1". */
export function fetchAnalytics<T>(qs: string): Promise<T> {
  const hit = entries.get(qs);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise as Promise<T>;

  const promise = fetch(`/api/admin/analytics${qs}`).then(async (res) => {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error || "Failed to load analytics");
    return json as T;
  });
  entries.set(qs, { at: Date.now(), promise });
  // A failed request must not be handed out again.
  promise.catch(() => {
    if (entries.get(qs)?.promise === promise) entries.delete(qs);
  });
  return promise;
}

/** Start loading ahead of a click (hover/focus). Errors are left for the page to surface. */
export function prefetchAnalytics(qs: string): void {
  fetchAnalytics(qs).catch(() => {});
}

/** Forget everything — call after the team changes. */
export function clearAnalyticsPrefetch(): void {
  entries.clear();
}
