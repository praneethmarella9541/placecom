import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  getSpreadsheetMeta,
  getSheetData,
  updateCell,
  getSheetValues,
} from "@/lib/sheets";
import { SHEETS_INSUFFICIENT_SCOPE } from "@/lib/sheets-scope-error";

export const runtime = "nodejs";

function errResponse(e: unknown) {
  const err = e as Error & { code?: string };
  if (err.code === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (err.code === SHEETS_INSUFFICIENT_SCOPE) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  console.error(e);
  return NextResponse.json({ error: err.message || "Sheets request failed" }, { status: 500 });
}

/**
 * GET — returns spreadsheet metadata (title + tabs) and the grid data for
 * one tab. If `?sheet=` is omitted, the first tab is loaded.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const requestedSheet = searchParams.get("sheet")?.trim() || undefined;

  try {
    const meta = await getSpreadsheetMeta(auth.accessToken, id);
    const tabTitle =
      (requestedSheet && meta.tabs.find((t) => t.title === requestedSheet)?.title) ||
      meta.tabs[0]?.title;
    if (!tabTitle) {
      return NextResponse.json({ error: "Spreadsheet has no sheets" }, { status: 404 });
    }
    const data = await getSheetData(auth.accessToken, id, tabTitle);
    return NextResponse.json(
      { meta, activeSheet: tabTitle, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return errResponse(e);
  }
}

type PutBody = {
  sheet: string;
  row: number; // 0-based
  col: number; // 0-based
  value: string;
};

/**
 * PUT — write a single cell (USER_ENTERED so formulas/numbers parse), then
 * return the refreshed computed values for the whole tab so any dependent
 * formula cells update in the grid.
 */
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const sheet = (body.sheet ?? "").trim();
  if (!sheet) return NextResponse.json({ error: "sheet is required" }, { status: 400 });
  if (typeof body.row !== "number" || typeof body.col !== "number" || body.row < 0 || body.col < 0) {
    return NextResponse.json({ error: "row and col must be non-negative numbers" }, { status: 400 });
  }

  try {
    await updateCell(auth.accessToken, id, sheet, body.row, body.col, body.value ?? "");
    // Re-fetch computed values so formula cells reflect the change.
    const values = await getSheetValues(auth.accessToken, id, sheet);
    return NextResponse.json({ ok: true, values });
  } catch (e) {
    return errResponse(e);
  }
}
