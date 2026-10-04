import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getUserOr401 } from "@/lib/request-auth";
import { splitCsvLine } from "@/lib/broadcast-recipients";
import {
  detectBroadcastSpreadsheetKind,
  detectPhoneColumnIndex,
  normalizeToE164,
} from "@/lib/broadcast-phones";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 200;

export type WaMergeRow = {
  phone: string;
  /** Values for {{1}}, {{2}}, … in order — one per non-phone column as mapped by client */
  cells: string[];
};

export type WaMergeParseResult = {
  rows: WaMergeRow[];
  /** All column headers except the phone column */
  headers: string[];
  /** Index of the phone column in the original sheet (for reference) */
  phoneColumnIndex: number;
  totalRows: number;
  skipped: number;
  truncated: boolean;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}

function detectPhoneColumn(headers: string[]): number {
  return detectPhoneColumnIndex(headers);
}

function parseTable(
  headers: string[],
  dataRows: string[][]
): WaMergeParseResult {
  const phoneCol = detectPhoneColumn(headers);
  const nonPhoneHeaders = headers.filter((_, i) => i !== phoneCol);

  let skipped = 0;
  const rows: WaMergeRow[] = [];

  for (const row of dataRows) {
    const rawPhone = String(row[phoneCol] ?? "").trim();
    const phone = normalizeToE164(rawPhone);
    if (!phone) {
      skipped++;
      continue;
    }
    const cells = headers
      .map((_, i) => String(row[i] ?? "").trim())
      .filter((_, i) => i !== phoneCol);
    rows.push({ phone, cells });
  }

  const truncated = rows.length > MAX_ROWS;
  return {
    rows: rows.slice(0, MAX_ROWS),
    headers: nonPhoneHeaders,
    phoneColumnIndex: phoneCol,
    totalRows: rows.length,
    skipped,
    truncated,
  };
}

export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 400 });
  }

  const kind = detectBroadcastSpreadsheetKind(file);
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    if (kind === "csv") {
      const text = stripBom(buf.toString("utf8"));
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        return NextResponse.json({ error: "CSV must have a header row and at least one data row." }, { status: 400 });
      }
      const headers = splitCsvLine(lines[0]).map((h) => stripBom(h).trim());
      const dataRows = lines.slice(1).map((l) => splitCsvLine(l).map((c) => stripBom(c).trim()));
      return NextResponse.json(parseTable(headers, dataRows));
    }

    if (kind === "excel") {
      const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: false });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) return NextResponse.json({ error: "Empty workbook" }, { status: 400 });
      const sheet = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as string[][];
      if (raw.length < 2) {
        return NextResponse.json({ error: "Sheet must have a header row and at least one data row." }, { status: 400 });
      }
      const headers = raw[0].map((h) => stripBom(String(h ?? "")));
      const dataRows = raw.slice(1).map((r) => r.map((c) => String(c ?? "").trim()));
      return NextResponse.json(parseTable(headers, dataRows));
    }

    return NextResponse.json({ error: "Unsupported file type. Use .csv, .xlsx, or .xls" }, { status: 400 });
  } catch (e) {
    console.error("[parse-wa-merge]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to parse file" }, { status: 400 });
  }
}
