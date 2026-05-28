import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";
export const maxDuration = 60;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_THREADS_PER_REQUEST = 100;
const PARALLELISM = 8;

type BatchBody = { threadIds?: string[] };

/** Permanently delete threads (Gmail "Delete forever" in Trash). */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: BatchBody;
  try {
    body = (await request.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const threadIds = Array.from(
    new Set((body.threadIds ?? []).filter((s) => typeof s === "string" && s.length > 0))
  );
  if (threadIds.length === 0) {
    return NextResponse.json({ error: "Pass at least one threadId" }, { status: 400 });
  }
  if (threadIds.length > MAX_THREADS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many threads (max ${MAX_THREADS_PER_REQUEST})` },
      { status: 400 }
    );
  }

  const accessToken = auth.accessToken;
  const succeeded: string[] = [];
  const failed: { threadId: string; error: string }[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < threadIds.length) {
      const i = cursor++;
      const id = threadIds[i];
      try {
        const res = await fetch(`${GMAIL_API}/threads/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.status === 401) {
          failed.push({ threadId: id, error: "UNAUTHORIZED" });
          cursor = threadIds.length;
          return;
        }
        if (res.status === 403) {
          const text = await res.text().catch(() => "");
          if (/insufficient/i.test(text)) {
            failed.push({ threadId: id, error: GMAIL_INSUFFICIENT_SCOPE });
            cursor = threadIds.length;
            return;
          }
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          failed.push({ threadId: id, error: text || `Delete failed (${res.status})` });
          continue;
        }
        succeeded.push(id);
      } catch (e) {
        failed.push({ threadId: id, error: e instanceof Error ? e.message : "Failed" });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLELISM, threadIds.length) }, () => worker())
  );

  return NextResponse.json({
    requested: threadIds.length,
    succeeded: succeeded.length,
    failed,
  });
}
