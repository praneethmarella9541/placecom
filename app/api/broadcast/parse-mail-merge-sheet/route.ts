import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { readGoogleSheetTable } from "@/lib/google-sheets";
import { parseMailMergeTable } from "@/lib/mail-merge-sheet";

export const runtime = "nodejs";

// Same cap as the file importer (parse-mail-merge) so both sources behave alike.
const MAX_ROWS = 80;

/**
 * POST { spreadsheetId, tab? } — reads an existing Google Sheet tab and returns
 * the same shape as POST /api/broadcast/parse-mail-merge, plus the sheet's
 * title and tab list. Reads with the mailbox owner's Google token, so only
 * sheets that account can open are available.
 */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { spreadsheetId?: string; tab?: string };
  try {
    body = (await request.json()) as { spreadsheetId?: string; tab?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const spreadsheetId = body.spreadsheetId?.trim();
  if (!spreadsheetId) {
    return NextResponse.json({ error: "spreadsheetId is required" }, { status: 400 });
  }

  try {
    const sheet = await readGoogleSheetTable(auth.accessToken, spreadsheetId, body.tab?.trim() || undefined);
    const parsed = parseMailMergeTable(sheet.values);

    if (parsed.rows.length === 0) {
      const headers = parsed.headerLabels.length > 0 ? parsed.headerLabels.join(", ") : "(tab is empty)";
      const hint =
        parsed.emailColumnIndex < 0
          ? "Row 1 must be headers. Add a column named Email (or any column whose cells contain email addresses)."
          : "Row 1 is headers, but no data rows had a valid email. Check the addresses in the sheet.";
      return NextResponse.json(
        {
          error: `No valid rows found in "${sheet.tab}". ${hint}`,
          detectedHeaders: parsed.headerLabels,
          headersFound: headers,
          fileName: sheet.title,
          tabs: sheet.tabs,
          tab: sheet.tab,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      fileName: sheet.title,
      tabs: sheet.tabs,
      tab: sheet.tab,
      rows: parsed.rows.slice(0, MAX_ROWS),
      columns: parsed.columns,
      headerLabels: parsed.headerLabels,
      skipped: parsed.skipped,
      truncated: parsed.rows.length > MAX_ROWS,
      maxRows: MAX_ROWS,
    });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.code === "SHEETS_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.status === 403 || err.status === 404) {
      return NextResponse.json(
        {
          error: `The connected Google account${auth.gmailAddress ? ` (${auth.gmailAddress})` : ""} can't open this sheet. Share it with that account, or pick another sheet.`,
        },
        { status: 403 }
      );
    }
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to read sheet" }, { status: 500 });
  }
}
