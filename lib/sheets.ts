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

/* ───────────────────────── Native editor (read/write) ──────────────────── */

/** A single tab within a spreadsheet. */
export type SheetTab = {
  sheetId: number;
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
  /** Number of frozen rows (header freeze), if any. */
  frozenRowCount: number;
  frozenColumnCount: number;
};

export type SpreadsheetMeta = {
  spreadsheetId: string;
  title: string;
  tabs: SheetTab[];
};

/** Per-cell display + edit payload returned to the grid. */
export type SheetCell = {
  /** Formatted display string (what Google shows in the cell). */
  display: string;
  /** Raw user-entered value or formula (what we put in the editor). */
  raw: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  /** Foreground (text) color as #rrggbb, if non-default. */
  textColor?: string;
  /** Background fill color as #rrggbb, if non-default. */
  bgColor?: string;
  /** "LEFT" | "CENTER" | "RIGHT" */
  align?: string;
  /** Font size in points, if non-default. */
  fontSize?: number;
};

export type SheetData = {
  title: string;
  /** 2-D array of cells [row][col]. Sparse rows are filled to maxCols. */
  cells: SheetCell[][];
  rowCount: number;
  columnCount: number;
  frozenRowCount: number;
  /** Pixel width per column (index = column). Missing → use default. */
  columnWidths: number[];
  /** Pixel height per row (index = row). Missing/0 → use default. */
  rowHeights: number[];
};

function rgbToHex(c?: { red?: number; green?: number; blue?: number }): string | undefined {
  if (!c) return undefined;
  const r = Math.round((c.red ?? 0) * 255);
  const g = Math.round((c.green ?? 0) * 255);
  const b = Math.round((c.blue ?? 0) * 255);
  // Treat pure white as "default" bg so we don't paint every cell white.
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

async function sheetsFetch(
  accessToken: string,
  url: string,
  init?: RequestInit
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Sheets API"));
  }
  if (res.status === 401) throw unauthorized();
  if (!res.ok) {
    const text = await res.text();
    throwIfSheetsInsufficientScope(res.status, text);
    throw new Error(`Sheets API ${res.status}: ${text}`);
  }
  return res;
}

