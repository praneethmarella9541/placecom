import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { throwIfSheetsInsufficientScope } from "@/lib/sheets-scope-error";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

/** Google Drive mime type for a spreadsheet file. */
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export type SpreadsheetRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  /** Owner display name (best-effort; Drive may omit on shared drives). */
  owner?: string;
  starred?: boolean;
};

export type SpreadsheetListPage = {
  files: SpreadsheetRow[];
  nextPageToken?: string;
};

/** Top-level views the Sheets sidebar exposes — mirrors the Drive section. */
export type SheetsView = "my-sheets" | "shared-with-me" | "starred";

function escapeQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Throw a tagged UNAUTHORIZED error (consumed by routes → 401). */
function unauthorized(): Error & { code?: string } {
  const err = new Error("UNAUTHORIZED") as Error & { code?: string };
  err.code = "UNAUTHORIZED";
  return err;
}

/**
 * List the user's Google Sheets via the Drive API (Drive is the file index;
 * Sheets API has no "list files" endpoint). Filters to spreadsheet mime type.
 * Supports search + the three sidebar views.
 */
export async function listSpreadsheetsPage(
  accessToken: string,
  options: {
    pageSize: number;
    pageToken?: string;
    search?: string;
    view?: SheetsView;
  }
): Promise<SpreadsheetListPage> {
  const pageSize = Math.min(Math.max(options.pageSize, 1), 100);
  const view: SheetsView = options.view ?? "my-sheets";
  const t = (options.search || "").trim();

  let q = `mimeType='${SPREADSHEET_MIME}' and trashed=false`;
  if (t) {
    q += ` and name contains '${escapeQ(t)}'`;
  } else if (view === "shared-with-me") {
    q += " and sharedWithMe=true";
  } else if (view === "starred") {
    q += " and starred=true";
  }

  const params = new URLSearchParams({
    pageSize: String(pageSize),
    fields:
      "nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, starred, owners(displayName))",
    q,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "allDrives",
  });
  if (!t) params.set("orderBy", "modifiedTime desc,name_natural");
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const url = `${DRIVE_API}/files?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive API (sheets list)"));
  }

  if (res.status === 401) throw unauthorized();
  if (!res.ok) {
    const text = await res.text();
    throwIfSheetsInsufficientScope(res.status, text);
    const err = new Error(`Sheets list ${res.status}: ${text}`) as Error & { code?: string };
    if (
      res.status === 403 &&
      (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        (text.includes("insufficientPermissions") && text.includes("drive.googleapis.com")))
    ) {
      err.code = "DRIVE_INSUFFICIENT_SCOPE";
      err.message =
        "Drive access was not granted for this Google account. Add the https://www.googleapis.com/auth/drive scope, then sign out and sign in with Google again.";
    }
    throw err;
  }

  const data = (await res.json()) as {
    nextPageToken?: string;
    files?: {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      webViewLink?: string;
      starred?: boolean;
      owners?: { displayName?: string }[];
    }[];
  };

  return {
    files: (data.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      starred: f.starred,
      owner: f.owners?.[0]?.displayName,
    })),
    nextPageToken: data.nextPageToken,
  };
}

export type SpreadsheetCreateResult = {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  title: string;
};

/**
 * Create a new, empty spreadsheet via the Sheets API.
 * Requires OAuth scope `https://www.googleapis.com/auth/spreadsheets`.
 */
export async function createSpreadsheet(
  accessToken: string,
  options: { title: string }
): Promise<SpreadsheetCreateResult> {
  const title = options.title.trim() || "Untitled spreadsheet";

  let res: Response;
  try {
    res = await fetch(SHEETS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { title } }),
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Google Sheets API (create) — check network and Sheets API enablement")
    );
  }

  const text = await res.text();
  if (res.status === 401) throw unauthorized();
  if (!res.ok) {
    throwIfSheetsInsufficientScope(res.status, text);
    throw new Error(`Sheets create failed (${res.status}): ${text}`);
  }

  const data = JSON.parse(text) as {
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
  };
  if (!data.spreadsheetId) {
    throw new Error("Sheets create returned no spreadsheetId");
  }
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
    title: data.properties?.title || title,
  };
}

/**
 * Move a spreadsheet to the trash via the Drive API (matches Drive's
 * delete-to-trash UX; recoverable from Google Drive's trash).
 */
export async function trashSpreadsheet(
  accessToken: string,
  fileId: string
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive API (sheets trash)"));
  }

  if (res.status === 401) throw unauthorized();
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Sheets trash ${res.status}: ${text}`) as Error & { code?: string };
    if (
      res.status === 403 &&
      (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
        text.includes("insufficientPermissions"))
    ) {
      err.code = "DRIVE_INSUFFICIENT_SCOPE";
    }
    throw err;
  }
}
