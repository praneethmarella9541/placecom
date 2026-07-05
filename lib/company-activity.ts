import "server-only";

import {
  fetchGmailMessagesByIds,
  fetchGmailMessageHeadersByIds,
  listMessageIdsPage,
  type GmailMessageSummary,
} from "@/lib/gmail";

export type CompanyActivityItem = {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  date: string;
  /** Only populated when mode: "full". */
  snippet?: string;
};

function contactsQuery(contactEmails: string[]): string {
  const terms = contactEmails.flatMap((email) => {
    const escaped = email.replace(/"/g, '\\"');
    return [`from:"${escaped}"`, `to:"${escaped}"`];
  });
  return `(${terms.join(" OR ")})`;
}

/**
 * Shared Gmail query/paging logic for a company's known contacts — used by both the
 * Activity tab (lightweight headers) and Emails tab (full bodies, for snippets).
 */
export async function fetchCompanyEmailActivity(
  accessToken: string,
  contactEmails: string[],
  opts: { mode: "headers" | "full"; maxResults?: number; searchQuery?: string }
): Promise<CompanyActivityItem[]> {
  if (contactEmails.length === 0) return [];
  const maxResults = Math.min(100, Math.max(1, opts.maxResults ?? (opts.mode === "full" ? 25 : 50)));

  const q = opts.searchQuery?.trim()
    ? `${contactsQuery(contactEmails)} ${opts.searchQuery.trim()}`
    : contactsQuery(contactEmails);

  const { messageIds } = await listMessageIdsPage(accessToken, {
    maxResults,
    q,
  });
  if (messageIds.length === 0) return [];

  if (opts.mode === "headers") {
    const headers = await fetchGmailMessageHeadersByIds(accessToken, messageIds);
    return headers
      .map((h) => ({
        id: h.id,
        threadId: h.threadId,
        from: h.from,
        subject: "",
        date: new Date(h.internalDate || Date.now()).toISOString(),
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  const messages: GmailMessageSummary[] = await fetchGmailMessagesByIds(accessToken, messageIds);
  return messages
    .map((m) => ({
      id: m.id,
      threadId: m.threadId,
      from: m.from,
      subject: m.subject,
      date: new Date(m.internalDate || Date.now()).toISOString(),
      snippet: m.body.slice(0, 200).trim(),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