/** Read spreadsheet metadata: title + the list of tabs. */
export async function getSpreadsheetMeta(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMeta> {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets(properties(sheetId,title,index,gridProperties))`;
  const res = await sheetsFetch(accessToken, url);
  const data = (await res.json()) as {
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: {
      properties?: {
        sheetId?: number;
        title?: string;
        index?: number;
        gridProperties?: {
          rowCount?: number;
          columnCount?: number;
          frozenRowCount?: number;
          frozenColumnCount?: number;
        };
      };
    }[];
  };
  const tabs: SheetTab[] = (data.sheets || []).map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title ?? "Sheet",
    index: s.properties?.index ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
    columnCount: s.properties?.gridProperties?.columnCount ?? 26,
    frozenRowCount: s.properties?.gridProperties?.frozenRowCount ?? 0,
    frozenColumnCount: s.properties?.gridProperties?.frozenColumnCount ?? 0,
  }));
  tabs.sort((a, b) => a.index - b.index);
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title ?? "Untitled spreadsheet",
    tabs,
  };
}

/**
 * Read one tab's grid data: formatted display values, raw values/formulas,
 * and basic cell formatting. Uses includeGridData scoped to the tab.
 */
export async function getSheetData(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<SheetData> {
  const range = encodeURIComponent(sheetTitle);
  const fields =
    "properties.title,sheets(properties(title,gridProperties),data(rowData(values(formattedValue,userEnteredValue,effectiveValue,userEnteredFormat(textFormat,backgroundColor,horizontalAlignment))),columnMetadata(pixelSize),rowMetadata(pixelSize)))";
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?ranges=${range}&includeGridData=true&fields=${fields}`;
  const res = await sheetsFetch(accessToken, url);
  const data = (await res.json()) as {
    sheets?: {
      properties?: {
        title?: string;
        gridProperties?: {
          rowCount?: number;
          columnCount?: number;
          frozenRowCount?: number;
        };
      };
      data?: {
        columnMetadata?: { pixelSize?: number }[];
        rowMetadata?: { pixelSize?: number }[];
        rowData?: {
          values?: {
            formattedValue?: string;
            userEnteredValue?: {
              stringValue?: string;
              numberValue?: number;
              boolValue?: boolean;
              formulaValue?: string;
            };
            userEnteredFormat?: {
              textFormat?: {
                bold?: boolean;
                italic?: boolean;
                strikethrough?: boolean;
                underline?: boolean;
                fontSize?: number;
                foregroundColor?: { red?: number; green?: number; blue?: number };
              };
              backgroundColor?: { red?: number; green?: number; blue?: number };
              horizontalAlignment?: string;
            };
          }[];
        }[];
      }[];
    }[];
  };

  const sheet = data.sheets?.[0];
  const grid = sheet?.data?.[0];
  const rowData = grid?.rowData ?? [];
  const columnMetadata = grid?.columnMetadata ?? [];
  const rowMetadata = grid?.rowMetadata ?? [];
  const declaredRows = sheet?.properties?.gridProperties?.rowCount ?? 1000;
  const declaredCols = sheet?.properties?.gridProperties?.columnCount ?? 26;
  const frozenRowCount = sheet?.properties?.gridProperties?.frozenRowCount ?? 0;

  // Determine actual extent of data, then pad to a comfortable minimum grid.
  let maxCols = 0;
  for (const r of rowData) {
    if (r.values && r.values.length > maxCols) maxCols = r.values.length;
  }
  const columnCount = Math.max(maxCols, 26, Math.min(declaredCols, 26));
  const dataRows = rowData.length;
  const rowCount = Math.max(dataRows + 20, 50, Math.min(declaredRows, 50));

  const cells: SheetCell[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: SheetCell[] = [];
    const src = rowData[r]?.values ?? [];
    for (let c = 0; c < columnCount; c++) {
      const cell = src[c];
      if (!cell) {
        row.push({ display: "", raw: "" });
        continue;
      }
      const uev = cell.userEnteredValue;
      let raw = "";
      if (uev?.formulaValue !== undefined) raw = uev.formulaValue;
      else if (uev?.stringValue !== undefined) raw = uev.stringValue;
      else if (uev?.numberValue !== undefined) raw = String(uev.numberValue);
      else if (uev?.boolValue !== undefined) raw = uev.boolValue ? "TRUE" : "FALSE";
      else raw = cell.formattedValue ?? "";

      const tf = cell.userEnteredFormat?.textFormat;
      const bg = cell.userEnteredFormat?.backgroundColor;
      const bgHex = rgbToHex(bg);
      row.push({
        display: cell.formattedValue ?? "",
        raw,
        bold: tf?.bold || undefined,
        italic: tf?.italic || undefined,
        strikethrough: tf?.strikethrough || undefined,
        underline: tf?.underline || undefined,
        fontSize: tf?.fontSize || undefined,
        textColor: rgbToHex(tf?.foregroundColor),
        bgColor: bgHex === "#ffffff" ? undefined : bgHex,
        align: cell.userEnteredFormat?.horizontalAlignment,
      });
    }
    cells.push(row);
  }

  const columnWidths: number[] = [];
  for (let c = 0; c < columnCount; c++) {
    columnWidths.push(columnMetadata[c]?.pixelSize ?? 0);
  }
  const rowHeights: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    rowHeights.push(rowMetadata[r]?.pixelSize ?? 0);
  }

  return {
    title: sheet?.properties?.title ?? sheetTitle,
    cells,
    rowCount,
    columnCount,
    frozenRowCount,
    columnWidths,
    rowHeights,
  };
}

/** Convert a 0-based column index to an A1 letter (0→A, 26→AA). */
export function colToLetter(col: number): string {
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Build an A1 cell ref for a tab, e.g. "Sheet1!B3". Tab name is quoted. */
export function a1(sheetTitle: string, row0: number, col0: number): string {
  const tab = sheetTitle.replace(/'/g, "''");
  return `'${tab}'!${colToLetter(col0)}${row0 + 1}`;
}

/**
 * Write a single cell using USER_ENTERED so "=SUM(...)" is parsed as a
 * formula and "5" becomes a number — matching Google Sheets typing behaviour.
 */
export async function updateCell(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  row0: number,
  col0: number,
  value: string
): Promise<void> {
  const ref = a1(sheetTitle, row0, col0);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    ref
  )}?valueInputOption=USER_ENTERED`;
  await sheetsFetch(accessToken, url, {
    method: "PUT",
    body: JSON.stringify({ range: ref, values: [[value]] }),
  });
}

/** Build an A1 range ref for a tab, e.g. "Sheet1!B3:D7" (end inclusive). */
export function a1Range(
  sheetTitle: string,
  startRow0: number,
  startCol0: number,
  endRow0: number,
  endCol0: number
): string {
  const tab = sheetTitle.replace(/'/g, "''");
  const start = `${colToLetter(startCol0)}${startRow0 + 1}`;
  const end = `${colToLetter(endCol0)}${endRow0 + 1}`;
  return `'${tab}'!${start}:${end}`;
}

/**
 * Write a rectangular block of values (paste). `values` is row-major; the
 * range is anchored at (startRow0, startCol0). USER_ENTERED so formulas and
 * numbers parse as in the UI.
 */
export async function updateRange(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  startRow0: number,
  startCol0: number,
  values: string[][]
): Promise<void> {
  if (!values.length) return;
  const endRow0 = startRow0 + values.length - 1;
  const endCol0 = startCol0 + Math.max(...values.map((r) => r.length)) - 1;
  const ref = a1Range(sheetTitle, startRow0, startCol0, endRow0, endCol0);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    ref
  )}?valueInputOption=USER_ENTERED`;
  await sheetsFetch(accessToken, url, {
    method: "PUT",
    body: JSON.stringify({ range: ref, values }),
  });
}

