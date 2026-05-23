import * as XLSX from "xlsx";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { splitCsvLine } from "@/lib/broadcast-recipients";
import {
  type MailMergeRow,
  normalizeMergeFieldKey,
  rowToMergeFields,
} from "@/lib/mail-merge";

export type MailMergeParseResult = {
  rows: MailMergeRow[];
  columns: string[];
  skipped: number;
};

const EMAIL_HEADER_HINTS = ["email", "e_mail", "mail", "email_address"];

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}

function padRow(row: string[], width: number): string[] {
  const out = row.map((c) => stripBom(String(c ?? "")));
  while (out.length < width) out.push("");
  return out;
}

/** Find the row that contains an Email column header (not always row 0). */
function findHeaderRowIndex(table: string[][]): number {
  const limit = Math.min(8, table.length);
  for (let i = 0; i < limit; i++) {
    for (const cell of table[i] || []) {
      const key = normalizeMergeFieldKey(stripBom(String(cell ?? "")));
      if (EMAIL_HEADER_HINTS.includes(key) || key.includes("email")) {
        return i;
      }
    }
  }
  return 0;
}

function parseTableRows(table: string[][]): MailMergeParseResult {
  if (table.length === 0) {
    return { rows: [], columns: [], skipped: 0 };
  }

  const headerIdx = findHeaderRowIndex(table);
  const headerRow = padRow(table[headerIdx] || [], Math.max(...table.map((r) => r.length)));
  const columns = headerRow.map((h, i) => stripBom(h) || `column_${i + 1}`);
  const colCount = columns.length;

  const rows: MailMergeRow[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < table.length; r++) {
    const cells = padRow(table[r] || [], colCount);
    if (cells.every((c) => !c.trim())) {
      skipped++;
      continue;
    }
    const fields = rowToMergeFields(columns, cells);
    if (!fields?.email || !isValidEmail(fields.email)) {
      skipped++;
      continue;
    }
    rows.push({ email: fields.email.toLowerCase(), fields });
  }

  const normalizedColumns = columns.map((c) => normalizeMergeFieldKey(c));
  return { rows, columns: normalizedColumns, skipped };
}

export function parseMailMergeCsv(text: string): MailMergeParseResult {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], columns: [], skipped: 0 };
  const table = lines.map((line) => splitCsvLine(line).map(stripBom));
  return parseTableRows(table);
}

export function parseMailMergeWorkbook(buf: Buffer): MailMergeParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return { rows: [], columns: [], skipped: 0 };
  const sheet = wb.Sheets[first];
  const ref = sheet["!ref"];
  const table = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
    sheet,
    { header: 1, defval: "", raw: false, blankrows: false }
  ) as string[][];
  const normalized = table.map((row) =>
    (row || []).map((c) => stripBom(String(c ?? "")))
  );
  if (normalized.length === 0 && ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        row.push(stripBom(String(sheet[addr]?.v ?? "")));
      }
      normalized.push(row);
    }
  }
  return parseTableRows(normalized);
}
