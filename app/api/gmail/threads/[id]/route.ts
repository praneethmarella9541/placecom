import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { getThreadMessages, markThreadRead } from "@/lib/gmail-inbox";
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

  const prefetchOnly =
    new URL(request.url).searchParams.get("prefetch") === "1";

  try {
    // Single Gmail round-trip: format=full already contains labelIds on each
    // message, so getThreadMessages extracts them — no second API call needed.
    const { messages, labelIds } = await getThreadMessages(auth.accessToken, threadId, {
      mailboxKey: auth.mailboxOwnerId,
    });

    // Hover prefetch must not mark unread mail as read — only explicit opens do.
    if (!prefetchOnly) {
      markThreadRead(auth.accessToken, threadId, {
        mailboxKey: auth.mailboxOwnerId,
      }).catch((e) => {
        console.warn("[gmail] mark-read failed:", e?.message ?? e);
      });
    }

    return NextResponse.json(
      { threadId, messages, labelIds },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
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
