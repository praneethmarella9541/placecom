import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { extractPhonesFromText, parsePhonesFromCsv } from "@/lib/broadcast-phones";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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

  let phones: string[] = [];

  try {
    if (name.endsWith(".csv") || file.type === "text/csv") {
      const text = buf.toString("utf8");
      phones = parsePhonesFromCsv(text);
      if (phones.length === 0) phones = extractPhonesFromText(text);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
      const wb = XLSX.read(buf, { type: "buffer" });
      const first = wb.SheetNames[0];
      if (!first) {
        return NextResponse.json({ phones: [] as string[], message: "Empty workbook" });
      }
      const sheet = wb.Sheets[first];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      }) as string[][];
      const flat = rows.map((row) => row.map((c) => String(c ?? "").trim()).join(" ")).join("\n");
      phones = extractPhonesFromText(flat);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Use .csv, .xlsx, or .xls" },
        { status: 400 },
      );
    }
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse file" },
      { status: 400 },
    );
  }

  return NextResponse.json({ phones });
}
