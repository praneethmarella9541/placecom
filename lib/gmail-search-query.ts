/**
 * Normalizes user-typed Gmail search text for the Gmail API `q` parameter.
 *
 * Gmail's web UI does prefix matching on words; the API is stricter unless you
 * add `*` suffixes. We add those for bare words only — never for operators,
 * quoted phrases, OR groups, or email addresses.
 */

const OPERATOR_TOKEN = /^[+\-]?(?:is|in|label|category|from|to|cc|bcc|subject|has|filename|after|before|newer_than|older_than|size|larger|smaller|rfc822msgid|deliveredto|list):/i;

const BOOLEAN_OP = /^(AND|OR|NOT)$/i;

/** Rough check for a bare email address token. */
function looksLikeEmail(token: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
}

/**
 * Tokenize like Gmail: quoted phrases and `{or groups}` stay intact.
 */
export function tokenizeGmailQuery(input: string): string[] {
  return input.match(/"[^"]*"|\{[^}]*\}|\S+/g) ?? [];
}

/**
 * Expand bare words with `*` for API prefix matching (Gmail UI parity).
 * Pass `raw: true` to skip expansion (e.g. when re-parsing an already-built query).
 */
export function expandPrefixSearch(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  return tokenizeGmailQuery(trimmed)
    .map((t) => {
      if (t.startsWith('"') && t.endsWith('"')) return t;
      if (t.startsWith("{") && t.endsWith("}")) return t;
      if (BOOLEAN_OP.test(t)) return t;
      if (t.startsWith("-")) {
        const rest = t.slice(1);
        if (rest.startsWith('"') || OPERATOR_TOKEN.test(rest) || looksLikeEmail(rest)) {
          return t;
        }
        if (rest.endsWith("*") || !/[a-zA-Z0-9]/.test(rest)) return t;
        return `-${rest}*`;
      }
      if (OPERATOR_TOKEN.test(t)) return t;
      if (t.endsWith("*")) return t;
      if (!/[a-zA-Z0-9]/.test(t)) return t;
      if (looksLikeEmail(t)) return `"${t}"`;
      return `${t}*`;
    })
    .join(" ");
}

/**
 * Extract a single `from:email@…` when the query is only that clause (for supplemental search).
 */
export function extractSingleFromEmail(raw: string): string | null {
  const stripped = raw.trim();
  if (!/^from:/i.test(stripped)) return null;
  if (stripped.split(/\s+/).length > 1) return null;
  const m = stripped.match(/^from:\(?([^\s)]+)\)?$/i);
  if (!m) return null;
  const candidate = m[1];
  return looksLikeEmail(candidate) ? candidate : null;
}

/** True when the query is free text without Gmail operators. */
export function isPlainTextSearch(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return !tokenizeGmailQuery(t).some(
    (tok) =>
      OPERATOR_TOKEN.test(tok) ||
      (tok.startsWith("{") && tok.endsWith("}")) ||
      (tok.startsWith('"') && tok.endsWith('"')),
  );
}

/**
 * Guess a spaced name from a single concatenated token (e.g. saibharath → sai bharath).
 * Gmail UI often matches contact/display names this way; the API does not unless we OR it in.
 */
export function guessSpacedName(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z]+$/.test(t) || t.length < 6) return null;
  for (const i of [3, 4, 5]) {
    if (i >= t.length - 2) continue;
    return `${t.slice(0, i)} ${t.slice(i)}`;
  }
  return null;
}

/**
 * Extra Gmail `q` strings to merge with the primary search (plain-text queries only).
 */
export function buildSupplementalSearchQueries(raw: string): string[] {
  if (!isPlainTextSearch(raw)) return [];
  const t = raw.trim();
  const out = new Set<string>();

  // Without prefix wildcards — matches token boundaries closer to Gmail for some names.
  if (t !== expandPrefixSearch(t)) out.add(t);

  if (!t.includes('"')) out.add(`"${t}"`);

  const spaced = guessSpacedName(t);
  if (spaced) {
    out.add(spaced);
    out.add(expandPrefixSearch(spaced));
    if (!spaced.includes('"')) out.add(`"${spaced}"`);
  }

  return Array.from(out);
}

export function buildFromEmailsQuery(emails: string[]): string | null {
  const list = emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
  if (!list.length) return null;
  if (list.length === 1) return `from:${list[0]}`;
  return `from:{${list.join(" ")}}`;
}

/**
 * Build negated terms for advanced "doesn't have" (multi-word → quoted exclusion).
 */
export function buildExclusionTokens(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // If user typed a quoted phrase, exclude it as one unit.
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return [`-${trimmed}`];
  }
  return tokenizeGmailQuery(trimmed).map((tok) => {
    if (tok.startsWith("-")) return tok;
    if (tok.includes(" ")) return `-"${tok}"`;
    return `-${tok}`;
  });
}
