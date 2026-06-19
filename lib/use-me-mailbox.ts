"use client";

import { useEffect, useState } from "react";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";

/**
 * Shared, cached access to `/api/me/mailbox`.
 *
 * The endpoint runs several sequential Supabase round trips and used to be
 * fetched independently by the sidebar, header, and workspace chrome — so a
 * cold load showed a blank nav for as long as the slowest request took.
 *
 * This module:
 *  - hydrates instantly from localStorage (returning users see their nav with
 *    feature restrictions already applied → no flash, no blank wait), and
 *  - dedupes concurrent callers behind a single in-flight request.
 */

const STORAGE_KEY = "nucleus:me-mailbox:v1";

let inFlight: Promise<MeMailboxResponse | null> | null = null;
let memoryCache: MeMailboxResponse | null = null;
const subscribers = new Set<(me: MeMailboxResponse) => void>();

export function readCachedMe(): MeMailboxResponse | null {
  if (memoryCache) return memoryCache;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MeMailboxResponse;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(me: MeMailboxResponse) {
  memoryCache = me;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(me));
  } catch {
    /* storage full / unavailable — keep the in-memory copy */
  }
  subscribers.forEach((cb) => cb(me));
}

export function clearMeMailboxCache() {
  memoryCache = null;
  inFlight = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function fetchMeMailbox(): Promise<MeMailboxResponse | null> {
  if (inFlight) return inFlight;
  inFlight = fetch("/api/me/mailbox")
    .then((r) => (r.ok ? (r.json() as Promise<MeMailboxResponse>) : null))
    .then((j) => {
      if (j) writeCache(j);
      return j;
    })
    .catch(() => null)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Returns the cached profile immediately (if any) and revalidates in the
 * background. `loaded` is true once a fresh response has arrived this session.
 */
export function useMeMailbox(): { me: MeMailboxResponse | null; loaded: boolean } {
  const [me, setMe] = useState<MeMailboxResponse | null>(() => readCachedMe());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const onUpdate = (next: MeMailboxResponse) => {
      if (!cancelled) setMe(next);
    };
    subscribers.add(onUpdate);
    void fetchMeMailbox().then((j) => {
      if (cancelled) return;
      if (j) setMe(j);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      subscribers.delete(onUpdate);
    };
  }, []);

  return { me, loaded };
}
