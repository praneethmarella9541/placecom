/**
 * Gmail search query handling for Placecom.
 *
 * ## How Gmail search actually works (official sources)
 *
 * 1. **Gmail web & API share one query language**
 *    - `users.messages.list` and `users.threads.list` accept `q` with the same
 *      operator syntax as the Gmail search box.
 *    - Docs: https://developers.google.com/workspace/gmail/api/guides/filtering
 *    - Operators: https://support.google.com/mail/answer/7190
 *
 * 2. **Documented differences (UI vs API) — only these two:**
 *    - **Alias expansion**: Workspace aliases match in UI, not always in API.
 *    - **Thread-wide semantics**: UI can surface whole threads differently;
 *      API matches per-message then returns threads (we use `threads.list`).
 *
 * 3. **What Gmail UI adds that the API does NOT expose:**
 *    - Contact / history based **suggestions** while typing (not a different `q`).
 *    - **Highlighting** and relevance ranking in the list.
 *    - **Chips** (Mail, From, Has attachment) that map to extra operators.
 *
 * 4. **What we should NOT invent:**
 *    - Guessing spaced names (saibharath → sai bharath), length thresholds, or
 *      automatic `*` wildcards — these are not in Gmail help and cause drift.
 *    - Merging multiple parallel `q` queries (quoted phrase, literal, contacts)
 *      unless the user typed those operators.
 *
 * ## Placecom strategy
 *
 * - Pass the user's search string to `q` **unchanged** (trim only).
 * - While searching: no folder/category `labelIds` (global search, like Gmail).
 * - Use `threads.list?q=…` for thread-level results.
 * - Advanced filter panel builds valid operator syntax only.
 * - Optional: `from:email` + `"email"` second query (body mentions) when the
 *   user typed a lone `from:` address — documented Gmail pattern for notifications.
 */

const OPERATOR_TOKEN =
  /^[+\-]?(?:is|in|label|category|from|to|cc|bcc|subject|has|filename|after|before|older_than|newer_than|older|newer|size|larger|smaller|rfc822msgid|deliveredto|list):/i;

/**
 * Trim and normalize whitespace; do not rewrite operators or tokens.
 */
export function normalizeGmailSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Tokenize like Gmail: quoted phrases and `{or groups}` stay intact.
 */
export function tokenizeGmailQuery(input: string): string[] {
  return input.match(/"[^"]*"|\{[^}]*\}|\S+/g) ?? [];
}

/** True when the string is only free text (no operators the user typed). */
export function isPlainTextSearch(raw: string): boolean {
  const t = normalizeGmailSearchQuery(raw);
  if (!t) return false;
  return !tokenizeGmailQuery(t).some(
    (tok) =>
      OPERATOR_TOKEN.test(tok) ||
      (tok.startsWith("{") && tok.endsWith("}")) ||
      (tok.startsWith('"') && tok.endsWith('"')),
  );
}

/**
 * Extract a single `from:email@…` when the query is only that clause.
 */
export function extractSingleFromEmail(raw: string): string | null {
  const stripped = normalizeGmailSearchQuery(raw);
  if (!/^from:/i.test(stripped)) return null;
  if (stripped.split(/\s+/).length > 1) return null;
  const m = stripped.match(/^from:\(?([^\s)]+)\)?$/i);
  if (!m) return null;
  const candidate = m[1];
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
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
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return [`-${trimmed}`];
  }
  return tokenizeGmailQuery(trimmed).map((tok) => {
    if (tok.startsWith("-")) return tok;
    if (tok.includes(" ")) return `-"${tok}"`;
    return `-${tok}`;
  });
}

/** URL to open the same search in Gmail web (for parity checks). */
export function gmailWebSearchUrl(query: string): string {
  const q = normalizeGmailSearchQuery(query);
  if (!q) return "https://mail.google.com/mail/u/0/";
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
}
