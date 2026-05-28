import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

/**
 * POST /api/drive/upload-session
 * Body: { fileName, mimeType, size }
 *
 * Creates a Google Drive resumable upload session and returns the session URL.
 * The client uploads via POST /api/drive/upload-chunk (4 MB chunks, server-side
 * PUT to Google) to avoid browser CORS failures on direct googleapis.com calls.
 *
 * After upload completes, PATCH this route with fileId to share the link.
 */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { fileName?: string; mimeType?: string; size?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const fileName = (body.fileName || "attachment").trim();
  const mimeType = (body.mimeType || "application/octet-stream").trim();
  const size = body.size ?? 0;
  if (size <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }

  const meta = JSON.stringify({ name: fileName, parents: ["root"] });

  let initRes: Response;
  try {
    initRes = await fetch(
      `${UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,modifiedTime,size,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(size),
        },
        body: meta,
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Could not start Drive upload session: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }

  if (!initRes.ok) {
    const text = await initRes.text();
    if (initRes.status === 401) {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (
      initRes.status === 403 &&
      (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || text.includes("insufficientPermissions"))
    ) {
      return NextResponse.json(
        { error: "Upload requires Google Drive write access. Sign out and sign in again to grant Drive permissions." },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: `Drive session init failed (${initRes.status})` },
      { status: 502 }
    );
  }

  const sessionUrl = initRes.headers.get("Location");
  if (!sessionUrl) {
    return NextResponse.json({ error: "Drive did not return an upload session URL" }, { status: 502 });
  }

  return NextResponse.json({ sessionUrl });
}

/**
 * PATCH /api/drive/upload-session
 * Body: { fileId }
 *
 * After the client finishes uploading directly to Drive, call this to:
 *  1. Grant "anyone with the link" viewer permission.
 *  2. Fetch and return the file's webViewLink + metadata.
 */
export async function PATCH(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { fileId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const fileId = body.fileId?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  }

  // Grant anyone-with-link viewer access (best-effort).
  try {
    await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }
    );
  } catch { /* non-fatal */ }

  // Fetch the file metadata including webViewLink.
  type FileMeta = { id: string; name: string; mimeType: string; size?: string; webViewLink?: string };
  let fileMeta: FileMeta | null = null;
  try {
    const r = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } }
    );
    if (r.ok) {
      fileMeta = (await r.json()) as FileMeta;
    }
  } catch { /* best-effort */ }

  return NextResponse.json({
    file: {
      id: fileId,
      name: fileMeta?.name ?? "attachment",
      mimeType: fileMeta?.mimeType ?? "application/octet-stream",
      size: fileMeta?.size,
      webViewLink: fileMeta?.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    },
  });
}
