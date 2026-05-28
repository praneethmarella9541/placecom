import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { renameDriveFile } from "@/lib/drive";
import { trashSpreadsheet } from "@/lib/sheets";

export const runtime = "nodejs";

/** PATCH — rename a spreadsheet. Body: { name: string } */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });
  }

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (name.length > 256) {
    return NextResponse.json({ error: "Name is too long (max 256)" }, { status: 400 });
  }

  try {
    const file = await renameDriveFile(auth.accessToken, fileId, name);
    return NextResponse.json({ file });
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
          message: "Renaming requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Rename failed" },
      { status: 500 }
    );
  }
}

/** DELETE — move the spreadsheet to the trash. */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });
  }

  try {
    await trashSpreadsheet(auth.accessToken, fileId);
    return NextResponse.json({ ok: true });
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
          message: "Deleting requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Delete failed" },
      { status: 500 }
    );
  }
}
