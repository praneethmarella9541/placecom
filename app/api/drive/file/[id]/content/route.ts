import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { isEditableSpreadsheetMimeType } from "@/lib/drive-file-proxy";
import { updateDriveFileContent } from "@/lib/drive";

export const runtime = "nodejs";
export const maxDuration = 120;

const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** In-app grid editor round-trips everything as .xlsx, regardless of the target's native mimeType. */
const UPLOAD_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MAX_EDITABLE_BYTES = 5 * 1024 * 1024;

/**
 * PUT — replace a spreadsheet file's content (used by the /drive/sheet/[id]
 * in-app editor). Body is the raw .xlsx bytes produced by SheetJS in the
 * browser. Guards against editing non-spreadsheet files and against
 * clobbering concurrent edits via an optional optimistic-lock header.
 */
export async function PUT(
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

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_EDITABLE_BYTES) {
    return NextResponse.json(
      { error: "File is too large to save from the in-app editor (max 5MB)." },
      { status: 413 }
    );
  }

  const expectedModifiedTime = request.headers.get("x-expected-modified-time")?.trim();

  let currentMeta: { mimeType?: string; modifiedTime?: string };
  try {
    const metaRes = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=mimeType,modifiedTime&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    if (metaRes.status === 401) {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (!metaRes.ok) {
      const text = await metaRes.text();
      return NextResponse.json({ error: text || "Could not load file metadata" }, { status: metaRes.status });
    }
    currentMeta = (await metaRes.json()) as { mimeType?: string; modifiedTime?: string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Metadata fetch failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!currentMeta.mimeType || !isEditableSpreadsheetMimeType(currentMeta.mimeType)) {
    return NextResponse.json(
      { error: "This file type cannot be edited from the in-app editor." },
      { status: 400 }
    );
  }

  if (expectedModifiedTime && currentMeta.modifiedTime && expectedModifiedTime !== currentMeta.modifiedTime) {
    return NextResponse.json(
      {
        error: "CONFLICT",
        message: "This file changed since you opened it. Reload to see the latest version before saving.",
      },
      { status: 409 }
    );
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Empty file body" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_EDITABLE_BYTES) {
    return NextResponse.json(
      { error: "File is too large to save from the in-app editor (max 5MB)." },
      { status: 413 }
    );
  }

  try {
    const updated = await updateDriveFileContent(auth.accessToken, fileId, bytes, UPLOAD_CONTENT_TYPE);
    return NextResponse.json({ file: updated });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json(
        {
          error: "DRIVE_INSUFFICIENT_SCOPE",
          message: "Saving files requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: err.message || "Failed to save file" }, { status: 500 });
  }
}
