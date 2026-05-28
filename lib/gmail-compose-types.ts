/**
 * Attachment in the compose / inline-reply window.
 * - `new` — freshly picked file with base64 in memory.
 * - `saved` — attachment on a server draft (fetched on send).
 * - `drive` — file over 25 MB uploaded to Drive; sent as a link.
 */
export type PendingFile =
  | { kind: "new"; file: File; base64: string }
  | {
      kind: "saved";
      name: string;
      mimeType: string;
      size: number;
      messageId: string;
      attachmentId: string;
    }
  | {
      kind: "drive";
      name: string;
      mimeType: string;
      size: number;
      driveFileId: string;
      webViewLink: string;
    };

export function pendingFileName(f: PendingFile): string {
  return f.kind === "new" ? f.file.name : f.name;
}

export function pendingFileSize(f: PendingFile): number {
  return f.kind === "new" ? f.file.size : f.size;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
