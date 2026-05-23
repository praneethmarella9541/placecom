import * as XLSX from "xlsx";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { splitCsvLine } from "@/lib/broadcast-recipients";
import { type MailMergeRow, normalizeMergeFieldKey, rowToMergeFields } from "@/lib/mail-merge";

export type MailMergeParseResult = {
  rows: MailMergeRow[];
  columns: string[];
  skipped: number;
};

function parseTableRows(table: string[][]): MailMergeParseResult {
  if (table.length === 0) {
    return { rows: [], columns: [], skipped: 0 };
  }

  const headerRow = table[0].map((c) => String(c ?? "").trim());
  const columns = headerRow.map((h, i) => h || `column_${i + 1}`);
  const rows: MailMergeRow[] = [];
  let skipped = 0;

  for (let r = 1; r < table.length; r++) {
    const cells = table[r].map((c) => String(c ?? "").trim());
    if (cells.every((c) => !c)) {
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

  return { rows, columns: columns.map((c) => normalizeMergeFieldKey(c)), skipped };
}

export function parseMailMergeCsv(text: string): MailMergeParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], columns: [], skipped: 0 };
  const table = lines.map((line) => splitCsvLine(line));
  return parseTableRows(table);
}

export function parseMailMergeWorkbook(buf: Buffer): MailMergeParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return { rows: [], columns: [], skipped: 0 };
  const sheet = wb.Sheets[first];
  const table = XLSX.utils.sheet_to_json<(string | number | boolean | null | undefined)[]>(
    sheet,
    { header: 1, defval: "", raw: false }
  ) as string[][];
  const normalized = table.map((row) => row.map((c) => String(c ?? "").trim()));
  return parseTableRows(normalized);
}
