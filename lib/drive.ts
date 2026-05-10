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
 * List children of a folder (My Drive root uses parentId `"root"`).
 * Matches Google Drive’s folder tree: same parent, folders first via `orderBy`.
 */
function buildFilesListQ(parentId: string, search: string | undefined): string {
  const pid = escapeDriveQFragment(parentId);
  const inFolder = `'${pid}' in parents and trashed = false`;
  const t = (search || "").trim();
  if (!t) return inFolder;
  const esc = escapeDriveQFragment(t);
  return `${inFolder} and name contains '${esc}'`;
}

export async function listDriveFilesPage(
  accessToken: string,
  options: {
    pageSize: number;
    pageToken?: string;
    search?: string;
    /** Google Drive folder id, or `"root"` for My Drive root. */
    parentId: string;
  }
): Promise<DriveListPage> {
  const pageSize = Math.min(Math.max(options.pageSize, 1), 100);
  const parentId = options.parentId.trim() || "root";
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
    // `folder` puts folders first (same as Drive list view), then recent files.
    orderBy: "folder,modifiedTime desc,name_natural",
    q: buildFilesListQ(parentId, options.search),
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
