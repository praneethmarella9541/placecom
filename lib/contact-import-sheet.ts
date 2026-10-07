import "server-only";

import * as XLSX from "xlsx";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { isValidE164 } from "@/lib/phone";

/** A parsed import file: header labels plus data rows, each with the row number the user sees in their sheet. */
export type ImportSheet = {
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
  /** True when row 1 already held data, so headers are generic "Column N" labels. */
  headerless: boolean;
};

/**
 * Decodes a CSV's bytes. Excel's plain "CSV" save is Windows-1252, not UTF-8,
 * and decoding that as UTF-8 turns every accented name into "�" — so UTF-8 is
 * tried strictly first and anything that isn't valid UTF-8 falls back.
 */
export function decodeCsvBytes(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** Comma, semicolon (European Excel) or tab — whichever splits the first line into the most cells outside quotes. */
function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 CSV → rows. Quoted cells may hold delimiters, doubled quotes and
 * line breaks — a notes column exported from a CRM routinely has all three,
 * which a split-by-line parser tears into broken rows.
 */
export function parseCsvRows(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * A cell's text as the sheet shows it — except long whole numbers, which
 * SheetJS renders in General format as "9.19877E+11": a 12-digit phone number
 * typed into Excel without a leading "+" would otherwise be lost.
 */
function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v == null) return "";
  if (cell.t === "n" && typeof cell.v === "number" && Number.isInteger(cell.v)) {
    if (!cell.w || /e[+-]/i.test(cell.w)) return String(cell.v);
  }
  return String(cell.w ?? cell.v);
}

/**
 * First sheet of a workbook → rows, blank rows kept so row numbers match the
 * sheet. Walks the cells that exist rather than the sheet's declared range:
 * formatting a whole column makes Excel declare a million-row range, and
 * looping over that would stall the request.
 */
export function readWorkbookRows(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : undefined;
  if (!sheet) return [];
  const rows: string[][] = [];
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const text = cellText(sheet[addr] as XLSX.CellObject);
    if (!text) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    while (rows.length <= r) rows.push([]);
    const row = rows[r];
    while (row.length < c) row.push("");
    row[c] = text;
  }
  return rows;
}

function filledCount(row: string[]): number {
  return row.reduce((n, c) => (c ? n + 1 : n), 0);
}

function looksLikeData(cell: string): boolean {
  return isValidEmail(cell) || (/^[+\d\s\-().]+$/.test(cell) && isValidE164(cell)) || /linkedin\.com\//i.test(cell);
}

/** How many leading rows to look through for the header before settling on the first filled one. */
const HEADER_SCAN_ROWS = 10;

/**
 * Raw rows → headers + data. Leading title/notes rows (one filled cell above a
 * wider header — LinkedIn's Connections.csv opens with a "Notes:" paragraph)
 * are dropped, as are blank rows and trailing empty columns. A first row that
 * already holds an email or phone number is treated as data.
 */
export function rowsToSheet(raw: string[][]): ImportSheet {
  const numbered = raw
    .map((row, i) => ({ cells: row.map((c) => c.replace(/^﻿/, "").trim()), number: i + 1 }))
    .filter((r) => filledCount(r.cells) > 0);
  if (numbered.length === 0) return { headers: [], rows: [], rowNumbers: [], headerless: false };

  // reduce, not Math.max(...rows): spreading a 100k-row file overflows the
  // call stack before the row cap gets a chance to refuse it.
  const widest = numbered.reduce((n, r) => Math.max(n, filledCount(r.cells)), 0);
  let start = 0;
  if (widest >= 2) {
    const firstWide = numbered.slice(0, HEADER_SCAN_ROWS).findIndex((r) => filledCount(r.cells) >= 2);
    if (firstWide > 0) start = firstWide;
  }
  const kept = numbered.slice(start);

  // Columns with nothing in them anywhere (a sheet that starts at column C,
  // stray formatting past the last column) aren't worth a mapping row.
  const usedCols: number[] = [];
  const maxLen = kept.reduce((n, r) => Math.max(n, r.cells.length), 0);
  for (let c = 0; c < maxLen; c++) {
    if (kept.some((r) => r.cells[c])) usedCols.push(c);
  }
  const project = (cells: string[]) => usedCols.map((c) => cells[c] ?? "");

  const headerless = kept[0].cells.some(looksLikeData);
  const dataRows = headerless ? kept : kept.slice(1);
  const headers = headerless
    ? usedCols.map((_, i) => `Column ${i + 1}`)
    : project(kept[0].cells).map((h, i) => h || `Column ${i + 1}`);

  return {
    headers,
    rows: dataRows.map((r) => project(r.cells)),
    rowNumbers: dataRows.map((r) => r.number),
    headerless,
  };
}
