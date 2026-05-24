import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const PARALLELISM = 8;
const MAX_LABELS_PER_REQUEST = 100;

/**
 * Return thread counts (total + unread) for a set of Gmail label ids.
 *
 * Caller passes `?ids=INBOX,SENT,Label_1234,...`. We fan out to
 * `labels.get` per id with bounded concurrency. Cached for 30 s by the
 * browser so flipping between folders doesn't re-hit Gmail.
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
          // Missing label or other transient error — silently skip; the UI
          // will just show no count for that id.
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
