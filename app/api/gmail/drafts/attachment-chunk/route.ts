import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  appendStagedChunk,
  createStagedUpload,
} from "@/lib/draft-attachment-staging";
import { GMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/gmail-draft-limits";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * POST multipart: uploadId?, offset, totalSize, filename?, mimeType?, chunk
 * First chunk (no uploadId): creates a staging session and returns uploadId.
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

  const offset = Number(formData.get("offset"));
  const totalSize = Number(formData.get("totalSize"));
  const mimeType = String(formData.get("mimeType") ?? "application/octet-stream").trim();
  const filename = String(formData.get("filename") ?? "attachment").trim() || "attachment";
  const uploadIdIn = String(formData.get("uploadId") ?? "").trim();
  const chunk = formData.get("chunk");

  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "Invalid offset" }, { status: 400 });
  }
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return NextResponse.json({ error: "Invalid total size" }, { status: 400 });
  }
  if (totalSize > GMAIL_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds Gmail's 25 MB attachment limit" },
      { status: 413 }
    );
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

  const buf = Buffer.from(await chunk.arrayBuffer());

  try {
    let uploadId = uploadIdIn;
    if (!uploadId) {
      if (offset !== 0) {
        return NextResponse.json({ error: "uploadId required after first chunk" }, { status: 400 });
      }
      uploadId = createStagedUpload(auth.userId, filename, mimeType, totalSize);
    }

    const { done, received } = await appendStagedChunk(auth.userId, uploadId, offset, buf);
    return NextResponse.json({ uploadId, done, received });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: err.message || "Staging failed" }, { status: 400 });
  }
}
