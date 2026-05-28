import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { uploadBinaryToDrive } from "@/lib/drive-upload";

export const runtime = "nodejs";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB ceiling for Drive uploads

/**
 * Upload a large attachment to the user's Drive and return a shareable link.
 * Used by compose when a file exceeds Gmail's 25 MB attachment limit —
 * mirrors Gmail's own behaviour of silently switching to a Drive link.
 *
 * Steps:
 *  1. Upload the file to the user's My Drive root (or a supplied parentId).
 *  2. Grant "anyone with the link can view" so the recipient can open it.
 *  3. Return { file: { id, name, mimeType, webViewLink } }.
 */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 500 MB limit" }, { status: 413 });
  }

  const fileName =
    typeof (file as File).name === "string" && (file as File).name
      ? (file as File).name
      : "attachment";
  const mimeType = file.type || "application/octet-stream";

  let buf: Buffer;
  try {
    buf = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read file" }, { status: 400 });
  }

  let uploaded: Awaited<ReturnType<typeof uploadBinaryToDrive>>;
  try {
    uploaded = await uploadBinaryToDrive(auth.accessToken, {
      fileName,
      mimeType,
      parentId: "root",
      body: buf,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_UPLOAD_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json({ error: err.message || "Upload failed" }, { status: 500 });
  }

  // Grant "anyone with the link" viewer access so the email recipient can
  // open the file without needing a Google account invitation.
  try {
    await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(uploaded.id)}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }
    );
  } catch {
    // Non-fatal — the upload succeeded; sharing failure is a best-effort.
  }

  // If webViewLink wasn't returned in the upload response (some Drive configs
  // omit it), fetch it directly.
  let webViewLink = uploaded.webViewLink;
  if (!webViewLink) {
    try {
      const r = await fetch(
        `${DRIVE_API}/files/${encodeURIComponent(uploaded.id)}?fields=webViewLink&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${auth.accessToken}` } }
      );
      if (r.ok) {
        const d = (await r.json()) as { webViewLink?: string };
        webViewLink = d.webViewLink;
      }
    } catch { /* best-effort */ }
  }

  return NextResponse.json({
    file: {
      id: uploaded.id,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      webViewLink: webViewLink ?? `https://drive.google.com/file/d/${uploaded.id}/view`,
    },
  });
}
