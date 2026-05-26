import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const PARALLELISM = 8;
const MAX_LABELS_PER_REQUEST = 100;

/**
 * For INBOX specifically, the Labels API returns stale/inflated internal
 * counts that don't match Gmail's UI. Gmail's sidebar number is the
 * resultSizeEstimate from threads.list with q=is:unread — use that instead.
 */
async function fetchInboxUnreadViaSearch(accessToken: string): Promise<number> {
  const params = new URLSearchParams({
    labelIds: "INBOX",
    q: "is:unread",
    maxResults: "1", // we only need resultSizeEstimate, not the actual threads
  });
  const res = await fetch(`${GMAIL_API}/threads?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return 0;
  const j = (await res.json()) as { resultSizeEstimate?: number };
  return j.resultSizeEstimate ?? 0;
}

/**
 * Return thread counts (total + unread) for a set of Gmail label ids.
 *
 * Caller passes `?ids=INBOX,SENT,Label_1234,...`. We fan out to
 * `labels.get` per id with bounded concurrency. INBOX unread is fetched
 * via threads.list search to match Gmail's own sidebar number.
 * Cached for 30 s by the browser so flipping between folders is cheap.
 */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("ids") ?? "").trim();
  if (!raw) {
    return NextResponse.json({ counts: {} });
  }
  const ids = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
  if (ids.length > MAX_LABELS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many label ids (max ${MAX_LABELS_PER_REQUEST})` },
      { status: 400 }
    );
  }

  const accessToken = auth.accessToken;
  const counts: Record<string, { total: number; unread: number }> = {};
  let scopeError: string | null = null;

  // Kick off the accurate INBOX unread search in parallel with the label fetches.
  const inboxUnreadPromise = ids.includes("INBOX")
    ? fetchInboxUnreadViaSearch(accessToken).catch(() => null)
    : Promise.resolve(null);

  let cursor = 0;
  async function worker() {
    while (cursor < ids.length && !scopeError) {
      const i = cursor++;
      const id = ids[i];
      try {
        const res = await fetch(
          `${GMAIL_API}/labels/${encodeURIComponent(id)}`,
          { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
        );
        if (res.status === 401) {
          scopeError = "UNAUTHORIZED";
          return;
        }
        if (res.status === 403) {
          const text = await res.text().catch(() => "");
          if (/insufficient/i.test(text)) {
            scopeError = GMAIL_INSUFFICIENT_SCOPE;
            return;
          }
        }
        if (!res.ok) {
          // Missing label or other transient error — silently skip.
          continue;
        }
        const j = (await res.json()) as {
          threadsTotal?: number;
          threadsUnread?: number;
        };
        counts[id] = {
          total: j.threadsTotal ?? 0,
          unread: j.threadsUnread ?? 0,
        };
      } catch {
        // Network blips — keep going for the rest.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLELISM, ids.length) }, () => worker())
  );

  // Overwrite INBOX unread with the accurate search-based count.
  const inboxUnread = await inboxUnreadPromise;
  if (inboxUnread !== null && counts["INBOX"]) {
    counts["INBOX"] = { ...counts["INBOX"], unread: inboxUnread };
  }

  if (scopeError === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (scopeError === GMAIL_INSUFFICIENT_SCOPE) {
    return NextResponse.json({ error: GMAIL_INSUFFICIENT_SCOPE }, { status: 403 });
  }

  return NextResponse.json(
    { counts },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
  );
}
