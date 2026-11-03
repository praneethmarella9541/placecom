/**
 * Server-side upload policy (CASA 5.2.1): refuse executable and script files. Everything else is
 * allowed on purpose: people attach all sorts of business files, and Google Drive / Gmail apply
 * their own malware scanning. Only the final extension counts ("invoice.pdf.exe" is an .exe).
 */

const BLOCKED_EXTENSIONS = new Set([
  "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "dll", "cpl", "lnk", "hta", "reg",
  "jar", "js", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "sh",
]);

/** Final extension, lower-case, ignoring trailing dots/spaces and Windows stream suffixes ("a.exe::$DATA"). */
export function uploadExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.split(/[:;]/)[0].replace(/[\s.]+$/, "");
  const dot = cleaned.lastIndexOf(".");
  return dot === -1 ? "" : cleaned.slice(dot + 1).trim().toLowerCase();
}

/** An error message when the filename's type is not allowed, otherwise null. */
export function blockedUploadError(name: string | null | undefined): string | null {
  if (!name) return null;
  const ext = uploadExtension(name);
  if (!ext || !BLOCKED_EXTENSIONS.has(ext)) return null;
  return `.${ext} files can't be uploaded because they can run programs.`;
}

/** First error among a list of attachments (anything with a filename), or null. */
export function blockedAttachmentError(list: ReadonlyArray<{ filename?: string | null }> | null | undefined): string | null {
  for (const item of list ?? []) {
    const err = blockedUploadError(item?.filename);
    if (err) return err;
  }
  return null;
}
