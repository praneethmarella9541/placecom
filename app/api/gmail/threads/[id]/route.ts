import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { getThreadMessages, markThreadRead } from "@/lib/gmail-inbox";
import { getThreadLabels } from "@/lib/gmail-labels";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const threadId = context.params.id;
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
  }

  try {
    // Pull messages and label ids in parallel so adding labels doesn't
    // add a serial round-trip.
    const [messages, labelIds] = await Promise.all([
      getThreadMessages(auth.accessToken, threadId),
      getThreadLabels(auth.accessToken, threadId).catch(() => [] as string[]),
    ]);
    // Best-effort: mark the thread as read on open. Fire-and-forget so the
    // response isn't blocked or failed if the user hasn't re-consented to
    // gmail.modify yet.
    markThreadRead(auth.accessToken, threadId).catch((e) => {
      console.warn("[gmail] mark-read failed:", e?.message ?? e);
    });
    return NextResponse.json({ threadId, messages, labelIds });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
      return NextResponse.json(
        { error: GMAIL_INSUFFICIENT_SCOPE, message: err.message },
        { status: 403 }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to load thread" },
      { status: 500 }
    );
  }
}
