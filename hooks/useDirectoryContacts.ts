"use client";

import { useCallback, useEffect, useState } from "react";
import type { DirectoryContact } from "@/lib/contact-directory";
import {
  getDirectoryContactsPrefetchCache,
  setDirectoryContactsPrefetchCache,
} from "@/lib/workspace-feature-prefetch";

type ContactsResponse = { contacts?: DirectoryContact[]; error?: string };
type ContactResponse = { contact?: DirectoryContact; error?: string };

export type DirectoryContactInput = {
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  location?: string;
  tags?: string[];
  notes?: string;
};

/**
 * Reads/writes the same session-scoped cache the login-time prefetch chain
 * warms (lib/workspace-feature-prefetch.ts, alongside Mail/Drive/Sheets/etc.)
 * — by the time you actually open a page that calls useDirectoryContacts(),
 * it's usually already warm and this fetch is skipped entirely. Falls back
 * to fetching itself (e.g. first login before the chain finishes, or a
 * restricted-feature session) with an in-flight guard so simultaneous
 * mounts (Contacts + WhatsApp + SMS, say) share one request.
 */
let inflight: Promise<DirectoryContact[]> | null = null;

async function fetchDirectory(): Promise<DirectoryContact[]> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/directory-contacts");
      const data = (await res.json()) as ContactsResponse;
      if (!res.ok) throw new Error(data.error || "Failed to load directory");
      const contacts = data.contacts ?? [];
      setDirectoryContactsPrefetchCache(contacts);
      return contacts;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Shared org-wide contact directory — visible/editable by every signed-in user. */
export function useDirectoryContacts() {
  const cached = getDirectoryContactsPrefetchCache();
  const [contacts, setContacts] = useState<DirectoryContact[]>(cached ?? []);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setContacts(await fetchDirectory());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const warm = getDirectoryContactsPrefetchCache();
    if (warm !== null) {
      // Instant paint from the login-time snapshot, but still revalidate
      // silently in the background — it may be stale (a teammate added a
      // contact, a mail sync ran) since it was warmed. Matches the Sheets
      // page's stale-while-revalidate pattern.
      setContacts(warm);
      setLoading(false);
      void fetchDirectory().then(setContacts).catch(() => {});
      return;
    }
    void reload();
  }, [reload]);

  const saveContact = useCallback(async (input: DirectoryContactInput, id?: string) => {
    const res = await fetch(id ? `/api/directory-contacts/${id}` : "/api/directory-contacts", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as ContactResponse;
    if (!res.ok || !data.contact) throw new Error(data.error || "Failed to save contact");

    setContacts((prev) => {
      const without = prev.filter((c) => c.id !== data.contact!.id);
      const next = [...without, data.contact!].sort((a, b) => a.name.localeCompare(b.name));
      setDirectoryContactsPrefetchCache(next);
      return next;
    });
    return data.contact;
  }, []);

  const deleteContact = useCallback(async (id: string) => {
    setContacts((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setDirectoryContactsPrefetchCache(next);
      return next;
    });
    const res = await fetch(`/api/directory-contacts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "Failed to delete contact");
    }
  }, []);

  return { contacts, loading, error, reload, saveContact, deleteContact };
}

/** Single shared contact, for the detail page (app/(workspace)/contacts/[id]/page.tsx). */
export function useDirectoryContact(id: string) {
  const [contact, setContact] = useState<DirectoryContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/directory-contacts/${id}`);
      const data = (await res.json()) as ContactResponse;
      if (!res.ok || !data.contact) throw new Error(data.error || "Failed to load contact");
      setContact(data.contact);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contact");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { contact, loading, error, reload, setContact };
}
