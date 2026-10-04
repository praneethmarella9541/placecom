import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const SHEETS_API = "https://sheets.googleapis.com/v4";

type SheetsApiError = Error & { status?: number; body?: string; code?: string };

function toSheetsApiError(res: Response, text: string, label: string): SheetsApiError {
  const err = new Error(`Google Sheets ${label} failed (${res.status}): ${text}`) as SheetsApiError;
  err.status = res.status;
  err.body = text;
  if (res.status === 401) {
    err.code = "UNAUTHORIZED";
  } else if (
    res.status === 403 &&
    (text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      (text.includes("insufficientPermissions") && text.includes("sheets.googleapis.com")))
  ) {
    err.code = "SHEETS_INSUFFICIENT_SCOPE";
    err.message =
      "Google Sheets access was not granted. Enable the Google Sheets API and scope https://www.googleapis.com/auth/spreadsheets; then sign out and sign in with Google again.";
  }
  return err;
}

export type GoogleSheetCreateResult = {
  spreadsheetId: string;
};

/** Creates a blank Google Sheet with the given title. Requires the `spreadsheets` scope. */
export async function createGoogleSheet(
  accessToken: string,
  options: { title: string }
): Promise<GoogleSheetCreateResult> {
  const title = options.title.trim();
  if (!title) {
    throw new Error("Sheet title is required");
  }

  let res: Response;
  try {
    res = await fetch(`${SHEETS_API}/spreadsheets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties: { title } }),
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Sheets API (create) — check network and Sheets API enablement"));
  }

  const text = await res.text();
  if (!res.ok) throw toSheetsApiError(res, text, "create");

  let data: { spreadsheetId?: string };
  try {
    data = JSON.parse(text) as { spreadsheetId?: string };
  } catch {
    throw new Error("Google Sheets create returned invalid JSON");
  }

  const spreadsheetId = data.spreadsheetId?.trim();
  if (!spreadsheetId) {
    throw new Error("Google Sheets create did not return spreadsheetId");
  }

  return { spreadsheetId };
}

export type GoogleSheetTable = {
  title: string;
  tabs: string[];
  tab: string;
  /** Row-major grid of display strings (what the user sees in Sheets). */
  values: string[][];
};

/** Rows read per import. Generous enough to detect "over the cap" without pulling a whole workbook. */
const SHEET_READ_MAX_ROWS = 2001;

async function sheetsGet(accessToken: string, path: string, label: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${SHEETS_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, `Google Sheets API (${label}) — check network and Sheets API enablement`));
  }
  const text = await res.text();
  if (!res.ok) throw toSheetsApiError(res, text, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Google Sheets ${label} returned invalid JSON`);
  }
}

/**
 * Reads one tab of an existing spreadsheet as a grid of formatted strings.
 * Defaults to the first visible tab. FORMATTED_VALUE keeps phone numbers and
 * leading zeros exactly as shown in the sheet. Requires the `spreadsheets` scope.
 */
export async function readGoogleSheetTable(
  accessToken: string,
  spreadsheetId: string,
  tab?: string
): Promise<GoogleSheetTable> {
  const meta = (await sheetsGet(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(title,hidden)`,
    "metadata"
  )) as {
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string; hidden?: boolean } }>;
  };

  const tabs = (meta.sheets ?? [])
    .filter((s) => !s.properties?.hidden && s.properties?.title)
    .map((s) => s.properties!.title as string);
  if (tabs.length === 0) throw new Error("This spreadsheet has no visible tabs.");

  const chosen = tab && tabs.includes(tab) ? tab : tabs[0];
  const range = `'${chosen.replace(/'/g, "''")}'!A1:AZ${SHEET_READ_MAX_ROWS}`;

  const data = (await sheetsGet(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
    "values"
  )) as { values?: unknown[][] };

  const values = (data.values ?? []).map((row) => (row ?? []).map((c) => String(c ?? "")));
  return { title: meta.properties?.title?.trim() || "Google Sheet", tabs, tab: chosen, values };
}
