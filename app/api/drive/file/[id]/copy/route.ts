import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { copyDriveFile } from "@/lib/drive";
import {
  DRIVE_INSUFFICIENT_SCOPE,
  driveInsufficientScopePayload,
} from "@/lib/drive-scope-error";

export const runtime = "nodejs";

/**
 * POST — copy a file or folder. Optional body: { parentId } destination folder.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  let body: { parentId?: string } = {};
  try {
    const raw = await request.text();
    if (raw) body = JSON.parse(raw) as { parentId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parentId =
    typeof body.parentId === "string" && body.parentId.trim()
      ? body.parentId.trim()
      : undefined;

  try {
    const file = await copyDriveFile(auth.accessToken, fileId, parentId);
    return NextResponse.json({ file });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === DRIVE_INSUFFICIENT_SCOPE) {
      return NextResponse.json(driveInsufficientScopePayload(), { status: 403 });
    }
    return NextResponse.json(
      { error: err.message || "Drive copy failed" },
      { status: 500 }
    );
  }
}
