"use client";

import type { RecipientSuggestion } from "@/components/RecipientField";

/**
 * Recipient suggestions for the sequence enrolment box.
 *
 * Reuses the same sources the mail composer draws on — Google contacts and
 * addresses seen in past conversations — so enrolling someone you have already
 * emailed is a matter of typing their name.
 */

let cached: RecipientSuggestion[] | null = null;
let inFlight: Promise<RecipientSuggestion[]> | null = null;

type GmailContactsResponse = {
  contacts?: RecipientSuggestion[];
  photoByEmail?: Record<string, string>;
};

type RecruitersResponse = {
  recruiters?: { email: string; name?: string; companyName?: string }[];
};

function dedupe(lists: RecipientSuggestion[][]): RecipientSuggestion[] {
  const byEmail = new Map<string, RecipientSuggestion>();
  for (const list of lists) {
    for (const item of list) {
      const email = item.email?.trim().toLowerCase();
      if (!email) continue;
      const existing = byEmail.get(email);
      if (!existing) {
        byEmail.set(email, { ...item, email });
      } else if (!existing.displayName && item.displayName) {
        byEmail.set(email, { ...existing, displayName: item.displayName });
      }
    }
  }
  return Array.from(byEmail.values());
}

/** Loads once per session; both endpoints are best-effort. */
export function loadRecipientSuggestions(): Promise<RecipientSuggestion[]> {
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const [contacts, recruiters] = await Promise.all([
      fetch("/api/gmail/contacts")
        .then((r) => (r.ok ? (r.json() as Promise<GmailContactsResponse>) : null))
        .catch(() => null),
      fetch("/api/recruiters")
        .then((r) => (r.ok ? (r.json() as Promise<RecruitersResponse>) : null))
        .catch(() => null),
    ]);

    const fromContacts = contacts?.contacts ?? [];
    const fromRecruiters = (recruiters?.recruiters ?? []).map((r) => ({
      email: r.email,
      displayName: r.name || r.companyName,
    }));

    cached = dedupe([fromContacts, fromRecruiters]);
    return cached;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Server-side typeahead over contacts + past threads, for anything not cached. */
export async function searchRecipientSuggestions(query: string): Promise<RecipientSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`/api/gmail/search/suggest?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { contacts?: RecipientSuggestion[] };
    return data.contacts ?? [];
  } catch {
    return [];
  }
}

export function clearRecipientSuggestionCache(): void {
  cached = null;
}
