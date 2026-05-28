import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { uploadResumableChunk } from "@/lib/drive-resumable-chunk";

export const runtime = "nodejs";
/** Large PDFs may need many 4 MB chunks. */
export const maxDuration = 120;

const MAX_CHUNK_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/drive/upload-chunk
 * multipart: sessionUrl, offset, totalSize, mimeType, chunk
 *
 * Proxies one chunk to a Drive resumable session URL from the server so the
 * browser never calls googleapis.com directly (avoids CORS "Failed to fetch").
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

  const sessionUrl = String(formData.get("sessionUrl") ?? "").trim();
  const offset = Number(formData.get("offset"));
  const totalSize = Number(formData.get("totalSize"));
  const mimeType = String(formData.get("mimeType") ?? "application/octet-stream").trim();
  const chunk = formData.get("chunk");

  if (!sessionUrl.startsWith("https://")) {
    return NextResponse.json({ error: "Invalid upload session" }, { status: 400 });
  }
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return NextResponse.json({ error: "Invalid total size" }, { status: 400 });
  }
  if (!(chunk instanceof Blob) || chunk.size === 0) {
    return NextResponse.json({ error: "Missing chunk data" }, { status: 400 });
  }
  if (chunk.size > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk too large" }, { status: 413 });
  }
  if (offset + chunk.size > totalSize) {
    return NextResponse.json({ error: "Chunk exceeds file size" }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(await chunk.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Could not read chunk" }, { status: 400 });
  }

  try {
    const result = await uploadResumableChunk(
      sessionUrl,
      buf,
      offset,
      totalSize,
      mimeType
    );

    if (result.done && result.file) {
      return NextResponse.json({
        done: true,
        file: {
          id: result.file.id,
          name: result.file.name,
          mimeType: result.file.mimeType,
          size: result.file.size,
          webViewLink:
            result.file.webViewLink ??
            `https://drive.google.com/file/d/${result.file.id}/view`,
        },
      });
    }

    return NextResponse.json({ done: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload chunk failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
