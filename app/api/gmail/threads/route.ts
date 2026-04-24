import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage, type MailFolder } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const folderRaw = searchParams.get("folder") || "inbox";
  const folder: MailFolder =
    folderRaw === "sent" ? "sent" : "inbox";
  const pageToken = searchParams.get("pageToken") || undefined;
  const maxResults = Math.min(
    50,
    Math.max(5, parseInt(searchParams.get("maxResults") || "25", 10) || 25)
  );

  try {
    const page = await listThreadsPage(auth.accessToken, {
      folder,
      maxResults,
      pageToken,
    });
    return NextResponse.json({
      folder,
      threads: page.threads,
      nextPageToken: page.nextPageToken,
    });
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
      { error: err.message || "Failed to list threads" },
      { status: 500 }
    );
  }
}
