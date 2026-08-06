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
