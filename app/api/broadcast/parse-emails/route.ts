import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  extractEmailsFromText,
  parseEmailsFromCsv,
} from "@/lib/broadcast-recipients";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

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

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  let emails: string[] = [];

  try {
    if (name.endsWith(".csv") || file.type === "text/csv") {
      const text = buf.toString("utf8");
      emails = parseEmailsFromCsv(text);
      if (emails.length === 0) emails = extractEmailsFromText(text);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const first = wb.SheetNames[0];
      if (!first) {
        return NextResponse.json({ emails: [] as string[], message: "Empty workbook" });
      }
      const sheet = wb.Sheets[first];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
        sheet,
        { header: 1, defval: "", raw: false }
      ) as string[][];
      const flat = rows
        .map((row) => row.map((c) => String(c ?? "").trim()).join(" "))
        .join("\n");
      emails = extractEmailsFromText(flat);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Use .csv, .xlsx, or .xls" },
        { status: 400 }
      );
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse file" },
      { status: 400 }
    );
  }

  return NextResponse.json({ emails });
}
