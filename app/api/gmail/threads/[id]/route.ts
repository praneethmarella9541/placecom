import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { getThreadMessages } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const threadId = context.params.id;
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
  }

  try {
    const messages = await getThreadMessages(auth.accessToken, threadId);
    return NextResponse.json({ threadId, messages });
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
