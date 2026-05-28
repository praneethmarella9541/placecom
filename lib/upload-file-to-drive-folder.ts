import { DRIVE_UPLOAD_CHUNK_BYTES } from "@/lib/upload-large-file-to-drive";
import type { DriveFileRow } from "@/lib/drive";

export type DriveFolderUploadResult = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
};

/**
 * Resumable upload into a specific Drive folder (no public link sharing).
 * Used by the Drive page for files larger than the simple multipart limit.
 */
export async function uploadFileToDriveFolder(
  file: File,
  parentId: string,
  onProgress?: (percent: number) => void
): Promise<DriveFolderUploadResult> {
  const mimeType = file.type || "application/octet-stream";
  const parent = parentId.trim() || "root";
  onProgress?.(0);

  const sessionRes = await fetch("/api/drive/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType,
      size: file.size,
      parentId: parent,
    }),
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
  let fileMeta: DriveFolderUploadResult | null = null;

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
      file?: DriveFolderUploadResult;
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
    const bytesPercent = file.size > 0 ? Math.round((offset / file.size) * 100) : 100;
    onProgress?.(Math.min(100, Math.max(1, bytesPercent)));
    if (chunkData.done && chunkData.file) {
      fileMeta = chunkData.file;
      break;
    }
  }

  onProgress?.(100);
  if (!fileMeta?.id) {
    throw new Error("Drive upload completed but returned no file metadata. Please try again.");
  }
  return fileMeta;
}

/** Map API upload result to list row shape. */
export function driveUploadResultToRow(
  uploaded: DriveFolderUploadResult
): DriveFileRow {
  return {
    id: uploaded.id,
    name: uploaded.name,
    mimeType: uploaded.mimeType,
    modifiedTime: new Date().toISOString(),
    size: uploaded.size,
    webViewLink: uploaded.webViewLink,
  };
}
