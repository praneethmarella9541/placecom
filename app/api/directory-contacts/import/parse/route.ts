import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { MAX_IMPORT_ROWS } from "@/lib/contact-import";
import { decodeCsvBytes, parseCsvRows, readWorkbookRows, rowsToSheet } from "@/lib/contact-import-sheet";

export const runtime = "nodejs";

/** Under Vercel's 4.5 MB request body cap, so an oversized file gets this message instead of a bare 413. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/directory-contacts/import/parse — reads an uploaded CSV / Excel
 * file into headers + rows for the import dialog. Nothing is written here;
 * the dialog maps columns client-side and then posts to ../import.
 */
export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 4 MB). Split it into smaller files." }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  let raw: string[][];
  try {
    if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt") || file.type === "text/csv") {
      raw = parseCsvRows(decodeCsvBytes(buf));
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".ods")) {
      raw = readWorkbookRows(buf);
    } else {
      return NextResponse.json({ error: "Unsupported file type. Use .csv, .xlsx or .xls" }, { status: 400 });
    }
  } catch (e) {
    console.error("[contact-import] parse failed", e);
    return NextResponse.json({ error: "Couldn't read that file. Is it a valid CSV or Excel file?" }, { status: 400 });
  }

  const sheet = rowsToSheet(raw);
  if (sheet.rows.length === 0) {
    return NextResponse.json(
      { error: "No contacts found. The file needs a header row and at least one row of data." },
      { status: 400 }
    );
  }
  if (sheet.rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      {
        error: `This file has ${sheet.rows.length.toLocaleString()} rows. Import up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time. Split the file and import each part.`,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ fileName: file.name, ...sheet });
}
