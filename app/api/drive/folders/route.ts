import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { createDriveFolder } from "@/lib/drive";

export const runtime = "nodejs";

/**
 * POST — create a new folder under {parentId}. Body: { name, parentId }.
 * parentId defaults to "root" (My Drive). For shared drives, pass the
 * driveId; the lib uses supportsAllDrives=true so the call works there too.
 */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { name?: string; parentId?: string };
  try {
    body = (await request.json()) as { name?: string; parentId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim() || "";
  const parentId = body.parentId?.trim() || "root";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > 256) {
    return NextResponse.json({ error: "Name is too long (max 256 chars)" }, { status: 400 });
  }

  try {
    const file = await createDriveFolder(auth.accessToken, name, parentId);
    return NextResponse.json({ file }, { status: 201 });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json(
        {
          error: "DRIVE_INSUFFICIENT_SCOPE",
          message:
            "Creating folders requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to create folder" },
      { status: 500 }
    );
  }
}