/** Clear the values in a rectangular range (Delete/cut). Formatting is kept. */
export async function clearRange(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  startRow0: number,
  startCol0: number,
  endRow0: number,
  endCol0: number
): Promise<void> {
  const ref = a1Range(sheetTitle, startRow0, startCol0, endRow0, endCol0);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    ref
  )}:clear`;
  await sheetsFetch(accessToken, url, { method: "POST", body: JSON.stringify({}) });
}

/** Read computed (formatted) values for a single tab — used to refresh after an edit. */
export async function getSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<string[][]> {
  const ref = encodeURIComponent(sheetTitle);
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${ref}?valueRenderOption=FORMATTED_VALUE`;
  const res = await sheetsFetch(accessToken, url);
  const data = (await res.json()) as { values?: string[][] };
  return data.values ?? [];
}

/* ── Structural + formatting batch ops ── */

export type CellFormat = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  fontSize?: number;
  textColor?: string | null; // null clears
  bgColor?: string | null; // null clears
  align?: "LEFT" | "CENTER" | "RIGHT" | null;
  numberFormat?: { type: string; pattern?: string } | null;
};

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const h = hex.replace("#", "");
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
}

type GridRange = {
  sheetId: number;
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
};

/** Apply formatting to a rectangular range via batchUpdate repeatCell. */
export async function formatRange(
  accessToken: string,
  spreadsheetId: string,
  range: GridRange,
  format: CellFormat
): Promise<void> {
  const textFormat: Record<string, unknown> = {};
  const fields: string[] = [];
  if (format.bold !== undefined) { textFormat.bold = format.bold; fields.push("userEnteredFormat.textFormat.bold"); }
  if (format.italic !== undefined) { textFormat.italic = format.italic; fields.push("userEnteredFormat.textFormat.italic"); }
  if (format.strikethrough !== undefined) { textFormat.strikethrough = format.strikethrough; fields.push("userEnteredFormat.textFormat.strikethrough"); }
  if (format.underline !== undefined) { textFormat.underline = format.underline; fields.push("userEnteredFormat.textFormat.underline"); }
  if (format.fontSize !== undefined) { textFormat.fontSize = format.fontSize; fields.push("userEnteredFormat.textFormat.fontSize"); }
  if (format.textColor !== undefined) {
    textFormat.foregroundColor = format.textColor ? hexToRgb(format.textColor) : { red: 0, green: 0, blue: 0 };
    fields.push("userEnteredFormat.textFormat.foregroundColor");
  }

  const userEnteredFormat: Record<string, unknown> = {};
  if (Object.keys(textFormat).length) userEnteredFormat.textFormat = textFormat;
  if (format.bgColor !== undefined) {
    userEnteredFormat.backgroundColor = format.bgColor ? hexToRgb(format.bgColor) : { red: 1, green: 1, blue: 1 };
    fields.push("userEnteredFormat.backgroundColor");
  }
  if (format.align !== undefined) {
    userEnteredFormat.horizontalAlignment = format.align ?? "LEFT";
    fields.push("userEnteredFormat.horizontalAlignment");
  }
  if (format.numberFormat !== undefined) {
    userEnteredFormat.numberFormat = format.numberFormat ?? { type: "TEXT" };
    fields.push("userEnteredFormat.numberFormat");
  }

  if (!fields.length) return;

  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range,
              cell: { userEnteredFormat },
              fields: fields.join(","),
            },
          },
        ],
      }),
    }
  );
}

/** Insert or delete rows/columns. dimension: "ROWS" | "COLUMNS". */
export async function insertDimension(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  dimension: "ROWS" | "COLUMNS",
  startIndex: number,
  count: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            insertDimension: {
              range: { sheetId, dimension, startIndex, endIndex: startIndex + count },
              inheritFromBefore: startIndex > 0,
            },
          },
        ],
      }),
    }
  );
}

export async function deleteDimension(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  dimension: "ROWS" | "COLUMNS",
  startIndex: number,
  count: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension, startIndex, endIndex: startIndex + count },
            },
          },
        ],
      }),
    }
  );
}

/** Freeze (or unfreeze) the top N rows of a tab. */
export async function setFrozenRows(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  frozenRowCount: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount } },
              fields: "gridProperties.frozenRowCount",
            },
          },
        ],
      }),
    }
  );
}

/* ── Tab management ── */

