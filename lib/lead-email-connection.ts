import "server-only";

import { fetchGmailMessage, listMessageIdsPage } from "@/lib/gmail";
import { bucketEmailConnection, type EmailConnectionStrength } from "@/lib/email-connection-strength";

export type { EmailConnectionStrength };

export type EmailConnectionResult = {
  lastInteractionAt: string | null;
  connectionStrength: EmailConnectionStrength;
};

function gmailAddressQuery(email: string): string {
  const escaped = email.replace(/"/g, '\\"');
  return `(from:"${escaped}" OR to:"${escaped}")`;
}

/** Reads `resultSizeEstimate` straight from the Gmail list endpoint — cheaper than paging messages. */
async function estimateMatchCount(accessToken: string, q: string): Promise<number> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({
    maxResults: "1",
    q,
  })}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return 0;
  const data = (await res.json()) as { resultSizeEstimate?: number };
  return data.resultSizeEstimate ?? 0;
}

/**
 * Derives a lightweight, recency + frequency based engagement signal for a lead's
 * email address from the connected Gmail mailbox — mirrors Attio's "connection
 * strength" column but computed on-demand rather than via a background sync.
 */
export async function computeEmailConnection(
  accessToken: string,
  email: string
): Promise<EmailConnectionResult> {
  const baseQuery = gmailAddressQuery(email);

  const { messageIds } = await listMessageIdsPage(accessToken, {
    maxResults: 1,
    q: baseQuery,
  });

  if (messageIds.length === 0) {
    return { lastInteractionAt: null, connectionStrength: "No communication" };
  }

  const latest = await fetchGmailMessage(accessToken, messageIds[0]);
  const lastInteractionAt = new Date(latest.internalDate || Date.now()).toISOString();

  const recentCount90d = await estimateMatchCount(accessToken, `${baseQuery} newer_than:90d`);
  const connectionStrength = bucketEmailConnection({ lastInteractionAt, recentCount90d });

  return { lastInteractionAt, connectionStrength };
}
