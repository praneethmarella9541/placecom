import { extractEmailAddress } from "@/lib/email-parse";

/** Every plausible email in a header blob (handles comma lists; misses rare quoted-comma cases). */
export function extractAllEmailsFromText(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const found = text.match(re);
  if (!found?.length) return [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

export type RecipientChipData = {
  email: string;
  displayName?: string;
};

/**
 * Does a suggestion match what the user typed?
 *
 * Shared by the compose To field and the mass-send recipient rail so both
 * surfaces resolve the same query to the same people — they previously had
 * separate copies of this and drifted.
 *
 * The whitespace-stripped comparison is what makes a run-together query like
 * "saibharath" match the display name "Sai Bharath"; a plain substring test
 * misses it over the space.
 */
export function recipientMatchesQuery(
  suggestion: { email: string; displayName?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const em = suggestion.email.toLowerCase();
  const name = (suggestion.displayName || "").toLowerCase();
  if (em.includes(q) || name.includes(q)) return true;
  const qCompact = q.replace(/\s+/g, "");
  return qCompact.length > 0 && name.replace(/\s+/g, "").includes(qCompact);
}

const EMAIL_LIKE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Parse parent-controlled comma string into chips + trailing draft (for chip UI). */
export function parseRecipientValue(raw: string): { chips: RecipientChipData[]; draft: string } {
  const s = raw.trim();
  if (!s) return { chips: [], draft: "" };
  const parts = s.split(",").map((p) => p.trim());
  const chips: RecipientChipData[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const isLast = i === parts.length - 1;
    const extracted = extractEmailAddress(part).trim().toLowerCase();
    const looksComplete = extracted.includes("@") && EMAIL_LIKE.test(extracted);

    if (looksComplete) {
      chips.push({ email: extracted });
    } else if (isLast) {
      return { chips, draft: part };
    }
  }
  return { chips, draft: "" };
}

export function serializeRecipientValue(chips: RecipientChipData[], draft: string): string {
  const out: string[] = chips.map((c) => c.email);
  const d = draft.trim();
  if (d) out.push(d);
  return out.join(", ");
}

export function isCompleteEmailAddress(s: string): boolean {
  const t = extractEmailAddress(s).trim().toLowerCase();
  return t.includes("@") && EMAIL_LIKE.test(t);
}

export type RecipientTokenSplit = {
  beforeToken: string;
  token: string;
  afterCursor: string;
};

export function splitRecipientAtCursor(value: string, cursor: number): RecipientTokenSplit {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const left = value.slice(0, safeCursor);
  const lastComma = left.lastIndexOf(",");
  const beforeToken = lastComma === -1 ? "" : value.slice(0, lastComma + 1);
  const tokenStart = lastComma === -1 ? 0 : lastComma + 1;
  const token = value.slice(tokenStart, safeCursor).trim();
  const afterCursor = value.slice(safeCursor);
  return { beforeToken, token, afterCursor };
}
