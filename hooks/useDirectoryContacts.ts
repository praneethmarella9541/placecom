"use client";

import { useCallback, useEffect, useState } from "react";
import type { DirectoryContact } from "@/lib/contact-directory";

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

/** Shared org-wide contact directory — visible/editable by every signed-in user. */
export function useDirectoryContacts() {
  const [contacts, setContacts] = useState<DirectoryContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/directory-contacts");
      const data = (await res.json()) as ContactsResponse;
      if (!res.ok) throw new Error(data.error || "Failed to load directory");
      setContacts(data.contacts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
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
      return [...without, data.contact!].sort((a, b) => a.name.localeCompare(b.name));
    });
    return data.contact;
  }, []);

  const deleteContact = useCallback(async (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
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
