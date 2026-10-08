/**
 * Gmail fills its search box with the current folder's operator when you focus
 * it — `in:sent` in Sent, `in:drafts` in Drafts, `is:starred` in Starred,
 * `label:name` in a label — and a search then stays within that folder. Delete
 * the operator and it searches everything. Inbox and All Mail get nothing, so
 * they search all mail. This is that behaviour: the scope token is shown in the
 * box like any other search term, and Gmail's own query language does the
 * narrowing, so the server needs no folder logic.
 */

const SYSTEM_SCOPES: Record<string, string> = {
  sent: "in:sent",
  drafts: "in:drafts",
  trash: "in:trash",
  spam: "in:spam",
  starred: "is:starred",
  important: "is:important",
};

/** The operator Gmail would prefill for this folder, or null where it prefills nothing (Inbox, All Mail). */
export function searchScopeForFolder(folder: string, userLabelName?: string | null): string | null {
  if (userLabelName?.trim()) {
    // Gmail's label operator takes the name with spaces (and nesting slashes) as hyphens.
    return `label:${userLabelName.trim().replace(/[\s/]+/g, "-")}`;
  }
  return SYSTEM_SCOPES[folder] ?? null;
}

/** True when the box holds only the scope token — nothing typed yet, so there is nothing to search for. */
export function isScopeOnly(input: string, scope: string | null | undefined): boolean {
  return Boolean(scope) && input.trim().toLowerCase() === scope!.toLowerCase();
}

/** The typed part of the box, without a leading scope token. */
export function stripScope(input: string, scope: string | null | undefined): string {
  if (!scope) return input;
  const trimmed = input.trimStart();
  if (trimmed.toLowerCase().startsWith(scope.toLowerCase())) {
    const rest = trimmed.slice(scope.length);
    // Only a whole token — "in:sentinel" is not "in:sent".
    if (rest === "" || /^\s/.test(rest)) return rest.trimStart();
  }
  return input;
}

/** Same, for any scope token (a query that arrived from another folder's box) — used to highlight only the words the user typed. */
const LEADING_SCOPE_RE = /^\s*(?:in:(?:sent|drafts|trash|spam)|is:(?:starred|important)|label:\S+)(?:\s+|$)/i;
export function stripAnyLeadingScope(query: string): string {
  return query.replace(LEADING_SCOPE_RE, "");
}

/** Scope tokens the suggest endpoint accepts — it prepends one to the Gmail query, so it must not take arbitrary text. */
export const SUGGEST_SCOPE_RE = /^(?:in:(?:sent|drafts|trash|spam)|is:(?:starred|important)|label:[^\s"{}()]+)$/i;
