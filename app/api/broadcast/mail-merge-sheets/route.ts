import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listGoogleSheetsPage } from "@/lib/drive";

export const runtime = "nodejs";

/**
 * Lists Google Sheets for the mass-send "attach a Google Sheet" picker. A twin
 * of GET /api/sheets, kept separate because that route is gated on the Sheets
 * module and this one has to work for anyone who can mass-send mail.
 */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const search = searchParams.get("search")?.trim() || undefined;

  try {
    const page = await listGoogleSheetsPage(auth.accessToken, { pageSize: 25, pageToken, search });
    return NextResponse.json({
      sheets: page.files,
      nextPageToken: page.nextPageToken,
      connectedEmail: auth.gmailAddress ?? null,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to list sheets" }, { status: 500 });
  }
}
