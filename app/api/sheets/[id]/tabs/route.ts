import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  addSheetTab,
  deleteSheetTab,
  renameSheetTab,
  moveSheetTab,
  getSpreadsheetMeta,
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
  return NextResponse.json({ error: err.message || "Tab operation failed" }, { status: 500 });
}

type Body =
  | { op: "add"; title?: string }
  | { op: "delete"; sheetId: number }
  | { op: "rename"; sheetId: number; title: string }
  | { op: "move"; sheetId: number; newIndex: number };

/**
 * POST — tab management: add / delete / rename / move (reorder). Always
 * returns the refreshed spreadsheet meta (title + tab list) plus, for add,
 * the new tab's title so the client can switch to it.
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
    let newTabTitle: string | undefined;
    switch (body.op) {
      case "add":
        newTabTitle = await addSheetTab(auth.accessToken, id, body.title);
        break;
      case "delete":
        await deleteSheetTab(auth.accessToken, id, body.sheetId);
        break;
      case "rename": {
        const title = (body.title ?? "").trim();
        if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
        await renameSheetTab(auth.accessToken, id, body.sheetId, title);
        break;
      }
      case "move":
        await moveSheetTab(auth.accessToken, id, body.sheetId, body.newIndex);
        break;
      default:
        return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    }

    const meta = await getSpreadsheetMeta(auth.accessToken, id);
    return NextResponse.json({ ok: true, meta, newTabTitle });
  } catch (e) {
    return errResponse(e);
  }
}
