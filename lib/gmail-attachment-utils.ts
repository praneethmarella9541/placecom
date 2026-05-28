export type GmailAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type AttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "presentation"
  | "document"
  | "archive"
  | "other";

export function gmailAttachmentUrl(
  messageId: string,
  a: GmailAttachment,
  download = false
): string {
  const base = `/api/gmail/attachment?messageId=${encodeURIComponent(messageId)}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}&mimeType=${encodeURIComponent(a.mimeType)}`;
  return download ? `${base}&download=1` : base;
}

export function isOfficeFile(mimeType: string, filename?: string): boolean {
  const name = filename?.toLowerCase() ?? "";
  return (
    /spreadsheetml|excel|presentation|powerpoint|wordprocessingml|msword/.test(mimeType) ||
    /\.(xlsx?|pptx?|docx?)$/.test(name)
  );
}

export function isPreviewable(mimeType: string, filename?: string): boolean {
  return (
    /^image\/|^video\/|^audio\/|^text\/(plain|html|csv)|^application\/pdf/.test(mimeType) ||
    mimeType === "text/csv" ||
    (filename?.toLowerCase().endsWith(".csv") ?? false) ||
    isOfficeFile(mimeType, filename)
  );
}

export function attachmentKind(mimeType: string, filename: string): AttachmentKind {
  const name = filename.toLowerCase();
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    /\.xlsx?$/.test(name) ||
    mimeType === "text/csv" ||
    name.endsWith(".csv")
  ) {
    return "spreadsheet";
  }
  if (
    mimeType.includes("presentation") ||
    mimeType.includes("powerpoint") ||
    /\.pptx?$/.test(name)
  ) {
    return "presentation";
  }
  if (
    mimeType.includes("word") ||
    mimeType.includes("msword") ||
    /\.docx?$/.test(name)
  ) {
    return "document";
  }
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return "archive";
  return "other";
}

/** Gmail-like fold color + preview surface for non-image attachments. */
export function attachmentAccent(kind: AttachmentKind): {
  fold: string;
  surface: string;
  grid?: boolean;
} {
  switch (kind) {
    case "spreadsheet":
      return { fold: "#1a73e8", surface: "bg-[#e8f0fe]", grid: true };
    case "presentation":
      return { fold: "#f9ab00", surface: "bg-[#fef7e0]" };
    case "document":
      return { fold: "#4285f4", surface: "bg-[#e8f0fe]" };
    case "pdf":
      return { fold: "#d93025", surface: "bg-[#fce8e6]" };
    case "video":
      return { fold: "#9334e6", surface: "bg-[#f3e8fd]" };
    case "audio":
      return { fold: "#188038", surface: "bg-[#e6f4ea]" };
    case "archive":
      return { fold: "#5f6368", surface: "bg-[#f1f3f4]" };
    default:
      return { fold: "#dadce0", surface: "bg-[#f8f9fa]" };
  }
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
