/** Chunk size for proxied Drive uploads (under typical serverless body limits). */
export const DRIVE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export type DriveUploadFileResult = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink: string;
};

/** 0–100 upload progress for Drive link attachments. */
export type DriveUploadProgressMap = Record<string, number>;

/**
 * Upload a large file to Drive via our API (chunked proxy).
 * Avoids browser CORS failures on direct PUT to googleapis.com.
 */
export async function uploadLargeFileToDrive(
  file: File,
  onProgress?: (percent: number) => void
): Promise<DriveUploadFileResult> {
  const mimeType = file.type || "application/octet-stream";
  onProgress?.(0);

  const sessionRes = await fetch("/api/drive/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType, size: file.size }),
  });
  const sessionRaw = await sessionRes.text();
  let sessionData: { sessionUrl?: string; error?: string } = {};
  try {
    sessionData = sessionRaw ? JSON.parse(sessionRaw) : {};
  } catch {
    /* non-JSON */
  }
  if (!sessionRes.ok || !sessionData.sessionUrl) {
    throw new Error(
      sessionData.error ||
        `Could not start Drive upload (${sessionRes.status}). Check that Drive access is enabled.`
    );
  }

  const sessionUrl = sessionData.sessionUrl;
  onProgress?.(1);
  let offset = 0;
  let fileMeta: DriveUploadFileResult | null = null;

  while (offset < file.size) {
    const end = Math.min(offset + DRIVE_UPLOAD_CHUNK_BYTES, file.size);
    const slice = file.slice(offset, end);

    const form = new FormData();
    form.append("sessionUrl", sessionUrl);
    form.append("offset", String(offset));
    form.append("totalSize", String(file.size));
    form.append("mimeType", mimeType);
    form.append("chunk", slice, "chunk.bin");

    const chunkRes = await fetch("/api/drive/upload-chunk", {
      method: "POST",
      body: form,
    });
    const chunkRaw = await chunkRes.text();
    let chunkData: {
      done?: boolean;
      file?: DriveUploadFileResult;
      error?: string;
    } = {};
    try {
      chunkData = chunkRaw ? JSON.parse(chunkRaw) : {};
    } catch {
      /* non-JSON */
    }
    if (!chunkRes.ok) {
      throw new Error(chunkData.error || `Drive upload failed (${chunkRes.status})`);
    }

    offset = end;
    const bytesPercent = file.size > 0 ? Math.round((offset / file.size) * 98) : 98;
    onProgress?.(Math.min(98, Math.max(1, bytesPercent)));
    if (chunkData.done && chunkData.file) {
      fileMeta = chunkData.file;
      break;
    }
  }

  if (fileMeta?.id) {
    onProgress?.(99);
    const finalRes = await fetch("/api/drive/upload-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: fileMeta.id }),
    });
    const finalRaw = await finalRes.text();
    let finalData: { file?: DriveUploadFileResult; error?: string } = {};
    try {
      finalData = finalRaw ? JSON.parse(finalRaw) : {};
    } catch {
      /* non-JSON */
    }
    onProgress?.(100);
    if (finalRes.ok && finalData.file) {
      return finalData.file;
    }
    return fileMeta;
  }

  // Upload finished without metadata in chunk response — finalize by querying session end.
  throw new Error("Drive upload completed but returned no file metadata. Please try again.");
}
