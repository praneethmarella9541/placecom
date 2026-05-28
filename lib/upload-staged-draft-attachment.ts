import { DRIVE_UPLOAD_CHUNK_BYTES } from "@/lib/upload-large-file-to-drive";

export type StagedDraftAttachmentResult = {
  uploadId: string;
  name: string;
  mimeType: string;
  size: number;
};

/**
 * Stage a draft attachment on the server in 4 MB chunks (avoids Vercel JSON body limits).
 * Files stay as real Gmail attachments when the draft is saved — not Drive links.
 */
export async function uploadStagedDraftAttachment(
  file: File,
  onProgress?: (percent: number) => void
): Promise<StagedDraftAttachmentResult> {
  const mimeType = file.type || "application/octet-stream";
  onProgress?.(0);

  let uploadId = "";
  let offset = 0;

  while (offset < file.size) {
    const end = Math.min(offset + DRIVE_UPLOAD_CHUNK_BYTES, file.size);
    const slice = file.slice(offset, end);

    const form = new FormData();
    if (uploadId) form.append("uploadId", uploadId);
    form.append("offset", String(offset));
    form.append("totalSize", String(file.size));
    form.append("mimeType", mimeType);
    form.append("filename", file.name);
    form.append("chunk", slice, "chunk.bin");

    const res = await fetch("/api/gmail/drafts/attachment-chunk", {
      method: "POST",
      body: form,
    });
    const data = (await res.json()) as {
      uploadId?: string;
      done?: boolean;
      error?: string;
    };
    if (!res.ok || !data.uploadId) {
      throw new Error(data.error || `Attachment upload failed (${res.status})`);
    }
    uploadId = data.uploadId;
    offset = end;
    const pct = file.size > 0 ? Math.round((offset / file.size) * 100) : 100;
    onProgress?.(Math.min(100, pct));
    if (data.done) break;
  }

  onProgress?.(100);
  return { uploadId, name: file.name, mimeType, size: file.size };
}
