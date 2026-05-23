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
  headerLabels: string[];
  skipped: number;
  emailColumnIndex: number;
};

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}

export function emailFromCell(cell: string): string | null {
  const t = stripBom(cell);
  if (!t) return null;
  if (isValidEmail(t)) return t.toLowerCase();
  const found = extractEmailsFromText(t);
  return found[0] ?? null;
}

function looksLikePhone(s: string): boolean {
  const t = s.trim();
  if (!t || /@/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function looksLikeName(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 80 || /@/.test(t)) return false;
  if (looksLikePhone(t)) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M}\s'.-]*$/u.test(t);
}

function padRow(row: string[], width: number): string[] {
  const out = row.map((c) => stripBom(String(c ?? "")));
  while (out.length < width) out.push("");
  return out;
}

/** Widest column count that has any value in the first N rows. */
function detectColumnCount(table: string[][]): number {
  let maxCol = 0;
  const limit = Math.min(table.length, 200);
  for (let r = 0; r < limit; r++) {
    const row = table[r] || [];
    for (let c = row.length - 1; c >= 0; c--) {
      if (String(row[c] ?? "").trim()) {
        maxCol = Math.max(maxCol, c + 1);
        break;
      }
    }
  }
  return Math.max(maxCol, 1);
}

function isGenericHeader(label: string): boolean {
  const t = stripBom(label);
  if (!t) return true;
  return /^column\s*\d+$/i.test(t) || /^field\s*\d+$/i.test(t);
}

/** Fill blank/generic headers (Column 2) using content or common positions. */
function finalizeHeaderLabels(headerRow: string[], dataRows: string[][]): string[] {
  const labels = headerRow.map((h, i) => stripBom(h) || "");
  const used = new Set<string>();

  for (const label of labels) {
    if (label && !isGenericHeader(label)) {
      used.add(normalizeMergeFieldKey(label));
    }
  }

  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && !isGenericHeader(labels[i])) continue;

    const samples = dataRows
      .map((row) => stripBom(row[i] ?? ""))
      .filter(Boolean)
      .slice(0, 25);

    let inferred: string | null = null;
    if (samples.length > 0) {
      let emailHits = 0;
      let phoneHits = 0;
      let nameHits = 0;
      for (const s of samples) {
        if (emailFromCell(s)) emailHits++;
        else if (looksLikePhone(s)) phoneHits++;
        else if (looksLikeName(s)) nameHits++;
      }
      const n = samples.length;
      if (emailHits / n >= 0.4) inferred = "Email";
      else if (phoneHits / n >= 0.4) inferred = "Phone";
      else if (nameHits / n >= 0.4) inferred = "Name";
    }

    if (!inferred) {
      if (i === 1) inferred = "Name";
      else if (i === 2) inferred = "Phone";
      else if (i === 3) inferred = "Company";
      else inferred = `Field_${i + 1}`;
    }

    let candidate = inferred;
    let n = 2;
    while (used.has(normalizeMergeFieldKey(candidate))) {
      candidate = `${inferred}_${n++}`;
    }
    labels[i] = candidate;
    used.add(normalizeMergeFieldKey(candidate));
  }

  return labels.map((h, i) => h || `Column ${i + 1}`);
}

function normalizeTable(table: string[][]): string[][] {
  if (table.length === 0) return [];
  const colCount = detectColumnCount(table);
  return table
    .map((row) => padRow(row || [], colCount))
    .filter((row, idx) => idx === 0 || row.some((c) => c.trim()));
}

function parseTableRows(table: string[][]): MailMergeParseResult {
  const empty: MailMergeParseResult = {
    rows: [],
    columns: [],
    headerLabels: [],
    skipped: 0,
    emailColumnIndex: -1,
  };

  const normalized = normalizeTable(table);
  if (normalized.length < 2) {
    return empty;
  }

  const dataRows = normalized.slice(1);
  const headerLabels = finalizeHeaderLabels(normalized[0], dataRows);
  const columns = headerLabels.map((h) => normalizeMergeFieldKey(h));
  const colCount = headerLabels.length;

  const paddedData = dataRows.map((row) => padRow(row, colCount));

  const emailColumnIndex = resolveEmailColumnIndex(headerLabels, paddedData, emailFromCell);
  if (emailColumnIndex < 0) {
    return { ...empty, headerLabels, columns };
  }

  const rows: MailMergeRow[] = [];
  let skipped = 0;

  for (const cells of paddedData) {
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

function cellValueToString(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  if (cell.w != null && String(cell.w).trim() !== "") {
    return stripBom(String(cell.w));
  }
  const v = cell.v;
  if (v == null) return "";
  if (typeof v === "number" && cell.t === "n") {
    if (Number.isInteger(v) && Math.abs(v) >= 1_000_000) {
      return String(Math.trunc(v));
    }
  }
  return stripBom(String(v));
}

function readGridFromSheet(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const table: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(cellValueToString(sheet[XLSX.utils.encode_cell({ r, c })]));
    }
    table.push(row);
  }
  return table;
}

export function readWorkbookTable(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  if (!sheet) return [];

  const fromJson = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  }) as string[][];

  const jsonTable = (fromJson || []).map((row) =>
    (row || []).map((c) => stripBom(String(c ?? "")))
  );

  const gridTable = readGridFromSheet(sheet);

  const jsonCols = detectColumnCount(jsonTable);
  const gridCols = detectColumnCount(gridTable);
  const base = gridCols > jsonCols ? gridTable : jsonTable;

  return normalizeTable(base);
}

export function parseMailMergeWorkbook(buf: Buffer): MailMergeParseResult {
  const table = readWorkbookTable(buf);
  return parseTableRows(table);
}
