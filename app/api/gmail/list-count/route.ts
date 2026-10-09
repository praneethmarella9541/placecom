import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { countThreadsUpTo, type MailFolder } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A few dozen 500-id pages at the background pace can take a while. */
export const maxDuration = 60;

/** Counting stops here; the pager then reads "20,000+". */
const COUNT_CAP = 20_000;

const FOLDERS = new Set<MailFolder>(["inbox", "sent", "trash", "spam", "allmail"]);

/**
 * GET /api/gmail/list-count — how many threads a list view holds, for the
 * pager's "of N". Same `folder` / `labelId` / `search` params as /api/gmail/threads.
 * Drafts aren't counted here (they come from a different Gmail call; the pager
 * uses the Drafts label total instead).
 */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const folderRaw = (searchParams.get("folder") || "inbox") as MailFolder;
  if (!FOLDERS.has(folderRaw)) {
    return NextResponse.json({ error: "Unsupported folder" }, { status: 400 });
  }
  const labelId = searchParams.get("labelId")?.trim() || undefined;
  const searchQuery = searchParams.get("search")?.trim() || undefined;

  try {
    const result = await countThreadsUpTo(auth.accessToken, {
      folder: folderRaw as Exclude<MailFolder, "drafts">,
      labelId,
      searchQuery,
      mailboxKey: auth.mailboxOwnerId,
      cap: COUNT_CAP,
      signal: request.signal,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
      return NextResponse.json({ error: GMAIL_INSUFFICIENT_SCOPE, message: err.message }, { status: 403 });
    }
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to count threads" }, { status: 500 });
  }
}
