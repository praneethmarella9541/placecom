import "server-only";

import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import type { DriveUploadResult } from "@/lib/drive-upload";

/**
 * Upload one chunk of a Drive resumable session from the server (avoids browser CORS).
 * See https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */
export async function uploadResumableChunk(
  sessionUrl: string,
  chunk: Buffer,
  rangeStart: number,
  totalSize: number,
  mimeType: string
): Promise<{ done: boolean; file?: DriveUploadResult }> {
  if (chunk.length === 0) {
    throw new Error("Empty upload chunk");
  }

  const rangeEnd = rangeStart + chunk.length - 1;
  if (rangeStart + chunk.length > totalSize) {
    throw new Error("Upload chunk exceeds declared file size");
  }

  let putRes: Response;
  try {
    putRes = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.length),
        "Content-Type": mimeType || "application/octet-stream",
        "Content-Range": `bytes ${rangeStart}-${rangeEnd}/${totalSize}`,
      },
      body: new Uint8Array(chunk),
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive upload (chunk)"));
  }

  // More bytes expected — not an error.
  if (putRes.status === 308) {
    return { done: false };
  }

  const putText = await putRes.text();
  if (!putRes.ok) {
    throw new Error(`Drive chunk upload failed (${putRes.status}): ${putText.slice(0, 500)}`);
  }

  if (!putText.trim()) {
    return { done: false };
  }

  try {
    const data = JSON.parse(putText) as DriveUploadResult;
    if (!data.id) {
      throw new Error("Drive upload: no file id in response");
    }
    return { done: true, file: data };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { done: false };
    }
    throw e;
  }
}
