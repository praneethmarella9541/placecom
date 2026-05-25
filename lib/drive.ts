import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type DriveFileRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

export type DriveListPage = {
  files: DriveFileRow[];
  nextPageToken?: string;
};

/** Escape single quotes for Drive `q` string literals. */
function escapeDriveQFragment(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Build the Drive `q` query string.
 *
 * Two distinct modes — matches Google Drive's UX:
 *
 * 1. **Browse mode (no search):** show children of the current folder.
 * 2. **Search mode (has search):** ignore folder context, search the ENTIRE
 *    Drive — same as typing in Google Drive's search bar. OR-joins
 *    `name contains` with `fullText contains` so it matches both
 *    filenames and file contents (PDFs, Docs, Sheets, etc.).
 */
function buildFilesListQ(parentId: string, search: string | undefined): string {
  const t = (search || "").trim();

  if (!t) {
    const pid = escapeDriveQFragment(parentId);
    return `'${pid}' in parents and trashed = false`;
  }

  const esc = escapeDriveQFragment(t);
  // For multi-word queries, wrap in quotes for fullText so Drive does a
  // phrase match rather than splitting tokens.
  const fullTextTerm = t.includes(" ") ? `"${esc}"` : esc;
  return `(name contains '${esc}' or fullText contains '${fullTextTerm}') and trashed = false`;
}

export async function listDriveFilesPage(
  accessToken: string,
  options: {
    pageSize: number;
    pageToken?: string;
    search?: string;
    /** Google Drive folder id, or `"root"` for My Drive root. Ignored in search mode. */
    parentId: string;
  }
): Promise<DriveListPage> {
  const pageSize = Math.min(Math.max(options.pageSize, 1), 100);
  const parentId = options.parentId.trim() || "root";
  const hasSearch = (options.search || "").trim().length > 0;
  // Browse mode: folders first, then recent. Search mode: recent first
  // (matches Google Drive's "Most relevant" default which surfaces recent
  // edits prominently — Drive API doesn't expose a relevance sort).
  const orderBy = hasSearch
    ? "modifiedTime desc,name_natural"
    : "folder,modifiedTime desc,name_natural";
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
    orderBy,
    q: buildFilesListQ(parentId, options.search),
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "user",
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const url = `${DRIVE_API}/files?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive API (files list)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Drive files list ${res.status}: ${text}`) as Error & {
      code?: string;
    };
    if (
      res.status === 403 &&
      (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        (text.includes("insufficientPermissions") && text.includes("drive.googleapis.com")))
    ) {
      err.code = "DRIVE_INSUFFICIENT_SCOPE";
      err.message =
        "Drive access was not granted for this Google account. In Google Cloud Console: enable the Google Drive API and add the drive.readonly scope to your OAuth client; then sign out and sign in with Google again.";
    }
    throw err;
  }

  const data = (await res.json()) as {
    files?: DriveFileRow[];
    nextPageToken?: string;
  };

  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}

const FORM_MIME = "application/vnd.google-apps.form";

/**
 * List Google Forms files from Drive (same account as the access token — mailbox admin when using Placecom mailbox).
 */
export async function listGoogleFormsPage(
  accessToken: string,
  options: {
    pageSize: number;
    pageToken?: string;
    search?: string;
  }
): Promise<DriveListPage> {
  const pageSize = Math.min(Math.max(options.pageSize, 1), 100);
  const base = `mimeType='${FORM_MIME}' and trashed=false`;
  const t = (options.search || "").trim();
  const q = t ? `${base} and name contains '${escapeDriveQFragment(t)}'` : base;

  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc,name_natural",
    q,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const url = `${DRIVE_API}/files?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive API (forms list)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Drive forms list ${res.status}: ${text}`) as Error & {
      code?: string;
    };
    if (
      res.status === 403 &&
      (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        (text.includes("insufficientPermissions") && text.includes("drive.googleapis.com")))
    ) {
      err.code = "DRIVE_INSUFFICIENT_SCOPE";
      err.message =
        "Drive access was not granted for this Google account. In Google Cloud Console: enable the Google Drive API and add the drive.readonly scope to your OAuth client; then sign out and sign in with Google again.";
    }
    throw err;
  }

  const data = (await res.json()) as {
    files?: DriveFileRow[];
    nextPageToken?: string;
  };

  return {
    files: data.files || [],
    nextPageToken: data.nextPageToken,
  };
}
