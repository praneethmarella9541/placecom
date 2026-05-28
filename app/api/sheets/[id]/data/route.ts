import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  getSpreadsheetMeta,
  getSheetData,
  updateCell,
  updateRange,
  clearRange,
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
  /** "cell" (default): write one cell. "range": paste a block. "clear": clear a block. */
  mode?: "cell" | "range" | "clear";
  row: number; // 0-based anchor / start row
  col: number; // 0-based anchor / start col
  value?: string; // for mode "cell"
  values?: string[][]; // for mode "range"
  endRow?: number; // for mode "clear" (0-based, inclusive)
  endCol?: number; // for mode "clear" (0-based, inclusive)
};

/**
 * PUT — write a single cell, paste a range of values, or clear a range
 * (USER_ENTERED so formulas/numbers parse), then return the refreshed
 * computed values for the whole tab so dependent formula cells update.
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

  const mode = body.mode ?? "cell";

  try {
    if (mode === "range") {
      if (!Array.isArray(body.values) || !body.values.length) {
        return NextResponse.json({ error: "values is required for range mode" }, { status: 400 });
      }
      await updateRange(auth.accessToken, id, sheet, body.row, body.col, body.values);
    } else if (mode === "clear") {
      const endRow = typeof body.endRow === "number" ? body.endRow : body.row;
      const endCol = typeof body.endCol === "number" ? body.endCol : body.col;
      await clearRange(auth.accessToken, id, sheet, body.row, body.col, endRow, endCol);
    } else {
      await updateCell(auth.accessToken, id, sheet, body.row, body.col, body.value ?? "");
    }
    // Re-fetch computed values so formula cells reflect the change.
    const values = await getSheetValues(auth.accessToken, id, sheet);
    return NextResponse.json({ ok: true, values });
  } catch (e) {
    return errResponse(e);
  }
}
