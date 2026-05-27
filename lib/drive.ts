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
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
    q: buildFilesListQ(parentId, options.search),
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "user",
  });
  // Drive API rejects orderBy when the query uses `fullText contains` —
  // results come back in descending relevance order automatically. So we
  // only set orderBy in browse mode (no search).
  if (!hasSearch) {
    params.set("orderBy", "folder,modifiedTime desc,name_natural");
  }
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

/* ───────────────────────────── Permissions ─────────────────────────── */

export type DriveRole = "reader" | "commenter" | "writer";
export type DrivePermissionType = "user" | "group" | "domain" | "anyone";

export type DrivePermission = {
  id: string;
  type: DrivePermissionType;
  role: DriveRole | "owner";
  emailAddress?: string;
  displayName?: string;
  photoLink?: string;
  domain?: string;
  /** Only present on type:"anyone" permissions. */
  allowFileDiscovery?: boolean;
};

async function driveAuthFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    const err = new Error(`Drive ${res.status}: ${text}`) as Error & { code?: string };
    if (res.status === 401) err.code = "UNAUTHORIZED";
    else if (
      res.status === 403 &&
      (text.includes("insufficientPermissions") ||
        text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    ) {
      err.code = "DRIVE_INSUFFICIENT_SCOPE";
    }
    throw err;
  }
  return res;
}

/** List all permissions on a file or folder. */
export async function listFilePermissions(
  accessToken: string,
  fileId: string,
): Promise<DrivePermission[]> {
  const params = new URLSearchParams({
    fields:
      "permissions(id,type,role,emailAddress,displayName,photoLink,domain,allowFileDiscovery)",
    supportsAllDrives: "true",
  });
  const res = await driveAuthFetch(
    accessToken,
    `/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
  );
  const data = (await res.json()) as { permissions?: DrivePermission[] };
  return data.permissions ?? [];
}

/** Fetch the shareable webViewLink for a file or folder. */
export async function getFileShareLink(
  accessToken: string,
  fileId: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    fields: "webViewLink",
    supportsAllDrives: "true",
  });
  const res = await driveAuthFetch(
    accessToken,
    `/files/${encodeURIComponent(fileId)}?${params.toString()}`,
  );
  const data = (await res.json()) as { webViewLink?: string };
  return data.webViewLink ?? null;
}

/**
 * Add a permission. For user/group: requires emailAddress and (by default)
 * sends Google's standard "X shared a file with you" email. Anyone/domain
 * types reject the notification flag, so we force it off there.
 */
export async function addFilePermission(
  accessToken: string,
  fileId: string,
  input: {
    role: DriveRole;
    type: DrivePermissionType;
    emailAddress?: string;
    domain?: string;
    sendNotificationEmail?: boolean;
    emailMessage?: string;
  },
): Promise<DrivePermission> {
  const sendNotificationEmail =
    input.type === "user" || input.type === "group"
      ? input.sendNotificationEmail !== false
      : false;
  const params = new URLSearchParams({
    fields:
      "id,type,role,emailAddress,displayName,photoLink,domain,allowFileDiscovery",
    supportsAllDrives: "true",
    sendNotificationEmail: sendNotificationEmail ? "true" : "false",
  });
  if (sendNotificationEmail && input.emailMessage) {
    params.set("emailMessage", input.emailMessage);
  }
  const body: Record<string, unknown> = { role: input.role, type: input.type };
  if (input.emailAddress) body.emailAddress = input.emailAddress;
  if (input.domain) body.domain = input.domain;

  const res = await driveAuthFetch(
    accessToken,
    `/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return (await res.json()) as DrivePermission;
}

/** Change an existing permission's role. */
export async function updateFilePermission(
  accessToken: string,
  fileId: string,
  permissionId: string,
  role: DriveRole,
): Promise<DrivePermission> {
  const params = new URLSearchParams({
    fields:
      "id,type,role,emailAddress,displayName,photoLink,domain,allowFileDiscovery",
    supportsAllDrives: "true",
  });
  const res = await driveAuthFetch(
    accessToken,
    `/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(
      permissionId,
    )}?${params.toString()}`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return (await res.json()) as DrivePermission;
}

/** Remove a permission (revokes access). 404 is treated as success. */
export async function deleteFilePermission(
  accessToken: string,
  fileId: string,
  permissionId: string,
): Promise<void> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  try {
    await driveAuthFetch(
      accessToken,
      `/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(
        permissionId,
      )}?${params.toString()}`,
      { method: "DELETE" },
    );
  } catch (e) {
    // 404 already-gone is acceptable
    const err = e as Error & { code?: string };
    if (/Drive 404/.test(err.message)) return;
    throw err;
  }
}
