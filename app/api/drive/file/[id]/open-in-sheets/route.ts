import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { convertFileToGoogleSheet } from "@/lib/drive-upload";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST — converts a CSV/XLSX/ODS Drive file into a native Google Sheet, for opening in /sheets/[id]. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await context.params;
  const fileId = id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  try {
    const result = await convertFileToGoogleSheet(auth.accessToken, fileId);
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_UPLOAD_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to open in Sheets" }, { status: 500 });
  }
}
