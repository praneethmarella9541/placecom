import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getUserOr401 } from "@/lib/request-auth";
import {
  detectBroadcastSpreadsheetKind,
  parsePhonesFromCsv,
  parsePhonesFromTable,
} from "@/lib/broadcast-phones";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
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
      const phones = parsePhonesFromCsv(stripBom(buf.toString("utf8")));
      return NextResponse.json({ phones });
    }

    if (kind === "excel") {
      const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: false });
      const first = wb.SheetNames[0];
      if (!first) {
        return NextResponse.json({ phones: [] as string[], message: "Empty workbook" });
      }
      const sheet = wb.Sheets[first];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
        sheet,
        {
          header: 1,
          defval: "",
          raw: false,
        }
      ) as unknown[][];
      if (rows.length < 2) {
        return NextResponse.json({
          error: "Sheet must have a header row and at least one data row.",
        }, { status: 400 });
      }
      const headers = rows[0].map((c) => stripBom(String(c ?? "")));
      const dataRows = rows.slice(1).map((r) => r.map((c) => String(c ?? "").trim()));
      const phones = parsePhonesFromTable(headers, dataRows);
      return NextResponse.json({ phones });
    }

    return NextResponse.json(
      { error: "Unsupported file type. Use .csv, .xlsx, or .xls" },
      { status: 400 },
    );
  } catch (e) {
    console.error("[parse-phones]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse file" },
      { status: 400 },
    );
  }
}
