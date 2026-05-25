const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

/** Microsoft Office + OpenDocument formats — browsers can't render these
 * inline, but Google Drive's hosted viewer can. */
const OFFICE_MIME_TYPES = new Set([
  // Excel
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // PowerPoint
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Word
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // OpenDocument
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  // Misc
  "application/rtf",
]);

export function isOfficeMimeType(mimeType: string): boolean {
  return OFFICE_MIME_TYPES.has(mimeType);
}

/** Types we can reasonably show inside an iframe. */
export function supportsInAppPreview(mimeType: string): boolean {
  if (!mimeType || mimeType === "application/vnd.google-apps.folder") return false;
  if (mimeType.startsWith("image/")) return true;
  if (mimeType === "application/pdf") return true;
  if (mimeType.startsWith("text/")) return true;
  // Google Workspace native — we export to PDF and stream via our proxy
  if (
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/vnd.google-apps.spreadsheet" ||
    mimeType === "application/vnd.google-apps.presentation" ||
    mimeType === "application/vnd.google-apps.drawing"
  ) {
    return true;
  }
  // Office / OpenDocument formats — rendered by Drive's hosted viewer
  if (isOfficeMimeType(mimeType)) return true;
  if (mimeType === "application/vnd.google-apps.form" || mimeType === "application/vnd.google-apps.script") {
    return false;
  }
  return false;
}

/**
 * For Google Workspace files, use the export API; otherwise `alt=media`.
 * Returns `null` URL if the type cannot be streamed (e.g. shortcut only — caller should error).
 */
export function buildDriveContentFetch(
  fileId: string,
  mimeType: string,
  mode: "preview" | "download"
): { url: string; resultMime: string } | { error: string } {
  if (mimeType === "application/vnd.google-apps.folder") {
    return { error: "Folders are not files" };
  }
  if (mimeType === "application/vnd.google-apps.shortcut") {
    return { error: "Shortcuts are not supported yet" };
  }

  const exportMime = workspaceExportMime(mimeType, mode);
  if (exportMime) {
    return {
      url: `${DRIVE_FILES}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      resultMime: exportMime,
    };
  }

  return {
    url: `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`,
    resultMime: mimeType,
  };
}

function workspaceExportMime(mimeType: string, mode: "preview" | "download"): string | null {
  if (!mimeType.startsWith("application/vnd.google-apps.")) return null;

  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return mode === "download"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/pdf";
  }
  if (mimeType === "application/vnd.google-apps.document") {
    return "application/pdf";
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return "application/pdf";
  }
  if (mimeType === "application/vnd.google-apps.drawing") {
    return "image/png";
  }
  // Forms, scripts, etc.: try PDF; Google may reject — route will surface error
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    return "application/pdf";
  }
  return null;
}

/** Safe filename for Content-Disposition (extension aligned with exported type). */
export function suggestedDownloadName(originalName: string, resultMime: string): string {
  const base = (originalName || "file").replace(/[/\\?%*:|"<>]/g, "_").trim() || "file";
  if (resultMime === "application/pdf" && !/\.pdf$/i.test(base)) return `${base}.pdf`;
  if (
    resultMime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    !/\.xlsx$/i.test(base)
  ) {
    return `${base}.xlsx`;
  }
  if (resultMime === "image/png" && !/\.png$/i.test(base)) return `${base}.png`;
  if (resultMime === "image/jpeg" && !/\.jpe?g$/i.test(base)) return `${base}.jpg`;
  return base;
}