/** Add a new tab. Returns the new tab's title (Google assigns if omitted). */
export async function addSheetTab(
  accessToken: string,
  spreadsheetId: string,
  title?: string
): Promise<string> {
  const properties: Record<string, unknown> = {};
  if (title?.trim()) properties.title = title.trim();
  const res = await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties } }] }),
    }
  );
  const data = (await res.json()) as {
    replies?: { addSheet?: { properties?: { title?: string } } }[];
  };
  return data.replies?.[0]?.addSheet?.properties?.title ?? title ?? "Sheet";
}

/** Delete a tab by sheetId. */
export async function deleteSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
    }
  );
}

/** Rename a tab. */
export async function renameSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  title: string
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, title },
              fields: "title",
            },
          },
        ],
      }),
    }
  );
}

/** Move a tab to a new 0-based index (reorder). */
export async function moveSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  newIndex: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, index: newIndex },
              fields: "index",
            },
          },
        ],
      }),
    }
  );
}

/** Set a column's pixel width (persisted), via updateDimensionProperties. */
export async function setColumnWidth(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  columnIndex: number,
  pixelSize: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: columnIndex,
                endIndex: columnIndex + 1,
              },
              properties: { pixelSize: Math.max(20, Math.round(pixelSize)) },
              fields: "pixelSize",
            },
          },
        ],
      }),
    }
  );
}

/** Set a row's pixel height (persisted). */
export async function setRowHeight(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  rowIndex: number,
  pixelSize: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
              properties: { pixelSize: Math.max(18, Math.round(pixelSize)) },
              fields: "pixelSize",
            },
          },
        ],
      }),
    }
  );
}

/* ── Charts ── */

export type ChartInfo = {
  chartId: number;
  title: string;
  /** Best-effort chart type label (e.g. "BAR", "LINE", "PIE"). */
  type: string;
};

/** List charts that exist on a tab (id + title + type). */
export async function listSheetCharts(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<ChartInfo[]> {
  const range = encodeURIComponent(sheetTitle);
  const fields =
    "sheets(properties(title),charts(chartId,spec(title,basicChart(chartType),pieChart)))";
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?ranges=${range}&fields=${fields}`;
  const res = await sheetsFetch(accessToken, url);
  const data = (await res.json()) as {
    sheets?: {
      charts?: {
        chartId?: number;
        spec?: {
          title?: string;
          basicChart?: { chartType?: string };
          pieChart?: unknown;
        };
      }[];
    }[];
  };
  const charts = data.sheets?.[0]?.charts ?? [];
  return charts.map((c) => ({
    chartId: c.chartId ?? 0,
    title: c.spec?.title || "Untitled chart",
    type: c.spec?.pieChart ? "PIE" : c.spec?.basicChart?.chartType || "CHART",
  }));
}

export type BasicChartType = "COLUMN" | "BAR" | "LINE" | "PIE";

/**
 * Insert a chart over a data range. The first row of the range is treated as
 * headers; the first column as domain (labels), remaining columns as series.
 * PIE uses the first data column only. The chart is anchored a few columns to
 * the right of the source range so it doesn't overlap the data.
 */
export async function addChart(
  accessToken: string,
  spreadsheetId: string,
  sheetId: number,
  range: { startRow: number; endRow: number; startCol: number; endCol: number },
  chartType: BasicChartType,
  title: string
): Promise<void> {
  const sourceRange = {
    sources: [
      {
        sheetId,
        startRowIndex: range.startRow,
        endRowIndex: range.endRow + 1,
        startColumnIndex: range.startCol,
        endColumnIndex: range.endCol + 1,
      },
    ],
  };

  const anchorCell = {
    sheetId,
    rowIndex: range.startRow,
    columnIndex: range.endCol + 2,
  };

  let spec: Record<string, unknown>;
  if (chartType === "PIE") {
    spec = {
      title,
      pieChart: {
        legendPosition: "RIGHT_LEGEND",
        domain: { sourceRange },
        series: { sourceRange },
      },
    };
  } else {
    spec = {
      title,
      basicChart: {
        chartType,
        legendPosition: "BOTTOM_LEGEND",
        headerCount: 1,
        domains: [{ domain: { sourceRange } }],
        series: [{ series: { sourceRange } }],
      },
    };
  }

  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            addChart: {
              chart: {
                spec,
                position: {
                  overlayPosition: {
                    anchorCell,
                    widthPixels: 480,
                    heightPixels: 300,
                  },
                },
              },
            },
          },
        ],
      }),
    }
  );
}

/** Delete a chart by id. */
export async function deleteChart(
  accessToken: string,
  spreadsheetId: string,
  chartId: number
): Promise<void> {
  await sheetsFetch(
    accessToken,
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: "POST",
      body: JSON.stringify({ requests: [{ deleteEmbeddedObject: { objectId: chartId } }] }),
    }
  );
}
