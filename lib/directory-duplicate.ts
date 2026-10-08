import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { findMatchingContact } from "@/lib/contact-import";
import type { DuplicateContact } from "@/lib/contact-directory";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";

/** Escapes LIKE wildcards so an email's "_" matches itself, not any character. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Finds the contact a card being saved would duplicate, within the caller's
 * team (RLS scopes the table). Looks up only rows that share the email or
 * phone — not the whole directory — then applies the import's matching rule.
 * `excludeId` leaves out the card being edited.
 */
export async function findDuplicateContact(
  supabase: SupabaseClient,
  candidate: { email: string | null; phone: string | null },
  excludeId?: string
): Promise<DuplicateContact | null> {
  const email = candidate.email?.trim().toLowerCase() || null;
  const phone = candidate.phone ? normalizePhone(candidate.phone) : null;
  if (!email && !phone) return null;

  const base = () => {
    const q = supabase.from("directory_contacts").select("id, name, email, phone, company, title, location, linkedin_url, tags").limit(50);
    return excludeId ? q.neq("id", excludeId) : q;
  };
  const [byEmail, byPhone] = await Promise.all([
    email ? base().ilike("email", likeLiteral(email)) : Promise.resolve({ data: [] }),
    phone ? base().in("phone", phoneLookupVariants(phone)) : Promise.resolve({ data: [] }),
  ]);

  const rows = [...(byEmail.data ?? []), ...(byPhone.data ?? [])] as DuplicateContact[];
  const unique = Array.from(new Map(rows.map((r) => [r.id, r])).values());
  return findMatchingContact({ email, phone }, unique) ?? null;
}
