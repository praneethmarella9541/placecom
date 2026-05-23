import * as XLSX from "xlsx";
import { extractEmailsFromText, isValidEmail } from "@/lib/broadcast-recipients";
import { splitCsvLine } from "@/lib/broadcast-recipients";
import {
  type MailMergeRow,
  normalizeMergeFieldKey,
  resolveEmailColumnIndex,
  rowToMergeFields,
} from "@/lib/mail-merge";

export type MailMergeParseResult = {
  rows: MailMergeRow[];
  columns: string[];
  /** Raw header labels from row 1 */
  headerLabels: string[];
  skipped: number;
  emailColumnIndex: number;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}

function emailFromCell(cell: string): string | null {
  const t = stripBom(cell);
  if (!t) return null;
  if (isValidEmail(t)) return t.toLowerCase();
  const found = extractEmailsFromText(t);
  return found[0] ?? null;
}

function padRow(row: string[], width: number): string[] {
  const out = row.map((c) => stripBom(String(c ?? "")));
  while (out.length < width) out.push("");
  return out;
}

function tableWidth(table: string[][]): number {
  let w = 0;
  for (const row of table) w = Math.max(w, row?.length ?? 0);
  return Math.max(w, 1);
}

function parseTableRows(table: string[][]): MailMergeParseResult {
  const empty: MailMergeParseResult = {
    rows: [],
    columns: [],
    headerLabels: [],
    skipped: 0,
    emailColumnIndex: -1,
  };

  if (table.length < 2) {
    return empty;
  }

  const colCount = tableWidth(table);
  const headerRow = padRow(table[0] || [], colCount);
  const headerLabels = headerRow.map((h, i) => stripBom(h) || `Column ${i + 1}`);
  const columns = headerLabels.map((h) => normalizeMergeFieldKey(h));

  const dataRows: string[][] = [];
  for (let r = 1; r < table.length; r++) {
    dataRows.push(padRow(table[r] || [], colCount));
  }

  const emailColumnIndex = resolveEmailColumnIndex(headerLabels, dataRows, emailFromCell);
  if (emailColumnIndex < 0) {
    return { ...empty, headerLabels, columns };
  }

  const rows: MailMergeRow[] = [];
  let skipped = 0;

  for (const cells of dataRows) {
    if (cells.every((c) => !c.trim())) {
      skipped++;
      continue;
    }
    const fields = rowToMergeFields(headerLabels, cells, emailColumnIndex, emailFromCell);
    if (!fields?.email) {
      skipped++;
      continue;
    }
    rows.push({ email: fields.email, fields });
  }

  return { rows, columns, headerLabels, skipped, emailColumnIndex };
}

export function parseMailMergeCsv(text: string): MailMergeParseResult {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      rows: [],
      columns: [],
      headerLabels: [],
      skipped: 0,
      emailColumnIndex: -1,
    };
  }
  const table = lines.map((line) => splitCsvLine(line).map(stripBom));
  return parseTableRows(table);
}

export function readWorkbookTable(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  const ref = sheet["!ref"];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const table: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell) {
        row.push("");
        continue;
      }
      const v =
        cell.w ??
        (cell.v !== undefined && cell.v !== null
          ? typeof cell.v === "object"
            ? String((cell.v as { text?: string }).text ?? "")
            : String(cell.v)
          : "");
      row.push(stripBom(v));
    }
    table.push(row);
  }
  return table;
}

export function parseMailMergeWorkbook(buf: Buffer): MailMergeParseResult {
  const table = readWorkbookTable(buf);
  return parseTableRows(table);
}
