import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { fetchGmail, GMAIL_COST } from "@/lib/gmail-quota";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Lightweight Gmail History API wrapper.
 *
 * GET /api/gmail/history?since=<historyId>&labelId=INBOX
 *
 * Returns { hasChanges: boolean, latestHistoryId?: string }.
 * hasChanges is true when Gmail reports any labelsAdded, labelsRemoved,
 * messagesAdded, or messagesDeleted events since the given historyId.
 * The caller uses this as a signal to selectively refresh the thread list
 * and/or counts — rather than unconditionally reloading every 30 s.
 *
 * historyId is an opaque monotonically-increasing string from Gmail; we
 * treat it as such (string compare only, never numeric math).
 */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since")?.trim();

  // Bootstrap: return current mailbox historyId (no change scan).
  if (!since) {
    try {
      const profileRes = await fetchGmail(
        `${GMAIL_API}/profile`,
        { headers: { Authorization: `Bearer ${auth.accessToken}` }, cache: "no-store" },
        { mailboxKey: auth.mailboxOwnerId, cost: GMAIL_COST.getProfile }
      );
      if (!profileRes.ok) {
        return NextResponse.json({ error: "Failed to fetch Gmail profile" }, { status: 502 });
      }
      const profile = (await profileRes.json()) as { historyId?: string };
      const historyId = profile.historyId?.trim() || null;
      return NextResponse.json(
        { hasChanges: false, historyId, latestHistoryId: historyId },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch {
      return NextResponse.json({ error: "Failed to fetch Gmail profile" }, { status: 502 });
    }
  }

  const labelId = searchParams.get("labelId")?.trim();

  const params = new URLSearchParams({
    startHistoryId: since,
    maxResults: "100",
    historyTypes: "labelAdded",
  });
  params.append("historyTypes", "labelRemoved");
  params.append("historyTypes", "messageAdded");
  params.append("historyTypes", "messageDeleted");
  if (labelId) params.set("labelId", labelId);

  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/history?${params.toString()}`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` }, cache: "no-store" },
      { mailboxKey: auth.mailboxOwnerId, cost: GMAIL_COST.historyList }
    );
  } catch {
    // Network error — treat as no-change so the client doesn't flash a reload.
    return NextResponse.json({ hasChanges: false });
  }

  // 404 means the historyId has expired (>30 days old or account reset).
  // Signal the caller to do a full refresh and pick up a new historyId.
  if (res.status === 404) {
    return NextResponse.json({ hasChanges: true, expired: true });
  }

  if (res.status === 401) {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("[gmail/history] list failed:", res.status, text.slice(0, 200));
    return NextResponse.json({ hasChanges: false, error: `Gmail history ${res.status}` });
  }

  const data = (await res.json()) as {
    history?: unknown[];
    historyId?: string;
  };

  const hasChanges = Array.isArray(data.history) && data.history.length > 0;

  return NextResponse.json(
    { hasChanges, latestHistoryId: data.historyId },
    { headers: { "Cache-Control": "no-store" } }
  );
}
