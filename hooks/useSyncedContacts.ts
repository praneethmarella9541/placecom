"use client";

import { useEffect, useRef, useState } from "react";
import type { SyncedContactRow } from "@/app/api/synced-contacts/route";

/**
 * People auto-derived from the shared mailbox (the "auto-synced from mail"
 * section). Fetched lazily and once per session — the table holds every
 * address the mailbox has ever seen, so it is far too big to pull on every
 * page load for a feature most sessions never open.
 */
export function useSyncedContacts(enabled: boolean) {
  const [contacts, setContacts] = useState<SyncedContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;

    let cancelled = false;
    setLoading(true);
    void fetch("/api/synced-contacts")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { contacts?: SyncedContactRow[] } | null) => {
        if (cancelled) return;
        setContacts(Array.isArray(json?.contacts) ? json!.contacts : []);
      })
      .catch(() => {
        if (!cancelled) {
          setContacts([]);
          // Allow a retry the next time the feature is opened.
          loadedRef.current = false;
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { contacts, loading };
}
