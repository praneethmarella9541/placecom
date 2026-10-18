"use client";

import { useEffect, useState } from "react";
import { useModuleVisibility } from "@/lib/module-visibility";

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
 * Always `false` while /configs has the Lusha module switched off (or the viewer's group blocks it),
 * so every Lusha entry point disappears together.
 */
export function useLushaConnected(): boolean | null {
  const { isVisible, loaded } = useModuleVisibility();
  const moduleOn = isVisible("lusha");
  const [connected, setConnected] = useState<boolean | null>(cached);
  useEffect(() => {
    if (!moduleOn) return;
    let live = true;
    void (cached === null ? load() : Promise.resolve(cached)).then((c) => {
      if (live) setConnected(c);
    });
    return () => {
      live = false;
    };
  }, [moduleOn]);
  if (!loaded) return null;
  return moduleOn ? connected : false;
}
