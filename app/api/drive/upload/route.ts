import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { uploadBinaryToDrive } from "@/lib/drive-upload";

export const runtime = "nodejs";

/** Large uploads: tune in next.config if needed (Route Handler body buffering). */
const MAX_BYTES = 50 * 1024 * 1024;

function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "").trim();
  return base || "upload";
}

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken();
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
  const parentRaw = formData.get("parent");
  const parent =
    typeof parentRaw === "string" && parentRaw.trim() ? parentRaw.trim() : "root";

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const size = file.size;
  if (size <= 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.floor(MAX_BYTES / (1024 * 1024))} MB)` },
      { status: 413 }
    );
  }

  const rawName =
    typeof (file as File).name === "string" ? (file as File).name : "upload";
  const fileName = sanitizeFileName(rawName);
  const mimeType = file.type || "application/octet-stream";

  let buf: Buffer;
  try {
    const ab = await file.arrayBuffer();
    buf = Buffer.from(ab);
  } catch {
    return NextResponse.json({ error: "Could not read file" }, { status: 400 });
  }

  try {
    const uploaded = await uploadBinaryToDrive(auth.accessToken, {
      fileName,
      mimeType,
      parentId: parent,
      body: buf,
    });
    return NextResponse.json({ file: uploaded });
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === "DRIVE_UPLOAD_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Upload failed" },
      { status: err.status && err.status >= 400 && err.status < 600 ? err.status : 500 }
    );
  }
}
