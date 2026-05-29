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

export type DateWithinPreset = "" | "1d" | "3d" | "7d" | "14d" | "30d" | "60d" | "180d" | "365d";

/** Advanced-search panel fields (Gmail “Show search options”). */
export type GmailFilterFields = {
  from: string;
  to: string;
  subject: string;
  hasWords: string;
  doesntHave: string;
  hasAttachment: boolean;
  dateWithin: DateWithinPreset;
  /** Anchor day for “Date within” — `YYYY-MM-DD` (local). */
  dateAnchor: string;
};

const NEWER_THAN_DATE: Record<string, DateWithinPreset> = {
  "1d": "1d",
  "3d": "3d",
  "7d": "7d",
  "14d": "14d",
  "30d": "30d",
  "60d": "60d",
  "180d": "180d",
  "365d": "365d",
};

const DATE_WITHIN_DAY_COUNT: Record<Exclude<DateWithinPreset, "">, number> = {
  "1d": 1,
  "3d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "60d": 60,
  "180d": 180,
  "365d": 365,
};

const DATE_WITHIN_BY_DAYS: { days: number; preset: Exclude<DateWithinPreset, ""> }[] = [
  { days: 365, preset: "365d" },
  { days: 180, preset: "180d" },
  { days: 60, preset: "60d" },
  { days: 30, preset: "30d" },
  { days: 14, preset: "14d" },
  { days: 7, preset: "7d" },
  { days: 3, preset: "3d" },
  { days: 1, preset: "1d" },
];

/** Gmail `after:` / `before:` date token — `YYYY/M/D`. */
export function formatGmailSlashDate(d: Date): string {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function parseGmailSlashDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

export function parseIsoDateLocal(iso: string): Date | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatGmailDisplayDate(iso: string): string {
  const d = parseIsoDateLocal(iso);
  if (!d) return "";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${mo}/${day}`;
}

function closestDateWithinPreset(daySpan: number): DateWithinPreset {
  if (daySpan <= 0) return "1d";
  for (const { days, preset } of DATE_WITHIN_BY_DAYS) {
    if (daySpan <= days) return preset;
  }
  return "365d";
}

/**
 * Build Gmail date clauses for advanced search.
 * With an anchor: `after:` / `before:` window ending on that day.
 * Without anchor: relative `newer_than:` only.
 */
export function buildDateSearchClauses(
  dateWithin: DateWithinPreset,
  dateAnchor: string,
): string[] {
  const anchor = parseIsoDateLocal(dateAnchor);
  if (anchor) {
    const days = dateWithin ? DATE_WITHIN_DAY_COUNT[dateWithin] : 1;
    const after = new Date(anchor);
    after.setDate(after.getDate() - (days - 1));
    const before = new Date(anchor);
    before.setDate(before.getDate() + 1);
    return [`after:${formatGmailSlashDate(after)}`, `before:${formatGmailSlashDate(before)}`];
  }
  if (dateWithin) return [`newer_than:${dateWithin}`];
  return [];
}

function stripQuotes(value: string): string {
  const t = value.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1);
  }
  return t;
}

function unwrapBraceGroup(value: string): string {
  const t = value.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * Map a Gmail `q` string into advanced-search fields (Gmail shows plain text in
 * “Has the words” after Enter). Used for display only — list search still uses
 * the exact `q` string passed to the API.
 */
export function parseGmailQueryToFilterFields(raw: string): GmailFilterFields {
  const empty: GmailFilterFields = {
    from: "",
    to: "",
    subject: "",
    hasWords: "",
    doesntHave: "",
    hasAttachment: false,
    dateWithin: "",
    dateAnchor: "",
  };
  const q = normalizeGmailSearchQuery(raw);
  if (!q) return empty;

  if (isPlainTextSearch(q)) {
    return { ...empty, hasWords: q };
  }

  const freeText: string[] = [];
  const exclusions: string[] = [];
  let from = "";
  let to = "";
  let subject = "";
  let hasAttachment = false;
  let dateWithin: DateWithinPreset = "";
  let dateAnchor = "";
  let afterRaw = "";
  let beforeRaw = "";

  for (const tok of tokenizeGmailQuery(q)) {
    if (tok.startsWith("-") && tok.length > 1 && !OPERATOR_TOKEN.test(tok.slice(1))) {
      exclusions.push(stripQuotes(tok.slice(1)));
      continue;
    }

    const lower = tok.toLowerCase();
    if (lower === "has:attachment") {
      hasAttachment = true;
      continue;
    }

    const op = tok.match(/^(from|to|subject|newer_than|after|before):(.+)$/i);
    if (op) {
      const key = op[1].toLowerCase();
      const val = stripQuotes(unwrapBraceGroup(op[2]));
      if (key === "from") from = val;
      else if (key === "to") to = val;
      else if (key === "subject") subject = val;
      else if (key === "newer_than") {
        dateWithin = NEWER_THAN_DATE[val.toLowerCase()] ?? "";
      } else if (key === "after") {
        afterRaw = val;
      } else if (key === "before") {
        beforeRaw = val;
      }
      continue;
    }

    freeText.push(tok);
  }

  const afterDate = afterRaw ? parseGmailSlashDate(afterRaw) : null;
  const beforeDate = beforeRaw ? parseGmailSlashDate(beforeRaw) : null;
  if (afterDate && beforeDate) {
    const anchor = new Date(beforeDate);
    anchor.setDate(anchor.getDate() - 1);
    dateAnchor = isoDateLocal(anchor);
    const spanDays = Math.max(
      1,
      Math.round((beforeDate.getTime() - afterDate.getTime()) / 86_400_000),
    );
    dateWithin = closestDateWithinPreset(spanDays);
  }

  return {
    from,
    to,
    subject,
    hasWords: freeText.join(" "),
    doesntHave: exclusions.join(" "),
    hasAttachment,
    dateWithin,
    dateAnchor,
  };
}

/** URL to open the same search in Gmail web (for parity checks). */
export function gmailWebSearchUrl(query: string): string {
  const q = normalizeGmailSearchQuery(query);
  if (!q) return "https://mail.google.com/mail/u/0/";
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
}
