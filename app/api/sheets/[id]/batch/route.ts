import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  formatRange,
  insertDimension,
  deleteDimension,
  setFrozenRows,
  getSheetData,
  type CellFormat,
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
  return NextResponse.json({ error: err.message || "Sheets batch failed" }, { status: 500 });
}

type FormatOp = {
  op: "format";
  sheetId: number;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  format: CellFormat;
};
type InsertOp = {
  op: "insert";
  sheetId: number;
  dimension: "ROWS" | "COLUMNS";
  startIndex: number;
  count?: number;
};
type DeleteOp = {
  op: "delete";
  sheetId: number;
  dimension: "ROWS" | "COLUMNS";
  startIndex: number;
  count?: number;
};
type FreezeOp = { op: "freeze"; sheetId: number; frozenRowCount: number };

type Body = (FormatOp | InsertOp | DeleteOp | FreezeOp) & {
  /** Tab title to re-read after the op so the client can refresh the grid. */
  refreshSheet?: string;
};

/**
 * POST — apply one structural/formatting operation, then (optionally) return
 * the refreshed grid data for `refreshSheet` so the client re-renders.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "format":
        await formatRange(
          auth.accessToken,
          id,
          {
            sheetId: body.sheetId,
            startRowIndex: body.startRow,
            endRowIndex: body.endRow,
            startColumnIndex: body.startCol,
            endColumnIndex: body.endCol,
          },
          body.format
        );
        break;
      case "insert":
        await insertDimension(
          auth.accessToken,
          id,
          body.sheetId,
          body.dimension,
          body.startIndex,
          body.count ?? 1
        );
        break;
      case "delete":
        await deleteDimension(
          auth.accessToken,
          id,
          body.sheetId,
          body.dimension,
          body.startIndex,
          body.count ?? 1
        );
        break;
      case "freeze":
        await setFrozenRows(auth.accessToken, id, body.sheetId, body.frozenRowCount);
        break;
      default:
        return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    }

    if (body.refreshSheet) {
      const data = await getSheetData(auth.accessToken, id, body.refreshSheet);
      return NextResponse.json({ ok: true, data });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
