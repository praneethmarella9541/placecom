"use client";

import { useEffect, useState } from "react";

let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

function load(): Promise<boolean> {
  if (!inFlight) {
    inFlight = fetch("/api/integrations", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return false;
        const json = (await res.json()) as { connections?: { lusha?: { connected?: boolean } } };
        return json.connections?.lusha?.connected === true;
      })
      .catch(() => false)
      .then((connected) => {
        cached = connected;
        return connected;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Forget what we know, e.g. after an admin connects or disconnects Lusha. */
export function resetLushaConnected(): void {
  cached = null;
}

/**
 * Whether this workspace has Lusha connected: `null` while unknown, so the page can leave the
 * button out rather than flash it in and out. Shared between components and fetched once.
 */
export function useLushaConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(cached);
  useEffect(() => {
    let live = true;
    void (cached === null ? load() : Promise.resolve(cached)).then((c) => {
      if (live) setConnected(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return connected;
}
