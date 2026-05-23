import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { mergeTemplate } from "@/lib/mail-merge";
import { parseMailMergeCsv, parseMailMergeWorkbook } from "@/lib/mail-merge-sheet";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 80;

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

  try {
    let parsed;
    if (name.endsWith(".csv") || file.type === "text/csv") {
      parsed = parseMailMergeCsv(buf.toString("utf8"));
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
      parsed = parseMailMergeWorkbook(buf);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Use .csv, .xlsx, or .xls" },
        { status: 400 }
      );
    }

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid rows found. Include a header row with an Email column plus any fields you want (Name, Phone, Company, etc.).",
        },
        { status: 400 }
      );
    }

    const rows = parsed.rows.slice(0, MAX_ROWS);
    const truncated = parsed.rows.length > MAX_ROWS;

    const sample = rows[0];
    const subjectTemplate = "Hello {{name}}";
    const bodyTemplate = "Dear {{name}},\n\nYour contact: {{phone}}\n";

    return NextResponse.json({
      rows,
      columns: parsed.columns,
      skipped: parsed.skipped,
      truncated,
      maxRows: MAX_ROWS,
      samplePreview: {
        subject: mergeTemplate(subjectTemplate, sample.fields),
        body: mergeTemplate(bodyTemplate, sample.fields),
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to parse file" },
      { status: 400 }
    );
  }
}
