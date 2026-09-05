import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { modifyThreadLabels } from "@/lib/gmail-labels";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_THREADS_PER_REQUEST = 200;
const PARALLELISM = 8;

/**
 * Apply the same add/remove label change to many threads. Gmail's REST API
 * doesn't expose a true "threads.batchModify", so we fan out with bounded
 * concurrency. Used by the inbox bulk-action toolbar (archive, trash,
 * mark read/unread, apply label to many).
 */
type BatchBody = {
  threadIds?: string[];
  add?: string[];
  remove?: string[];
};

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
  const add = Array.isArray(body.add) ? body.add.filter((s) => typeof s === "string") : [];
  const remove = Array.isArray(body.remove) ? body.remove.filter((s) => typeof s === "string") : [];

  if (threadIds.length === 0) {
    return NextResponse.json({ error: "Pass at least one threadId" }, { status: 400 });
  }
  if (threadIds.length > MAX_THREADS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many threads (max ${MAX_THREADS_PER_REQUEST} per request)` },
      { status: 400 }
    );
  }
  if (add.length === 0 && remove.length === 0) {
    return NextResponse.json({ error: "Pass labels to add or remove" }, { status: 400 });
  }

  // Token / scope errors should fail the whole batch fast (otherwise we'd
  // hammer Gmail with N 401s). Detect by sampling the first call's outcome.
  const accessToken = auth.accessToken;
  const mailboxKey = auth.mailboxOwnerId;
  const succeeded: string[] = [];
  const failed: { threadId: string; error: string }[] = [];

  // Simple bounded-concurrency executor.
  let cursor = 0;
  async function worker() {
    while (cursor < threadIds.length) {
      const i = cursor++;
      const id = threadIds[i];
      try {
        await modifyThreadLabels(accessToken, id, { add, remove }, { mailboxKey });
        succeeded.push(id);
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "UNAUTHORIZED" || err.code === GMAIL_INSUFFICIENT_SCOPE) {
          // Abort the entire batch by jumping the cursor past the end.
          cursor = threadIds.length;
          failed.push({ threadId: id, error: err.message });
          break;
        }
        failed.push({ threadId: id, error: err.message || "Failed" });
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
