import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

/**
 * Returns the Google OAuth access token for the authenticated user's mailbox.
 * Used by the mobile app to upload large files directly to Google Drive
 * (bypassing the Next.js route body-size limit).
 */
export async function GET(request: Request) {
  // A raw token can do anything the mailbox can, so only full access gets one.
  const auth = await requireGmailAccessToken(request, { need: "modify" });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  return NextResponse.json({ accessToken: auth.accessToken });
}
