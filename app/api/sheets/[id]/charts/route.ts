import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  listSheetCharts,
  addChart,
  deleteChart,
  type BasicChartType,
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
  return NextResponse.json({ error: err.message || "Chart request failed" }, { status: 500 });
}

/** GET ?sheet=Title — list charts on a tab. */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  const sheet = new URL(request.url).searchParams.get("sheet")?.trim();
  if (!sheet) return NextResponse.json({ error: "sheet is required" }, { status: 400 });

  try {
    const charts = await listSheetCharts(auth.accessToken, id, sheet);
    return NextResponse.json({ charts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errResponse(e);
  }
}

type AddBody = {
  sheetId: number;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  chartType: BasicChartType;
  title?: string;
};

/** POST — insert a chart over a range. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  let body: AddBody;
  try {
    body = (await request.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const valid: BasicChartType[] = ["COLUMN", "BAR", "LINE", "PIE"];
  if (!valid.includes(body.chartType)) {
    return NextResponse.json({ error: "Invalid chartType" }, { status: 400 });
  }

  try {
    await addChart(
      auth.accessToken,
      id,
      body.sheetId,
      { startRow: body.startRow, endRow: body.endRow, startCol: body.startCol, endCol: body.endCol },
      body.chartType,
      body.title || "Chart"
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}

/** DELETE ?chartId=123 — remove a chart. */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing spreadsheet id" }, { status: 400 });

  const chartId = parseInt(new URL(request.url).searchParams.get("chartId") || "", 10);
  if (Number.isNaN(chartId)) {
    return NextResponse.json({ error: "chartId is required" }, { status: 400 });
  }

  try {
    await deleteChart(auth.accessToken, id, chartId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
