/** Contact directory (scoped per admin mailbox team) — types + field validators. */

export type DirectoryContact = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  tags: string[];
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  /** Admin mailbox team this card belongs to — scopes visibility (see 0047 migration). */
  mailbox_owner_id: string;
  created_at: string;
  updated_at: string;
  /** Computed by the list API: latest of matching synced_contacts.last_interaction_at or updated_at. */
  last_contacted_at?: string;
  /**
   * Computed by the list API: the matching CRM lead's board column (by
   * email/phone), or null if that contact isn't on the board. `lead_stage` is
   * the crm_stages name — the same classification the kanban shows — falling
   * back to the legacy `leads.stage` enum for leads that predate the board.
   */
  lead_stage?: string | null;
  lead_score?: string | null;
  /** The board column's colour, so this chip matches its kanban card. */
  lead_stage_color?: string | null;
  /**
   * Computed by the API: the name/company Gmail itself has for this email
   * (synced_contacts), independent of whatever `name`/`company` were edited to
   * when the card was saved. Null for a contact with no synced row.
   */
  source_name?: string | null;
  source_company?: string | null;
};

/** Any http(s) URL is accepted, but we nudge users toward an actual LinkedIn link. */
export function isValidUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isLikelyLinkedInUrl(input: string): boolean {
  if (!isValidUrl(input)) return false;
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(input.trim()).hostname);
  } catch {
    return false;
  }
}

/** Prefix a bare "linkedin.com/in/…" or "in/…" entry with https:// so it's a usable link. */
export function normalizeLinkedInUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^linkedin\.com/i.test(trimmed)) return `https://${trimmed}`;
  if (/^in\//i.test(trimmed)) return `https://linkedin.com/${trimmed}`;
  return trimmed;
}

/**
 * Best-effort human name from an email's local part (e.g. "marella.praneeth" ->
 * "Marella Praneeth") — used when there's no real display name to search
 * LinkedIn with. Searching LinkedIn's people-search with a raw email address
 * (e.g. "kanagaraj@xlri.ac.in") returns nothing useful; the domain is noise,
 * not part of anyone's name.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || email;
  return local
    .split(/[.\-_+]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const EMAIL_LIKE_RE = /\S+@\S+\.\S+/;

/**
 * Best-effort display name for a synced contact — prefers the real display_name,
 * but Gmail sometimes has no real name for a sender and sets display_name to the
 * sender's own email address verbatim (not null/empty, so a plain `|| fallback`
 * doesn't catch it). Treats an email-shaped display_name the same as a missing
 * one: falls back to nameFromEmail rather than showing/searching a raw address.
 */
export function personNameForSearch(displayName: string | null | undefined, email: string): string {
  const trimmed = displayName?.trim();
  if (trimmed && !EMAIL_LIKE_RE.test(trimmed)) return trimmed;
  return nameFromEmail(email);
}

/**
 * LinkedIn has no public "look up the profile for this name+company" API — this just
 * opens LinkedIn's own people-search prefilled, for a human to confirm and paste the
 * real profile URL back in. Not an auto-fill; a one-click shortcut to find it.
 */
export function linkedInSearchUrl(name: string, company?: string | null): string {
  const keywords = [name, company].filter(Boolean).join(" ").trim();
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

/**
 * LinkedIn search for a saved directory card, preferring what Gmail knows over
 * what the card was edited to.
 *
 * Saving a contact from the synced list prefills the form, and people routinely
 * shorten or annotate the name for their own list ("Ravi — SASTRA", "HR"). That
 * edited label is the right thing to *show*, but searching LinkedIn for it
 * returns nothing; the Gmail display name is the one that matches a real
 * profile. So the search uses source_name/source_company where they exist and
 * falls back to the card's own fields otherwise — which is all a manually
 * created contact ever has.
 *
 * A saved linkedin_url always wins over any of this; callers check that first.
 */
export function contactLinkedInSearchUrl(contact: {
  name: string;
  company: string | null;
  email: string | null;
  source_name?: string | null;
  source_company?: string | null;
}): string {
  const source = contact.source_name?.trim();
  const name =
    source && !EMAIL_LIKE_RE.test(source)
      ? source
      : personNameForSearch(contact.name, contact.email ?? "");
  return linkedInSearchUrl(name, contact.source_company?.trim() || contact.company);
}
