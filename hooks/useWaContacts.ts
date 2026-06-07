"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildContactNameMap,
  canonicalPeer,
  resolveContactName,
  type WaContactRow,
} from "@/lib/wa-contacts-display";

type ContactsResponse = { contacts?: WaContactRow[]; error?: string };

export function useWaContacts() {
  const [contacts, setContacts] = useState<WaContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const nameMap = useMemo(() => buildContactNameMap(contacts), [contacts]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/whatsapp/contacts");
      const data = (await res.json()) as ContactsResponse;
      if (!res.ok) throw new Error(data.error || "Failed to load contacts");
      setContacts(data.contacts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveContact = useCallback(
    async (peerRaw: string, name: string) => {
      const peer = canonicalPeer(peerRaw);
      const trimmed = name.trim();
      if (!peer || !trimmed) return;

      setContacts((prev) => {
        const without = prev.filter((c) => canonicalPeer(c.peer_e164) !== peer);
        return [...without, { peer_e164: peer, name: trimmed }].sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      });

      const res = await fetch("/api/whatsapp/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peer_e164: peer, name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Failed to save contact");
      }
    },
    []
  );

  const deleteContact = useCallback(async (peerRaw: string) => {
    const peer = canonicalPeer(peerRaw);
    if (!peer) return;

    setContacts((prev) => prev.filter((c) => canonicalPeer(c.peer_e164) !== peer));

    const res = await fetch("/api/whatsapp/contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer_e164: peer }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error || "Failed to delete contact");
    }
  }, []);

  const resolveName = useCallback(
    (peer: string) => resolveContactName(nameMap, peer),
    [nameMap]
  );

  return {
    contacts,
    nameMap,
    loading,
    error,
    reload,
    saveContact,
    deleteContact,
    resolveName,
  };
}
